// 可拖动、最小化、关闭、缩放的玻璃浮层；打开时自动避开其他浮层、图例、时间轴与工具条
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon } from './Icon.jsx';
import { closePanel } from '../core/store.js';

const frontId = signal(null);
const registry = new Map(); // 已打开浮层的屏幕矩形
const load = id => { try { return JSON.parse(localStorage.getItem('tw-panel:' + id)); } catch { return null; } };
const save = (id, v) => { try { localStorage.setItem('tw-panel:' + id, JSON.stringify(v)); } catch { } };
const winW = () => Math.max(320, window.innerWidth), winH = () => Math.max(320, window.innerHeight);
const TOP = 104; // 顶部工具条、面包屑、图层条下方

// 请求位置（x<0 表示距右侧；y<0 表示距底部）→ 依当前窗口计算实际位置
function resolvePos(p) {
  const W = winW(), H = winH();
  const w = Math.min(p.w, W - 24);
  let x = p.x < 0 ? W + p.x - w : p.x;
  let y = p.y < 0 ? H + p.y : p.y;
  x = Math.max(8, Math.min(x, W - 80));
  y = Math.max(56, Math.min(y, H - 60));
  const h = p.h ? Math.min(p.h, H - y - 12) : undefined;
  return { x, y, w, h, maxH: p.maxH };
}
function rectOf(el) { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
// 固定界面元素（入口坞、时间轴、图例）
function fixedObstacles() {
  return ['.dock', '.timeline', '[data-legend]'].map(s => rectOf(document.querySelector(s))).filter(Boolean);
}
// 自动寻找空位：候选位置依序为偏好位置、左栏、右栏、中栏，再退为层叠
function place(id, pos) {
  const W = winW(), H = winH();
  const w = Math.min(pos.w, W - 24);
  const others = [...registry.entries()].filter(([k]) => k !== id).map(([, r]) => r);
  const fixed = fixedObstacles();
  const all = [...others, ...fixed];
  const pref = resolvePos(pos);
  const cands = [
    { x: pref.x, y: pref.y },
    { x: 76, y: TOP + 4 },
    { x: W - w - 12, y: TOP + 8 },
    { x: Math.round((W - w) / 2), y: TOP + 4 },
    { x: 76 + 380, y: TOP + 4 },
    { x: W - w - 12 - 380, y: TOP + 8 },
  ].filter(c => c.x >= 8 && c.x + w <= W - 8);
  // 可用高度：直到下方第一个水平相交的障碍
  const fitH = c => {
    let bottom = H - 12;
    for (const o of all) if (o.y > c.y + 40 && o.x < c.x + w && o.x + o.w > c.x) bottom = Math.min(bottom, o.y - 10);
    return bottom - c.y;
  };
  const want = pos.h || 460;
  let best = null;
  for (const c of cands) {
    const avail = fitH(c);
    const h = Math.min(want, avail);
    if (h < Math.min(want, 300)) continue;
    const r = { x: c.x, y: c.y, w, h };
    const ov = others.reduce((a, o) => a + overlap(r, o), 0) + fixed.reduce((a, o) => a + overlap(r, o), 0);
    if (ov < w * h * 0.04) { best = { ...c, maxH: avail }; break; }
    if (!best || ov < best.ov) best = { ...c, maxH: avail, ov };
  }
  // 若全部候选位置都有遮挡，则采用遮挡最少的位置，高度仍避开时间轴等固定元素
  if (!best) best = { x: pref.x, y: pref.y, maxH: fitH(pref) };
  return { ...pos, x: best?.x ?? pref.x, y: best?.y ?? pref.y, maxH: best?.maxH };
}

export function Panel({ id, title, sub, icon, pos, children, actions, onClose, className = '', shot = '', bodyStyle, noPad }) {
  const [req, setReq] = useState(() => load(id) ? { ...pos, ...load(id) } : place(id, pos));
  const [, setTick] = useState(0);
  const st = resolvePos(req);
  const setSt = f => setReq(r => f(resolvePos(r)));
  const [min, setMin] = useState(false);
  const ref = useRef();
  useEffect(() => { frontId.value = id; }, []);
  useEffect(() => {
    const onR = () => setTick(t => t + 1);
    window.addEventListener('resize', onR);
    return () => { window.removeEventListener('resize', onR); registry.delete(id); };
  }, []);
  useLayoutEffect(() => { const r = rectOf(ref.current); if (r) registry.set(id, r); });
  const drag = e => {
    if (e.target.closest('button, input, select, .no-drag')) return;
    frontId.value = id;
    const sx = e.clientX, sy = e.clientY, ox = st.x, oy = st.y;
    const mv = ev => setSt(s => ({ ...s, x: Math.max(4 - s.w + 80, Math.min(window.innerWidth - 60, ox + ev.clientX - sx)), y: Math.max(48, Math.min(window.innerHeight - 40, oy + ev.clientY - sy)), maxH: undefined }));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setSt(s => { save(id, { x: s.x, y: s.y, w: s.w, h: s.h }); return s; }); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const resize = e => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = st.w, oh = ref.current.offsetHeight;
    const mv = ev => setSt(s => ({ ...s, w: Math.max(260, ow + ev.clientX - sx), h: Math.max(160, oh + ev.clientY - sy), maxH: undefined }));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setSt(s => { save(id, { x: s.x, y: s.y, w: s.w, h: s.h }); return s; }); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const close = onClose || (() => closePanel(id));
  const h = min ? 'auto' : st.h ? Math.min(st.h, st.maxH || 1e9) + 'px' : undefined;
  return (
    <div ref={ref} data-panel={id} class={`panel glass ${min ? 'min' : ''} ${frontId.value === id ? 'front' : ''} ${shot} ${className}`}
      style={{ left: st.x + 'px', top: st.y + 'px', width: st.w + 'px', height: h, maxHeight: st.maxH ? st.maxH + 'px' : undefined }}
      onPointerDown={() => (frontId.value = id)}>
      <div class="panel-head" onPointerDown={drag} onDblClick={() => setMin(m => !m)}>
        {icon && <span style={{ color: 'var(--ink-2)', display: 'flex' }}><Icon name={icon} size={16} /></span>}
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="panel-title ellipsis">{title}</div>
          {sub && <div class="panel-sub ellipsis">{sub}</div>}
        </div>
        {actions}
        <button class="btn ghost sm icon shot-hide" title={min ? '展开' : '最小化'} onClick={() => setMin(m => !m)}><Icon name={min ? 'max' : 'min'} size={14} /></button>
        <button class="btn ghost sm icon shot-hide" title="关闭" onClick={close}><Icon name="close" size={14} /></button>
      </div>
      <div class="panel-body" style={{ ...(noPad ? { padding: 0 } : {}), ...bodyStyle }}>{children}</div>
      {!min && <div class="resize-grip shot-hide" onPointerDown={resize} />}
    </div>
  );
}
