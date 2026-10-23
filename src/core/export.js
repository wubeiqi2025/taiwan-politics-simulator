// 截图合成：以矢量 SVG 组合地图、玻璃面板、席位图与文字，再栅格化为高清 PNG
import { IDX, DB, instName } from './db.js';
import { regionValue, townValue, party, pname, seatsAt, officeAt, execAt, townInfo, sortedComp, person, electionResult, latestElection, unitAgg, unitsAt, unitInfo, instExists, personPartyAt, chairAt, allParties, partyExists } from './world.js';
import { seatLayout } from './seatlayout.js';
import { TOWN_D, TOWN_BOUNDS, townAssignment, fillFor, features, townGroup, INSETS, boundsOf, unitGeometryPath } from '../ui/MapView.jsx';
import { fmtDate } from './dates.js';
import { orderMembers } from '../ui/SeatChart.jsx';
import { countValue } from './countview.js';

const FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const T = (x, y, s, size = 14, opt = {}) => `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${size}" font-weight="${opt.w || 500}" fill="${PRINT ? (opt.c ? '#333' : '#000') : opt.c || '#1d1d1f'}" text-anchor="${opt.a || 'start'}"${opt.ls ? ` letter-spacing="${opt.ls}"` : ''}>${esc(s)}</text>`;

export const ASPECTS = { '16:9': [1920, 1080], '4:3': [1600, 1200], '9:16': [1080, 1920], window: null };

