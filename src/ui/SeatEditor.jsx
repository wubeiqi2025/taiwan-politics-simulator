// 议会席位编辑器：总席数、成员、党籍、职务、空缺、批量改党
import { useState, useMemo } from 'preact/hooks';
import { branch, viewDate, mutate, uid, toast, highlightParty } from '../core/store.js';
import { instName } from '../core/db.js';
import { seatsAt, party, pname, sortedComp } from '../core/world.js';
import { PartySelect, PersonPicker } from './pickers.jsx';
import { SeatChart } from './SeatChart.jsx';
import { D } from './common.jsx';
import { Icon } from './Icon.jsx';

const STATUS = ['在任', '辞职', '补选', '递补', '缺额'];
export function SeatEditor({ resolve, inst }) {
  const b = branch.value, d = viewDate.value;
  const cur = seatsAt(b, inst, d);
  const [rows, setRows] = useState(() => (cur?.members || []).map(m => ({ key: uid('r'), p: m.p, name: m.p ? null : (m.name || ''), party: m.party || 'IND', district: m.district || '', status: m.vacant ? '缺额' : '在任', role: m.role || '' })));
  const [speaker, setSpeaker] = useState(cur?.speaker || '');
  const [deputy, setDeputy] = useState(cur?.deputy || '');
  const [label, setLabel] = useState(cur?.label ? cur.label + '（架空调整）' : '架空届次');
  const [bf, setBf] = useState({ from: '', to: '' });
  const [q, setQ] = useState('');
  const total = rows.length;
  const preview = useMemo(() => ({ total, members: rows.map(r => r.status === '缺额' || r.status === '辞职' ? { vacant: true } : { p: r.p, name: r.name, party: r.party, district: r.district }), speaker }), [rows, speaker]);
  const comp = {}; for (const r of rows) if (r.status !== '缺额' && r.status !== '辞职') comp[r.party] = (comp[r.party] || 0) + 1;
  const before = cur?.comp || {};
  const setTotal = n => {
    n = Math.max(1, Math.min(800, n | 0));
    if (n > rows.length) setRows([...rows, ...Array.from({ length: n - rows.length }, () => ({ key: uid('r'), p: null, name: '', party: 'IND', district: '', status: '缺额' }))]);
    else {
      // 先移除空缺席位
      let r = [...rows];
      while (r.length > n) { const i = r.map(x => x.status).lastIndexOf('缺额'); r.splice(i >= 0 ? i : r.length - 1, 1); }
      setRows(r);
    }
  };
  const upd = (key, patch) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const save = () => {
    mutate(br => {
      const members = [];
      for (const r of rows) {
        if (r.status === '缺额' || r.status === '辞职') continue;
        let p = r.p;
        if (!p && r.name) {
          const np = { id: uid('f'), n: r.name, fictional: true, created: br.date };
          br.customPeople.push(np);
          p = np.id;
        }
        members.push({ p, name: p ? undefined : r.name, party: r.party, district: r.district, role: r.status !== '在任' ? r.status : r.role || undefined });
      }
      br.patches = br.patches.filter(x => !(x.t === 'seats:' + inst && x.date === br.date));
      br.patches.push({ id: uid('pt'), t: 'seats:' + inst, date: br.date, by: 'admin', v: { label, total: rows.length, members, speaker: speaker || null, deputy: deputy || null, note: '管理员编辑' } });
    }, `编辑${instName(inst)}席位`);
    toast('席位已更新，地图与各面板已同步', 'ok');
    resolve(true);
  };
  const shown = rows.filter(r => !q || (r.p ? pname(b, r.p) : r.name || '').includes(q) || r.district.includes(q) || party(b, r.party).name.includes(q));
  return (
    <>
      <div class="modal-head">编辑席位 · {instName(inst)}<div class="small muted" style={{ fontWeight: 400 }}>生效日期：{D(d)}（自此日起覆盖史实组成，直到下一次史实换届经你确认）</div></div>
      <div class="modal-body">
        <div class="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 260, flex: 'none' }}>
            <SeatChart seats={{ ...preview, members: preview.members, vacant: preview.members.filter(m => m.vacant).length }} width={250} onSeat={() => { }} />
            <div class="section-title">修改前后影响</div>
            <table class="table">
              <thead><tr><th>政党</th><th>原</th><th>新</th></tr></thead>
              <tbody>{[...new Set([...Object.keys(before), ...Object.keys(comp)])].map(p => <tr><td><span class="dot" style={{ background: party(b, p).color, display: 'inline-block', marginRight: 4 }} />{party(b, p).short}</td><td class="num">{before[p] || 0}</td><td class="num" style={{ color: (comp[p] || 0) !== (before[p] || 0) ? 'var(--accent)' : undefined, fontWeight: 600 }}>{comp[p] || 0}</td></tr>)}</tbody>
            </table>
            <div class="tiny muted" style={{ marginTop: 6 }}>保存后同步：席位图、党派数字、人物卡任职、地图“议会最大党”图层。</div>
          </div>
          <div class="grow col" style={{ gap: 8 }}>
            <div class="row wrap">
              <label class="field">届次名称<input class="input sm" value={label} onInput={e => setLabel(e.target.value)} /></label>
              <label class="field">总席数<input class="input sm num" type="number" style={{ width: 80 }} value={total} onChange={e => setTotal(+e.target.value)} /></label>
              <label class="field">院长／议长<select class="select sm" value={speaker} onChange={e => setSpeaker(e.target.value)}><option value="">（无）</option>{rows.filter(r => r.p).map(r => <option value={r.p}>{pname(b, r.p)}</option>)}</select></label>
              <label class="field">副院长／副议长<select class="select sm" value={deputy} onChange={e => setDeputy(e.target.value)}><option value="">（无）</option>{rows.filter(r => r.p).map(r => <option value={r.p}>{pname(b, r.p)}</option>)}</select></label>
            </div>
            <div class="row wrap inner" style={{ padding: 8 }}>
              <span class="small bold">批量改党</span>
              <PartySelect value={bf.from} onChange={v => setBf({ ...bf, from: v })} />
              <Icon name="chevronR" size={12} />
              <PartySelect value={bf.to} onChange={v => setBf({ ...bf, to: v })} />
              <button class="btn sm" disabled={!bf.from || !bf.to} onClick={() => { const n = rows.filter(r => r.party === bf.from).length; setRows(rs => rs.map(r => (r.party === bf.from ? { ...r, party: bf.to } : r))); toast(`已将 ${n} 席改为${party(b, bf.to).short}`); }}>应用</button>
              <button class="btn sm right" onClick={() => setRows([...rows, { key: uid('r'), p: null, name: '', party: 'IND', district: '', status: '在任' }])}><Icon name="plus" size={13} />增加议员</button>
            </div>
            <input class="input sm" placeholder="筛选姓名／选区／政党" value={q} onInput={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              <table class="table">
                <thead><tr><th>#</th><th>议员</th><th>党籍</th><th>选区</th><th>状态</th><th></th></tr></thead>
                <tbody>
                  {shown.slice(0, 300).map((r, i) => (
                    <tr key={r.key}>
                      <td class="muted num">{rows.indexOf(r) + 1}</td>
                      <td style={{ minWidth: 130 }}><PersonPicker pid={r.p} name={r.name} onPick={x => upd(r.key, { p: x.pid || null, name: x.name || null, status: r.status === '缺额' ? '在任' : r.status })} /></td>
                      <td><PartySelect value={r.party} onChange={v => upd(r.key, { party: v })} /></td>
                      <td><input class="input sm" style={{ width: 120 }} value={r.district} onInput={e => upd(r.key, { district: e.target.value })} /></td>
                      <td><select class="select sm" value={r.status} onChange={e => upd(r.key, { status: e.target.value })}>{STATUS.map(s => <option>{s}</option>)}</select></td>
                      <td><button class="btn ghost sm icon" title="移除此席" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><Icon name="trash" size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 300 && <div class="empty">仅显示前300席，请用筛选缩小范围</div>}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onClick={() => resolve(false)}>取消</button>
        <button class="btn primary" onClick={save}>保存（可撤销）</button>
      </div>
    </>
  );
}
