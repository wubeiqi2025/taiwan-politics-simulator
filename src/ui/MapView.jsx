// 全屏台湾政治地图：真实乡镇边界、历史县市合成、金马插图、平滑缩放与淡化
import { useEffect, useRef, useMemo, useLayoutEffect } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import { geoMercator, geoPath } from 'd3-geo';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';
import { easeCubicInOut } from 'd3-ease';
import { feature, mesh, merge } from 'topojson-client';
import { GEO, IDX, DB } from '../core/db.js';
import { branch, viewDate, prefs, sel, hover, rev, panels, shotMode } from '../core/store.js';
import { unitOfTown, regionValue, townValue, party, townInfo, unitsAt } from '../core/world.js';
import { countView, countValue } from '../core/countview.js';

export const VB = { w: 1100, h: 1250 };
export const zoomK = signal(1);
let zoomApi = null;
export const mapApi = { zoomToUnit: null, zoomToTown: null, reset: null, svg: null };

// ---------- 静态几何 ----------
// 分组：本岛（含澎湖）、金门（不含乌坵）、乌坵（金门插图内小框）、马祖
const GROUP_OF = p => (p.c === '金門縣' ? (p.n === '烏坵鄉' ? 'wuq' : 'kin') : p.c === '連江縣' ? 'lie' : 'main');
const GROUPS = ['main', 'kin', 'wuq', 'lie'];
const geoms = GEO.objects.towns.geometries;
const features = feature(GEO, GEO.objects.towns).features;
const byGroup = { main: [], kin: [], wuq: [], lie: [] };
features.forEach((f, i) => byGroup[GROUP_OF(f.properties)].push(i));
const INSETS = {
  kin: { x: 40, y: 430, w: 260, h: 200, title: '金門縣' },
  lie: { x: 40, y: 150, w: 260, h: 230, title: '連江縣' },
};
const WUQ = { x: 236, y: 438, w: 56, h: 40 };
const fc = idx => ({ type: 'FeatureCollection', features: idx.map(i => features[i]) });
const fit = (r, g, pad = 14, top = 24) => geoMercator().fitExtent([[r.x + pad, r.y + top], [r.x + r.w - pad, r.y + r.h - 10]], fc(byGroup[g]));
const projMain = geoMercator().fitExtent([[330, 30], [1080, 1220]], fc(byGroup.main));
const gp = p => geoPath(p).digits(2);
const PATHS = { main: gp(projMain), kin: gp(fit({ ...INSETS.kin, w: INSETS.kin.w - 50 }, 'kin')), wuq: gp(fit(WUQ, 'wuq', 8, 12)), lie: gp(fit(INSETS.lie, 'lie')) };
const townGroup = {}; features.forEach(f => { townGroup[f.id] = GROUP_OF(f.properties); });
const TOWN_D = Object.fromEntries(features.map(f => [f.id, PATHS[townGroup[f.id]](f)]));
const TOWN_BOUNDS = Object.fromEntries(features.map(f => [f.id, PATHS[townGroup[f.id]].bounds(f)]));
const TOWN_CENTROID = Object.fromEntries(features.map(f => [f.id, PATHS[townGroup[f.id]].centroid(f)]));
const geomById = Object.fromEntries(geoms.map(g => [g.id, g]));
const groupGeoms = g => ({ type: 'GeometryCollection', geometries: byGroup[g].map(i => geoms[i]) });
const TOWN_MESH = GROUPS.map(g => PATHS[g](mesh(GEO, groupGeoms(g), (a, b) => a !== b))).join('');

export function unitGeometryPath(townCodes) {
  const by = {};
  for (const t of townCodes) (by[townGroup[t]] ||= []).push(geomById[t]);
  return Object.entries(by).map(([g, gs]) => PATHS[g](merge(GEO, gs))).join('');
}
function boundsOf(codes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of codes) { const [[a, b], [c, d]] = TOWN_BOUNDS[t]; x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
  return [[x0, y0], [x1, y1]];
}