let patK = 1; // 地图放大倍数：纹理按此缩小以维持密度
// 打印版：白底、黑字、黑线分割，无阴影与玻璃；政党颜色保持彩色
let PRINT = false;
const col = (b, p) => party(b, p).color;
function defs(b, vals) {
  const ties = new Set();
  for (const v of Object.values(vals)) if (v?.kind === 'tie' && v.parties?.length >= 2) ties.add(v.parties.slice(0, 2).join('-'));
  const hp = new Set(Object.values(vals).filter(v => v?.hatch).map(v => v.party));
  return [...hp].map(p => `<pattern id="mp-${p}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45) scale(${(1 / patK).toFixed(4)})"><rect width="8" height="8" fill="${party(b, p).color}"/><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,.55)" stroke-width="2.2"/></pattern>`).join('') + `<pattern id="hatch-missing" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45) scale(${(1 / patK).toFixed(4)})"><rect width="6" height="6" fill="#e3e6eb"/><line x1="0" y1="0" x2="0" y2="6" stroke="#b6bcc6" stroke-width="2"/></pattern>
<pattern id="dots-none" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="scale(${(1 / patK).toFixed(4)})"><rect width="5" height="5" fill="#eef0f3"/><circle cx="2.5" cy="2.5" r="0.7" fill="#c3c8d0"/></pattern>
${[...ties].map(k => { const [p1, p2] = k.split('-'); return `<pattern id="tie-${k}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="${party(b, p1).color}"/><rect x="4" width="4" height="8" fill="${party(b, p2).color}"/></pattern>`; }).join('')}
<filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#1e283c" flood-opacity="0.16"/></filter>
<filter id="landshadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#1c2533" flood-opacity="0.2"/></filter>
<radialGradient id="sea" cx="60%" cy="40%" r="90%"><stop offset="0" stop-color="#f3f6f9"/><stop offset="0.55" stop-color="#e9edf2"/><stop offset="1" stop-color="#dfe5ec"/></radialGradient>`;
}

// 地图图层：在 rect 内放置（region 指定县市时放大该县市）
function mapLayer(b, d, mode, opts, rect, unit) {
  const A = townAssignment(b, d);
  const vals = {};
  const townLevel = mode === 'ly' || mode === 'count';
  const cache = {};
  for (const [t, u] of Object.entries(A.a)) {
    if (unit && u === unit) vals[t] = townValue(b, d, mode, u, t, opts, cache[u] ||= regionValue(b, d, mode, u, null, opts));
    else if (!unit && townLevel) vals[t] = regionValue(b, d, mode, u, t, opts);
    else if (!unit) vals[t] = cache[u] ||= regionValue(b, d, mode, u, null, opts);
  }
  let bounds = unit ? boundsOf(A.units[unit]) : [[30, 120], [1080, 1230]];
  const [[x0, y0], [x1, y1]] = bounds;
  const k = Math.min(rect.w / (x1 - x0), rect.h / (y1 - y0)) * (unit ? 0.9 : 0.98);
  const tx = rect.x + rect.w / 2 - k * (x0 + x1) / 2, ty = rect.y + rect.h / 2 - k * (y0 + y1) / 2;
  const sw = 1 / k;
  patK = k;
  let paths = '';
  for (const f of features) {
    const t = f.id;
    const inSel = !unit || A.a[t] === unit;
    // 县市截图只画本县市，不画其他县市与其边界
    if (unit && !inSel) continue;
    const v = vals[t];
    paths += `<path d="${TOWN_D[t]}" fill="${fillFor(b, v)}" opacity="${v?.alpha ?? 1}" stroke="rgba(255,255,255,${unit ? 0.95 : 0.5})" stroke-width="${(unit ? 0.9 : 0.35) * sw}"/>`;
  }
  let insets = '';
  if (!unit) for (const [g, r] of Object.entries(INSETS)) insets += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="14" fill="rgba(255,255,255,0.35)" stroke="rgba(60,60,67,0.25)" stroke-width="${0.8 * sw}" stroke-dasharray="${3 * sw} ${3 * sw}"/>` + T(r.x + 12, r.y + 18, g === 'kin' ? '金门（插图）' : '马祖（插图）', 11, { c: '#86868b', w: 600 });
  let labels = '';
  const fs = (unit ? 13 : 12.5) / k * (unit ? 1 : Math.max(1, rect.w / 900));
  if (unit) for (const t of A.units[unit]) { const [[a, c], [e, f2]] = TOWN_BOUNDS[t]; labels += `<text x="${(a + e) / 2}" y="${(c + f2) / 2}" font-family='${FONT}' font-size="${fs}" font-weight="600" fill="#1d1d1f" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" stroke="rgba(255,255,255,.88)" stroke-width="${fs / 4}">${esc(townInfo(t, d).name)}</text>`; }
  else for (const [u, [x, y]] of Object.entries(A.centroids)) labels += `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${fs}" font-weight="650" fill="#1d1d1f" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" stroke="rgba(255,255,255,.88)" stroke-width="${fs / 4}">${esc(IDX.unit[u].name)}</text>`;
  // 县市截图：只描本县市外框；全台图：县市界线
  const mesh = unit
    ? `<path d="${unitGeometryPath(A.units[unit])}" fill="none" stroke="${PRINT ? '#000' : '#1d1d1f'}" stroke-width="${1.6 * sw}" stroke-linejoin="round"/>`
    : `<path d="${A.countyMesh}" fill="none" stroke="${PRINT ? '#000' : '#fff'}" stroke-width="${1.6 * sw}" stroke-linejoin="round"/>`;
  return { svg: `<g transform="translate(${tx},${ty}) scale(${k})">${insets}<g${PRINT ? '' : ' filter="url(#landshadow)"'}>${paths}</g>${mesh}${labels}</g>`, vals };
}
// 玻璃面板：背后地图模糊 + 轻度白色磨砂 + 边缘高光
function glass(id, x, y, w, h, r = 22) {
  if (PRINT) return '';
  return `<g filter="url(#shadow)"><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
<g clip-path="url(#${id})"><use href="#bgmap" filter="url(#blur)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(250,251,253,0.74)"/></g></g>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.2"/>
<rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="${r - 1}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`;
}
function seatSvg(b, seats, x, y, w) {
  const members = orderMembers(b, seats.members);
  const L = seatLayout(members.length, w);
  let s = '';
  L.pts.forEach((pt, i) => {
    const m = members[i]; if (!m) return;
    const col = m.vacant ? 'none' : m.status === 'pending' ? '#d5d9df' : party(b, m.party).color;
    const proj = m.status === 'projected';
    s += `<circle cx="${x + pt.x}" cy="${y + pt.y}" r="${L.r}" fill="${proj ? '#fff' : col}" stroke="${m.vacant ? '#9aa0a6' : proj ? party(b, m.party).color : 'rgba(255,255,255,.75)'}" stroke-width="${m.vacant ? 1 : proj ? Math.max(1, L.r * 0.45) : 0.6}"/>`;
  });
  s += T(x + w / 2, y + L.H - L.r - 8, seats.total, Math.max(18, w / 13), { w: 700, a: 'middle' });
  s += T(x + w / 2, y + L.H - L.r + 10, '总席位' + (seats.vacant ? ` · 空缺${seats.vacant}` : ''), 11, { c: '#86868b', a: 'middle' });
  return { svg: s, h: L.H };
}
function compRows(b, comp, total, x, y, w, max = 8) {
  let s = '';
  const rows = sortedComp(b, comp).slice(0, max);
  // 比例条
  let cx = x;
  for (const [p, n] of sortedComp(b, comp)) { const ww = n / total * w; s += `<rect x="${cx}" y="${y}" width="${Math.max(0, ww - 1)}" height="9" rx="2" fill="${col(b, p)}"${PRINT ? ' stroke="#000" stroke-width="0.6"' : ''}/>`; cx += ww; }
  s += `<line x1="${x + w / 2}" x2="${x + w / 2}" y1="${y - 3}" y2="${y + 12}" stroke="#1d1d1f" stroke-width="1.5" opacity=".55"/>`;
  y += 28;
  for (const [p, n] of rows) {
    s += `<rect x="${x}" y="${y - 10}" width="12" height="12" rx="3.5" fill="${col(b, p)}"${PRINT ? ' stroke="#000" stroke-width="0.8"' : ''}/>` + T(x + 20, y, party(b, p).name, 14) + T(x + w - 52, y, n, 15, { w: 700, a: 'end' }) + T(x + w, y, (n / total * 100).toFixed(1) + '%', 12, { c: '#86868b', a: 'end' });
    y += 24;
  }
  s += T(x, y + 2, `过半门槛 ${Math.floor(total / 2) + 1} 席`, 11.5, { c: '#86868b' });
  return { svg: s, h: y + 10 };
}
function legendSvg(b, vals, x, y, bottomAnchor) {
  const counts = {};
  let miss = 0, none = 0;
  for (const v of Object.values(vals)) { if (v?.kind === 'party') counts[v.party] = 1; if (v?.kind === 'missing') miss = 1; if (v?.kind === 'none') none = 1; }
  const ps = Object.keys(counts).sort((a, c) => (party(b, a).order ?? 50) - (party(b, c).order ?? 50));
  const items = [...ps.map(p => [col(b, p), party(b, p).name]), ...(miss ? [['url(#hatch-missing)', '资料待补']] : []), ...(none ? [['url(#dots-none)', '无该类选举']] : [])];
  const h = 22 + items.length * 20;
  if (bottomAnchor) y = y - h;
  let s = PRINT ? `<rect x="${x}" y="${y}" width="190" height="${h}" fill="#fff" stroke="#000" stroke-width="1"/>` : glass('lg', x, y, 190, h, 16);
  items.forEach(([c, n], i) => { s += `<rect x="${x + 14}" y="${y + 14 + i * 20}" width="12" height="12" rx="3.5" fill="${c}"${PRINT ? ' stroke="#000" stroke-width="0.8"' : ''}/>` + T(x + 34, y + 24 + i * 20, n, 12.5); });
  return s;
}
function header(b, d, o, W, title, sub) {
  const sim = b.kind === 'sim' || o.demo;
  let s = glass('hd', 24, 22, W - 48, 70, 20);
  s += T(48, 64, title, 26, { w: 750, ls: 0.5 });
  let x = 48 + title.length * 27 + 18;
  if (o.date) { s += T(x, 63, fmtDate(d, { roc: o.roc }), 20, { w: 650 }); x += 170; }
  if (sub) { s += T(x, 63, sub, 16, { c: '#48484d' }); }
  // 状态标记（架空必显示）
  const badge = o.demo ? ['推演开票', '#9a5800', 'rgba(255,159,10,0.18)'] : sim ? ['架空模拟', '#7a2fa8', 'rgba(175,82,222,0.16)'] : ['真实历史', '#1e7a3c', 'rgba(48,177,88,0.16)'];
  if (o.badge || sim) { s += `<rect x="${W - 190}" y="40" width="${o.season ? 0 : 0}" height="0"/><rect x="${W - 176}" y="41" width="128" height="32" rx="${PRINT ? 0 : 16}" fill="${PRINT ? '#fff' : badge[2]}"${PRINT ? ' stroke="#000" stroke-width="1.2"' : ''}/>` + T(W - 112, 63, badge[0], 15, { w: 700, c: badge[1], a: 'middle' }); }
  if (o.season) s += T(W - 196, 63, o.seasonName || '', 14, { c: '#48484d', a: 'end' });
  return s;
}
function footer(b, o, W, H, extra) {
  let s = '';
  const parts = [];
  if (o.source) parts.push('资料来源：中选会选举资料库、立法院资料开放平台' + (b.kind === 'sim' ? '；架空分支含管理员修改与系统推算' : ''));
  if (o.version) parts.push(`分支：${b.name}`);
  if (extra) parts.push(extra);
  if (parts.length) s += T(36, H - 22, parts.join('　·　'), 12.5, { c: '#6e6e73' });
  return s;
}

