// 后台统一资料编辑：架空修改清单、人物批量、区划归属、导入导出、校验
import { useState, useMemo } from 'preact/hooks';
import * as XLSX from 'xlsx';
import { branch, viewDate, mutate, uid, toast, ask, openPanel, isSim } from '../core/store.js';
import { IDX, DB, instName } from '../core/db.js';
import { party, pname, person, partyExists, seatsAt, unitsAt, townInfo, unitOfTown, execAt, activePatch, personPartyAt, allParties } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { D, PartyDot } from './common.jsx';
import { PartySelect } from './pickers.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable, branchFromHere } from '../core/actions.js';
import { download } from './SavesPanel.jsx';

const TARGET_NAME = t => {
  const [k, v] = [t.split(':')[0], t.slice(t.indexOf(':') + 1)];
  return ({ exec: '县市首长 ' + (IDX.unit[v]?.name || v), townexec: '乡镇首长 ' + (DB.towns[v]?.n || v), seats: '议会席位 ' + instName(v), person: '人物 ' + (pname(branch.value, v)), office: '中央职务 ' + v, partyExists: '政党存续 ' + party(branch.value, v).short, control: '控制党 ' + (IDX.unit[v]?.name || v), admin: '区划归属 ' + (DB.towns[v]?.n || IDX.unit[v]?.name || v), chair: '党主席 ' + v })[k] || t;
};
const IMPACT = { exec: '地图（县市长图层）、地区详情、人物卡', townexec: '地图（乡镇层级）、地区详情、人物卡', seats: '席位图、党派席次、地图（议会最大党）、人物卡', person: '人物卡党籍、所有席位图中该人所在席位颜色', office: '重要人物摘要、人物卡', partyExists: '政党库、事件冲突判断', control: '地图（模拟控制党）', admin: '县市边界、地区归属、各图层统计', chair: '政党库、重要人物摘要' };

