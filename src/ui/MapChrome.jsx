// 地图周边：悬浮提示、面包屑、图层切换、图例
import { useState } from 'preact/hooks';
import { branch, viewDate, prefs, sel, hover, setPrefs, openPanel, shotMode, isSim } from '../core/store.js';
import { IDX } from '../core/db.js';
import { regionValue, execAt, townExecAt, townInfo, party, MAP_MODES, LY_OPTS, pname, unitTypeLabel, unitInfo } from '../core/world.js';
import { mapValues, mapApi } from './MapView.jsx';
import { countView } from '../core/countview.js';
import { Icon } from './Icon.jsx';
import { D, Seg } from './common.jsx';

export function Tooltip() {
  const h = hover.value;
  if (!h || !h.u) return null;
  const b = branch.value, d = viewDate.value;
  const s = sel.value;
  const townMode = s.unit === h.u;
  const u = unitInfo(b, h.u, d);
  const v = mapValues.value.vals[h.t];
  const ti = townInfo(h.t, d);
  const head = townMode ? townExecAt(b, h.t, d) : execAt(b, h.u, d);
  const x = Math.min(h.x + 16, window.innerWidth - 310), y = Math.min(h.y + 14, window.innerHeight - 170);
  return (
    <div class="tooltip glass glass-strong" style={{ left: x + 'px', top: y + 'px' }}>
      <div class="t1">{townMode ? `${u.name} · ${ti.name}` : u.name}</div>
      <div class="small muted">{townMode ? ti.type : `${unitTypeLabel(u)}${u.prov ? ' · ' + u.prov : ''}`} · {D(d)}</div>
      <div class="sep" style={{ margin: '6px 0' }} />
      {townMode && ti.type === '區'
        ? <div class="small">区长由市长任命，不设民选首长与代表会</div>
        : <div class="small row" style={{ gap: 6 }}>
          <span class="muted">{townMode ? '首长' : '县市长'}</span>
          {head ? <><span class="dot" style={{ background: party(b, head.party).color }} /><b>{head.p ? pname(b, head.p) : head.name || '资料待补'}</b><span class="muted">{party(b, head.party).short}{head.how && head.how !== '民选' ? ' · ' + head.how : ''}</span></> : <span class="muted">资料待补</span>}
        </div>}
      {v && v.label && prefs.value.mapMode !== 'exec' && <div class="small" style={{ marginTop: 4 }}>{MAP_MODES.find(m => m.id === prefs.value.mapMode)?.name}：{v.kind === 'party' && <span class="dot" style={{ background: party(b, v.party).color, display: 'inline-block', marginRight: 4 }} />}{v.label}</div>}
      {ti.note && townMode && <div class="tiny muted" style={{ marginTop: 4 }}>{ti.note}</div>}
      <div class="tiny muted" style={{ marginTop: 4 }}>点击{townMode ? '查看乡镇详情' : '放大并查看县市政治详情'}</div>
    </div>
  );
}

export function Breadcrumb() {
  const s = sel.value, b = branch.value, d = viewDate.value;
  return (
    <div class="glass shot-hide row" style={{ position: 'fixed', top: 62, left: 74, zIndex: 29, padding: '4px 6px', borderRadius: 12, gap: 2 }}>
      <button class="btn ghost sm" onClick={() => (sel.value = { unit: null, town: null })}><Icon name="home" size={14} />全台湾</button>
      {s.unit && <><Icon name="chevronR" size={12} style={{ color: 'var(--ink-3)' }} /><button class="btn ghost sm" onClick={() => (sel.value = { unit: s.unit, town: null })}>{IDX.unit[s.unit]?.name}</button></>}
      {s.town && <><Icon name="chevronR" size={12} style={{ color: 'var(--ink-3)' }} /><button class="btn ghost sm">{townInfo(s.town, d).name}</button></>}
      <div class="vsep" />
      <button class="btn ghost sm icon" title="恢复初始视角" onClick={() => { sel.value = { unit: null, town: null }; mapApi.reset(); }}><Icon name="locate" size={14} /></button>
      <QuickJump />
    </div>
  );
}
// 离岛与小地区快速定位
function QuickJump() {
  const [open, setOpen] = useState(false);
  const d = viewDate.value;
  const { A } = mapValues.value;
  return (
    <span style={{ position: 'relative' }}>
      <button class="btn ghost sm" onClick={() => setOpen(o => !o)} title="快速定位（含离岛）"><Icon name="search" size={14} />定位</button>
      {open && (
        <div class="glass glass-strong" style={{ position: 'absolute', top: 32, left: 0, width: 220, maxHeight: 360, overflow: 'auto', padding: 6, zIndex: 40 }}>
          {Object.keys(A.units).map(u => (
            <div class="list-item small" onClick={() => { sel.value = { unit: u, town: null }; setOpen(false); }}>{IDX.unit[u].name}<span class="muted tiny right">{IDX.unit[u].type}</span></div>
          ))}
        </div>
      )}
    </span>
  );
}

export function LayerSwitch() {
  const p = prefs.value;
  return (
    <div class="glass shot-hide" style={{ position: 'fixed', top: 62, right: 12, zIndex: 29, padding: 6, borderRadius: 12, maxWidth: 'calc(100vw - 100px)' }}>
      <div class="row wrap" style={{ gap: 4 }}>
        <Icon name="layers" size={15} style={{ color: 'var(--ink-3)', marginLeft: 4 }} />
        <Seg value={p.mapMode} options={MAP_MODES.map(m => ({ ...m, title: m.id === 'control' && !isSim.value ? '真实历史模式下沿用首长党籍' : m.name }))} onChange={v => setPrefs({ mapMode: v })} />
        <button class={`btn sm ghost ${p.showLegend ? 'on' : ''}`} onClick={() => setPrefs({ showLegend: !p.showLegend })}>图例</button>
      </div>
      {p.mapMode === 'ly' && <div class="row" style={{ marginTop: 6, gap: 6 }}><span class="tiny muted" style={{ marginLeft: 6 }}>立委胜出口径</span><Seg value={p.lyOpt} options={LY_OPTS} onChange={v => setPrefs({ lyOpt: v })} /></div>}
    </div>
  );
}

