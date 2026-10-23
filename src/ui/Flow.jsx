// 时间流动：预览、按日期依序处理事件、冲突询问、选举暂停、结束汇总
import { useState } from 'preact/hooks';
import { branch, ask, mutate, uid, toast, setRealDate, saveVersion, openPanel, prefs, isSim, previewDate } from '../core/store.js';
import { IDX } from '../core/db.js';
import { allEvents, eventConflicts, partyExists, party, pname, execAt, seatsAt, officeAt, activePatch } from '../core/world.js';
import { addDuration, diffDays, MAX_DATE, MIN_DATE, TODAY_REAL } from '../core/dates.js';
import { D } from './common.jsx';
import { Icon } from './Icon.jsx';
import { CATS, decisionLabel } from './EventsPanel.jsx';

const clone = o => JSON.parse(JSON.stringify(o));
const relevant = (b, e) => !(e.kind === 'custom' && e.cond?.party && !partyExists(b, e.cond.party, e.date));

export function flowPreview(b, target) {
  const evs = allEvents(b).filter(e => e.date > b.date && e.date <= target && relevant(b, e));
  const elections = evs.filter(e => e.els?.length || e.el);
  const conflicts = b.kind === 'sim' ? evs.filter(e => eventConflicts(b, e).length) : [];
  return { evs, elections, conflicts, key: evs.filter(e => e.imp >= 2) };
}

// 冲突描述：真实历史发生了什么、当前架空状态、应用后变化
function describe(b, c, e) {
  const t = c.effect.t;
  const [kind, key] = [t.split(':')[0], t.slice(t.indexOf(':') + 1)];
  const at = e.date;
  if (kind === 'exec') {
    const cur = execAt(b, key, at);
    const real = c.effect.v ? `${pname(b, c.effect.v)}（${party(b, c.effect.party).short}）` : '首长更替';
    return { what: `${IDX.unit[key]?.name}首长：${real}`, now: cur ? `${cur.p ? pname(b, cur.p) : cur.name || '—'}（${party(b, cur.party).short}，${cur.how || '架空设定'}）` : '—', after: `改为史实人选 ${real}` };
  }
  if (kind === 'inst') {
    const s = seatsAt(b, key, at);
    return { what: `${IDX.inst[key]?.name || key}换届（史实新届次）`, now: s ? `架空席位 ${s.total} 席：` + Object.entries(s.comp).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([p, n]) => `${party(b, p).short}${n}`).join('、') : '—', after: '席位组成改为史实新届' };
  }
  if (kind === 'office') {
    const o = officeAt(b, key, at);
    return { what: `${({ president: '总统', vp: '副总统', premier: '行政院长', speaker: '立法院长', governor: '省主席' })[key] || key}：${c.effect.v || '异动'}`, now: o ? (o.p ? pname(b, o.p) : o.name || '—') : '—', after: `由史实人选 ${c.effect.v || ''} 接任` };
  }
  if (kind === 'partyExists') return { what: `${party(b, key).name}${c.effect.v ? '成立' : '解散'}`, now: c.patch.v ? '架空分支中已存在' : '架空分支中被设为不存在', after: c.effect.v ? '该党依史实成立' : '该党依史实解散' };
  if (kind === 'chair') return { what: `${party(b, key).short}党主席：${c.effect.v}`, now: '架空设定的主席', after: `改为 ${c.effect.v}` };
  if (kind === 'admin') return { what: `${IDX.unit[key]?.name || key}行政区划调整`, now: '架空行政设定', after: '套用史实改制' };
  return { what: t, now: '架空设定', after: '套用史实' };
}
function ConflictDialog({ resolve, e, conf, b }) {
  const rows = conf.map(c => describe(b, c, e));
  const nonConf = (e.effects || []).filter(x => !conf.some(c => c.effect.t === x.t));
  return (
    <>
      <div class="modal-head row"><Icon name="warn" size={18} style={{ color: 'var(--warn)' }} />史实事件与架空现状冲突</div>
      <div class="modal-body col">
        <div class="inner" style={{ padding: 10 }}>
          <div class="small muted">{D(e.date)} · 真实历史发生了：</div>
          <div class="bold">{e.title}</div>
          {e.desc && <div class="small" style={{ marginTop: 3 }}>{e.desc}</div>}
        </div>
        <table class="table">
          <thead><tr><th>冲突项目</th><th>当前架空状态</th><th>若应用将改变</th></tr></thead>
          <tbody>{rows.map(r => <tr><td>{r.what}</td><td style={{ color: 'var(--sim)' }}>{r.now}</td><td>{r.after}</td></tr>)}</tbody>
        </table>
        {nonConf.length > 0 && <div class="small muted">另有 {nonConf.length} 项不冲突效果。</div>}
        <div class="notice info">无论如何选择，该史实都会保留在事件时间轴上。</div>
      </div>
      <div class="modal-foot">
        <button class="btn" onClick={() => resolve('kept')}>保留架空现状，仅记录史实</button>
        <button class="btn" onClick={() => resolve('partial')} disabled={!nonConf.length} title={nonConf.length ? '' : '没有不冲突的部分'}>仅应用不冲突部分</button>
        <button class="btn" onClick={() => resolve('manual')}>手动编辑本次效果</button>
        <button class="btn primary" onClick={() => resolve('applied')}>按真实历史应用效果</button>
      </div>
    </>
  );
}
function ElectionPause({ resolve, e }) {
  return (
    <>
      <div class="modal-head row"><Icon name="ballot" size={18} />到达选举节点</div>
      <div class="modal-body col">
        <div class="bold">{e.title}</div>
        <div class="small muted">{D(e.date)}</div>
        <div class="small">可以在此暂停，打开选举控制台：以史实结果为底稿建立模拟选举、调整比例并逐步开票；完成后再继续流动余下时间。</div>
      </div>
      <div class="modal-foot">
        <button class="btn" onClick={() => resolve('skipall')}>本次不再暂停</button>
        <button class="btn" onClick={() => resolve('skip')}>跳过动画，按史实结算</button>
        <button class="btn primary" onClick={() => resolve('pause')}>暂停并打开选举控制台</button>
      </div>
    </>
  );
}

