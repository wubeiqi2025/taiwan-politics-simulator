// 地区政治详情：首长、议会、立委选区、最近选举、相关事件；架空编辑入口
import { useState } from 'preact/hooks';
import { branch, viewDate, sel, openPanel, mutate, uid, toast, ask, readOnly, prefs } from '../core/store.js';
import { IDX, DB, RESULTS, instName } from '../core/db.js';
import { execAt, townExecAt, townInfo, seatsAt, party, pname, latestElection, electionResult, unitAgg, activePatch, allEvents, unitTypeLabel, instExists, unitInfo, townsOfUnit, unitsAt } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { SeatChart, CompLegend } from './SeatChart.jsx';
import { PersonLink, PartyTag, D, fmtN, fmtP, Bar, Missing, SourceNote, DataClass } from './common.jsx';
import { PartySelect, PersonPicker } from './pickers.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable } from '../core/actions.js';
import { EditGear } from './EditMenu.jsx';
import { SeatEditor } from './SeatEditor.jsx';
import { EventEditor } from './EventsPanel.jsx';

export function RegionPanel() {
  const b = branch.value, d = viewDate.value, s = sel.value;
  if (!s.unit) return null;
  const u = unitInfo(b, s.unit, d);
  if (!u) return null;
  const t = s.town;
  const ti = t ? townInfo(t, d) : null;
  // 编辑入口统一收在标题栏的齿轮按钮中
  const items = [];
  if (!t) {
    const noun = u.name + (u.type === '縣' ? '县长' : '市长');
    items.push(
      { icon: 'person', name: `修改${noun}`, desc: '更换人选、党籍与产生方式（民选、代理、官派等）', run: () => editHead('exec:' + u.id, noun, execAt(b, u.id, d)) },
      { icon: 'flag', name: '指定模拟控制党', desc: '用于地图“模拟控制党”图层，与首长、议会资料互相独立', run: () => setControl(u) },
      { icon: 'parliament', name: `编辑${instName('C:' + u.id)}席位`, desc: '总席数、议员、党籍、议长、空缺', run: () => editSeats('C:' + u.id) },
      { icon: 'history', name: '新增本地事件', desc: '建立与此地区相关的自定义事件', run: () => addEvent(u.id) },
      { icon: 'map', name: '调整乡镇行政归属', desc: '在后台“区划归属”中改隶乡镇市区', run: () => openPanel('editor') },
    );
  } else if (ti.type !== '區') {
    items.push({ icon: 'person', name: `修改${ti.name}首长`, desc: '更换乡镇市长／区长人选与党籍', run: () => editHead('townexec:' + t, ti.name + '首长', townExecAt(b, t, d)) });
    if (IDX.inst['R:' + t] && instExists(IDX.inst['R:' + t], d)) items.push({ icon: 'parliament', name: `编辑${instName('R:' + t)}席位`, desc: '代表人数、成员与党籍', run: () => editSeats('R:' + t) });
    items.push({ icon: 'history', name: '新增本地事件', desc: '建立与此地区相关的自定义事件', run: () => addEvent(u.id) });
  } else {
    items.push({ icon: 'parliament', name: `编辑${instName('C:' + u.id)}席位`, desc: '直辖市区不设独立议会，改由市议会编辑', run: () => editSeats('C:' + u.id) });
  }
  return (
    <Panel id="region" title={t ? `${u.name} ${ti.name}` : u.name} sub={`${t ? ti.type : unitTypeLabel(u)}${u.prov && !t ? ' · ' + u.prov + '辖' : ''} · ${D(d)}`} icon="map" pos={{ x: 76, y: 108, w: 370 }}
      actions={<EditGear title={t ? ti.name : u.name} items={items} />}
      onClose={() => (sel.value = { unit: null, town: null })}>
      {t ? <TownBody u={u} t={t} ti={ti} /> : <UnitBody u={u} />}
    </Panel>
  );
}
async function editHead(target, noun, head) {
  if (!(await ensureEditable('修改地区首长'))) return;
  const v = await ask({ kind: 'custom', Comp: HeadEditor, props: { title: noun, cur: head } });
  if (!v) return;
  mutate(br => {
    let p = v.pid || null;
    if (!p && v.name) { const np = { id: uid('f'), n: v.name, fictional: true }; br.customPeople.push(np); p = np.id; }
    br.patches = br.patches.filter(x => !(x.t === target && x.date === br.date));
    br.patches.push({ id: uid('pt'), t: target, date: br.date, by: 'admin', v: { p, party: v.party, how: v.how } });
  }, `修改${noun}`);
  toast(`${noun}已更新`, 'ok');
}
async function setControl(u) {
  if (!(await ensureEditable('指定控制党'))) return;
  const ctl = activePatch(branch.value, 'control:' + u.id, branch.value.date);
  const v = await ask({ kind: 'custom', Comp: ControlEditor, props: { cur: ctl?.v } });
  if (v === undefined || v === false) return;
  mutate(br => { br.patches.push({ id: uid('pt'), t: 'control:' + u.id, date: br.date, by: 'admin', v: v || undefined }); }, `指定${u.name}控制党`);
}
async function editSeats(inst) {
  if (!(await ensureEditable('修改议会席位'))) return;
  ask({ kind: 'custom', wide: true, Comp: SeatEditor, props: { inst } });
}
async function addEvent(region) {
  if (!(await ensureEditable('新建自定义事件'))) return;
  const v = await ask({ kind: 'custom', wide: true, Comp: EventEditor, props: { ev: { date: branch.value.date, title: '', desc: '', cat: '党争', imp: 2, people: [], parties: [], regions: [region], effects: [], oneTime: true } } });
  if (!v) return;
  mutate(br => { br.customEvents.push({ ...v, id: uid('ce'), kind: 'custom' }); }, `新建事件 ${v.title}`);
  toast('事件已加入本分支时间轴', 'ok');
}
function HeadBlock({ head, title }) {
  return (
    <div class="inner" style={{ padding: 10 }}>
      <div class="row">
        <span class="small muted">{title}</span>
      </div>
      {head ? (
        <div class="row" style={{ marginTop: 4, gap: 8 }}>
          <b style={{ fontSize: 16 }}>{head.p ? <PersonLink pid={head.p} /> : head.name || <span class="muted">（姓名待补）</span>}</b>
          {head.party && <PartyTag id={head.party} />}
          {head.patch && <span class="chip sim">架空</span>}
        </div>
      ) : <div class="small muted" style={{ marginTop: 4 }}>资料待补</div>}
      {head && <div class="tiny muted" style={{ marginTop: 3 }}>{head.how || ''}{head.from ? ` · 任期 ${D(head.from)} — ${head.to ? D(head.to) : '—'}` : ''}{head.note ? ' · ' + head.note : ''}</div>}
    </div>
  );
}
function HeadEditor({ resolve, title, cur }) {
  const [v, setV] = useState({ pid: cur?.p || null, name: cur?.name || '', party: cur?.party || 'IND', how: '架空设定' });
  return (
    <>
      <div class="modal-head">修改{title}</div>
      <div class="modal-body col">
        <label class="field">人物<PersonPicker pid={v.pid} name={v.name} onPick={x => setV({ ...v, pid: x.pid || null, name: x.name || '' })} /></label>
        <label class="field">所属政党<PartySelect value={v.party} onChange={p => setV({ ...v, party: p })} small={false} /></label>
        <label class="field">产生方式<select class="select" value={v.how} onChange={e => setV({ ...v, how: e.target.value })}>{['架空设定', '民选', '代理', '官派', '补选', '政变／非常态'].map(x => <option>{x}</option>)}</select></label>
        <div class="tiny muted">自分支当前日期起生效。若之后真实历史发生首长更替，时间流动时会询问是否套用。</div>
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn primary" onClick={() => resolve(v)}>保存</button></div>
    </>
  );
}
function UnitBody({ u }) {
  const b = branch.value, d = viewDate.value;
  const head = execAt(b, u.id, d);
  const council = seatsAt(b, 'C:' + u.id, d);
  const ctl = activePatch(b, 'control:' + u.id, d);
  return (
    <div class="col" style={{ gap: 10 }}>
      {u.note && !(u.note.includes('战地政务') && d >= '1992-11-07') && <div class="notice info">{u.note}</div>}
      {u.id === 'TPE' && d < '1990-03-12' && <div class="notice">{DB.meta.taipeiNote}</div>}
      <HeadBlock head={head} title={u.type === '縣' ? '县长' : '市长'} noun={u.name + (u.type === '縣' ? '县长' : '市长')} editTarget={'exec:' + u.id} />
      <div class="row small">
        <span class="muted">模拟控制党</span>
        {ctl ? <PartyTag id={ctl.v} /> : <span class="muted">未指定（与首长党籍为独立资料）</span>}
      </div>
      <div>
        <div class="row"><div class="section-title">{instName('C:' + u.id)}</div><button class="btn ghost sm right shot-hide" onClick={() => openPanel('parliament', { inst: 'C:' + u.id })}>在议会面板打开</button></div>
        {!council && <Missing>该日期无议会资料</Missing>}
        {council?.missing && <Missing><div>{council.label}：资料待补</div><div class="tiny">{council.note}</div></Missing>}
        {council && !council.missing && <><SeatChart seats={council} width={300} /><CompLegend comp={council.comp} total={council.total} /><div class="tiny muted">议会最大党与县市长所属党派为两项独立资料。</div></>}
      </div>
      <LyDistricts towns={townsOfUnit(b, u.id, d)} />
      <RecentElections u={u.id} />
      <RegionEvents ids={[u.id, ...(u.pred || []), u.succ].filter(Boolean)} />
      <SourceNote src={head?.patch ? 'admin' : head?.src || 'cec'} verified={head?.verified} prec={head?.prec} />
    </div>
  );
}
function ControlEditor({ resolve, cur }) {
  const [v, setV] = useState(cur || 'KMT');
  return (
    <>
      <div class="modal-head">指定模拟控制党</div>
      <div class="modal-body col"><PartySelect value={v} onChange={setV} small={false} /><div class="tiny muted">用于地图“模拟控制党”图层，不影响首长与议会资料。</div></div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(false)}>取消</button><button class="btn danger" onClick={() => resolve(null)}>清除指定</button><button class="btn primary" onClick={() => resolve(v)}>保存</button></div>
    </>
  );
}
function TownBody({ u, t, ti }) {
  const b = branch.value, d = viewDate.value;
  const isDistrict = ti.type === '區';
  const head = isDistrict ? null : townExecAt(b, t, d);
  const inst = IDX.inst['R:' + t];
  const rep = inst && instExists(inst, d) ? seatsAt(b, 'R:' + t, d) : null;
  return (
    <div class="col" style={{ gap: 10 }}>
      {ti.note && <div class="notice">{ti.note}</div>}
      <div class="kv">
        <span>行政层级</span><span>{ti.type}</span>
        <span>上级地区</span><span><a href="#" onClick={e => { e.preventDefault(); sel.value = { unit: u.id, town: null }; }}>{u.name}</a></span>
        {ti.modern !== ti.name && <><span>今名</span><span>{IDX.unit[u.id] && ti.modern}</span></>}
      </div>
      {isDistrict ? <div class="notice info">该地区为{u.type === '直轄市' ? '直辖市' : '省辖市'}之区，区长由市长任命，不设独立民选议会。<a href="#" onClick={e => { e.preventDefault(); openPanel('parliament', { inst: 'C:' + u.id }); }}>查看{u.name}议会</a></div>
        : <HeadBlock head={head} title={ti.type === '山地原住民區' ? '区长' : '乡镇市长'} noun={ti.name + '首长'} editTarget={'townexec:' + t} />}
      {!isDistrict && (
        <div>
          <div class="section-title">{inst ? instName('R:' + t) : '民意机关'}</div>
          {!rep && <Missing>{inst && !instExists(inst, d) ? '此日期不设代表会' : '资料待补'}</Missing>}
          {rep?.missing && <Missing>{rep.label} 资料待补</Missing>}
          {rep && !rep.missing && <><SeatChart seats={rep} width={260} /><CompLegend comp={rep.comp} total={rep.total} /></>}
          {!rep && inst && <div class="tiny muted" style={{ marginTop: 4 }}>中选会资料库收录2010年起的乡镇市民代表选举；更早届次待补。</div>}
        </div>
      )}
      <LyDistricts towns={[t]} />
      <TownElection t={t} u={u.id} />
    </div>
  );
}
function LyDistricts({ towns }) {
  const b = branch.value, d = viewDate.value;
  const el = latestElection(b, d, e => e.type === 'ly' && !e.summary);
  if (!el) return null;
  const res = electionResult(b, el.id);
  const ds = res.districts.filter(x => x.towns?.some(t => towns.includes(t)));
  if (!ds.length) return null;
  return (
    <div>
      <div class="section-title">立委选区（{el.name}）</div>
      {ds.map(x => (
        <div class="list-item small" onClick={() => openPanel('election', { view: el.id, district: x.k })}>
          <span class="grow ellipsis">{x.name}{x.seats > 1 ? <span class="chip" style={{ height: 16, marginLeft: 4 }}>应选{x.seats}</span> : ''}</span>
          <span class="row" style={{ gap: 4 }}>{x.cands.filter(c => c.win).slice(0, 4).map(c => <span class="row" style={{ gap: 3 }}><span class="dot" style={{ background: party(b, c.party).color }} />{c.name}</span>)}{x.cands.filter(c => c.win).length > 4 && '…'}</span>
        </div>
      ))}
    </div>
  );
}
function Race({ title, cands, valid, el, onOpen }) {
  const b = branch.value;
  const tot = valid || cands.reduce((a, c) => a + (c.votes || 0), 0);
  return (
    <div class="inner" style={{ padding: 9, cursor: onOpen ? 'pointer' : undefined }} onClick={onOpen}>
      <div class="row small"><b>{title}</b><span class="muted tiny right">{el.date}</span></div>
      {cands.slice().sort((a, c) => (c.votes || 0) - (a.votes || 0)).slice(0, 5).map(c => (
        <div style={{ marginTop: 5 }}>
          <div class="row small"><span class="dot" style={{ background: party(b, c.party).color }} /><span class="grow ellipsis">{c.name}{c.vice ? '／' + c.vice : ''}</span>{c.win && <span class="status-tag won">当选</span>}<span class="num">{c.votes != null ? fmtP(c.votes / tot * 100) : '—'}</span></div>
          <Bar pct={c.votes / tot * 100} color={party(b, c.party).color} />
        </div>
      ))}
    </div>
  );
}
function RecentElections({ u }) {
  const b = branch.value, d = viewDate.value;
  const mayorEl = latestElection(b, d, e => e.type === 'mayor' && electionResult(b, e.id)?.races?.[u]);
  const presEl = latestElection(b, d, e => e.type === 'president');
  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="section-title">最近相关选举</div>
      {mayorEl && (() => { const r = electionResult(b, mayorEl.id).races[u]; return <Race title={mayorEl.name + (r.partial ? '（仅当选人）' : '')} cands={r.cands} valid={r.valid} el={mayorEl} onOpen={() => openPanel('election', { view: mayorEl.id, unit: u })} />; })()}
      {!mayorEl && <div class="small muted">此前无收录的首长选举结果（1985年前或官派时期）。</div>}
      {presEl && (() => { const res = electionResult(b, presEl.id); const v = unitAgg(res, u, b, d); if (!v) return null; return <Race title={presEl.name + '（本地得票）'} cands={res.cands.map((c, i) => ({ ...c, votes: v.votes[i], win: false }))} el={presEl} onOpen={() => openPanel('election', { view: presEl.id })} />; })()}
      {mayorEl && electionResult(b, mayorEl.id).races[u]?.turnout && <div class="tiny muted">投票率 {fmtP(electionResult(b, mayorEl.id).races[u].turnout)} · 选举人 {fmtN(electionResult(b, mayorEl.id).races[u].electorate)}</div>}
    </div>
  );
}
function TownElection({ t, u }) {
  const b = branch.value, d = viewDate.value;
  const el = latestElection(b, d, e => e.type === 'township' && electionResult(b, e.id)?.towns?.[t]);
  const presEl = latestElection(b, d, e => e.type === 'president');
  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="section-title">最近相关选举</div>
      {el && <Race title={el.name} cands={electionResult(b, el.id).towns[t].cands} el={el} onOpen={() => openPanel('election', { view: el.id })} />}
      {presEl && electionResult(b, presEl.id).byTown?.[t] && (() => { const res = electionResult(b, presEl.id); const v = res.byTown[t]; return <Race title={presEl.name + '（本地得票）'} cands={res.cands.map((c, i) => ({ ...c, votes: v.votes[i], win: false }))} el={presEl} onOpen={() => openPanel('election', { view: presEl.id })} />; })()}
    </div>
  );
}
function RegionEvents({ ids }) {
  const b = branch.value, d = viewDate.value;
  const evs = allEvents(b).filter(e => e.date <= d && e.regions?.some(r => ids.includes(r)) && e.auto !== 'term').slice(-8).reverse();
  if (!evs.length) return null;
  return (
    <div>
      <div class="section-title">相关历史事件</div>
      {evs.map(e => <div class="list-item small" onClick={() => openPanel('events', { focus: e.id })}><span class="muted num tiny" style={{ width: 70 }}>{e.date}</span><span class="grow ellipsis">{e.title}</span>{e.kind === 'custom' && <span class="chip sim" style={{ height: 16 }}>架空</span>}</div>)}
    </div>
  );
}
