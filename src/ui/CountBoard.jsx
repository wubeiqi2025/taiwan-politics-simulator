// 逐步开票面板：每按一次推进一个阶段；地图、曲线、候选人数值、席位同步变化
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { branch, counting, prefs, setPrefs, closePanel, openPanel, mutate, toast, ask, uid, saveVersion } from '../core/store.js';
import { IDX } from '../core/db.js';
import { party } from '../core/world.js';
import { countTargets, snapshotAt, confirmPlan, simToResult, nationalTotals } from '../core/sim.js';
import { countView } from '../core/countview.js';
import { Panel } from './Panel.jsx';
import { SeatChart } from './SeatChart.jsx';
import { PartyDot, D, fmtN, fmtP, Bar, Flip } from './common.jsx';
import { Icon } from './Icon.jsx';
import { CountSettings } from './ElectionPanel.jsx';

export function CountBoard() {
  const b = branch.value;
  const c = counting.value;
  const sim = c && b.sims?.[c.simId];
  const targets = useMemo(() => countTargets(prefs.value), [prefs.value.countMethod, prefs.value.countStep, prefs.value.countBatches]);
  const [auto, setAuto] = useState(false);
  const [showSet, setShowSet] = useState(false);
  const [series, setSeries] = useState('top');
  const cache = useRef({});
  const idx = c?.idx ?? -1;
  const snapOf = i => {
    const pct = i < 0 ? 0 : targets[Math.min(i, targets.length - 1)];
    const k = sim.id + '|' + pct + '|' + sim.final.units.length;
    return cache.current[k] ||= snapshotAt(sim, pct);
  };
  const snap = sim ? snapOf(idx) : null;
  const prev = sim && idx >= 0 ? snapOf(idx - 1) : null;
  useEffect(() => {
    if (!sim) return;
    const updated = new Set();
    if (prev) for (const u of sim.units) if (snap.units[u.k].f !== prev.units[u.k].f) updated.add(u.k);
    countView.value = { sim, snap, updated };
  }, [sim, idx, targets]);
  // 被其他工作面板替换时：恢复原地图图层
  useEffect(() => () => { countView.value = null; const pm = counting.peek()?.prevMode; if (prefs.peek().mapMode === 'count' && pm && pm !== 'count') setPrefs({ mapMode: pm }); }, []);
  useEffect(() => {
    if (!auto) return;
    if (idx >= targets.length - 1) { setAuto(false); return; }
    const t = setTimeout(() => step(1), prefs.value.countSpeed * 1000);
    return () => clearTimeout(t);
  }, [auto, idx]);
  if (!sim) return null;
  const step = dlt => { counting.value = { ...c, idx: Math.max(-1, Math.min(targets.length - 1, idx + dlt)) }; };
  const jump = i => { counting.value = { ...c, idx: i }; };
  const close = () => { countView.value = null; const pm = c.prevMode; counting.value = null; closePanel('count'); if (pm && pm !== 'count') setPrefs({ mapMode: pm }); };
  const done = idx >= targets.length - 1;
  const cb = Object.fromEntries(sim.cands.map(x => [x.k, x]));
  const totalValid = sim.final.units.reduce((a, u) => a + u.valid, 0);
  const isCand = sim.type === 'president';
  // 曲线资料
  const hist = [];
  for (let i = -1; i <= idx; i++) hist.push(snapOf(i));
  const keys = isCand ? sim.cands.map(x => x.k) : [...new Set(sim.cands.map(x => x.party))];
  const finalT = nationalTotals(sim, sim.final.units);
  const ranked = keys.sort((x, y) => (isCand ? finalT.byCand[y] - finalT.byCand[x] : (finalT.byParty[y] || 0) - (finalT.byParty[x] || 0)));
  const shown = series === 'all' ? ranked : ranked.slice(0, 4);
  const val = (s, k) => (isCand ? s.nat.byCand[k] || 0 : s.nat.byParty[k] || 0);
  const confirm = async () => {
    const plan = confirmPlan(b, sim);
    const ok = await ask({ kind: 'confirm', title: '确认为本分支选举结果？', okText: '确认结果', body: (
      <div class="col small">
        <div>确认后将形成“本分支选举结果”（不会与史实混淆），并按就职日期 <b>{D(plan.start)}</b> 同步：</div>
        <div class="inner" style={{ padding: 8, maxHeight: 160, overflow: 'auto' }}>{plan.summary.map(s => <div class="tiny">{s}</div>)}</div>
        <div class="tiny muted">县市首长、议会席位、人物任职与地图党色在就职日起生效；时间流动经过同日的史实就职事件时，以本结果为准。</div>
        {plan.start < b.date && <div class="notice">就职日期早于分支当前日期，结果将回溯自 {D(plan.start)} 起生效。</div>}
      </div>) });
    if (!ok) return;
    const key = sim.baseId || sim.id;
    mutate(br => {
      br.patches = br.patches.filter(p => !(p.simId && p.simId === sim.id));
      br.patches.push(...plan.patches);
      br.sims[sim.id] = { ...br.sims[sim.id], confirmed: true };
      br.confirmed[key] = { name: sim.name, simId: sim.id, result: simToResult(sim), standalone: !sim.baseId, meta: { id: key, date: sim.date, type: sim.type, name: sim.name, start: sim.termStart } };
      br.customEvents.push({ id: uid('ce'), date: sim.date, title: `本分支选举结果：${sim.name}`, cat: '选举', imp: 2, desc: plan.summary.join('；'), people: [], parties: [], regions: [], effects: [], kind: 'custom', simResult: sim.id, el: key });
    }, `确认选举结果 ${sim.name}`);
    await saveVersion(`确认 ${sim.name}`, true);
    toast('已确认为本分支选举结果', 'ok');
  };
  const pct = snap.pct;
  const counted = snap.nat.valid;
  const R = 34, C = 2 * Math.PI * R;
  // 席位图（立委／议员）
  let seatData = null;
  if (sim.type === 'ly' || sim.type === 'council') {
    const members = [];
    for (const u of sim.units) {
      const st = snap.status[u.k];
      for (let i = 0; i < u.seats; i++) {
        const k = st.leaders[i];
        if (!k || snap.units[u.k].f <= 0) members.push({ party: null, status: 'pending', district: u.name });
        else members.push({ party: cb[k].party, name: cb[k].name, p: cb[k].pid, district: u.name, status: st.decided[i] ? 'won' : 'projected' });
      }
    }
    for (const [p, n] of Object.entries(snap.plSeats || {})) for (let i = 0; i < n; i++) members.push({ party: p, name: '不分区', district: '全国不分区', status: done ? 'won' : 'projected' });
    seatData = { total: members.length, members, vacant: 0 };
  }
  const recent = sim.units.filter(u => !prev || snap.units[u.k].f !== prev.units[u.k].f).slice(0, 8);
  return (
    <Panel id="count" title={sim.name} sub={`${D(sim.date)} · 逐步开票`} icon="ballot" pos={{ x: 80, y: 96, w: 620, h: 700 }} onClose={close}
      actions={<span class={`mode-badge ${sim.source === 'demo' ? 'demo' : 'sim'}`}>{sim.source === 'demo' ? '推演开票' : '架空模拟'}</span>}>
      <div class="notice" style={{ marginBottom: 8 }}>根据最终结果演示的模拟开票：中途曲线为系统生成，并非当年真实开票纪录。</div>
      <div class="row" style={{ gap: 16, alignItems: 'center' }}>
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r={R} fill="none" stroke="rgba(118,118,128,.16)" stroke-width="7" />
          <circle class="progress-ring" cx="42" cy="42" r={R} fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - pct / 100)} transform="rotate(-90 42 42)" />
          <text x="42" y="46" text-anchor="middle" style={{ font: '700 17px var(--font)' }} class="num">{pct.toFixed(pct % 1 ? 1 : 0)}%</text>
        </svg>
        <div class="grow">
          <div class="small muted">已开票（有效票）</div>
          <div class="big-num"><Flip value={counted} /></div>
          <div class="small muted">共 {fmtN(totalValid)} 票 · 第 {idx + 1}/{targets.length} 阶段</div>
        </div>
        {snap.presStatus && <div style={{ textAlign: 'right' }}>
          <div class="small muted">{snap.presStatus.decided ? '确定当选' : '暂时领先'}</div>
          <div class="row" style={{ justifyContent: 'flex-end' }}><PartyDot id={cb[snap.presStatus.leader].party} size={11} /><b style={{ fontSize: 17 }}>{cb[snap.presStatus.leader].name}</b></div>
          {snap.presStatus.decided && <span class="status-tag won">当选确定</span>}
        </div>}
      </div>
      <div class="row wrap shot-hide" style={{ gap: 6, margin: '10px 0' }}>
        <button class="btn sm" onClick={() => step(-1)} disabled={idx < 0}><Icon name="back" size={12} />退回上一步</button>
        <button class="btn primary" onClick={() => step(1)} disabled={done} style={{ minWidth: 120 }}><Icon name="step" size={13} />前进一步</button>
        <button class="btn sm" onClick={() => setAuto(a => !a)} disabled={done}><Icon name={auto ? 'pause' : 'play'} size={12} />{auto ? '暂停' : '自动播放'}</button>
        <button class="btn sm" onClick={() => jump(-1)}><Icon name="restart" size={12} />重新开始</button>
        <select class="select sm" value={idx} onChange={e => jump(+e.target.value)}><option value={-1}>跳至：0%</option>{targets.map((t, i) => <option value={i}>跳至：{t}%</option>)}</select>
        <button class="btn sm" onClick={() => jump(targets.length - 1)} disabled={done}><Icon name="end" size={12} />公布最终结果</button>
        <button class="btn sm ghost" onClick={() => setShowSet(s => !s)}><Icon name="settings" size={13} /></button>
      </div>
      {showSet && <div class="inner shot-hide" style={{ padding: 10, marginBottom: 8 }}><CountSettings /></div>}
      <div class="col" style={{ gap: 6 }}>
        {ranked.slice(0, isCand ? 6 : 8).map(k => {
          const v = val(snap, k);
          const share = counted ? v / counted * 100 : 0;
          const p = isCand ? cb[k].party : k;
          const seatsDec = !isCand ? snap.decided[k] || 0 : null, seatsProj = !isCand ? snap.projected[k] || 0 : null;
          return (
            <div>
              <div class="row small"><PartyDot id={p} /><b class="grow ellipsis">{isCand ? `${cb[k].name}${cb[k].vice ? '／' + cb[k].vice : ''}` : party(b, p).name}</b>
                {!isCand && <span class="tiny"><span class="status-tag won">确定 {seatsDec}</span> <span class="status-tag proj">推算 {seatsProj}</span></span>}
                <span class="num muted"><Flip value={v} /></span><b class="num" style={{ width: 64, textAlign: 'right' }}>{fmtP(share)}</b></div>
              <Bar pct={share} color={party(b, p).color} />
            </div>
          );
        })}
      </div>
      <div class="row" style={{ marginTop: 12 }}><span class="section-title" style={{ margin: 0 }}>{isCand ? '候选人' : '政党'}得票率走势</span><div class="seg right"><button class={series === 'top' ? 'on' : ''} onClick={() => setSeries('top')}>前几名</button><button class={series === 'all' ? 'on' : ''} onClick={() => setSeries('all')}>全部</button></div></div>
      <TrendChart hist={hist} keys={shown} val={val} color={k => party(b, isCand ? cb[k].party : k).color} label={k => (isCand ? cb[k].name : party(b, k).short)} />
      {seatData && <div style={{ marginTop: 8 }}><div class="section-title">席位（中性色＝尚未确定；空心＝推算；实心＝确定当选）</div><SeatChart seats={seatData} width={360} /></div>}
      <div class="section-title">本阶段更新地区</div>
      <div class="col" style={{ gap: 2 }}>
        {recent.map(u => { const st = snap.status[u.k]; const x = snap.units[u.k]; const lead = cb[st.leaders[0]]; return (
          <div class="row small"><span class="ellipsis" style={{ width: 150 }}>{u.name}</span><div class="grow"><Bar pct={x.f * 100} color="var(--accent)" /></div><span class="num tiny" style={{ width: 38 }}>{(x.f * 100).toFixed(0)}%</span>{lead && x.f > 0 && <><PartyDot id={lead.party} /><span class="ellipsis" style={{ width: 70 }}>{lead.name}</span>{st.decided[0] ? <span class="status-tag won">确定</span> : <span class="status-tag lead">领先</span>}</>}</div>); })}
        {!recent.length && <div class="empty">尚未开始开票</div>}
      </div>
      {done && sim.source !== 'demo' && !sim.confirmed && <div class="row shot-hide" style={{ marginTop: 12 }}><button class="btn primary" onClick={confirm}><Icon name="check" size={14} />确认为本分支正式结果</button><button class="btn" onClick={() => openPanel('election', { sim: sim.id })}>返回设置</button></div>}
      {done && sim.confirmed && <div class="notice sim" style={{ marginTop: 10 }}>已确认为本分支选举结果，相关职务与席位将于 {D(sim.termStart)} 生效。</div>}
      {done && sim.source === 'demo' && <div class="notice info" style={{ marginTop: 10 }}>推演开票只用于展示史实最终结果，不会改变任何资料。</div>}
    </Panel>
  );
}
function TrendChart({ hist, keys, val, color, label }) {
  const [tip, setTip] = useState(null);
  const W = 560, H = 170, P = { l: 34, r: 60, t: 8, b: 20 };
  const pts = hist.map(s => ({ x: s.pct, tot: s.nat.valid, s }));
  let maxY = 10;
  for (const p of pts) for (const k of keys) if (p.tot) maxY = Math.max(maxY, val(p.s, k) / p.tot * 100);
  maxY = Math.min(100, Math.ceil(maxY / 10) * 10 + 5);
  const X = x => P.l + (x / 100) * (W - P.l - P.r), Y = y => H - P.b - (y / maxY) * (H - P.t - P.b);
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} onPointerLeave={() => setTip(null)}>
        {[0, 25, 50, 75, 100].map(x => <g><line class="chart-grid" x1={X(x)} x2={X(x)} y1={P.t} y2={H - P.b} /><text x={X(x)} y={H - 5} text-anchor="middle" style={{ font: '10px var(--font)', fill: 'var(--ink-3)' }}>{x}%</text></g>)}
        {[0, maxY / 2, maxY].map(y => <g><line class="chart-grid" x1={P.l} x2={W - P.r} y1={Y(y)} y2={Y(y)} /><text x={P.l - 5} y={Y(y) + 3} text-anchor="end" style={{ font: '10px var(--font)', fill: 'var(--ink-3)' }}>{y.toFixed(0)}%</text></g>)}
        {keys.map(k => {
          const line = pts.filter(p => p.tot).map(p => `${X(p.x)},${Y(val(p.s, k) / p.tot * 100)}`).join(' ');
          const last = pts.filter(p => p.tot).slice(-1)[0];
          return <g>
            <polyline class="chart-line" points={line} stroke={color(k)} />
            {pts.filter(p => p.tot).map(p => <circle cx={X(p.x)} cy={Y(val(p.s, k) / p.tot * 100)} r="3.2" fill="#fff" stroke={color(k)} stroke-width="1.6" style={{ cursor: 'pointer' }} onPointerEnter={() => setTip({ p, k })} />)}
            {last && <text x={X(last.x) + 6} y={Y(val(last.s, k) / last.tot * 100) + 3} style={{ font: '600 10.5px var(--font)', fill: color(k) }}>{label(k)} {(val(last.s, k) / last.tot * 100).toFixed(1)}%</text>}
          </g>;
        })}
      </svg>
      {tip && <div class="tooltip glass glass-strong" style={{ position: 'absolute', left: `${X(tip.p.x) / W * 100}%`, top: 0, transform: 'translateX(-50%)' }}>
        <div class="t1">开票 {tip.p.x}%</div>
        {keys.map(k => <div class="small row"><span class="dot" style={{ background: color(k) }} />{label(k)}<span class="num right">{fmtN(val(tip.p.s, k))}（{fmtP(val(tip.p.s, k) / tip.p.tot * 100)}）</span></div>)}
      </div>}
    </div>
  );
}