export async function runFlow(target, { pause = true } = {}) {
  const b0 = branch.value;
  if (target <= b0.date) return;
  if (b0.kind === 'real') {
    const pv = flowPreview(b0, target);
    let stopAt = null;
    if (pause) for (const e of pv.evs) {
      if (!(e.els?.length) || e.planned) continue;
      const r = await ask({ kind: 'custom', Comp: ElectionPause, props: { e } });
      if (r === 'skipall') break;
      if (r === 'pause') { stopAt = e; break; }
    }
    const end = stopAt ? stopAt.date : target;
    setRealDate(end);
    const done = pv.evs.filter(e => e.date <= end);
    if (stopAt) { mutate(b => { b.pendingFlow = { target }; }, '暂停于选举', { undo: false }); openPanel('election', { setup: stopAt.els[0], demo: true }); }
    await showSummary(done, b0.date, end, branch.value);
    return;
  }
  const work = clone(b0);
  const from = b0.date;
  const evs = allEvents(b0).filter(e => e.date > from && e.date <= target && relevant(b0, e));
  const triggered = [], manual = [];
  let stopAt = null, skipAll = !pause;
  for (const e of evs) {
    work.date = e.date;
    if (e.kind === 'custom') {
      // 自定义事件：效果写成当日补丁
      for (const x of e.effects || []) work.patches.push({ id: uid('pt'), t: x.t, v: x.v, date: e.date, by: 'event', ev: e.id });
      work.decisions[e.id] = { d: 'applied', at: new Date().toISOString() };
    } else if (e.effects?.length) {
      // 本分支模拟选举已确认、同日生效的结果视为取代
      const conf = eventConflicts(work, e).filter(c => !(c.patch.by === 'sim' && c.patch.date >= e.date));
      const replaced = e.effects.some(x => work.patches.some(p => p.by === 'sim' && p.date === e.date && (p.t === x.t || p.t === 'seats:' + x.t.slice(5))));
      if (conf.length) {
        const r = await ask({ kind: 'custom', wide: true, Comp: ConflictDialog, props: { e, conf, b: work } });
        if (r === 'partial') work.decisions[e.id] = { d: 'partial', targets: e.effects.filter(x => !conf.some(c => c.effect.t === x.t)).map(x => x.t), at: new Date().toISOString() };
        else work.decisions[e.id] = { d: r, at: new Date().toISOString() };
        if (r === 'manual') manual.push({ e, conf });
      } else if (replaced) work.decisions[e.id] = { d: 'replaced', at: new Date().toISOString() };
    }
    work.seen[e.id] = 1;
    triggered.push(e);
    if (!skipAll && (e.els?.length) && !e.planned) {
      const r = await ask({ kind: 'custom', Comp: ElectionPause, props: { e } });
      if (r === 'skipall') skipAll = true;
      if (r === 'pause') { stopAt = e; break; }
    }
  }
  const end = stopAt ? stopAt.date : target;
  mutate(b => {
    Object.assign(b, { patches: work.patches, decisions: work.decisions, seen: work.seen, date: end, pendingFlow: stopAt ? { target } : null });
    (b.flowMarks ||= []).push({ from, to: end, at: new Date().toISOString() });
  }, `时间流动 ${from} → ${end}`);
  await saveVersion(`流动至 ${end}`, true);
  if (stopAt) openPanel('election', { setup: stopAt.els[0] });
  await showSummary(triggered, from, end, branch.value, manual);
}
export async function continueFlow() {
  const t = branch.value.pendingFlow?.target;
  if (!t) return;
  mutate(b => { b.pendingFlow = null; }, '继续流动', { undo: false });
  await runFlow(t);
}