export function composeSVG(preset, b, d, o) {
  PRINT = !!o.print;
  if ((preset === 'region' && o.unitIds) || (preset === 'seats' && o.instIds) || preset === 'people') return composeCollectionSVG(preset, b, d, o);
  let [W, H] = o.size;
  const portrait = H > W;
  const mode = o.mapMode;
  const opts = { lyOpt: o.lyOpt, countValue: (u, t) => countValue(b, d, u, t) };
  let body = '', bg = '', vals = {};
  let split = null; // 打印版：地图与资料栏之间的分割线位置
  const top = 110, bottom = o.source || o.version ? 46 : 20;
  if (preset === 'mapLY' || preset === 'map') {
    const panelW = preset === 'map' ? 0 : portrait ? W - 48 : Math.min(560, W * 0.36);
    const panelH = preset === 'map' ? 0 : portrait ? Math.min(760, H * 0.42) : H - top - bottom - 10;
    const mapRect = portrait ? { x: 24, y: top, w: W - 48, h: H - top - panelH - bottom - 24 } : { x: 24, y: top, w: W - panelW - 72, h: H - top - bottom };
    const m = mapLayer(b, d, mode, opts, mapRect, null);
    bg = m.svg; vals = m.vals;
    if (preset === 'mapLY') {
      const px = portrait ? 24 : W - panelW - 24, py = portrait ? H - panelH - bottom - 6 : top;
      split = portrait ? { y: py - 8 } : { x: px - 14 };
      body += glass('pl', px, py, panelW, panelH);
      const seats = seatsAt(b, o.inst || 'LY', d);
      body += T(px + 26, py + 42, o.instName || '立法院', 22, { w: 700 }) + T(px + panelW - 26, py + 42, seats?.label || '', 14, { c: '#86868b', a: 'end' });
      if (seats && !seats.missing) {
        const sw = Math.min(panelW - 52, portrait ? 420 : panelW - 52);
        const sc = seatSvg(b, seats, px + (panelW - sw) / 2, py + 60, sw);
        body += sc.svg;
        const cr = compRows(b, seats.comp, seats.total, px + 26, py + 76 + sc.h, panelW - 52, portrait ? 5 : 8);
        body += cr.svg;
        if (!portrait) {
          let yy = cr.h + 18;
          const rows = [['总统', 'president'], ['行政院长', 'premier'], ['立法院长', 'speaker']];
          for (const [lab, k] of rows) { const of = officeAt(b, k, d); if (!of) continue; body += T(px + 26, yy, lab, 13, { c: '#86868b' }) + `<circle cx="${px + 112}" cy="${yy - 4.5}" r="4.5" fill="${col(b, of.party)}"${PRINT ? ' stroke="#000" stroke-width="0.8"' : ''}/>` + T(px + 122, yy, of.p ? pname(b, of.p) : of.name || '—', 15, { w: 600 }); yy += 24; }
        }
      } else body += T(px + 26, py + 90, '该时期席次资料待补', 15, { c: '#86868b' });
    }
    if (o.legend) body += legendSvg(b, vals, portrait ? 36 : 40, portrait ? top + 10 : H - bottom - 10, !portrait);
  } else if (preset === 'region') {
    const u = o.unit;
    const panelW = portrait ? W - 48 : Math.min(620, W * 0.42);
    const mapRect = portrait ? { x: 24, y: top, w: W - 48, h: H * 0.42 } : { x: 24, y: top, w: W - panelW - 72, h: H - top - bottom };
    const m = mapLayer(b, d, mode, opts, mapRect, u);
    bg = m.svg; vals = m.vals;
    const px = portrait ? 24 : W - panelW - 24, py = portrait ? top + H * 0.42 + 16 : top, ph = portrait ? H - py - bottom - 6 : H - top - bottom;
    split = portrait ? { y: py - 8 } : { x: px - 14 };
    body += glass('rg', px, py, panelW, ph);
    const info = IDX.unit[u];
    body += T(px + 26, py + 44, info.name, 26, { w: 750 }) + T(px + 26 + info.name.length * 27 + 12, py + 43, info.type + (info.prov ? ' · ' + info.prov : ''), 14, { c: '#86868b' });
    const e = execAt(b, u, d);
    let yy = py + 82;
    body += T(px + 26, yy, info.type === '縣' ? '县长' : '市长', 13, { c: '#86868b' });
    if (e) body += `<circle cx="${px + 72}" cy="${yy - 5}" r="6" fill="${col(b, e.party)}"${PRINT ? ' stroke="#000" stroke-width="0.8"' : ''}/>` + T(px + 84, yy + 1, (e.p ? pname(b, e.p) : e.name || '资料待补') + '　' + party(b, e.party).name + (e.how && e.how !== '民选' ? `（${e.how}）` : ''), 18, { w: 650 });
    yy += 30;
    const council = seatsAt(b, 'C:' + u, d);
    body += T(px + 26, yy, info.name + '議會' + (council?.label ? ' ' + council.label : ''), 15, { w: 650 });
    yy += 8;
    if (council && !council.missing) {
      const sw = Math.min(panelW - 52, 300);
      const sc = seatSvg(b, council, px + 26, yy, sw);
      body += sc.svg;
      const cr = compRows(b, council.comp, council.total, px + 26 + sw + 18, yy + 8, panelW - 52 - sw - 18, 6);
      body += cr.svg.replace(/font-size="14"/g, 'font-size="12.5"');
      yy += Math.max(sc.h, 160) + 10;
    } else { body += T(px + 26, yy + 26, '议会资料待补', 13, { c: '#86868b' }); yy += 46; }
    const mel = latestElection(b, d, x => x.type === 'mayor' && electionResult(b, x.id)?.races?.[u]);
    if (mel) {
      const r = electionResult(b, mel.id).races[u];
      const tot = r.valid || r.cands.reduce((a, c) => a + (c.votes || 0), 0);
      body += T(px + 26, yy + 8, mel.name, 14, { w: 650 }); yy += 24;
      for (const c of r.cands.slice().sort((a, c2) => (c2.votes || 0) - (a.votes || 0)).slice(0, portrait ? 3 : 4)) {
        const pct = tot && c.votes != null ? c.votes / tot * 100 : 0;
        body += T(px + 26, yy + 10, c.name, 13.5, { w: c.win ? 700 : 500 }) + T(px + panelW - 26, yy + 10, c.votes != null ? pct.toFixed(2) + '%' : '—', 13.5, { w: 650, a: 'end' });
        body += `<rect x="${px + 26}" y="${yy + 16}" width="${panelW - 52}" height="7" rx="3.5" fill="${PRINT ? '#fff' : 'rgba(118,118,128,0.14)'}"${PRINT ? ' stroke="#000" stroke-width="0.6"' : ''}/><rect x="${px + 26}" y="${yy + 16}" width="${(panelW - 52) * pct / 100}" height="7" rx="3.5" fill="${col(b, c.party)}"/>`;
        yy += 34;
      }
    }
    // 本地区域立委（最近一届，按剩余空间排列）
    const lel = latestElection(b, d, x => x.type === 'ly' && !x.summary);
    if (lel) {
      const res = electionResult(b, lel.id);
      const ts = townAssignment(b, d).units[u] || [];
      const winners = res.districts.filter(x => x.u === u || x.towns?.some(t => ts.includes(t))).flatMap(x => x.cands.filter(c => c.win).map(c => ({ ...c, dn: x.name })));
      const room = Math.floor((py + ph - 30 - (yy + 40)) / 24);
      if (winners.length && room > 1) {
        body += T(px + 26, yy + 14, `本地区域立委（${lel.name.replace(/選舉|选举/, '')}）`, 14, { w: 650 }); yy += 34;
        const cols = winners.length > room ? 2 : 1, cw = (panelW - 52) / cols;
        winners.slice(0, room * cols).forEach((c, i) => {
          const cx = px + 26 + Math.floor(i / room) * cw, cy = yy + (i % room) * 24;
          body += `<circle cx="${cx + 5}" cy="${cy - 4.5}" r="5" fill="${col(b, c.party)}"${PRINT ? ' stroke="#000" stroke-width="0.8"' : ''}/>` + T(cx + 16, cy, c.name, 13.5, { w: 600 }) + T(cx + cw - 10, cy, c.dn.replace(/^.*?(第\d+選區|第\d+选区)$/, '$1'), 11.5, { c: '#86868b', a: 'end' });
        });
      }
    }
    if (o.legend) body += legendSvg(b, vals, 40, portrait ? top + 10 : H - bottom - 10, !portrait);
  } else if (preset === 'seats') {
    const seats = seatsAt(b, o.inst || 'LY', d);
    bg = `<rect x="0" y="0" width="${W}" height="${H}" fill="${PRINT ? '#fff' : 'url(#sea)'}"/>`;
    body += glass('st', 40, top, W - 80, H - top - bottom - 10);
    body += T(W / 2, top + 50, (o.instName || '立法院') + ' ' + (seats?.label || ''), 26, { w: 700, a: 'middle' });
    if (seats && !seats.missing) {
      const sw = Math.min(W - 200, (H - top - bottom - 180) * 1.8, 900);
      const sc = seatSvg(b, seats, (W - sw) / 2, top + 80, sw);
      body += sc.svg;
      const cw = Math.min(W - 160, 700);
      body += compRows(b, seats.comp, seats.total, (W - cw) / 2, top + 100 + sc.h, cw, portrait ? 10 : 6).svg;
    }
  } else if (preset === 'person') {
    bg = `<rect x="0" y="0" width="${W}" height="${H}" fill="${PRINT ? '#fff' : 'url(#sea)'}"/>`;
    const pr = person(b, o.pid);
    body += glass('pc', W * 0.15, top, W * 0.7, H - top - bottom - 10);
    body += T(W * 0.15 + 40, top + 60, pr?.n || '', 34, { w: 750 });
    let yy = top + 100;
    for (const r of (o.roles || []).slice(-14)) { body += `<circle cx="${W * 0.15 + 46}" cy="${yy - 5}" r="5" fill="${col(b, r.party)}"${PRINT ? ' stroke="#000" stroke-width="0.8"' : ''}/>` + T(W * 0.15 + 62, yy, r.label, 16, { w: 600 }) + T(W * 0.85 - 40, yy, `${r.from || ''} — ${r.to || ''}`, 13, { c: '#86868b', a: 'end' }); yy += 30; }
  } else if (preset === 'election') {
    bg = `<rect x="0" y="0" width="${W}" height="${H}" fill="${PRINT ? '#fff' : 'url(#sea)'}"/>`;
    const mr = portrait ? { x: 24, y: top, w: W - 48, h: H * 0.45 } : { x: 24, y: top, w: W * 0.48, h: H - top - bottom };
    const m = mapLayer(b, d, o.counting ? 'count' : mode, opts, mr, null);
    bg += m.svg; vals = m.vals;
    const px = portrait ? 24 : W * 0.5 + 10, py = portrait ? top + H * 0.45 + 12 : top, pw = portrait ? W - 48 : W * 0.5 - 34, ph = portrait ? H - py - bottom - 6 : H - top - bottom;
    split = portrait ? { y: py - 8 } : { x: px - 14 };
    body += glass('el', px, py, pw, ph);
    body += T(px + 26, py + 44, o.electionName || '选举', 22, { w: 700 });
    if (o.progress != null) body += T(px + pw - 26, py + 44, `已开票 ${o.progress.toFixed(o.progress % 1 ? 1 : 0)}%`, 18, { w: 700, a: 'end', c: '#0a84ff' });
    let yy = py + 84;
    for (const r of (o.rows || []).slice(0, 8)) {
      body += `<circle cx="${px + 32}" cy="${yy - 5}" r="6" fill="${r.color}"/>` + T(px + 46, yy, r.name, 16, { w: 650 }) + T(px + pw - 26, yy, r.pct.toFixed(2) + '%', 17, { w: 700, a: 'end' }) + T(px + pw - 120, yy, r.extra || '', 12.5, { c: '#86868b', a: 'end' });
      body += `<rect x="${px + 26}" y="${yy + 9}" width="${pw - 52}" height="8" rx="4" fill="rgba(118,118,128,0.14)"/><rect x="${px + 26}" y="${yy + 9}" width="${(pw - 52) * Math.min(1, r.pct / 100)}" height="8" rx="4" fill="${r.color}"/>`;
      yy += 44;
    }
    if (o.chartSvg) body += `<g transform="translate(${px + 20},${yy}) scale(${(pw - 40) / 560})">${o.chartSvg}</g>`;
    if (o.counting) body += T(px + 26, py + ph - 20, '根据最终结果演示的模拟开票（中途曲线为系统生成）', 12, { c: '#9a5800' });
  }
  const title = o.title || '台湾政党斗争';
  const sub = [o.region ? o.regionName : '', o.election ? o.electionName : ''].filter(Boolean).join(' · ');
  const head = header(b, d, o, W, title, sub);
  let foot = footer(b, o, W, H);
  if (PRINT) {
    // 黑线分割：标题下、地图与资料栏之间、页脚上
    const ln = (x1, y1, x2, y2, w = 1.4) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${w}"/>`;
    foot += ln(24, 100, W - 24, 100, 2);
    if (split?.x) foot += ln(split.x, 112, split.x, H - bottom - 4);
    if (split?.y) foot += ln(24, split.y, W - 24, split.y);
    if (o.source || o.version) foot += ln(24, H - bottom + 4, W - 24, H - bottom + 4, 1);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs(b, vals)}<g id="bgmap"><rect x="0" y="0" width="${W}" height="${H}" fill="${PRINT ? '#fff' : 'url(#sea)'}"/>${bg}</g></defs>
<use href="#bgmap"/>${body}${head}${foot}</svg>`;
}

// 人物名单从现有时点引擎读取；不推测党籍，不按主观知名度排名。
export function exportPeople(b, d, source = 'mayors') {
  const rows = [], byId = new Map();
  const add = (id, pid, name, partyId, role, region = '', note = '') => {
    const pr = pid ? person(b, pid) : null;
    let row = byId.get(id);
    if (!row) {
      row = { id, pid, name: pr?.n || name || '资料待补', party: pid ? personPartyAt(b, pid, d, partyId) : partyId, roles: [], region, note, birth: pr?.b || '', fictional: !!pr?.fictional };
      rows.push(row); byId.set(id, row);
    }
    if (role && !row.roles.includes(role)) row.roles.push(role);
    return row;
  };
  if (source === 'mayors') {
    for (const u of unitsAt(d)) {
      const info = unitInfo(b, u.id, d), e = execAt(b, u.id, d);
      add('exec:' + u.id, e?.p, e?.name, e?.party, info.name + (info.type === '縣' ? '县长' : '市长'), info.name, e?.how || (e ? '' : '首长资料待补'));
    }
    return rows;
  }
  const current = (pid, partyId, role, name, note) => add(pid ? 'person:' + pid : 'role:' + role, pid, name, partyId, role, '', note);
  for (const [key, info] of Object.entries(DB.offices)) {
    const e = officeAt(b, key, d);
    if (e?.p || e?.name) current(e.p, e.party, info.name, e.name);
  }
  for (const p of allParties(b)) if (partyExists(b, p.id, d)) {
    const chair = chairAt(b, p.id, d);
    if (chair?.p || chair?.name) current(chair.p, p.id, p.name + '主席', chair.name, chair.note);
  }
  for (const u of unitsAt(d)) {
    const e = execAt(b, u.id, d), info = unitInfo(b, u.id, d);
    if (e?.p || e?.name) current(e.p, e.party, info.name + (info.type === '縣' ? '县长' : '市长'), e.name);
  }
  const seats = seatsAt(b, 'LY', d);
  for (const m of seats?.members || []) if (!m.vacant && (m.p || m.name)) current(m.p, m.party, '立法委员' + (m.district ? ' · ' + m.district : ''), m.name);
  const election = latestElection(b, d, e => e.type === 'president' && !e.summary);
  if (election) for (const c of electionResult(b, election.id)?.cands || []) {
    current(c.pid, c.party, `${election.date} 总统候选人`, c.name);
    if (c.vpid || c.vice) current(c.vpid, c.party, `${election.date} 副总统候选人`, c.vice);
  }
  if (source === 'library') {
    const known = new Set(rows.map(r => r.pid).filter(Boolean));
    for (const pr of [...DB.people, ...(b.customPeople || [])]) {
      if (known.has(pr.id) || (pr.b && String(pr.b).slice(0, 4) > d.slice(0, 4)) || (pr.created && pr.created > d)) continue;
      const past = (IDX.roles[pr.id] || []).filter(r => r.from && r.from <= d).sort((a, z) => z.from.localeCompare(a.from));
      if (!past.length && !pr.fictional) continue;
      const r = past[0], text = r ? `${r.to && r.to < d ? '曾任：' : ''}${r.label}` : '架空人物';
      add('person:' + pr.id, pr.id, pr.n, r?.party, text, r?.region ? unitInfo(b, r.region, d)?.name : '', r?.to && r.to < d ? `任职记录：${r.from} — ${r.to}` : '');
    }
  }
  return rows;
}

// 合图继续复用原有地图、席位圆点与玻璃面板；可延长画布，也可整体缩入固定画幅。
const fitLine = (x, y, s, w, size = 14, opt = {}) => {
  const n = [...String(s ?? '')].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 1 : 0.58), 0);
  return T(x, y, s, Math.min(size, w / Math.max(1, n)), opt);
};
function collectionParties(b, seats, w, y) {
  let svg = '';
  const total = seats.total || 0;
  for (const [p, n] of sortedComp(b, seats.comp)) {
    svg += `<rect x="22" y="${y - 11}" width="12" height="12" rx="${PRINT ? 0 : 3}" fill="${col(b, p)}"${PRINT ? ' stroke="#000" stroke-width="0.6"' : ''}/>`;
    svg += fitLine(42, y, party(b, p).name, w - 190, 15) + T(w - 22, y, `${n} 席 · ${total ? (n / total * 100).toFixed(1) : '0.0'}%`, 14, { a: 'end', w: 650 });
    y += 25;
  }
  svg += T(22, y + 2, total ? `过半门槛 ${Math.floor(total / 2) + 1} 席` : '席位资料待补', 12, { c: '#86868b' });
  return { svg, y: y + 25 };
}
function collectionCard(preset, id, index, b, d, o, w) {
  let s = '', y = 36;
  if (preset === 'people') {
    const row = o.peopleRows.find(r => r.id === id);
    const content = { party: true, roles: true, region: true, birth: false, ...o.peopleContent };
    if (content.region && row.region) { s += fitLine(22, y, row.region, w - 44, 16, { w: 650 }); y += 30; }
    s += fitLine(22, y, row.name, w - 44, 25, { w: 750 }); y += 34;
    if (content.party) {
      s += `<circle cx="28" cy="${y - 5}" r="6" fill="${col(b, row.party)}"/>` + fitLine(44, y, row.party ? party(b, row.party).name : '党籍资料待补', w - 66, 16); y += 29;
    }
    if (content.roles) for (const role of row.roles) { s += fitLine(22, y, role, w - 44, 14); y += 25; }
    if (content.birth) { s += T(22, y, row.birth ? `出生：${row.birth}` : '出生资料待补', 13, { c: '#86868b' }); y += 24; }
    if (row.note) { s += fitLine(22, y, row.note, w - 44, 12, { c: '#86868b' }); y += 23; }
    if (row.fictional) { s += T(22, y, '架空人物', 12, { c: '#af52de' }); y += 23; }
    return { svg: s, h: y + 10 };
  }
  const part = preset === 'region' ? { map: true, head: true, council: true, election: true, ly: true, ...o.regionContent } : { term: true, chart: true, parties: true, leaders: true, members: false, ...o.seatContent };
  const rule = () => { s += `<line x1="22" y1="${y}" x2="${w - 22}" y2="${y}" stroke="${PRINT ? '#000' : 'rgba(60,60,67,.18)'}" stroke-width="1"/>`; y += 26; };
  const label = text => { rule(); s += fitLine(22, y, text, w - 44, 16, { w: 700 }); y += 25; };
  const diagram = seats => {
    const sw = Math.min(w - 64, 420);
    const sc = seatSvg(b, seats, (w - sw) / 2, y, sw);
    s += sc.svg; y += sc.h + 38;
  };
  if (preset === 'region') {
    const info = unitInfo(b, id, d);
    s += fitLine(22, y, info.name, w - 44, 25, { w: 750 }); y += 25;
    s += fitLine(22, y, info.type + (info.prov ? ' · ' + info.prov : ''), w - 44, 13, { c: '#86868b' }); y += 20;
    if (part.map) {
      const mh = Math.min(400, (w - 44) * 0.75);
      const m = mapLayer(b, d, o.mapMode, { lyOpt: o.lyOpt, countValue: (u, t) => countValue(b, d, u, t) }, { x: 22, y, w: w - 44, h: mh }, id);
      // 每张地图有独立纹理比例与定义，避免合图后离岛纹理串用。
      const prefix = 'map-' + index + '-';
      const scoped = text => text.replace(/id="([^"]+)"/g, (_, k) => `id="${prefix}${k}"`).replace(/url\(#([^)]+)\)/g, (_, k) => `url(#${prefix}${k})`).replace(/href="#([^"]+)"/g, (_, k) => `href="#${prefix}${k}"`);
      s += `<defs>${scoped(defs(b, m.vals))}</defs>${scoped(m.svg)}`; y += mh + 22;
      if (o.legend) {
        const ps = [...new Set(Object.values(m.vals).filter(v => v?.kind === 'party').map(v => v.party))];
        for (const p of ps) { s += `<circle cx="28" cy="${y - 5}" r="5" fill="${col(b, p)}"/>` + fitLine(42, y, party(b, p).name, w - 64, 12); y += 20; }
        if (Object.values(m.vals).some(v => v?.kind === 'missing')) { s += T(22, y, '斜纹：资料待补／未核实', 12, { c: '#86868b' }); y += 20; }
      }
    }
    if (part.head) {
      label(info.type === '縣' ? '县长' : '市长');
      const e = execAt(b, id, d);
      if (e) {
        s += `<circle cx="28" cy="${y - 6}" r="6" fill="${col(b, e.party)}"/>` + fitLine(44, y, e.p ? pname(b, e.p) : e.name || '资料待补', w - 66, 20, { w: 650 }); y += 25;
        s += fitLine(22, y, party(b, e.party).name + (e.how ? ' · ' + e.how : ''), w - 44, 13, { c: '#86868b' }); y += 25;
      } else { s += T(22, y, '首长资料待补', 14, { c: '#86868b' }); y += 25; }
    }
    if (part.council) {
      label(instName('C:' + id));
      const council = seatsAt(b, 'C:' + id, d);
      if (council && !council.missing) {
        if (council.label) { s += fitLine(22, y, council.label, w - 44, 13, { c: '#86868b' }); y += 25; }
        diagram(council); const cr = collectionParties(b, council, w, y); s += cr.svg; y = cr.y;
      } else { s += T(22, y, '议会资料待补', 14, { c: '#86868b' }); y += 25; }
    }
    if (part.election) {
      const el = latestElection(b, d, e => e.type === 'mayor' && electionResult(b, e.id)?.races?.[id]);
      label('最近县市长选举');
      if (el) {
        s += fitLine(22, y, el.name, w - 44, 14, { w: 650 }); y += 28;
        const race = electionResult(b, el.id).races[id];
        const total = race.valid || race.cands.reduce((a, c) => a + (c.votes || 0), 0);
        for (const c of race.cands.slice().sort((a, z) => (z.votes || 0) - (a.votes || 0))) {
          const pct = total && c.votes != null ? c.votes / total * 100 : 0;
          s += fitLine(22, y, c.name + (c.win ? ' · 当选' : ''), (w - 44) * 0.48, 14, { w: c.win ? 700 : 500 });
          s += T(w - 22, y, c.votes == null ? '票数待补' : `${c.votes.toLocaleString()} 票 · ${pct.toFixed(2)}%`, 12, { a: 'end' });
          s += `<rect x="22" y="${y + 8}" width="${w - 44}" height="7" rx="${PRINT ? 0 : 3.5}" fill="${PRINT ? '#fff' : 'rgba(118,118,128,.14)'}" stroke="${PRINT ? '#000' : 'none'}"/><rect x="22" y="${y + 8}" width="${(w - 44) * pct / 100}" height="7" fill="${col(b, c.party)}"/>`; y += 39;
        }
      } else { s += T(22, y, '该日期之前暂无已收录选举结果', 14, { c: '#86868b' }); y += 25; }
    }
    if (part.ly) {
      label('本地区域立委');
      const el = latestElection(b, d, e => e.type === 'ly' && !e.summary);
      const towns = townAssignment(b, d).units[id] || [];
      const winners = (el ? electionResult(b, el.id)?.districts || [] : []).filter(x => x.u === id || x.towns?.some(t => towns.includes(t))).flatMap(x => x.cands.filter(c => c.win).map(c => ({ ...c, dn: x.name })));
      for (const c of winners) { s += `<circle cx="28" cy="${y - 5}" r="5" fill="${col(b, c.party)}"/>` + fitLine(44, y, c.name + ' · ' + c.dn, w - 66, 14); y += 25; }
      if (!winners.length) { s += T(22, y, '暂无已收录的区域立委资料', 14, { c: '#86868b' }); y += 25; }
    }
  } else {
    s += fitLine(22, y, instName(id), w - 44, 25, { w: 750 }); y += 30;
    const seats = seatsAt(b, id, d);
    if (part.term) { s += fitLine(22, y, seats?.label || '当期届次资料待补', w - 44, 14, { c: '#86868b' }); y += 26; }
    if (!seats || seats.missing) { s += T(22, y + 15, '该时期席次资料待补', 15, { c: '#86868b' }); y += 50; }
    else {
      if (part.chart) diagram(seats);
      if (part.parties) { const cr = collectionParties(b, seats, w, y + 12); s += cr.svg; y = cr.y; }
      if (part.leaders) {
        label('议长／副议长');
        for (const [name, value] of [['议长', seats.speaker], ['副议长', seats.deputy]]) {
          const text = typeof value === 'string' ? (IDX.roles[value] ? pname(b, value) : value) : value?.p ? pname(b, value.p) : value?.name;
          s += fitLine(22, y, name + '：' + (text || '资料待补'), w - 44, 14); y += 25;
        }
      }
      if (part.members) {
        label('成员名单');
        for (const [i, m] of orderMembers(b, seats.members).entries()) {
          const name = m.vacant ? '空缺' : m.p ? pname(b, m.p) : m.name || '未收录姓名';
          s += fitLine(22, y, `${i + 1}. ${name} · ${m.vacant ? '空缺' : party(b, m.party).short}${m.district ? ' · ' + m.district : ''}`, w - 44, 13); y += 23;
        }
      }
    }
  }
  return { svg: s, h: Math.max(180, y + 18) };
}
function composeCollectionSVG(preset, b, d, o) {
  if (preset === 'people') o = { ...o, peopleRows: exportPeople(b, d, o.peopleSource) };
  const allowed = preset === 'people' ? o.peopleRows.map(r => r.id) : preset === 'region' ? unitsAt(d).map(u => u.id) : DB.insts.filter(i => i.kind === 'elected' && instExists(i, d)).map(i => i.id);
  const ids = [...new Set((preset === 'people' ? o.peopleIds : preset === 'region' ? o.unitIds : o.instIds) || [])];
  if (!ids.length) throw new Error(preset === 'people' ? '请至少勾选一位人物' : preset === 'region' ? '请至少勾选一个县市' : '请至少勾选一个议会');
  if (ids.some(id => !allowed.includes(id))) throw new Error('所选对象在当前历史日期不存在，请重新勾选');
  if (preset === 'seats' && ids.length > 3) throw new Error('议会合图最多选择 3 个议会');
  const [W, minH] = o.size;
  const people = preset === 'people';
  const maxCols = Math.max(1, Math.floor((W - 48 + 20) / (people ? 240 : 540)));
  let cols = Math.min(ids.length, o.columns ? Number(o.columns) : maxCols, maxCols, people ? maxCols : 3);
  const cw = people ? Math.min(220, W - 48) : o.forceAspect ? Math.min(620, W - 48) : (W - 48 - (cols - 1) * 20) / cols;
  const cards = ids.map((id, i) => collectionCard(preset, id, i, b, d, o, cw));
  const bottom = o.source || o.version ? 46 : 20;
  const measure = c => ({ w: c * cw + (c - 1) * 20, h: cards.reduce((sum, card, i) => i % c ? sum : sum + Math.max(...cards.slice(i, i + c).map(x => x.h)) + (i ? 20 : 0), 0) });
  let factor = 1;
  if (o.forceAspect) {
    let best = null;
    for (let c = 1; c <= ids.length; c++) {
      if (o.columns && c !== Math.min(ids.length, Number(o.columns))) continue;
      const box = measure(c), scale = Math.min(1, (W - 48) / box.w, (minH - 110 - bottom - 12) / box.h);
      if (!best || scale > best.scale || (people && scale === best.scale && box.h < best.h)) best = { c, scale, h: box.h };
    }
    cols = best.c; factor = best.scale;
  }
  let y = o.forceAspect ? 0 : 110, body = '';
  for (let i = 0; i < cards.length; i += cols) {
    const row = cards.slice(i, i + cols), h = Math.max(...row.map(c => c.h));
    row.forEach((c, j) => {
      const x = (o.forceAspect ? 0 : 24) + j * (cw + 20);
      body += `<g transform="translate(${x},${y})">${PRINT ? `<rect width="${cw}" height="${h}" fill="#fff" stroke="#000" stroke-width="1.2"/>` : glass('collection-' + (i + j), 0, 0, cw, h)}${c.svg}</g>`;
    });
    y += h + 20;
  }
  const H = o.forceAspect ? minH : Math.max(minH, y + bottom);
  if (o.forceAspect) {
    const box = measure(cols), x = (W - box.w * factor) / 2, top = 110 + (minH - 110 - bottom - box.h * factor) / 2;
    body = `<g data-fixed-aspect="true" data-fit-scale="${factor}" transform="translate(${x},${top}) scale(${factor})">${body}</g>`;
  }
  const title = o.title || '台湾政党斗争';
  const hd = header(b, d, o, W, title, `${ids.length} ${preset === 'people' ? '位人物' : '个' + (preset === 'region' ? '县市' : '议会')}合图`);
  const ft = footer(b, o, W, H) + (PRINT ? `<line x1="24" y1="100" x2="${W - 24}" y2="100" stroke="#000" stroke-width="2"/>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs(b, {})}<g id="bgmap"><rect width="${W}" height="${H}" fill="${PRINT ? '#fff' : 'url(#sea)'}"/></g></defs><use href="#bgmap"/>${body}${hd}${ft}</svg>`;
}

// 独立页面内嵌两套 PNG，不依赖原站点或临时 Blob 地址，离线仍可切换、下载与打印。
export function exportPageHTML({ title, description, variants, style = 'print', landscape = variants.print.width >= variants.print.height }) {
  const widthMM = landscape ? 277 : 190, heightMM = landscape ? 190 : 277;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>
@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:10mm}*{box-sizing:border-box}html,body{margin:0;font:14px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d1d1f}body{background:${style === 'print' ? '#fff' : '#e9edf2'}}.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid #000;background:rgba(252,252,254,.86)}button{font:inherit;padding:6px 14px;cursor:pointer;border:1px solid #888;background:#fff;border-radius:8px}button.active{border-color:#0a84ff;color:#0a84ff}.meta{padding:12px 16px;line-height:1.7;overflow-wrap:anywhere}.page{padding:16px;display:flex;justify-content:center}.variant{display:none;max-width:100%;height:auto}.variant.active{display:block}.print-pages{display:none}body[data-style="print"] .variant{border:1px solid #000}body[data-style="glass"] .variant{border-radius:12px;box-shadow:0 4px 14px rgba(30,40,60,.12)}
@media print{html,body{background:#fff}.bar,.meta,.page{display:none!important}.print-pages{display:block}.print-sheet{position:relative;overflow:hidden;width:${widthMM}mm;break-after:page;page-break-after:always}.print-sheet:last-child{break-after:auto;page-break-after:auto}.print-sheet img{position:absolute;left:0;width:${widthMM}mm;max-width:none;height:auto}}
</style></head><body data-style="${style}"><div class="bar"><b>${esc(title)}</b><button data-pick="print">打印版</button><button data-pick="glass">展示版</button><button id="do-print">打印（使用打印版）</button><button id="download">下载当前 PNG</button><button id="save-page">保存本页 HTML</button></div><div class="meta">${esc(description)}<div id="size"></div><div>页面已内嵌打印版和展示版；离线可用。打印时使用白底黑线版本，长图按 A4 自动分段。</div></div><div class="page">${['print', 'glass'].map(k => `<img class="variant${style === k ? ' active' : ''}" data-style="${k}" data-name="${esc(variants[k].name)}" data-width="${variants[k].width}" data-height="${variants[k].height}" src="${variants[k].dataUrl}" alt="${k === 'print' ? '打印版' : '展示版'}">`).join('')}</div><div class="print-pages"></div><script>
const images=[...document.querySelectorAll('.variant')];
function pick(k){document.body.dataset.style=k;document.body.style.background=k==='print'?'#fff':'#e9edf2';images.forEach(x=>x.classList.toggle('active',x.dataset.style===k));document.querySelectorAll('[data-pick]').forEach(x=>x.classList.toggle('active',x.dataset.pick===k));const x=images.find(x=>x.dataset.style===k);document.getElementById('size').textContent=(k==='print'?'打印版':'展示版')+' · '+x.dataset.width+' × '+x.dataset.height+' px';}
document.querySelectorAll('[data-pick]').forEach(x=>x.onclick=()=>pick(x.dataset.pick));
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
document.getElementById('download').onclick=()=>{const x=images.find(x=>x.classList.contains('active'));download(x.src,x.dataset.name);};
document.getElementById('save-page').onclick=()=>{const copy=document.documentElement.cloneNode(true);copy.querySelector('.print-pages').replaceChildren();const u=URL.createObjectURL(new Blob(['<!doctype html>\\n'+copy.outerHTML],{type:'text/html;charset=utf-8'}));download(u,document.title+'.html');setTimeout(()=>URL.revokeObjectURL(u),2000);};
function printSheets(){const box=document.querySelector('.print-pages');box.replaceChildren();const x=images.find(x=>x.dataset.style==='print');const total=${widthMM}*Number(x.dataset.height)/Number(x.dataset.width);for(let y=0;y<total;y+=${heightMM}){const sheet=document.createElement('div');sheet.className='print-sheet';sheet.style.height=Math.min(${heightMM},total-y)+'mm';const img=document.createElement('img');img.src=x.src;img.style.top=-y+'mm';sheet.append(img);box.append(sheet);}}
document.getElementById('do-print').onclick=()=>{printSheets();window.print();};window.addEventListener('beforeprint',printSheets);pick(document.body.dataset.style);
</script></body></html>`;
}

export async function svgToPng(svg, W, H, scale = 2, bg = '#e9edf2') {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('图片栅格化失败')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(blob => blob ? res(blob) : rej(new Error('图片过大或浏览器无法编码，请减少合图内容或降低清晰度')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
