// 半圆席位图（矢量）：悬浮显示议员、点击打开人物卡、党派高亮
import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { branch, highlightParty, openPanel, viewDate } from '../core/store.js';
import { party, pname, sortedComp, person } from '../core/world.js';
import { seatLayout } from '../core/seatlayout.js';
import { D } from './common.jsx';

// 将成员按政党顺序排列，空缺在最后
export function orderMembers(b, members) {
  return [...members].sort((x, y) => {
    if (x.vacant !== y.vacant) return x.vacant ? 1 : -1;
    const ox = party(b, x.party).order ?? 50, oy = party(b, y.party).order ?? 50;
    if (ox !== oy) return ox - oy;
    if ((x.status || '') !== (y.status || '')) return (x.status === 'won' ? -1 : 1);
    return 0;
  });
}
export function SeatChart({ seats, width = 320, onSeat, statusMode }) {
  const b = branch.value;
  const [tip, setTip] = useState(null);
  const members = orderMembers(b, seats.members);
  const L = seatLayout(members.length, width);
  const hp = highlightParty.value;
  const speaker = seats.speaker;
  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${L.W} ${L.H}`} style={{ display: 'block', overflow: 'visible' }} onPointerLeave={() => setTip(null)}>
        {L.pts.map((pt, i) => {
          const m = members[i];
          if (!m) return null;
          const col = m.vacant ? 'none' : m.status === 'pending' ? '#d5d9df' : party(b, m.party).color;
          const proj = m.status === 'projected';
          const dim = hp && m.party !== hp;
          const isSp = speaker && m.p === speaker;
          return (
            <circle key={i} class={`seat ${dim ? 'dimmed' : ''}`} cx={pt.x} cy={pt.y} r={tip?.i === i ? L.r * 1.35 : L.r}
              fill={proj ? '#fff' : col} stroke={m.vacant ? '#9aa0a6' : proj ? party(b, m.party).color : isSp ? '#1d1d1f' : 'rgba(255,255,255,.7)'}
              stroke-width={m.vacant ? 1 : proj ? Math.max(1, L.r * 0.45) : isSp ? 1.6 : 0.6} stroke-dasharray={m.vacant ? '2 1.5' : undefined}
              onPointerEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ i, m, cx: r.left + r.width / 2, top: r.top, bottom: r.bottom }); }} onPointerLeave={() => setTip(t => (t?.i === i ? null : t))}
              onClick={e => { e.stopPropagation(); if (onSeat) onSeat(m); else if (m.p) openPanel('person', { pid: m.p }); }} />
          );
        })}
        <text x={L.W / 2} y={L.H - L.r - 6} text-anchor="middle" style={{ font: '700 22px var(--font)', fill: 'var(--ink)' }} class="num">{seats.total}</text>
        <text x={L.W / 2} y={L.H - L.r + 9} text-anchor="middle" style={{ font: '500 10px var(--font)', fill: 'var(--ink-3)' }}>总席位{seats.vacant ? ` · 空缺${seats.vacant}` : ''}</text>
      </svg>
      {tip && createPortal(<SeatTip tip={tip} />, document.body)}
    </div>
  );
}
// 悬浮窗挂在页面最上层，按圆点的屏幕位置定位，并自动避开窗口边缘
function SeatTip({ tip }) {
  const b = branch.value, m = tip.m;
  const pr = m.p ? person(b, m.p) : null;
  const ref = useRef();
  const [pos, setPos] = useState({ left: tip.cx, top: tip.top, vis: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    const left = Math.max(8, Math.min(tip.cx - w / 2, W - w - 8));
    let top = tip.top - h - 10;
    if (top < 8) top = Math.min(tip.bottom + 10, H - h - 8);
    setPos({ left, top, vis: 'visible' });
  }, [tip.cx, tip.top, m]);
  return (
    <div ref={ref} class="tooltip glass glass-strong" style={{ position: 'fixed', zIndex: 120, left: pos.left + 'px', top: pos.top + 'px', visibility: pos.vis, minWidth: '170px' }}>
      {m.vacant ? <div class="t1">空缺席位</div> : (
        <div class="row" style={{ alignItems: 'flex-start' }}>
          {pr?.pic && <img class="avatar sm" src={pr.pic} alt="" onError={e => (e.target.style.display = 'none')} />}
          <div>
            <div class="t1">{m.p ? pname(b, m.p) : m.name || '（姓名待补）'}</div>
            <div class="small row" style={{ gap: 5 }}><span class="dot" style={{ background: party(b, m.party).color }} />{party(b, m.party).name}</div>
            {m.district && <div class="small muted">{m.district}</div>}
            {m.role && <div class="small">{m.role}</div>}
            {m.status && <div class="small">{m.status === 'won' ? '确定当选' : m.status === 'projected' ? '推算席位（暂时领先）' : '尚未确定'}</div>}
            {m.unnamed && <div class="tiny muted">仅有党派席次资料，议员姓名待补</div>}
          </div>
        </div>
      )}
    </div>
  );
}
// 党派席次条与名册入口
export function CompLegend({ comp, total, onParty }) {
  const b = branch.value;
  const hp = highlightParty.value;
  const half = Math.floor(total / 2) + 1;
  return (
    <div class="col" style={{ gap: 2 }}>
      <div class="row" style={{ height: 8, borderRadius: 4, overflow: 'hidden', gap: 1, margin: '2px 0 6px', position: 'relative' }}>
        {sortedComp(b, comp).map(([p, n]) => <div style={{ width: (n / total * 100) + '%', height: '100%', background: party(b, p).color, transition: 'width .5s var(--spring)' }} title={`${party(b, p).name} ${n}`} />)}
        <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1.5, background: 'var(--ink)', opacity: 0.6 }} title={`过半门槛 ${half} 席`} />
      </div>
      {sortedComp(b, comp).map(([p, n]) => (
        <div class={`legend-row ${hp === p ? 'active' : ''}`} onClick={() => { highlightParty.value = hp === p ? null : p; onParty?.(p); }}>
          <span class="swatch" style={{ background: party(b, p).color }} />
          <span class="grow">{party(b, p).name}</span>
          <b class="num">{n}</b>
          <span class="tiny muted num" style={{ width: 42, textAlign: 'right' }}>{(n / total * 100).toFixed(1)}%</span>
        </div>
      ))}
      <div class="tiny muted" style={{ marginTop: 2 }}>过半门槛 {half} 席 · 点击政党高亮其席位并显示名册</div>
    </div>
  );
}
