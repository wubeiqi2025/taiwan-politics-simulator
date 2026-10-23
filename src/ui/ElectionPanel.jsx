// 选举面板：选择选举 → 查看史实结果 → 复制为模拟／新建架空 → 设置比例与补齐 → 开票
import { useState, useMemo, useEffect } from 'preact/hooks';
import { branch, viewDate, panelArgs, openPanel, mutate, toast, ask, isSim, prefs, setPrefs, counting, closePanel, uid } from '../core/store.js';
import { DB, IDX, RESULTS } from '../core/db.js';
import { party, pname, allParties, partyExists, electionResult } from '../core/world.js';
import { simFromReal, simFromCouncil, simNew, computeFinal, fillRemaining, nationalShares, targetConflicts, weightedTurnout, SIM_TYPES, nationalTotals } from '../core/sim.js';
import { Panel } from './Panel.jsx';
import { PersonLink, PartyTag, PartyDot, D, fmtN, fmtP, Bar, Missing, SourceNote, DataClass, Seg } from './common.jsx';
import { PartySelect } from './pickers.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable } from '../core/actions.js';

const TYPE_NAME = { president: '总统', ly: '立委', mayor: '县市长', council: '县市议员', township: '乡镇市长', townrep: '乡镇市民代表', na: '国民大会', governor: '省长', indirect: '间接选举' };
const clone = o => JSON.parse(JSON.stringify(o));

export function ElectionPanel() {
  const args = panelArgs.value.election || {};
  const b = branch.value;
  let body, title = '选举', sub = '';
  if (args.sim && b.sims?.[args.sim]) { body = <SimEditor key={args.sim} simId={args.sim} />; title = b.sims[args.sim].name; sub = '模拟选举设置'; }
  else if (args.view) { body = <RealView id={args.view} unit={args.unit} district={args.district} />; title = IDX.election[args.view]?.name || (b.confirmed?.[args.view]?.name) || '选举结果'; sub = '选举结果'; }
  else body = <Chooser setup={args.setup} />;
  return (
    <Panel id="election" title={title} sub={sub} icon="ballot" pos={{ x: 80, y: 100, w: 560, h: 640 }}
      actions={(args.sim || args.view) && <button class="btn ghost sm shot-hide" onClick={() => openPanel('election', {})}><Icon name="chevronL" size={13} />选举列表</button>}>
      {body}
    </Panel>
  );
}