async function showSummary(evs, from, to, b, manual = []) {
  await ask({ kind: 'custom', wide: true, Comp: Summary, props: { evs, from, to, b, manual } });
}
function Summary({ resolve, evs, from, to, b, manual }) {
  const [cat, setCat] = useState('全部');
  const [imp, setImp] = useState(evs.length > 40 ? 2 : 1);
  const list = evs.filter(e => (cat === '全部' || e.cat === cat) && e.imp >= imp);
  const byYear = {};
  for (const e of list) (byYear[e.date.slice(0, 4)] ||= []).push(e);
  const kept = evs.filter(e => b.decisions?.[e.id]?.d === 'kept').length;
  return (
    <>
      <div class="modal-head">时间流动完成<div class="small muted" style={{ fontWeight: 400 }}>{D(from)} → {D(to)} · 共 {diffDays(from, to)} 天 · 已收录事件 {evs.length} 条{kept ? ` · ${kept} 条史实未在分支中应用效果` : ''}</div></div>
      <div class="modal-body">
        {manual.length > 0 && <div class="notice" style={{ marginBottom: 8 }}>你选择了手动编辑 {manual.length} 项效果：请在对应的地区、席位或人物卡中进行修改（已保持架空现状）。{manual.map(m => <div class="tiny">· {m.e.title}</div>)}</div>}
        <div class="row wrap" style={{ gap: 4, marginBottom: 8 }}>
          {CATS.map(c => <button class={`btn sm ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
          <div class="seg right"><button class={imp === 1 ? 'on' : ''} onClick={() => setImp(1)}>全部</button><button class={imp === 2 ? 'on' : ''} onClick={() => setImp(2)}>重点</button></div>
        </div>
        <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
          {Object.keys(byYear).sort().map(y => (
            <div>
              <div class="section-title">{y}年（{byYear[y].length}）</div>
              {byYear[y].map(e => (
                <div class="list-item small" style={{ alignItems: 'flex-start' }} onClick={() => { openPanel('events', { focus: e.id }); }}>
                  <span class="num tiny muted" style={{ width: 44, paddingTop: 1 }}>{e.date.slice(5)}</span>
                  <div class="grow">
                    <div><b>{e.title}</b> {e.kind === 'custom' ? <span class="chip sim" style={{ height: 16 }}>架空</span> : <span class="chip real" style={{ height: 16 }}>史实</span>}</div>
                    {e.desc && <div class="tiny muted ellipsis" style={{ maxWidth: 640 }}>{e.desc}</div>}
                    {b.kind === 'sim' && e.effects?.length > 0 && <div class="tiny" style={{ color: b.decisions?.[e.id]?.d === 'kept' ? 'var(--sim)' : 'var(--ink-3)' }}>{decisionLabel(b, e)}</div>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {!list.length && <div class="empty">这段时间没有符合筛选的已收录事件</div>}
        </div>
      </div>
      <div class="modal-foot"><button class="btn primary" onClick={() => resolve(true)}>完成</button></div>
    </>
  );
}

// 流动输入与预览确认
export function FlowControl() {
  const b = branch.value;
  const [n, setN] = useState(8);
  const [unit, setUnit] = useState('月');
  const go = async () => {
    const target = addDuration(b.date, Math.max(1, n | 0), unit);
    const t = target > MAX_DATE ? MAX_DATE : target;
    if (t <= b.date) { toast('已到达可推进的最后日期'); return; }
    const pv = flowPreview(b, t);
    const ok = await ask({ kind: 'confirm', title: `流动 ${n}${unit}`, okText: '开始流动', body: (
      <div class="col">
        <div class="kv"><span>起始</span><b>{D(b.date)}</b><span>目标</span><b>{D(t)}</b><span>跨越</span><span>{diffDays(b.date, t)} 天</span><span>已收录事件</span><span>{pv.evs.length} 条（重点 {pv.key.length}）</span><span>可能触发选举</span><span>{pv.elections.length} 场</span>{b.kind === 'sim' && <><span>预计冲突</span><span style={{ color: pv.conflicts.length ? 'var(--warn)' : undefined }}>{pv.conflicts.length} 项</span></>}</div>
        {pv.key.length > 0 && <div class="inner" style={{ padding: 8, maxHeight: 180, overflow: 'auto' }}>{pv.key.slice(0, 30).map(e => <div class="tiny">{e.date} {e.title}</div>)}</div>}
        {t > TODAY_REAL && <div class="notice">目标日期晚于真实资料核实日（{TODAY_REAL}），之后的事件仅为计划，不会显示虚构的真实结果。</div>}
      </div>) });
    if (!ok) return;
    await runFlow(t);
  };
  return (
    <div class="row" style={{ gap: 4 }}>
      <span class="small muted">流动</span>
      <input class="input sm num" type="number" min="1" style={{ width: 54 }} value={n} onInput={e => setN(+e.target.value)} />
      <select class="select sm" value={unit} onChange={e => setUnit(e.target.value)}>{['日', '周', '月', '年'].map(u => <option>{u}</option>)}</select>
      <button class="btn sm primary" onClick={go} disabled={!!previewDate.value}><Icon name="play" size={12} />推进</button>
      {b.pendingFlow && <button class="btn sm" onClick={continueFlow}>继续剩余流动</button>}
    </div>
  );
}
