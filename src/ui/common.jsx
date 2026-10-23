// 通用小组件：政党标签、人物链接、来源标注、模态框、提示条
import { useState, useEffect } from 'preact/hooks';
import { branch, prefs, modal, toasts, openPanel, highlightParty } from '../core/store.js';
import { party, pname } from '../core/world.js';
import { SRC } from '../core/db.js';
import { fmtDate } from '../core/dates.js';
import { Icon } from './Icon.jsx';

export const fmtN = n => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('zh-CN'));
export const fmtP = (n, d = 2) => (n == null || isNaN(n) ? '—' : n.toFixed(d) + '%');
export const D = (s, prec) => fmtDate(s, { roc: prefs.value.roc, prec });

export function PartyDot({ id, size = 9 }) {
  return <span class="dot" style={{ background: party(branch.value, id).color, width: size + 'px', height: size + 'px' }} />;
}
export function PartyTag({ id, short = true, click = true }) {
  const p = party(branch.value, id);
  return (
    <span class={`chip ${click ? 'click' : ''}`} onClick={click ? e => { e.stopPropagation(); openPanel('party', { id }); } : undefined} title={p.name}>
      <span class="dot" style={{ background: p.color }} />{short ? p.short : p.name}{p.fictional && <span class="tiny" style={{ color: 'var(--sim)' }}>架空</span>}
    </span>
  );
}
export function PersonLink({ pid, name, party: pt }) {
  const n = pid ? pname(branch.value, pid) : name || '（姓名待补）';
  if (!pid) return <span class={name ? '' : 'muted'}>{n}</span>;
  return (
    <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); openPanel('person', { pid }); }} style={{ color: 'inherit', textDecoration: 'none', borderBottom: '0.5px dashed var(--line-strong)', cursor: 'pointer' }}>
      {pt && <PartyDot id={pt} size={8} />} {n}
    </a>
  );
}
export function SourceNote({ src, verified, prec, extra }) {
  const s = SRC[src] || (src === 'admin' ? { name: '管理员修改（架空）' } : src === 'sim' ? { name: '系统推算（模拟）' } : null);
  return (
    <div class="tiny muted row wrap" style={{ gap: 6, marginTop: 6 }}>
      <Icon name="doc" size={12} />
      <span>来源：{s ? (s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{s.name}</a> : s.name) : '未注明'}</span>
      {verified === false && <span class="chip warn" style={{ height: 18 }}>待核</span>}
      {prec && prec !== 'd' && <span class="chip warn" style={{ height: 18 }}>日期精度：{prec === 'm' ? '月' : '年'}</span>}
      {extra}
    </div>
  );
}
export function DataClass({ kind }) {
  // 四类资料：史实／管理员修改／系统推算／缺资料
  const map = { real: ['real', '可核实史实'], admin: ['sim', '管理员修改'], auto: ['warn', '系统推算'], missing: ['miss', '缺资料／未核实'] };
  const [c, t] = map[kind] || map.missing;
  return <span class={`chip ${c}`} style={{ height: 18, fontSize: 10.5 }}>{t}</span>;
}
export function Seg({ value, options, onChange, small }) {
  return (
    <div class="seg" style={small ? { transform: 'scale(.95)', transformOrigin: 'left' } : null}>
      {options.map(o => <button class={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)} title={o.title}>{o.name}</button>)}
    </div>
  );
}
export function Bar({ pct, color }) {
  return <div class="bar"><i style={{ width: Math.max(0, Math.min(100, pct || 0)) + '%', background: color }} /></div>;
}
export function Missing({ children }) { return <div class="missing-box">{children || '资料待补'}</div>; }

// ---------- 模态框宿主 ----------
export function ModalHost() {
  const m = modal.value;
  if (!m) return null;
  if (m.kind === 'confirm') return (
    <div class="backdrop" onClick={() => m.resolve(false)}>
      <div class="modal glass glass-strong" onClick={e => e.stopPropagation()}>
        <div class="modal-head">{m.title}</div>
        <div class="modal-body">{typeof m.body === 'string' ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.body}</p> : m.body}</div>
        <div class="modal-foot">
          <button class="btn" onClick={() => m.resolve(false)}>取消</button>
          <button class={`btn ${m.danger ? 'danger fill' : 'primary'}`} onClick={() => m.resolve(true)}>{m.okText || '确认'}</button>
        </div>
      </div>
    </div>
  );
  if (m.kind === 'choose') return (
    <div class="backdrop">
      <div class={`modal glass glass-strong ${m.wide ? 'wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div class="modal-head">{m.title}</div>
        <div class="modal-body">{m.body}</div>
        <div class="modal-foot">{m.options.map(o => <button class={`btn ${o.primary ? 'primary' : ''} ${o.danger ? 'danger' : ''}`} onClick={() => m.resolve(o.id)}>{o.name}</button>)}</div>
      </div>
    </div>
  );
  if (m.kind === 'prompt') return <PromptModal m={m} />;
  if (m.kind === 'custom') return (
    <div class="backdrop">
      <div class={`modal glass glass-strong ${m.wide ? 'wide' : ''}`} onClick={e => e.stopPropagation()}>
        <m.Comp resolve={m.resolve} {...m.props} />
      </div>
    </div>
  );
  return null;
}
function PromptModal({ m }) {
  const [v, setV] = useState(m.value || '');
  return (
    <div class="backdrop" onClick={() => m.resolve(null)}>
      <div class="modal glass glass-strong" onClick={e => e.stopPropagation()}>
        <div class="modal-head">{m.title}</div>
        <div class="modal-body col">
          {m.body && <div class="small muted">{m.body}</div>}
          <input class="input" autofocus value={v} onInput={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && m.resolve(v)} placeholder={m.placeholder} />
        </div>
        <div class="modal-foot"><button class="btn" onClick={() => m.resolve(null)}>取消</button><button class="btn primary" onClick={() => m.resolve(v)}>确定</button></div>
      </div>
    </div>
  );
}
export function Toasts() {
  return (
    <div class="toasts">
      {toasts.value.map(t => (
        <div key={t.id} class="toast glass glass-strong" style={{ color: t.kind === 'error' ? 'var(--danger)' : t.kind === 'ok' ? '#1e7a3c' : 'var(--ink)' }}>
          {t.kind === 'ok' && <Icon name="check" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />}{t.msg}
        </div>
      ))}
    </div>
  );
}
// 简易数字翻牌
export function Flip({ value, fmt = fmtN }) {
  const [k, setK] = useState(0);
  useEffect(() => setK(x => x + 1), [value]);
  return <span key={k} class="flip num">{fmt(value)}</span>;
}