// ---------- 随日期变化的县市划分 ----------
const assignCache = new Map();
export function townAssignment(b, d) {
  const key = rev.value + '|' + d + '|' + b?.id;
  if (assignCache.has(key)) return assignCache.get(key);
  const a = {};
  for (const f of features) a[f.id] = unitOfTown(b, f.id, d);
  const units = {};
  for (const [t, u] of Object.entries(a)) (units[u] ||= []).push(t);
  const countyMesh = GROUPS.map(g => PATHS[g](mesh(GEO, groupGeoms(g), (x, y) => x === y || a[x.id] !== a[y.id]))).join('');
  const res = { a, units, countyMesh, centroids: {} };
  for (const [u, ts] of Object.entries(units)) {
    // 以面积最大乡镇群的质心作为标注点
    const main = ts.filter(t => townGroup[t] !== 'wuq');
    const g = townGroup[main[0] || ts[0]];
    const m = merge(GEO, (main.length ? main : ts).map(t => geomById[t]));
    res.centroids[u] = PATHS[g].centroid(m);
    res[u + ':path'] = null;
  }
  if (assignCache.size > 30) assignCache.clear();
  assignCache.set(key, res);
  return res;
}
const outlineCache = new Map();
function unitOutline(ts) {
  const k = ts.join(',');
  if (!outlineCache.has(k)) outlineCache.set(k, unitGeometryPath(ts));
  return outlineCache.get(k);
}

// ---------- 着色 ----------
const NEUTRAL = '#d5dae1';
export function fillFor(b, v) {
  if (!v) return NEUTRAL;
  if (v.kind === 'party') return v.hatch ? `url(#mp-${v.party})` : party(b, v.party).color;
  if (v.kind === 'tie') return v.parties?.length >= 2 ? `url(#tie-${v.parties.slice(0, 2).join('-')})` : 'url(#hatch-missing)';
  if (v.kind === 'missing') return 'url(#hatch-missing)';
  if (v.kind === 'none') return 'url(#dots-none)';
  if (v.kind === 'special') return '#b9b2a6';
  return '#cfd5dc';
}
export const mapValues = computed(() => {
  const b = branch.value, d = viewDate.value, p = prefs.value;
  rev.value; countView.value;
  if (!b) return {};
  const A = townAssignment(b, d);
  const mode = p.mapMode;
  const opts = { lyOpt: p.lyOpt, countValue: (u, t) => countValue(b, d, u, t) };
  const s = sel.value;
  const unitVals = {};
  const out = {};
  const townLevel = mode === 'ly' || mode === 'count';
  for (const [t, u] of Object.entries(A.a)) {
    let v;
    if (s.unit === u) v = townValue(b, d, mode, u, t, opts, unitVals[u] ||= regionValue(b, d, mode, u, null, opts));
    else if (townLevel && mode === 'count') v = regionValue(b, d, mode, u, t, opts);
    else if (townLevel && mode === 'ly') v = regionValue(b, d, mode, u, t, opts);
    else v = unitVals[u] ||= regionValue(b, d, mode, u, null, opts);
    out[t] = v;
  }
  return { vals: out, A };
});

