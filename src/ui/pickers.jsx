// 选择器：人物搜索、政党下拉
import { useState, useMemo } from 'preact/hooks';
import { branch, viewDate } from '../core/store.js';
import { DB } from '../core/db.js';
import { allParties, partyExists, person } from '../core/world.js';
import { normS } from '../core/i18n.js';

export function PartySelect({ value, onChange, small = true, allowAll = true, style }) {
  const b = branch.value, d = viewDate.value;
  const ps = allParties(b).filter(p => !p.minor || p.id === value).sort((x, y) => (x.order ?? 50) - (y.order ?? 50));
  return (
    <select class={`select ${small ? 'sm' : ''}`} value={value || ''} onChange={e => onChange(e.target.value)} style={style}>
      {!value && <option value="">（选择政党）</option>}
      {ps.map(p => { const ex = partyExists(b, p.id, d); if (!ex && !allowAll && p.id !== value) return null; return <option value={p.id}>{p.name}{ex ? '' : '（此日未存在）'}{p.fictional ? '（架空）' : ''}</option>; })}
      {ps.length < allParties(b).length && <optgroup label="其他小党">{allParties(b).filter(p => p.minor && p.id !== value).map(p => <option value={p.id}>{p.name}</option>)}</optgroup>}
    </select>
  );
}
// 人物搜索：返回 {pid} 或 {name}（新建架空人物）
export function PersonPicker({ pid, name, onPick, placeholder = '输入姓名搜索或新建', style }) {
  const b = branch.value;
  const [q, setQ] = useState(null);
  const shown = q ?? (pid ? person(b, pid)?.n : name || '');
  const matches = useMemo(() => {
    if (!q) return [];
    const out = [];
    const nq = normS(q);
    for (const p of b.customPeople || []) if (normS(p.n).includes(nq)) out.push(p);
    for (const p of DB.people) { if (normS(p.n).startsWith(nq)) out.push(p); if (out.length > 12) break; }
    return out;
  }, [q]);
  return (
    <span style={{ position: 'relative', display: 'inline-block', ...style }}>
      <input class="input sm" style={{ width: '100%' }} value={shown} placeholder={placeholder} onInput={e => setQ(e.target.value)} onBlur={() => setTimeout(() => setQ(null), 200)} />
      {q && (
        <div class="glass glass-strong" style={{ position: 'absolute', zIndex: 5, top: 28, left: 0, minWidth: 200, maxHeight: 240, overflow: 'auto', padding: 4 }}>
          {matches.map(p => <div class="list-item small" onMouseDown={() => { onPick({ pid: p.id }); setQ(null); }}>{p.n}{p.b ? <span class="muted tiny">（{p.b}年生）</span> : null}{p.fictional && <span class="chip sim" style={{ height: 16 }}>架空</span>}</div>)}
          <div class="list-item small" onMouseDown={() => { onPick({ name: q }); setQ(null); }} style={{ color: 'var(--sim)' }}>＋ 新建架空人物「{q}」</div>
        </div>
      )}
    </span>
  );
}