// ---------- 选择 ----------
function Chooser({ setup }) {
  const b = branch.value, d = viewDate.value;
  const [type, setType] = useState('all');
  const [year, setYear] = useState('');
  const list = DB.elections.filter(e => (type === 'all' || e.type === type) && (!year || e.date.startsWith(year))).slice().reverse();
  const sims = Object.values(b.sims || {}).sort((x, y) => (y.created || '').localeCompare(x.created || ''));
  useEffect(() => { if (setup) openPanel('election', { view: setup, fromFlow: true }); }, [setup]);
  const createNew = async () => {
    if (!(await ensureEditable('新建架空选举'))) return;
    const v = await ask({ kind: 'custom', Comp: NewSimDialog });
    if (!v) return;
    const sim = simNew(branch.value, v);
    mutate(br => { br.sims[sim.id] = sim; }, `新建${sim.name}`);
    openPanel('election', { sim: sim.id });
  };
  return (
    <div class="col">
      <div class="row wrap" style={{ gap: 4 }}>
        {['all', 'president', 'ly', 'mayor', 'council', 'township', 'townrep', 'na', 'governor'].map(t => <button class={`btn sm ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{t === 'all' ? '全部' : TYPE_NAME[t]}</button>)}
      </div>
      <div class="row"><input class="input sm num" style={{ width: 90 }} placeholder="年份筛选" value={year} onInput={e => setYear(e.target.value)} /><button class="btn sm primary right" onClick={createNew}><Icon name="plus" size={13} />全新架空选举</button></div>
      {sims.length > 0 && <div><div class="section-title">本分支的模拟选举</div>
        {sims.map(s => <div class="list-item small" onClick={() => openPanel('election', { sim: s.id })}><span class="chip sim" style={{ height: 18 }}>{s.source === 'demo' ? '推演' : s.confirmed ? '已确认' : '设置中'}</span><span class="grow ellipsis">{s.name}</span><span class="muted tiny">{s.date}</span></div>)}
      </div>}
      <div class="section-title">史实选举（{list.length}）</div>
      <div class="list">
        {list.map(e => (
          <div class="list-item small" onClick={() => openPanel('election', { view: e.id })} style={{ opacity: e.date > d ? 0.55 : 1 }}>
            <span class="num tiny muted" style={{ width: 74 }}>{e.date}</span>
            <span class="grow ellipsis">{e.name}</span>
            <span class="chip" style={{ height: 18 }}>{TYPE_NAME[e.type]}</span>
            {e.summary && <span class="chip warn" style={{ height: 18 }}>摘要</span>}
            {e.date > d && <span class="tiny muted">尚未到达</span>}
          </div>
        ))}
      </div>
      <div class="tiny muted">1994年以后的选举资料取自中选会选举资料库；更早的选举仅有摘要（标“摘要”）。2026年11月28日地方选举尚未举行，不列出结果，可新建架空选举模拟。</div>
    </div>
  );
}
function NewSimDialog({ resolve }) {
  const b = branch.value;
  const ps = allParties(b).filter(p => !p.minor && p.id !== 'IND' && partyExists(b, p.id, b.date));
  const [v, setV] = useState({ type: 'mayor', date: b.date, name: '', parties: ps.slice(0, 3).map(p => p.id), unitId: 'TPE' });
  const units = DB.units.filter(u => (!u.from || u.from <= v.date) && (!u.to || u.to >= v.date));
  return (
    <>
      <div class="modal-head">全新架空选举</div>
      <div class="modal-body col">
        <div class="row wrap">
          <label class="field">类型<select class="select" value={v.type} onChange={e => setV({ ...v, type: e.target.value })}>{['president', 'ly', 'mayor', 'council'].map(t => <option value={t}>{SIM_TYPES[t]}</option>)}</select></label>
          <label class="field">投票日<input class="input" type="date" value={v.date} onInput={e => setV({ ...v, date: e.target.value })} /></label>
          {v.type === 'council' && <label class="field">县市<select class="select" value={v.unitId} onChange={e => setV({ ...v, unitId: e.target.value })}>{units.map(u => <option value={u.id}>{u.name}</option>)}</select></label>}
        </div>
        <label class="field">名称<input class="input" placeholder={`架空${SIM_TYPES[v.type]}选举`} value={v.name} onInput={e => setV({ ...v, name: e.target.value })} /></label>
        <div class="small muted">参选政党（每地各推一人，可在设置中修改候选人与比例）</div>
        <div class="row wrap" style={{ gap: 6 }}>{allParties(b).filter(p => !p.minor).map(p => <label class="chip click"><input type="checkbox" checked={v.parties.includes(p.id)} onChange={e => setV({ ...v, parties: e.target.checked ? [...v.parties, p.id] : v.parties.filter(x => x !== p.id) })} /><span class="dot" style={{ background: p.color }} />{p.short}</label>)}</div>
        <div class="tiny muted">选举人数取各县市最近一次总统或县市长选举之资料；无资料者以估计值并标记“系统估算”。</div>
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn primary" disabled={v.parties.length < 2} onClick={() => resolve({ ...v, parties: v.parties.map(id => party(b, id)) })}>建立</button></div>
    </>
  );
}

// ---------- 史实结果 ----------
function RealView({ id, unit, district }) {
  const b = branch.value, d = viewDate.value;
  const el = IDX.election[id] || b.confirmed?.[id]?.meta;
  const res = electionResult(b, id);
  const [cu, setCu] = useState(unit || null);
  if (!el || !res) return <Missing>无此选举资料</Missing>;
  const future = el.date > d;
  const copy = async (demo) => {
    if (!demo && !(await ensureEditable('复制史实选举为模拟选举'))) return;
    try {
      let sim;
      if (el.type === 'council') {
        const u = cu || await ask({ kind: 'custom', Comp: PickCouncilUnit, props: { res } });
        if (!u) return;
        sim = simFromCouncil(branch.value, id, u, { demo });
      } else sim = simFromReal(branch.value, id, { demo });
      mutate(br => { br.sims[sim.id] = sim; }, demo ? `推演开票 ${sim.name}` : `复制选举 ${sim.name}`, { undo: !demo });
      if (demo) startCount(sim.id);
      else openPanel('election', { sim: sim.id });
      toast(demo ? '已建立推演开票（根据最终结果演示）' : '已按真实历史结果生成模拟底稿（不会改动史料）', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };
  const canSim = !el.summary && ['president', 'ly', 'mayor', 'council'].includes(el.type);
  return (
    <div class="col">
      <div class="row wrap" style={{ gap: 6 }}>
        <span class="chip">{TYPE_NAME[el.type]}</span><span class="small muted">{D(el.date)}{el.start ? ` · 就职 ${D(el.start)}` : ''}</span>
        {res.simulated ? <span class="chip sim">本分支选举结果（模拟）</span> : <span class="chip real">官方最后结果</span>}
        {future && <span class="chip warn">晚于当前日期</span>}
      </div>
      {canSim && <div class="row wrap shot-hide" style={{ gap: 6 }}>
        <button class="btn sm primary" onClick={() => copy(false)}><Icon name="copy" size={13} />按真实历史结果生成模拟</button>
        <button class="btn sm" onClick={() => copy(true)}><Icon name="play" size={12} />推演开票（演示）</button>
      </div>}
      {el.note && <div class="notice info">{el.note}</div>}
      {el.summary && <SummaryResult el={el} res={res} />}
      {el.type === 'president' && <PresidentResult res={res} />}
      {el.type === 'mayor' && <MayorResult res={res} cu={cu} setCu={setCu} />}
      {(el.type === 'ly' || el.type === 'council' || el.type === 'na') && !el.summary && <DistrictResult res={res} el={el} focus={district} cu={cu} setCu={setCu} />}
      {(el.type === 'township' || el.type === 'townrep') && <TownResult res={res} el={el} />}
      <SourceNote src={res.simulated ? 'sim' : el.src} verified={el.verified} />
      {!res.simulated && <div class="tiny muted">细分层级未取得官方资料时显示为未知，不做平均填充。</div>}
    </div>
  );
}
function PickCouncilUnit({ resolve, res }) {
  const us = [...new Set(res.districts.map(d => d.u))].filter(Boolean);
  return (<><div class="modal-head">选择县市</div><div class="modal-body"><div class="row wrap" style={{ gap: 6 }}>{us.map(u => <button class="btn sm" onClick={() => resolve(u)}>{IDX.unit[u].name}</button>)}</div></div><div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button></div></>);
}
function SummaryResult({ el, res }) {
  const b = branch.value;
  if (res.cands) return <CandBars cands={res.cands} />;
  const total = Object.values(res.seats || {}).reduce((a, x) => a + x, 0);
  return (
    <div class="col">
      <table class="table"><thead><tr><th>政党</th><th>席次</th>{res.partyVotes && <th>得票</th>}</tr></thead>
        <tbody>{Object.entries(res.seats || {}).sort((x, y) => y[1] - x[1]).map(([p, n]) => <tr><td><PartyDot id={p} /> {party(b, p).name}</td><td class="num">{n} <span class="tiny muted">/{total}</span></td>{res.partyVotes && <td class="num">{fmtN(res.partyVotes[p])}</td>}</tr>)}</tbody></table>
      {res.turnout && <div class="small">投票率 {fmtP(res.turnout)}</div>}
      <div class="tiny muted">早期选举仅收录党派席次摘要；候选人分区得票资料待补。</div>
    </div>
  );
}
function CandBars({ cands, valid }) {
  const b = branch.value;
  const tot = valid || cands.reduce((a, c) => a + (c.votes || 0), 0);
  return (
    <div class="col" style={{ gap: 6 }}>
      {cands.slice().sort((a, c) => (c.votes || 0) - (a.votes || 0)).map(c => (
        <div>
          <div class="row small"><PartyDot id={c.party} /><b>{c.pid ? <PersonLink pid={c.pid} /> : c.name}</b>{c.vice && <span class="muted">／{c.vpid ? <PersonLink pid={c.vpid} /> : c.vice}</span>}<span class="muted tiny">{party(b, c.party).short}</span>{c.win && <span class="status-tag won">当选</span>}<span class="right num">{fmtN(c.votes)}</span><b class="num" style={{ width: 62, textAlign: 'right' }}>{fmtP(c.votes / tot * 100)}</b></div>
          <Bar pct={c.votes / tot * 100} color={party(b, c.party).color} />
        </div>
      ))}
    </div>
  );
}
function PresidentResult({ res }) {
  const b = branch.value;
  const nat = res.national || {};
  const cands = res.cands.map((c, i) => ({ ...c, votes: nat.votes?.[i] }));
  return (
    <div class="col">
      <CandBars cands={cands} valid={nat.valid} />
      <div class="kv"><span>投票率</span><span class="num">{fmtP(nat.turnout)}</span><span>有效票</span><span class="num">{fmtN(nat.valid)}</span><span>无效票</span><span class="num">{fmtN(nat.invalid)}</span><span>选举人</span><span class="num">{fmtN(nat.electorate)}</span></div>
      <div class="section-title">各县市</div>
      <table class="table"><thead><tr><th>县市</th>{res.cands.map(c => <th class="num"><PartyDot id={c.party} /> {c.name}</th>)}<th>投票率</th></tr></thead>
        <tbody>{Object.entries(res.byUnit).map(([u, v]) => { const t = v.votes.reduce((a, x) => a + x, 0); const mx = Math.max(...v.votes); return <tr><td>{IDX.unit[u]?.name}</td>{v.votes.map(x => <td class="num" style={{ fontWeight: x === mx ? 700 : 400 }}>{fmtP(x / t * 100, 1)}</td>)}<td class="num">{fmtP(v.turnout, 1)}</td></tr>; })}</tbody></table>
    </div>
  );
}
function MayorResult({ res, cu, setCu }) {
  const b = branch.value;
  const us = Object.keys(res.races);
  const u = cu && res.races[cu] ? cu : us[0];
  const comp = {}; for (const r of Object.values(res.races)) { const w = r.cands.find(c => c.win); if (w) comp[w.party] = (comp[w.party] || 0) + 1; }
  return (
    <div class="col">
      <div class="row wrap" style={{ gap: 4 }}>{Object.entries(comp).sort((x, y) => y[1] - x[1]).map(([p, n]) => <span class="chip"><PartyDot id={p} />{party(b, p).short} {n}席</span>)}</div>
      <div class="row wrap" style={{ gap: 4 }}>{us.map(x => <button class={`btn sm ${x === u ? 'on' : ''}`} onClick={() => setCu(x)}>{IDX.unit[x]?.name}</button>)}</div>
      {u && <><CandBars cands={res.races[u].cands} valid={res.races[u].valid} />
        {res.races[u].turnout && <div class="kv"><span>投票率</span><span class="num">{fmtP(res.races[u].turnout)}</span><span>有效票</span><span class="num">{fmtN(res.races[u].valid)}</span><span>无效票</span><span class="num">{fmtN(res.races[u].invalid)}</span><span>选举人</span><span class="num">{fmtN(res.races[u].electorate)}</span></div>}
        {res.races[u].partial && <div class="tiny muted">仅收录当选人，其他候选人资料待补。</div>}</>}
    </div>
  );
}
function DistrictResult({ res, el, focus, cu, setCu }) {
  const b = branch.value;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(focus || null);
  const comp = {};
  for (const d of res.districts) for (const c of d.cands) if (c.win) comp[c.party] = (comp[c.party] || 0) + 1;
  const pl = res.partyList;
  const plSeats = pl?.seats ? Object.fromEntries(pl.parties.map((p, i) => [p, pl.seats[i]])) : null;
  if (plSeats) for (const [p, n] of Object.entries(plSeats)) if (n) comp[p] = (comp[p] || 0) + n;
  const ds = res.districts.filter(d => (!cu || d.u === cu) && (!q || d.name.includes(q) || d.cands.some(c => c.name.includes(q))));
  const units = [...new Set(res.districts.map(d => d.u).filter(Boolean))];
  return (
    <div class="col">
      <div class="small muted">当选席次合计{plSeats ? '（含不分区）' : '（区域与原住民，不含不分区与侨选）'}：</div>
      <div class="row wrap" style={{ gap: 4 }}>{Object.entries(comp).sort((x, y) => y[1] - x[1]).map(([p, n]) => <span class="chip"><PartyDot id={p} />{party(b, p).short} {n}</span>)}</div>
      {pl && <div><div class="section-title">政党票（不分区）</div>
        {pl.parties.map((p, i) => ({ p, v: pl.national.votes[i], s: pl.seats?.[i] })).sort((x, y) => y.v - x.v).slice(0, 8).map(x => { const tot = pl.national.votes.reduce((a, c) => a + c, 0); return <div class="row small" style={{ marginTop: 3 }}><PartyDot id={x.p} /><span class="grow">{party(b, x.p).name}</span><span class="num">{fmtP(x.v / tot * 100)}</span><b class="num" style={{ width: 40, textAlign: 'right' }}>{x.s || 0}席</b></div>; })}
      </div>}
      <div class="row"><select class="select sm" value={cu || ''} onChange={e => setCu(e.target.value || null)}><option value="">全部县市</option>{units.map(u => <option value={u}>{IDX.unit[u]?.name}</option>)}</select><input class="input sm grow" placeholder="搜索选区或候选人" value={q} onInput={e => setQ(e.target.value)} /></div>
      <div class="list">
        {ds.slice(0, 150).map(d => (
          <div>
            <div class="list-item small" onClick={() => setOpen(open === d.k ? null : d.k)}>
              <span class="grow ellipsis"><b>{d.name}</b>{d.kind && <span class="muted tiny"> {d.kind}</span>} <span class="tiny muted">应选{d.seats}</span></span>
              <span class="row" style={{ gap: 3 }}>{d.cands.filter(c => c.win).slice(0, 5).map(c => <span class="dot" style={{ background: party(b, c.party).color }} title={c.name} />)}</span>
              <Icon name={open === d.k ? 'chevronD' : 'chevronR'} size={12} />
            </div>
            {open === d.k && <div style={{ padding: '4px 8px 8px' }}><CandBars cands={d.cands} valid={d.valid} />{d.turnout && <div class="tiny muted" style={{ marginTop: 4 }}>投票率 {fmtP(d.turnout)} · 有效票 {fmtN(d.valid)} · 无效票 {fmtN(d.invalid)}</div>}</div>}
          </div>
        ))}
        {ds.length > 150 && <div class="empty">请用筛选缩小范围（共{ds.length}区）</div>}
      </div>
    </div>
  );
}
function TownResult({ res }) {
  const b = branch.value;
  const [q, setQ] = useState('');
  const towns = Object.keys(res.towns || {}).filter(t => !q || DB.towns[t].n.includes(q) || DB.towns[t].c.includes(q));
  return (
    <div class="col">
      <input class="input sm" placeholder="搜索乡镇" value={q} onInput={e => setQ(e.target.value)} />
      {towns.slice(0, 60).map(t => { const v = res.towns[t]; const list = Array.isArray(v) ? v.flatMap(x => x.cands) : v.cands; const w = list.filter(c => c.win); return (
        <div class="list-item small"><span style={{ width: 120 }} class="ellipsis">{DB.towns[t].c}{DB.towns[t].n}</span><span class="grow row wrap" style={{ gap: 4 }}>{w.slice(0, 12).map(c => <span class="row" style={{ gap: 2 }}><span class="dot" style={{ background: party(b, c.party).color }} />{c.name}</span>)}{w.length > 12 && '…'}</span></div>); })}
      {towns.length > 60 && <div class="empty">共 {towns.length} 个乡镇，请搜索</div>}
    </div>
  );
}

// ---------- 模拟设置 ----------
export function startCount(simId) {
  const p = prefs.value;
  counting.value = { simId, idx: -1, prevMode: p.mapMode };
  setPrefs({ mapMode: 'count' });
  openPanel('count');
}
function SimEditor({ simId }) {
  const b = branch.value;
  const stored = b.sims[simId];
  const [sim, setSim] = useState(() => clone(stored));
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState('parties');
  const [unitQ, setUnitQ] = useState('');
  const upd = f => { const s = clone(sim); f(s); computeFinal(s); setSim(s); setDirty(true); };
  const save = (msg = '保存模拟设置') => { mutate(br => { br.sims[simId] = clone(sim); }, msg); setDirty(false); };
  const cb = Object.fromEntries(sim.cands.map(c => [c.k, c]));
  const shares = nationalShares(sim);
  const parties = [...new Set(sim.cands.map(c => c.party))].sort((x, y) => (shares[y] || 0) - (shares[x] || 0));
  const lockedSum = parties.filter(p => sim.targets[p]?.locked).reduce((a, p) => a + (sim.targets[p].pct || 0), 0);
  const setTarget = (p, pct, locked) => upd(s => {
    const t = s.targets[p] || {};
    const others = parties.filter(x => x !== p && s.targets[x]?.pct != null).reduce((a, x) => a + s.targets[x].pct, 0);
    pct = Math.max(0, Math.min(100 - others, pct));
    s.targets[p] = { ...t, pct, locked: locked ?? t.locked };
  });
  const conflicts = targetConflicts(sim);
  const totals = nationalTotals(sim, sim.final.units);
  const fill = () => { const s = clone(sim); fillRemaining(s); setSim(s); setDirty(true); toast('已补齐：管理员指定项保持不变，其余为系统估算', 'ok'); };
  const assigned = parties.filter(p => sim.targets[p]?.pct != null).reduce((a, p) => a + sim.targets[p].pct, 0);
  const seatComp = sim.seats?.comp || {};
  const pres = sim.type === 'president' ? cb[sim.seats.president] : null;
  const units = sim.units.filter(u => !unitQ || u.name.includes(unitQ));
  const begin = () => { if (dirty) save('开票前保存设置'); startCount(simId); };
  return (
    <div class="col">
      <div class="row wrap" style={{ gap: 6 }}>
        <span class="chip sim">{sim.source === 'demo' ? '推演开票（演示）' : sim.source === 'copy' ? '由史实复制的模拟' : '全新架空选举'}</span>
        <span class="small muted">{D(sim.date)} · 就职 {D(sim.termStart)}</span>
        {sim.confirmed && <span class="chip real">已确认为本分支结果</span>}
        {dirty && <span class="chip warn">未保存</span>}
      </div>
      <div class="row wrap shot-hide" style={{ gap: 6 }}>
        <button class="btn sm primary" onClick={fill}><Icon name="sparkle" size={13} />一键补齐剩余数据</button>
        <button class="btn sm" disabled={!dirty} onClick={() => save()}><Icon name="save" size={13} />保存设置</button>
        <button class="btn sm" onClick={begin}><Icon name="play" size={12} />开始逐步开票</button>
        <Seg value={view} onChange={setView} options={[{ id: 'parties', name: '全国比例' }, { id: 'units', name: '各地设置' }, { id: 'count', name: '开票方式' }]} />
      </div>
      {conflicts.length > 0 && <div class="notice">与全国目标不一致：{conflicts.map(c => `${party(b, c.party).short} 目标${fmtP(c.target, 1)}，现为${fmtP(c.got, 1)}`).join('；')}。请按“一键补齐”重新分配，或放宽地区锁定。</div>}
      {view === 'parties' && (
        <div class="col">
          <div class="small muted">拖动滑块或输入得票率设定全国目标；锁定后补齐不会改动。已指定合计 {fmtP(assigned, 1)}，其余可分配 <b>{fmtP(100 - assigned, 1)}</b>。</div>
          {parties.map(p => {
            const t = sim.targets[p];
            return (
              <div class="inner" style={{ padding: '7px 9px' }}>
                <div class="row small"><PartyDot id={p} /><b class="grow">{party(b, p).name}</b><span class="muted">现 {fmtP(shares[p] || 0, 2)}</span>
                  <input class="input sm num" style={{ width: 70 }} type="number" step="0.1" value={t?.pct != null ? +t.pct.toFixed(2) : ''} placeholder="自动" onChange={e => e.target.value === '' ? upd(s => { delete s.targets[p]; }) : setTarget(p, +e.target.value)} />
                  <button class={`btn sm icon ${t?.locked ? 'on' : 'ghost'}`} title={t?.locked ? '已锁定' : '锁定'} onClick={() => setTarget(p, t?.pct ?? shares[p] ?? 0, !t?.locked)}><Icon name={t?.locked ? 'lock' : 'unlock'} size={13} /></button>
                </div>
                <input type="range" min="0" max="100" step="0.1" style={{ width: '100%' }} value={t?.pct ?? shares[p] ?? 0} disabled={t?.locked} onInput={e => setTarget(p, +e.target.value)} />
              </div>
            );
          })}
          <div class="row small"><span class="muted">全国投票率目标</span><input class="input sm num" style={{ width: 70 }} type="number" step="0.1" value={sim.turnoutTarget ?? ''} placeholder={weightedTurnout(sim).toFixed(1)} onChange={e => upd(s => { s.turnoutTarget = e.target.value === '' ? null : +e.target.value; })} />%</div>
          {sim.partyList?.independent && <PartyListEdit sim={sim} upd={upd} />}
          <ResultPreview sim={sim} totals={totals} pres={pres} seatComp={seatComp} />
        </div>
      )}
      {view === 'units' && (
        <div class="col">
          <input class="input sm" placeholder="搜索地区／选区" value={unitQ} onInput={e => setUnitQ(e.target.value)} />
          <div class="tiny muted">修改任一地区的候选人得票率后，该地标记为“管理员指定”，补齐时保持不变。合计自动保持100%。</div>
          {units.slice(0, 80).map(u => <UnitEdit u={u} sim={sim} upd={upd} cb={cb} />)}
          {units.length > 80 && <div class="empty">请搜索以显示更多（共{units.length}）</div>}
        </div>
      )}
      {view === 'count' && <CountSettings />}
      <SourceNote src="sim" extra={<span class="tiny">模拟数据不会反向写入史料库</span>} />
    </div>
  );
}
function PartyListEdit({ sim, upd }) {
  const b = branch.value;
  const pl = sim.partyList;
  const sum = pl.parties.reduce((a, p) => a + (pl.shares[p] || 0), 0);
  const top = [...pl.parties].sort((x, y) => (pl.shares[y] || 0) - (pl.shares[x] || 0)).slice(0, 8);
  return (
    <div class="inner" style={{ padding: 8 }}>
      <div class="small bold">政党票（不分区 {pl.seats} 席，门槛 {pl.threshold}%）</div>
      {top.map(p => (
        <div class="row small" style={{ marginTop: 4 }}>
          <PartyDot id={p} /><span class="grow">{party(b, p).short}</span>
          <input type="range" min="0" max="80" step="0.1" value={pl.shares[p] || 0} onInput={e => upd(s => { const v = +e.target.value; const others = s.partyList.parties.filter(x => x !== p); const rest = others.reduce((a, x) => a + (s.partyList.shares[x] || 0), 0); s.partyList.shares[p] = v; const room = 100 - v; for (const x of others) s.partyList.shares[x] = rest ? (s.partyList.shares[x] || 0) / rest * room : room / others.length; })} />
          <span class="num" style={{ width: 52, textAlign: 'right' }}>{fmtP(pl.shares[p] || 0, 1)}</span>
          <b class="num" style={{ width: 34, textAlign: 'right' }}>{sim.seats.plSeats?.[p] || 0}席</b>
        </div>
      ))}
      <div class="tiny muted">拖动一党时，其余政党按原比例分配剩余（合计 {fmtP(sum, 1)}）。</div>
    </div>
  );
}
function UnitEdit({ u, sim, upd, cb }) {
  const b = branch.value;
  const fin = sim.final.units.find(x => x.k === u.k);
  const winners = sim.seats.winners[u.k] || [];
  const setShare = (c, v) => upd(s => {
    const x = s.units.find(y => y.k === u.k);
    v = Math.max(0, Math.min(100, v));
    const others = x.cands.filter(k => k !== c);
    const lockedO = others.filter(k => x.locks[k]).reduce((a, k) => a + x.shares[k], 0);
    v = Math.min(v, 100 - lockedO);
    const free = others.filter(k => !x.locks[k]);
    const rest = free.reduce((a, k) => a + x.shares[k], 0);
    const room = 100 - v - lockedO;
    for (const k of free) x.shares[k] = rest ? x.shares[k] / rest * room : room / free.length;
    x.shares[c] = v;
    x.setBy = 'admin';
  });
  return (
    <div class="inner" style={{ padding: '7px 9px' }}>
      <div class="row small"><b class="grow ellipsis">{u.name}</b>{u.seats > 1 && <span class="chip" style={{ height: 16 }}>应选{u.seats}</span>}<DataClass kind={u.setBy === 'admin' ? 'admin' : u.setBy === 'real' ? 'real' : 'auto'} />
        <span class="tiny muted">投票率</span><input class="input sm num" style={{ width: 58 }} type="number" step="0.1" value={+u.turnout.toFixed(1)} onChange={e => upd(s => { const x = s.units.find(y => y.k === u.k); x.turnout = +e.target.value; x.lockTurnout = true; })} />
        {u.setBy === 'admin' && <button class="btn ghost sm" title="恢复为系统估算" onClick={() => upd(s => { s.units.find(y => y.k === u.k).setBy = 'auto'; })}>解除</button>}
      </div>
      {u.cands.map(c => (
        <div class="row small" style={{ marginTop: 3 }}>
          <PartyDot id={cb[c].party} /><input class="input sm" style={{ width: 96 }} value={cb[c].name} onChange={e => upd(s => { s.cands.find(x => x.k === c).name = e.target.value; })} />
          <input type="range" class="grow" min="0" max="100" step="0.1" value={u.shares[c] || 0} onInput={e => setShare(c, +e.target.value)} />
          <input class="input sm num" style={{ width: 58 }} type="number" step="0.1" value={+(u.shares[c] || 0).toFixed(2)} onChange={e => setShare(c, +e.target.value)} />
          <button class={`btn sm icon ${u.locks[c] ? 'on' : 'ghost'}`} style={{ width: 22, height: 22 }} onClick={() => upd(s => { const x = s.units.find(y => y.k === u.k); x.locks[c] = !x.locks[c]; })}><Icon name={u.locks[c] ? 'lock' : 'unlock'} size={11} /></button>
          <span class="num tiny" style={{ width: 66, textAlign: 'right' }}>{fmtN(fin.votes[c])}</span>
          {winners.includes(c) && <span class="status-tag won">胜</span>}
        </div>
      ))}
      <div class="tiny muted" style={{ marginTop: 3 }}>选举人 {fmtN(u.electorate)} · 投票 {fmtN(fin.voters)} · 有效 {fmtN(fin.valid)} · 无效 {fmtN(fin.invalid)}</div>
    </div>
  );
}
function ResultPreview({ sim, totals, pres, seatComp }) {
  const b = branch.value;
  const comp = Object.entries(seatComp).sort((x, y) => y[1] - x[1]);
  const total = comp.reduce((a, x) => a + x[1], 0);
  return (
    <div class="inner" style={{ padding: 9 }}>
      <div class="small bold">最终结果预览（开票终点）</div>
      {pres && <div class="row small" style={{ marginTop: 4 }}><PartyDot id={pres.party} /><b>{pres.name}</b> 当选总统 · 得票 {fmtN(totals.byCand[pres.k])}（{fmtP(totals.byCand[pres.k] / totals.valid * 100)}）</div>}
      {sim.type === 'mayor' && <div class="small" style={{ marginTop: 4 }}>{Object.entries(sim.seats.winners).map(([u, ws]) => { const c = sim.cands.find(x => x.k === ws[0]); return c ? `${sim.units.find(x => x.k === u).name}·${party(b, c.party).short}` : ''; }).join('　')}</div>}
      {comp.length > 0 && <div class="row wrap" style={{ gap: 4, marginTop: 4 }}>{comp.map(([p, n]) => <span class="chip"><PartyDot id={p} />{party(b, p).short} {n}</span>)}<span class="small muted">共{total}席</span></div>}
      <div class="tiny muted" style={{ marginTop: 4 }}>有效票合计 {fmtN(totals.valid)}；各区票数加总与全国汇总一致。</div>
    </div>
  );
}
export function CountSettings() {
  const p = prefs.value;
  return (
    <div class="col">
      <div class="small bold">开票推进方式</div>
      <Seg value={p.countMethod} onChange={v => setPrefs({ countMethod: v })} options={[{ id: 'fixed', name: 'A 每次10%' }, { id: 'custom', name: 'B 自定义百分点' }, { id: 'batches', name: 'C 不等量批次' }]} />
      {p.countMethod === 'custom' && <label class="row small">每次增加<input class="input sm num" style={{ width: 70 }} type="number" min="0.5" step="0.5" value={p.countStep} onChange={e => setPrefs({ countStep: +e.target.value })} />个百分点</label>}
      {p.countMethod === 'batches' && <label class="field">累计开票比例批次（逗号分隔）<input class="input sm" value={p.countBatches} onChange={e => setPrefs({ countBatches: e.target.value })} /></label>}
      <label class="row small">自动播放间隔<input type="range" min="0.4" max="3" step="0.1" value={p.countSpeed} onInput={e => setPrefs({ countSpeed: +e.target.value })} /><span class="num">{p.countSpeed}秒</span></label>
      <div class="tiny muted">最终票数与席次始终等于设定的最终结果；中途曲线为根据最终结果演示的模拟开票。</div>
    </div>
  );
}