// ---------- 组件 ----------
export function MapView() {
  const svgRef = useRef(), gRef = useRef();
  const b = branch.value, d = viewDate.value;
  const { vals, A } = mapValues.value;
  const s = sel.value;
  const mode = prefs.value.mapMode;

  useEffect(() => {
    const svg = select(svgRef.current);
    const z = d3zoom().scaleExtent([0.6, 80]).on('start', () => svgRef.current.classList.add('zooming')).on('zoom', e => {
      gRef.current.setAttribute('transform', e.transform.toString());
      // 斜线与点纹理保持固定的屏幕密度
      applyPatternScale(svgRef.current, e.transform.k);
    }).on('end', e => { zoomK.value = e.transform.k; svgRef.current.classList.remove('zooming'); window.dispatchEvent(new Event('map-zoom-end')); });
    svg.call(z).on('dblclick.zoom', null);
    zoomApi = { svg, z };
    mapApi.svg = svgRef.current;
    mapApi.reset = (instant) => zoomToBounds([[0, 0], [VB.w, VB.h]], instant, 1);
    mapApi.zoomToUnit = (ts) => zoomToBounds(boundsOf(ts));
    mapApi.zoomToTown = (t) => zoomToBounds(TOWN_BOUNDS[t], false, 0.55);
    return () => svg.on('.zoom', null);
  }, []);

  // 选中变化时自动缩放；窗口尺寸改变时重新对焦
  const refocus = (instant) => {
    const cur = sel.value;
    const units = townAssignment(branch.value, viewDate.value).units;
    if (cur.town) zoomToBounds(TOWN_BOUNDS[cur.town], instant, 0.55);
    else if (cur.unit && units[cur.unit]) zoomToBounds(boundsOf(units[cur.unit]), instant);
    else zoomToBounds([[0, 0], [VB.w, VB.h]], instant, 1);
  };
  useEffect(() => { refocus(false); }, [s.unit, s.town]);
  useEffect(() => {
    let t;
    const onR = () => { clearTimeout(t); t = setTimeout(() => refocus(true), 120); };
    window.addEventListener('resize', onR);
    const ro = new ResizeObserver(onR); ro.observe(svgRef.current);
    return () => { window.removeEventListener('resize', onR); ro.disconnect(); };
  }, []);

  const onTownClick = (t, e) => {
    e.stopPropagation();
    const u = A.a[t];
    if (s.unit === u) sel.value = { unit: u, town: s.town === t ? null : t };
    else sel.value = { unit: u, town: null };
  };
  const onMove = (t, e) => { hover.value = { t, u: A.a[t], x: e.clientX, y: e.clientY }; };
  useLayoutEffect(() => applyPatternScale(svgRef.current, zoomK.peek()));
  const selTowns = s.unit ? A.units[s.unit] || [] : null;
  const ties = new Set(), hatchP = new Set();
  for (const v of Object.values(vals)) if (v?.hatch) hatchP.add(v.party);
  for (const v of Object.values(vals)) if (v?.kind === 'tie' && v.parties?.length >= 2) ties.add(v.parties.slice(0, 2).join('-'));
  const updated = countView.value?.updated;

  return (
    <div class="map-root" onClick={() => { if (s.town) sel.value = { unit: s.unit, town: null }; else if (s.unit) sel.value = { unit: null, town: null }; }}>
      <svg ref={svgRef} viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet" onPointerLeave={() => (hover.value = null)}>
        <defs>
          <pattern id="hatch-missing" data-base="rotate(45)" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="#e3e6eb" /><line x1="0" y1="0" x2="0" y2="9" stroke="#b9bfc8" stroke-width="2.6" /></pattern>
          <pattern id="dots-none" data-base="" width="7" height="7" patternUnits="userSpaceOnUse" ><rect width="7" height="7" fill="#eef0f3" /><circle cx="3.5" cy="3.5" r="1.1" fill="#c3c8d0" /></pattern>
          {[...ties].map(k2 => { const [p1, p2] = k2.split('-'); return <pattern id={`tie-${k2}`} data-base="rotate(45)" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill={party(b, p1).color} /><rect x="4" width="4" height="8" fill={party(b, p2).color} /></pattern>; })}
          {[...hatchP].map(pp => <pattern id={`mp-${pp}`} data-base="rotate(45)" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill={party(b, pp).color} /><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,.55)" stroke-width="2.2" /></pattern>)}
          <filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.6" flood-color="#1c2533" flood-opacity="0.18" /></filter>
        </defs>
        <g ref={gRef}>
          {Object.entries(INSETS).map(([g, r]) => (
            <g opacity={selTowns && !selTowns.some(t => townGroup[t] === g) ? 0.35 : 1} style={{ transition: 'opacity .5s' }}>
              <rect class="inset-frame" x={r.x} y={r.y} width={r.w} height={r.h} rx="14" />
              {g === 'kin' && <><rect class="inset-frame" x={WUQ.x} y={WUQ.y} width={WUQ.w} height={WUQ.h} rx="6" /><InsetTitle x={WUQ.x + 4} y={WUQ.y + 9} size={8}>乌坵</InsetTitle></>}
              <InsetTitle x={r.x + 12} y={r.y + 16} size={11}>{g === 'kin' ? '金门（插图，比例放大）' : '马祖（插图，比例放大）'}</InsetTitle>
            </g>
          ))}
          <g class="land">
            {features.map(f => {
              const t = f.id;
              const v = vals[t];
              const inSel = !selTowns || selTowns.includes(t);
              const fill = inSel ? fillFor(b, v) : '#dfe3e8';
              const alpha = inSel ? (v?.alpha ?? 1) : 0.55;
              const isSelTown = s.town === t;
              return <path key={t} class={`town ${updated && v?.updated ? 'flash' : ''}`} d={TOWN_D[t]} style={{ fill, opacity: s.town && !isSelTown && inSel ? 0.55 : alpha }}
                onClick={e => onTownClick(t, e)} onPointerMove={e => onMove(t, e)} onDblClick={e => { e.stopPropagation(); sel.value = { unit: A.a[t], town: t }; }} />;
            })}
          </g>
          <TownMesh unit={s.unit} />
          <path class="county-mesh" d={A.countyMesh} style={{ opacity: s.unit ? 0.35 : 1 }} />
          {selTowns && <path class="sel-outline" d={unitOutline(selTowns)} />}
          {s.town && <path class="sel-outline town-sel" d={TOWN_D[s.town]} />}
          <HoverOutline A={A} />
          <Labels A={A} />
        </g>
      </svg>
    </div>
  );
}
function HoverOutline({ A }) {
  const h = hover.value;
  if (!h) return null;
  const s = sel.value;
  if (s.unit && A.a[h.t] === s.unit) return <path class="hov-outline" d={TOWN_D[h.t]} />;
  const ts = A.units[h.u];
  return ts ? <path class="hov-outline" d={unitOutline(ts)} /> : null;
}
function TownMesh({ unit }) {
  const k = zoomK.value;
  return <path class="town-mesh" d={TOWN_MESH} style={{ opacity: unit ? 0.9 : k > 2.2 ? 0.5 : 0.18 }} />;
}
function InsetTitle({ x, y, size, children }) {
  const k = zoomK.value;
  return <text class="inset-title" x={x} y={y} style={{ fontSize: Math.max(size * 0.36, size / Math.max(1, k * 0.8)) + 'px' }}>{children}</text>;
}
function applyPatternScale(svg, k) {
  if (!svg) return;
  for (const p of svg.querySelectorAll('pattern[data-base]')) p.setAttribute('patternTransform', p.dataset.base + ' scale(' + (1 / k).toFixed(4) + ')');
}
function Labels({ A }) {
  const k = zoomK.value;
  const s = sel.value, d = viewDate.value, b = branch.value;
  if (shotMode.value && !prefs.value.shotLabels && prefs.value.shotLabels !== undefined) return null;
  if (s.unit) {
    const ts = A.units[s.unit] || [];
    const fs = Math.max(1.2, 12 / k);
    return <g>{ts.map(t => { const [x, y] = TOWN_CENTROID[t]; const ti = townInfo(t, d); return <text class="map-label" x={x} y={y} style={{ fontSize: fs + 'px', strokeWidth: fs / 4 + 'px', fontWeight: s.town === t ? 750 : 550 }}>{ti.name}</text>; })}</g>;
  }
  const fs = Math.max(2, 12.5 / k);
  return <g>{Object.entries(A.centroids).map(([u, [x, y]]) => <text class="map-label" x={x} y={y} style={{ fontSize: fs + 'px', strokeWidth: fs / 4 + 'px' }}>{IDX.unit[u]?.name}</text>)}</g>;
}

function zoomToBounds([[x0, y0], [x1, y1]], instant, fill = 0.78) {
  if (!zoomApi) return;
  const { svg, z } = zoomApi;
  const dx = x1 - x0, dy = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const el = svg.node();
  const rect = el.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 50) return;
  // 视窗中可见的 viewBox 区域（meet 缩放）
  const sc = Math.min(rect.width / VB.w, rect.height / VB.h);
  const visW = rect.width / sc, visH = rect.height / sc;
  // 右侧议会面板与左侧入口坞占用的区域：把焦点中心略向左移
  const narrow = rect.width < 760;
  const rightPad = !narrow && panels.value.parliament ? Math.min(380, rect.width * 0.3) / sc : 0;
  const leftPad = (narrow ? 0 : 70 + (sel.value.unit ? Math.min(390, rect.width * 0.3) : 0)) / sc;
  const availW = visW - rightPad - leftPad, availH = visH - 150 / sc;
  const k = Math.max(0.6, Math.min(80, fill / Math.max(dx / availW, dy / availH)));
  const offX = (leftPad - rightPad) / 2;
  const t = zoomIdentity.translate(VB.w / 2 + offX, VB.h / 2 + 10 / sc).scale(k).translate(-cx, -cy);
  const motion = prefs.value.motion;
  if (instant || motion === 'off') svg.call(z.transform, t);
  else svg.transition().duration(motion === 'reduced' ? 250 : 820).ease(easeCubicInOut).call(z.transform, t);
}
export { TOWN_D, TOWN_CENTROID, TOWN_BOUNDS, features, townGroup, INSETS, boundsOf };