const MODE_NOTES = {
  exec: '颜色＝当日县市长（放大后为乡镇市长）所属政党。官派、代理等以括号注明。',
  president: '颜色＝当日之前最近一次总统直选各地得票第一的候选人政党。',
  ly: '立委选举：可切换“当选席位最多”“最高票候选人”“政党票第一”。复数选区以当选席位计算，不视为单一政党胜出；并列以条纹表示。',
  council: '颜色＝当日在任议会（放大后为乡镇市民代表会）席次最多政党；并列以条纹表示。议会最大党与县市长党籍是独立资料。',
  control: '颜色＝管理员在架空分支指定的控制党；未指定者沿用首长党籍并注明。',
  count: '开票中：颜色＝当前领先者，透明度随开票进度加深；本轮更新地区会闪亮。',
  plain: '无颜色行政区划底图。',
};
export function Legend() {
  const p = prefs.value, b = branch.value;
  if (!p.showLegend) return null;
  const { vals } = mapValues.value;
  const counts = {};
  let miss = 0, none = 0, tie = 0, special = 0;
  for (const v of Object.values(vals)) {
    if (!v) continue;
    if (v.kind === 'party') counts[v.party] = (counts[v.party] || 0) + 1;
    else if (v.kind === 'missing') miss++;
    else if (v.kind === 'none') none++;
    else if (v.kind === 'tie') tie++;
    else if (v.kind === 'special') special++;
  }
  const parties = Object.keys(counts).sort((a, c) => (party(b, a).order ?? 50) - (party(b, c).order ?? 50));
  return (
    <LegendBox title={MAP_MODES.find(m => m.id === p.mapMode)?.name + (p.mapMode === 'ly' ? '·' + LY_OPTS.find(o => o.id === p.lyOpt).name : '')}>
      <div class="col" style={{ gap: 3 }}>
        {parties.map(id => <div class="row small" style={{ gap: 6 }}><span class="swatch" style={{ background: party(b, id).color }} />{party(b, id).name}{id === 'IND' && <span class="tiny muted">（非政党）</span>}</div>)}
        {tie > 0 && <div class="row small" style={{ gap: 6 }}><span class="swatch" style={{ background: 'repeating-linear-gradient(45deg,#1f4ea3 0 3px,#1b9431 3px 6px)' }} />并列（条纹显示前两党）</div>}
        {special > 0 && <div class="row small" style={{ gap: 6 }}><span class="swatch" style={{ background: '#b9b2a6' }} />官派／战地政务</div>}
        {miss > 0 && <div class="row small" style={{ gap: 6 }}><span class="swatch" style={{ background: 'repeating-linear-gradient(45deg,#e3e6eb 0 2px,#b6bcc6 2px 4px)' }} />资料待补／未核实</div>}
        {none > 0 && <div class="row small" style={{ gap: 6 }}><span class="swatch" style={{ background: 'radial-gradient(#c3c8d0 30%, #eef0f3 32%) 0 0/5px 5px' }} />无该类选举／不设机关</div>}
        {p.mapMode === 'plain' && <div class="small muted">行政区划底图</div>}
      </div>
      <div class="tiny muted" style={{ marginTop: 6, maxWidth: 230 }}>{MODE_NOTES[p.mapMode]}</div>
      {countView.value && p.mapMode === 'count' && <div class="tiny" style={{ marginTop: 4, color: '#9a5800' }}>根据最终结果演示的模拟开票</div>}
    </LegendBox>
  );
}
function LegendBox({ title, children }) {
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem('tw-legend')) || { x: 80, y: -210 }; } catch { return { x: 80, y: -210 }; } });
  const [scale, setScale] = useState(1);
  const top = pos.y < 0 ? window.innerHeight + pos.y : pos.y;
  const drag = e => {
    if (e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = top;
    const mv = ev => setPos({ x: ox + ev.clientX - sx, y: oy + ev.clientY - sy });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setPos(p => { try { localStorage.setItem('tw-legend', JSON.stringify(p)); } catch { } return p; }); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div class="glass" data-legend style={{ position: 'fixed', left: pos.x, top, zIndex: 28, padding: '9px 11px', borderRadius: 14, cursor: 'grab', transform: `scale(${scale})`, transformOrigin: 'left top', touchAction: 'none' }} onPointerDown={drag}>
      <div class="row" style={{ marginBottom: 6 }}>
        <b class="small">{title}</b>
        <span class="right shot-hide row" style={{ gap: 0 }}>
          <button class="btn ghost sm icon" style={{ width: 20, height: 20 }} onClick={() => setScale(s => Math.max(0.7, s - 0.1))}>−</button>
          <button class="btn ghost sm icon" style={{ width: 20, height: 20 }} onClick={() => setScale(s => Math.min(1.8, s + 0.1))}>＋</button>
          <button class="btn ghost sm icon" style={{ width: 20, height: 20 }} onClick={() => setPrefs({ showLegend: false })}><Icon name="close" size={11} /></button>
        </span>
      </div>
      {children}
    </div>
  );
}