export function EditorPanel() {
  const [tab, setTab] = useState('patches');
  return (
    <Panel id="editor" title="后台资料编辑" sub={isSim.value ? '架空分支：修改只写入本分支' : '真实历史为只读，编辑时会提示建立架空分支'} icon="edit" pos={{ x: 80, y: 100, w: 640, h: 640 }}>
      <div class="seg" style={{ marginBottom: 8 }}>
        {[['patches', '架空修改清单'], ['people', '人物批量'], ['region', '区划归属'], ['import', '导入'], ['export', '导出'], ['check', '校验']].map(([id, n]) => <button class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{n}</button>)}
      </div>
      {tab === 'patches' && <Patches />}
      {tab === 'people' && <PeopleBatch />}
      {tab === 'region' && <RegionAssign />}
      {tab === 'import' && <Importer />}
      {tab === 'export' && <Exporter />}
      {tab === 'check' && <Checker />}
    </Panel>
  );
}
function Patches() {
  const b = branch.value;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const list = b.patches.filter(p => (kind === 'all' || p.t.startsWith(kind + ':')) && (!q || TARGET_NAME(p.t).includes(q))).sort((x, y) => y.date.localeCompare(x.date));
  const del = async p => {
    if (!(await ask({ kind: 'confirm', title: '删除这项架空修改？', body: `${TARGET_NAME(p.t)}（${p.date}）\n影响范围：${IMPACT[p.t.split(':')[0]] || '—'}\n可用撤销恢复。`, danger: true, okText: '删除' }))) return;
    mutate(br => { br.patches = br.patches.filter(x => x.id !== p.id); }, `删除修改 ${TARGET_NAME(p.t)}`);
  };
  const desc = p => {
    const v = p.v;
    if (v === undefined) return '清除设定';
    if (typeof v !== 'object') return String(v === true ? '存在' : v === false ? '不存在' : party(b, v).name || v);
    if (v.members) return `${v.total}席：` + Object.entries(v.members.reduce((a, m) => ({ ...a, [m.party]: (a[m.party] || 0) + 1 }), {})).sort((x, y) => y[1] - x[1]).map(([pp, n]) => party(b, pp).short + n).join('、');
    return [v.p ? pname(b, v.p) : v.name, v.party && party(b, v.party).short, v.status, v.how, v.unit && IDX.unit[v.unit]?.name].filter(Boolean).join(' · ');
  };
  return (
    <div class="col">
      {!isSim.value && <div class="notice info">真实历史分支没有架空修改。</div>}
      <div class="row"><input class="input sm grow" placeholder="筛选对象" value={q} onInput={e => setQ(e.target.value)} />
        <select class="select sm" value={kind} onChange={e => setKind(e.target.value)}><option value="all">全部类型</option>{Object.keys(IMPACT).map(k => <option value={k}>{TARGET_NAME(k + ':').replace(/ .*$/, '') || k}</option>)}</select></div>
      <table class="table">
        <thead><tr><th>生效日</th><th>对象</th><th>内容</th><th>来源</th><th></th></tr></thead>
        <tbody>{list.slice(0, 300).map(p => <tr><td class="num">{p.date}</td><td>{TARGET_NAME(p.t)}</td><td class="ellipsis" style={{ maxWidth: 220 }} title={IMPACT[p.t.split(':')[0]]}>{desc(p)}</td><td><span class={`chip ${p.by === 'sim' ? 'warn' : 'sim'}`} style={{ height: 16 }}>{p.by === 'sim' ? '模拟选举' : p.by === 'event' ? '自定义事件' : '管理员'}</span></td><td><button class="btn ghost sm icon" onClick={() => del(p)}><Icon name="trash" size={12} /></button></td></tr>)}</tbody>
      </table>
      {!list.length && <div class="empty">没有架空修改</div>}
      <div class="tiny muted">鼠标停在内容上可查看影响范围。所有修改都可撤销／重做，也可从存档版本回退。</div>
    </div>
  );
}
function PeopleBatch() {
  const b = branch.value, d = viewDate.value;
  const [inst, setInst] = useState('LY');
  const [fp, setFp] = useState('');
  const [chosen, setChosen] = useState({});
  const [to, setTo] = useState('IND');
  const seats = seatsAt(b, inst, d);
  const members = (seats?.members || []).filter(m => m.p && (!fp || m.party === fp));
  const apply = async () => {
    const ids = Object.keys(chosen).filter(k => chosen[k]);
    if (!ids.length) return;
    if (!(await ensureEditable('批量更改人物党籍'))) return;
    if (!(await ask({ kind: 'confirm', title: `批量改党籍（${ids.length}人）`, body: `自 ${D(branch.value.date)} 起改为${party(b, to).name}。影响：席位图、人物卡、地图议会图层。`, okText: '确认' }))) return;
    mutate(br => { for (const pid of ids) br.patches.push({ id: uid('pt'), t: 'person:' + pid, date: br.date, by: 'admin', v: { ...(activePatch(br, 'person:' + pid, br.date)?.v || {}), party: to } }); }, `批量改党籍 ${ids.length}人`);
    setChosen({});
    toast('批量修改完成', 'ok');
  };
  return (
    <div class="col">
      <div class="row wrap">
        <select class="select sm" value={inst} onChange={e => setInst(e.target.value)}>
          <option value="LY">立法院</option>
          {unitsAt(d).map(u => <option value={'C:' + u.id}>{u.name}议会</option>)}
        </select>
        <span class="small muted">现任党籍</span><PartySelect value={fp} onChange={setFp} />
        <button class="btn sm" onClick={() => setChosen(Object.fromEntries(members.map(m => [m.p, true])))}>全选</button>
        <button class="btn sm" onClick={() => setChosen({})}>清除</button>
      </div>
      <div class="row wrap inner" style={{ padding: 8 }}><span class="small">已选 {Object.values(chosen).filter(Boolean).length} 人，改为</span><PartySelect value={to} onChange={setTo} /><button class="btn sm primary" onClick={apply}>批量更改党籍</button></div>
      <div style={{ maxHeight: 380, overflow: 'auto' }}>
        <table class="table"><tbody>{members.map(m => <tr class="click"><td><input type="checkbox" checked={!!chosen[m.p]} onChange={e => setChosen({ ...chosen, [m.p]: e.target.checked })} /></td><td onClick={() => openPanel('person', { pid: m.p })}>{pname(b, m.p)}</td><td><PartyDot id={m.party} /> {party(b, m.party).short}</td><td class="muted tiny">{m.district}</td></tr>)}</tbody></table>
        {seats?.missing && <div class="empty">该届资料待补</div>}
      </div>
    </div>
  );
}
function RegionAssign() {
  const b = branch.value, d = viewDate.value;
  const [u, setU] = useState('TPE');
  const units = unitsAt(d);
  const towns = Object.keys(DB.towns).filter(t => unitOfTown(b, t, d) === u);
  const move = async (t, nu) => {
    if (!(await ensureEditable('修改地区归属'))) return;
    if (!(await ask({ kind: 'confirm', title: '修改行政归属？', body: `${townInfo(t, d).name} 自 ${D(branch.value.date)} 起改属 ${IDX.unit[nu].name}。\n影响：县市边界、地区统计、各图层颜色。属于架空自定义，不会被系统矫正为史实。` }))) return;
    mutate(br => { br.patches.push({ id: uid('pt'), t: 'admin:' + t, date: br.date, by: 'admin', v: { unit: nu } }); }, `${townInfo(t, d).name} 改隶 ${IDX.unit[nu].name}`);
  };
  return (
    <div class="col">
      <div class="row"><span class="small muted">县市</span><select class="select sm" value={u} onChange={e => setU(e.target.value)}>{units.map(x => <option value={x.id}>{x.name}</option>)}</select><span class="tiny muted">共 {towns.length} 个乡镇市区</span></div>
      <table class="table"><tbody>{towns.map(t => <tr><td>{townInfo(t, d).name}</td><td class="muted tiny">{townInfo(t, d).type}</td><td><select class="select sm" value={u} onChange={e => move(t, e.target.value)}>{units.map(x => <option value={x.id}>{x.name}</option>)}</select></td></tr>)}</tbody></table>
    </div>
  );
}
// ---------- 导入 ----------
const IMPORT_KINDS = {
  members: { name: '议会成员（覆盖指定议会的席位组成）', fields: ['姓名', '党籍', '选区'] },
  partyChange: { name: '人物党籍变更', fields: ['姓名', '党籍'] },
  events: { name: '自定义事件', fields: ['日期', '标题', '内容', '分类'] },
  execs: { name: '县市首长', fields: ['县市', '姓名', '党籍'] },
};
function Importer() {
  const b = branch.value, d = viewDate.value;
  const [kind, setKind] = useState('members');
  const [inst, setInst] = useState('LY');
  const [sheet, setSheet] = useState(null); // {cols, rows}
  const [map, setMap] = useState({});
  const pick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const cols = Object.keys(rows[0] || {});
      setSheet({ cols, rows, name: f.name });
      const m = {}; for (const fld of IMPORT_KINDS[kind].fields) m[fld] = cols.find(c => c.includes(fld)) || '';
      setMap(m);
    };
    inp.click();
  };
  const partyByName = name => { const n = String(name || '').trim(); if (!n || /無黨|无党/.test(n)) return 'IND'; const p = allParties(b).find(x => x.name === n || x.short === n || x.id === n); return p?.id || null; };
  const plan = useMemo(() => {
    if (!sheet) return null;
    const rows = sheet.rows.map(r => Object.fromEntries(IMPORT_KINDS[kind].fields.map(f => [f, String(r[map[f]] ?? '').trim()])));
    const errors = [], dup = new Set(), seen = new Set();
    rows.forEach((r, i) => {
      const key = JSON.stringify(r);
      if (seen.has(key)) dup.add(i); seen.add(key);
      if (kind !== 'events' && r['党籍'] && !partyByName(r['党籍'])) errors.push(`第${i + 2}行：未知政党「${r['党籍']}」`);
      if (kind === 'events' && !/^\d{4}-\d{2}-\d{2}$/.test(r['日期'])) errors.push(`第${i + 2}行：日期格式错误`);
      if (kind === 'execs' && !unitsAt(d).some(u => u.name === r['县市'])) errors.push(`第${i + 2}行：此日期不存在县市「${r['县市']}」`);
    });
    const known = rows.filter(r => r['姓名'] && DB.people.some(p => p.n === r['姓名'])).length;
    return { rows, errors, dup, known, add: rows.length - known };
  }, [sheet, map, kind]);
  const commit = async () => {
    if (!(await ensureEditable('导入资料'))) return;
    const ok = await ask({ kind: 'confirm', title: '确认导入？', body: `共 ${plan.rows.length} 行，重复 ${plan.dup.size} 行（将略过），验证问题 ${plan.errors.length} 项（有问题的行将略过）。导入后可撤销。`, okText: '导入' });
    if (!ok) return;
    const findP = (br, name) => { const hit = DB.people.find(p => p.n === name) || br.customPeople.find(p => p.n === name); if (hit) return hit.id; const np = { id: uid('f'), n: name, fictional: true }; br.customPeople.push(np); return np.id; };
    const good = plan.rows.filter((r, i) => !plan.dup.has(i) && !plan.errors.some(e => e.startsWith(`第${i + 2}行`)));
    mutate(br => {
      if (kind === 'members') br.patches.push({ id: uid('pt'), t: 'seats:' + inst, date: br.date, by: 'admin', v: { label: '导入名单', total: good.length, members: good.map(r => ({ p: findP(br, r['姓名']), party: partyByName(r['党籍']) || 'IND', district: r['选区'] })), note: '由 ' + sheet.name + ' 导入' } });
      if (kind === 'partyChange') for (const r of good) { const pid = findP(br, r['姓名']); br.patches.push({ id: uid('pt'), t: 'person:' + pid, date: br.date, by: 'admin', v: { party: partyByName(r['党籍']) } }); }
      if (kind === 'events') for (const r of good) br.customEvents.push({ id: uid('ce'), date: r['日期'], title: r['标题'], desc: r['内容'], cat: r['分类'] || '党争', imp: 2, people: [], parties: [], regions: [], effects: [], kind: 'custom' });
      if (kind === 'execs') for (const r of good) { const u = unitsAt(br.date).find(x => x.name === r['县市']); br.patches.push({ id: uid('pt'), t: 'exec:' + u.id, date: br.date, by: 'admin', v: { p: findP(br, r['姓名']), party: partyByName(r['党籍']) || 'IND', how: '导入' } }); }
    }, `导入 ${sheet.name}`);
    toast(`已导入 ${good.length} 行`, 'ok');
    setSheet(null);
  };
  return (
    <div class="col">
      <div class="row wrap">
        <select class="select sm" value={kind} onChange={e => { setKind(e.target.value); setSheet(null); }}>{Object.entries(IMPORT_KINDS).map(([k, v]) => <option value={k}>{v.name}</option>)}</select>
        {kind === 'members' && <select class="select sm" value={inst} onChange={e => setInst(e.target.value)}><option value="LY">立法院</option>{unitsAt(d).map(u => <option value={'C:' + u.id}>{u.name}议会</option>)}</select>}
        <button class="btn sm primary" onClick={pick}><Icon name="upload" size={13} />选择 Excel／CSV</button>
      </div>
      <div class="tiny muted">需要的栏位：{IMPORT_KINDS[kind].fields.join('、')}。导入前会预览栏位对应、资料范围、新增与重复数量以及验证结果。</div>
      {sheet && <>
        <div class="inner" style={{ padding: 8 }}>
          <div class="small bold">栏位对应（{sheet.name}，{sheet.rows.length}行）</div>
          <div class="row wrap" style={{ marginTop: 4 }}>{IMPORT_KINDS[kind].fields.map(f => <label class="field">{f}<select class="select sm" value={map[f]} onChange={e => setMap({ ...map, [f]: e.target.value })}><option value="">（不导入）</option>{sheet.cols.map(c => <option>{c}</option>)}</select></label>)}</div>
        </div>
        {plan && <div class="col">
          <div class="row wrap small"><span class="chip">共 {plan.rows.length} 行</span>{kind !== 'events' && <><span class="chip real">已知人物 {plan.known}</span><span class="chip sim">将新建 {plan.add}</span></>}<span class="chip warn">重复 {plan.dup.size}</span><span class="chip" style={{ color: plan.errors.length ? 'var(--danger)' : undefined }}>问题 {plan.errors.length}</span></div>
          {plan.errors.length > 0 && <div class="notice" style={{ maxHeight: 100, overflow: 'auto' }}>{plan.errors.slice(0, 30).map(e => <div class="tiny">{e}</div>)}</div>}
          <div style={{ maxHeight: 200, overflow: 'auto' }}><table class="table"><thead><tr>{IMPORT_KINDS[kind].fields.map(f => <th>{f}</th>)}</tr></thead><tbody>{plan.rows.slice(0, 50).map((r, i) => <tr style={{ opacity: plan.dup.has(i) ? 0.4 : 1 }}>{IMPORT_KINDS[kind].fields.map(f => <td>{r[f]}</td>)}</tr>)}</tbody></table></div>
          <button class="btn primary" onClick={commit}>确认导入</button>
        </div>}
      </>}
    </div>
  );
}
function Exporter() {
  const b = branch.value, d = viewDate.value;
  const [what, setWhat] = useState('LY');
  const rows = () => {
    if (what === 'execs') return unitsAt(d).map(u => { const e = execAt(b, u.id, d); return { 县市: u.name, 首长: e?.p ? pname(b, e.p) : e?.name || '', 党籍: party(b, e?.party).name, 产生方式: e?.how || '', 日期: d }; });
    if (what === 'events') return b.customEvents.map(e => ({ 日期: e.date, 标题: e.title, 内容: e.desc, 分类: e.cat }));
    const s = seatsAt(b, what, d);
    return (s?.members || []).filter(m => !m.vacant).map(m => ({ 姓名: m.p ? pname(b, m.p) : m.name || '', 党籍: party(b, m.party).name, 选区: m.district || '', 机关: instName(what), 日期: d }));
  };
  const out = fmt => {
    const r = rows();
    const ws = XLSX.utils.json_to_sheet(r);
    if (fmt === 'csv') download(`${what}_${d}.csv`, '﻿' + XLSX.utils.sheet_to_csv(ws), 'text/csv');
    else { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '资料'); XLSX.writeFile(wb, `${what}_${d}.xlsx`); }
    toast(`已导出 ${r.length} 行`, 'ok');
  };
  return (
    <div class="col">
      <div class="row wrap"><select class="select sm" value={what} onChange={e => setWhat(e.target.value)}><option value="LY">立法院成员</option><option value="execs">各县市首长</option><option value="events">本分支自定义事件</option>{unitsAt(d).map(u => <option value={'C:' + u.id}>{u.name}议会成员</option>)}</select>
        <button class="btn sm" onClick={() => out('xlsx')}><Icon name="download" size={13} />导出 Excel</button><button class="btn sm" onClick={() => out('csv')}><Icon name="download" size={13} />导出 CSV</button></div>
      <div class="tiny muted">导出以当前日期 {d}、当前分支的状态为准（含架空修改）。</div>
      <div class="section-title">模板快速生成</div>
      <button class="btn sm" onClick={async () => { if (!(await ensureEditable('复制史实资料'))) return; const s = seatsAt(branch.value, 'LY', branch.value.date); mutate(br => { br.patches.push({ id: uid('pt'), t: 'seats:LY', date: br.date, by: 'admin', v: { label: (s.label || '') + '（架空副本）', total: s.total, members: s.members.filter(m => !m.vacant).map(m => ({ p: m.p, name: m.name, party: m.party, district: m.district })), note: '复制史实组成作为可编辑版本' } }); }, '复制立法院组成为架空版本'); toast('已复制，可在席位编辑器修改'); }}>复制当前立法院组成为可编辑版本</button>
    </div>
  );
}
function Checker() {
  const b = branch.value, d = viewDate.value;
  const issues = useMemo(() => {
    const out = [];
    for (const p of b.patches) {
      if (p.t.startsWith('seats:')) {
        const v = p.v;
        if (!v) continue;
        if (v.members.length > v.total) out.push({ lvl: 'err', msg: `${instName(p.t.slice(6))}（${p.date}）：成员 ${v.members.length} 人多于总席数 ${v.total}` });
        const ids = v.members.map(m => m.p).filter(Boolean);
        if (new Set(ids).size !== ids.length) out.push({ lvl: 'err', msg: `${instName(p.t.slice(6))}（${p.date}）：有人物重复占席` });
        for (const m of v.members) if (m.party && m.party !== 'IND' && !partyExists(b, m.party, p.date)) out.push({ lvl: 'sim', msg: `${instName(p.t.slice(6))}：${m.p ? pname(b, m.p) : m.name} 所属${party(b, m.party).short}于 ${p.date} 尚未存在（架空自定义）` });
      }
      if (p.t.startsWith('exec:')) {
        const u = IDX.unit[p.t.slice(5)];
        if (u && ((u.from && p.date < u.from) || (u.to && p.date > u.to))) out.push({ lvl: 'warn', msg: `${u.name}首长修改日期 ${p.date} 不在该单位存续期间` });
        if (p.v?.party && p.v.party !== 'IND' && !partyExists(b, p.v.party, p.date)) out.push({ lvl: 'sim', msg: `${u?.name}首长所属${party(b, p.v.party).short}于 ${p.date} 尚未存在（架空自定义）` });
      }
      if (p.date > b.date) out.push({ lvl: 'warn', msg: `${TARGET_NAME(p.t)} 的生效日期 ${p.date} 晚于分支当前日期` });
    }
    for (const e of b.customEvents) if (e.date < '1986-01-01') out.push({ lvl: 'warn', msg: `事件「${e.title}」日期早于1986年` });
    for (const s of Object.values(b.sims || {})) { const tot = s.final.units.reduce((a, u) => a + u.valid, 0); const sum = s.final.units.reduce((a, u) => a + Object.values(u.votes).reduce((x, y) => x + y, 0), 0); if (tot !== sum) out.push({ lvl: 'err', msg: `模拟选举「${s.name}」票数汇总不一致` }); }
    return out;
  }, [b]);
  return (
    <div class="col">
      <div class="small">检查席位与成员、人物重复、日期先后、政党存在时间、行政归属、选举票数汇总。标示“架空自定义”的项目是你刻意建立的架空异常，系统不会擅自矫正。</div>
      {issues.map(i => <div class={`notice ${i.lvl === 'sim' ? 'sim' : i.lvl === 'warn' ? '' : ''}`} style={i.lvl === 'err' ? { background: 'rgba(255,59,48,.1)', color: '#b3261e' } : null}>{i.lvl === 'err' ? '错误' : i.lvl === 'sim' ? '架空自定义' : '提示'}：{i.msg}</div>)}
      {!issues.length && <div class="notice info">没有发现问题。</div>}
    </div>
  );
}
