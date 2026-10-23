// 模拟选举引擎：复制史实、一键补齐、计票、席位分配、逐步开票轨迹
import { DB, IDX, RESULTS } from './db.js';
import { uid } from './store.js';
import { townsOfUnit, unitsAt, seatsAt, termAt, unitOfTown } from './world.js';
import { addDays } from './dates.js';

export const SIM_TYPES = { president: '总统副总统', mayor: '县市长', ly: '立法委员', council: '县市议员', custom: '自定义' };

// ---------- 随机数（确定性） ----------
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// 最大余数法：把 total 按比例 weights 分成整数
export function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && rest > 0; k++, rest--) out[order[k][1]]++;
  return out;
}

const PARTY_LIST_SEATS = { 1995: [36, 5], 1998: [49, 5], 2001: [49, 5], 2004: [49, 5] }; // 不分区+侨选（依区域票政党得票分配）

// ---------- 由真实选举建立模拟 ----------
export function simFromReal(b, elId, { demo = false } = {}) {
  const el = IDX.election[elId];
  const res = RESULTS[elId];
  if (!el || !res || el.summary) throw new Error('该场选举缺少可复制的分区资料');
  const sim = { id: uid('s'), baseId: elId, name: el.name + (demo ? '（推演开票）' : '（模拟）'), date: el.date, type: el.type, source: demo ? 'demo' : 'copy', units: [], cands: [], targets: {}, partyList: null, termStart: el.start, created: new Date().toISOString(), confirmed: false, count: { cur: 0 } };
  const mkUnit = (k, name, region, seats, cands, votes, prof) => {
    const valid = votes.reduce((a, x) => a + (x || 0), 0);
    const voters = prof?.voters || Math.round(valid / 0.985);
    const electorate = prof?.electorate || Math.round(voters / 0.7);
    const shares = {};
    cands.forEach((c, i) => { shares[c] = valid ? (votes[i] || 0) / valid * 100 : 100 / cands.length; });
    return { k, name, region, seats, cands, electorate, turnout: electorate ? voters / electorate * 100 : 70, invalidRate: voters ? (voters - valid) / voters * 100 : 1.5, shares, setBy: 'real', locks: {} };
  };
  if (el.type === 'president') {
    sim.cands = res.cands.map((c, i) => ({ k: 'c' + i, name: c.name, vice: c.vice, party: c.party, pid: c.pid, vpid: c.vpid }));
    for (const [u, v] of Object.entries(res.byUnit)) {
      const unit = mkUnit(u, IDX.unit[u].name, { u }, 1, sim.cands.map(c => c.k), v.votes, v);
      unit.townBase = Object.fromEntries(Object.entries(res.byTown || {}).filter(([t]) => IDX.unit[u].towns.includes(t)).map(([t, x]) => [t, x.votes]));
      sim.units.push(unit);
    }
  } else if (el.type === 'mayor') {
    for (const [u, race] of Object.entries(res.races)) {
      const ks = race.cands.map((c, i) => { const k = u + '-' + i; sim.cands.push({ k, name: c.name, party: c.party, pid: c.pid, unit: u }); return k; });
      const unit = mkUnit(u, IDX.unit[u].name, { u }, 1, ks, race.cands.map(c => c.votes || 0), race);
      unit.townBase = Object.fromEntries(Object.entries(race.byTown || {}).map(([t, x]) => [t, x.votes]));
      sim.units.push(unit);
    }
  } else if (el.type === 'ly') {
    sim.inst = 'LY';
    for (const d of res.districts) {
      const ks = d.cands.map((c, i) => { const k = d.k + '-' + i; sim.cands.push({ k, name: c.name, party: c.party, pid: c.pid, unit: d.k }); return k; });
      const unit = mkUnit(d.k, d.name, { u: d.u, towns: d.towns || [] }, d.seats, ks, d.cands.map(c => c.votes || 0), d);
      unit.townBase = Object.fromEntries(Object.entries(d.byTown || {}).map(([t, x]) => [t, x.votes]));
      sim.units.push(unit);
    }
    const yr = el.date.slice(0, 4);
    if (res.partyList) {
      const pl = res.partyList;
      const tot = pl.national.votes.reduce((a, b) => a + b, 0);
      sim.partyList = { parties: pl.parties, shares: Object.fromEntries(pl.parties.map((p, i) => [p, pl.national.votes[i] / tot * 100])), locks: {}, valid: tot, seats: pl.seats?.reduce((a, b) => a + b, 0) || 34, threshold: 5, independent: true };
    } else if (PARTY_LIST_SEATS[yr]) {
      sim.partyList = { derived: true, seats: PARTY_LIST_SEATS[yr][0], threshold: PARTY_LIST_SEATS[yr][1] };
    }
  } else if (el.type === 'council') {
    throw new Error('请从县市议会选择具体县市后复制');
  }
  computeFinal(sim);
  return sim;
}
// 县市议员选举：限定一个县市
export function simFromCouncil(b, elId, unitId, { demo = false } = {}) {
  const el = IDX.election[elId];
  const res = RESULTS[elId];
  const sim = { id: uid('s'), baseId: elId, name: `${el.name}·${IDX.unit[unitId].name}` + (demo ? '（推演开票）' : '（模拟）'), date: el.date, type: 'council', source: demo ? 'demo' : 'copy', inst: 'C:' + unitId, units: [], cands: [], targets: {}, termStart: el.start, created: new Date().toISOString(), confirmed: false, count: { cur: 0 } };
  for (const d of res.districts.filter(d => d.u === unitId)) {
    const ks = d.cands.map((c, i) => { const k = d.k + '-' + i; sim.cands.push({ k, name: c.name, party: c.party, pid: c.pid, unit: d.k }); return k; });
    const valid = d.cands.reduce((a, c) => a + (c.votes || 0), 0);
    const voters = d.voters || Math.round(valid / 0.98);
    sim.units.push({ k: d.k, name: d.name + (d.kind ? `（${d.kind}）` : ''), region: { u: unitId }, seats: d.seats, cands: ks, electorate: d.electorate || Math.round(voters / 0.65), turnout: d.electorate ? voters / d.electorate * 100 : 65, invalidRate: voters ? (voters - valid) / voters * 100 : 2, shares: Object.fromEntries(ks.map((k, i) => [k, valid ? (d.cands[i].votes || 0) / valid * 100 : 100 / ks.length])), setBy: 'real', locks: {} });
  }
  computeFinal(sim);
  return sim;
}

// ---------- 全新架空选举 ----------
// parties：参选政党；按当前行政区建立选举单位，选举人数取最近一次总统或县市长选举
export function simNew(b, { type, date, name, parties, unitId }) {
  const sim = { id: uid('s'), baseId: null, name: name || `架空${SIM_TYPES[type]}选举`, date, type, source: 'new', units: [], cands: [], targets: {}, partyList: null, created: new Date().toISOString(), confirmed: false, count: { cur: 0 }, standalone: true };
  sim.termStart = type === 'president' ? date.slice(0, 4) + '-05-20' : type === 'ly' ? addDays(date, 20) : addDays(date, 27);
  const units = unitsAt(date);
  const elect = u => electorateOf(u, date);
  const share = 100 / parties.length;
  if (type === 'president') {
    sim.cands = parties.map((p, i) => ({ k: 'c' + i, name: `${p.short || p.name}候选人`, party: p.id }));
    for (const u of units) sim.units.push({ k: u.id, name: u.name, region: { u: u.id }, seats: 1, cands: sim.cands.map(c => c.k), electorate: elect(u.id), turnout: 70, invalidRate: 1.2, shares: Object.fromEntries(sim.cands.map(c => [c.k, share])), setBy: 'auto', locks: {} });
  } else if (type === 'mayor') {
    for (const u of units) {
      const ks = parties.map((p, i) => { const k = u.id + '-' + i; sim.cands.push({ k, name: `${p.short || p.name}候选人`, party: p.id, unit: u.id }); return k; });
      sim.units.push({ k: u.id, name: u.name, region: { u: u.id }, seats: 1, cands: ks, electorate: elect(u.id), turnout: 65, invalidRate: 1.5, shares: Object.fromEntries(ks.map(k => [k, share])), setBy: 'auto', locks: {} });
    }
  } else if (type === 'ly') {
    sim.inst = 'LY';
    // 按县市设单一选区：席次按选举人数比例分配73席（每县市至少1席）
    const w = units.map(u => elect(u.id));
    const seats = apportion(73 - units.length, w).map(x => x + 1);
    units.forEach((u, idx) => {
      for (let s = 0; s < seats[idx]; s++) {
        const k = `${u.id}-${s + 1}`;
        const ks = parties.map((p, i) => { const ck = k + '-' + i; sim.cands.push({ k: ck, name: `${u.name.slice(0, 2)}${s + 1}区${p.short || p.name}候选人`, party: p.id, unit: k }); return ck; });
        sim.units.push({ k, name: `${u.name}第${s + 1}選區`, region: { u: u.id, towns: chunk(townsOfUnit(b, u.id, date), seats[idx], s) }, seats: 1, cands: ks, electorate: Math.round(elect(u.id) / seats[idx]), turnout: 66, invalidRate: 1.5, shares: Object.fromEntries(ks.map(k => [k, share])), setBy: 'auto', locks: {} });
      }
    });
    sim.partyList = { parties: parties.map(p => p.id), shares: Object.fromEntries(parties.map(p => [p.id, share])), locks: {}, valid: w.reduce((a, x) => a + x, 0) * 0.66, seats: 40, threshold: 5, independent: true };
  } else if (type === 'council') {
    const u = unitId || units[0].id;
    sim.inst = 'C:' + u;
    const cur = seatsAt(b, 'C:' + u, date);
    const total = cur?.total || 30;
    const nd = Math.max(1, Math.round(total / 4));
    const per = apportion(total, Array(nd).fill(1));
    for (let i = 0; i < nd; i++) {
      const k = `${u}-d${i + 1}`;
      const ks = [];
      parties.forEach((p, j) => { for (let n = 0; n < Math.max(1, Math.ceil(per[i] / parties.length)); n++) { const ck = `${k}-${j}-${n}`; ks.push(ck); sim.cands.push({ k: ck, name: `${p.short || p.name}${i + 1}区${n + 1}号`, party: p.id, unit: k }); } });
      sim.units.push({ k, name: `${IDX.unit[u].name}第${i + 1}選舉區`, region: { u }, seats: per[i], cands: ks, electorate: Math.round(elect(u) / nd), turnout: 62, invalidRate: 2, shares: Object.fromEntries(ks.map(k => [k, 100 / ks.length])), setBy: 'auto', locks: {} });
    }
  }
  computeFinal(sim);
  return sim;
}
const chunk = (arr, n, i) => { const size = Math.ceil(arr.length / n); return arr.slice(i * size, (i + 1) * size); };
export function electorateOf(u, date) {
  let best = null;
  for (const el of DB.elections) {
    if (el.type !== 'president' && el.type !== 'mayor') continue;
    const r = RESULTS[el.id];
    const x = r?.byUnit?.[u] || r?.races?.[u];
    if (x?.electorate && (!best || Math.abs(+el.date.slice(0, 4) - +date.slice(0, 4)) < best.gap)) best = { v: x.electorate, gap: Math.abs(+el.date.slice(0, 4) - +date.slice(0, 4)) };
  }
  if (best) return best.v;
  // 依据现代县市其他单位估算
  return 200000;
}

// ---------- 计票：由比例计算最终票数 ----------
export function computeFinal(sim) {
  const units = sim.units.map(u => {
    const voters = Math.round(u.electorate * u.turnout / 100);
    const invalid = Math.round(voters * (u.invalidRate || 0) / 100);
    const valid = voters - invalid;
    const votes = apportion(valid, u.cands.map(c => Math.max(0, u.shares[c] || 0)));
    return { k: u.k, voters, invalid, valid, votes: Object.fromEntries(u.cands.map((c, i) => [c, votes[i]])) };
  });
  let partyList = null;
  if (sim.partyList?.independent) {
    const pl = sim.partyList;
    const totValid = Math.round(pl.valid || units.reduce((a, u) => a + u.valid, 0));
    const v = apportion(totValid, pl.parties.map(p => Math.max(0, pl.shares[p] || 0)));
    partyList = { votes: Object.fromEntries(pl.parties.map((p, i) => [p, v[i]])), valid: totValid };
  }
  sim.final = { units, partyList };
  sim.seats = seatResult(sim);
  return sim;
}
const candBy = sim => Object.fromEntries(sim.cands.map(c => [c.k, c]));
export function nationalTotals(sim, unitsVotes) {
  const cb = candBy(sim);
  const byCand = {}, byParty = {};
  let valid = 0;
  for (const u of unitsVotes) for (const [c, v] of Object.entries(u.votes)) {
    byCand[c] = (byCand[c] || 0) + v;
    const p = cb[c]?.party || 'IND';
    byParty[p] = (byParty[p] || 0) + v;
    valid += v;
  }
  return { byCand, byParty, valid };
}
// 席位与当选
export function seatResult(sim, unitsVotes = sim.final.units, plVotes = sim.final.partyList) {
  const cb = candBy(sim);
  const winners = {}; // unit -> [cand]
  for (const u of unitsVotes) {
    const unit = sim.units.find(x => x.k === u.k);
    const sorted = Object.entries(u.votes).sort((a, b) => b[1] - a[1]);
    winners[u.k] = sorted.slice(0, unit.seats).filter(x => x[1] > 0).map(x => x[0]);
  }
  const comp = {};
  if (sim.type === 'president') {
    const t = nationalTotals(sim, unitsVotes);
    const top = Object.entries(t.byCand).sort((a, b) => b[1] - a[1])[0];
    return { winners, president: top?.[0], comp: {} };
  }
  for (const ks of Object.values(winners)) for (const k of ks) { const p = cb[k].party; comp[p] = (comp[p] || 0) + 1; }
  let plSeats = null;
  if (sim.partyList) {
    const pl = sim.partyList;
    let votes;
    if (pl.independent && plVotes) votes = plVotes.votes;
    else votes = nationalTotals(sim, unitsVotes).byParty;
    const tot = Object.values(votes).reduce((a, b) => a + b, 0);
    const eligible = Object.entries(votes).filter(([p, v]) => p !== 'IND' && tot && v / tot * 100 >= pl.threshold);
    const seats = apportion(pl.seats, eligible.map(e => e[1]));
    plSeats = Object.fromEntries(eligible.map((e, i) => [e[0], seats[i]]));
    for (const [p, n] of Object.entries(plSeats)) if (n) comp[p] = (comp[p] || 0) + n;
  }
  return { winners, comp, plSeats };
}

// ---------- 一键补齐 ----------
// 规则：管理员指定（setBy=admin）或锁定的数值不动；其余地区按全国目标比例做乘数摆动并重新归一化
export function fillRemaining(sim) {
  const cb = candBy(sim);
  const targets = Object.entries(sim.targets || {}).filter(([, t]) => t && t.pct != null);
  for (const u of sim.units) {
    if (u.setBy === 'admin') continue;
    if (u.cands.some(c => u.shares[c] == null)) for (const c of u.cands) u.shares[c] ??= 100 / u.cands.length;
  }
  if (sim.turnoutTarget != null) {
    const cur = weightedTurnout(sim);
    const f = sim.turnoutTarget / cur;
    for (const u of sim.units) if (!u.lockTurnout && u.setBy !== 'admin') u.turnout = Math.min(98, Math.max(5, u.turnout * f));
  }
  if (targets.length) {
    for (let iter = 0; iter < 240; iter++) {
      computeFinal(sim);
      const t = nationalTotals(sim, sim.final.units);
      let maxErr = 0;
      const f = {};
      for (const [p, tg] of targets) {
        const cur = t.valid ? (t.byParty[p] || 0) / t.valid * 100 : 0;
        maxErr = Math.max(maxErr, Math.abs(cur - tg.pct));
        f[p] = cur > 0 ? tg.pct / cur : (tg.pct > 0 ? 2 : 0);
      }
      if (maxErr < 0.002) break;
      for (const u of sim.units) {
        if (u.setBy === 'admin') continue;
        const lockedSum = u.cands.filter(c => u.locks[c]).reduce((a, c) => a + (u.shares[c] || 0), 0);
        const free = u.cands.filter(c => !u.locks[c]);
        for (const c of free) { const p = cb[c].party; if (f[p] != null) u.shares[c] = Math.max(0.0001, (u.shares[c] || 0.01) * Math.pow(f[p], iter < 30 ? 0.85 : 1)); }
        const s = free.reduce((a, c) => a + u.shares[c], 0);
        const room = Math.max(0, 100 - lockedSum);
        for (const c of free) u.shares[c] = s ? u.shares[c] / s * room : room / free.length;
        if (u.setBy === 'real') u.setBy = 'auto';
      }
    }
  }
  computeFinal(sim);
  return sim;
}
export function weightedTurnout(sim) {
  const e = sim.units.reduce((a, u) => a + u.electorate, 0);
  return e ? sim.units.reduce((a, u) => a + u.electorate * u.turnout, 0) / e : 0;
}
// 当前全国各党得票率（由各地汇总）
export function nationalShares(sim) {
  const t = nationalTotals(sim, sim.final.units);
  return Object.fromEntries(Object.entries(t.byParty).map(([p, v]) => [p, t.valid ? v / t.valid * 100 : 0]));
}
// 目标可达性检查
export function targetConflicts(sim) {
  const cur = nationalShares(sim);
  return Object.entries(sim.targets || {}).filter(([p, t]) => t?.pct != null && Math.abs((cur[p] || 0) - t.pct) > 0.05).map(([p, t]) => ({ party: p, target: t.pct, got: cur[p] || 0 }));
}

// ---------- 开票过程 ----------
export function countTargets(prefs) {
  if (prefs.countMethod === 'custom') { const s = Math.max(0.5, +prefs.countStep || 10); const out = []; for (let x = s; x < 100; x += s) out.push(+x.toFixed(2)); out.push(100); return out; }
  if (prefs.countMethod === 'batches') { const arr = String(prefs.countBatches).split(/[,，\s]+/).map(Number).filter(x => x > 0 && x <= 100).sort((a, b) => a - b); if (arr[arr.length - 1] !== 100) arr.push(100); return [...new Set(arr)]; }
  return [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
}
// 计票时间表：各单位开始与持续（确定性）
function schedule(sim) {
  const r = rng(hash(sim.id + (sim.seed || '')));
  const sched = {};
  const noise = {};
  for (const u of sim.units) {
    const size = u.electorate;
    const a = r() * 0.45 + (size > 500000 ? 0.08 : 0);
    const w = 0.35 + r() * 0.3;
    sched[u.k] = [a, Math.min(w, 1.05 - a)];
    // 各候选人开票早期偏差（加权和为零）
    const raw = u.cands.map(() => gauss(r));
    const fin = sim.final.units.find(x => x.k === u.k);
    const tot = fin.valid || 1;
    const mean = u.cands.reduce((s, c, i) => s + raw[i] * fin.votes[c] / tot, 0);
    noise[u.k] = Object.fromEntries(u.cands.map((c, i) => [c, raw[i] - mean]));
  }
  return { sched, noise };
}
const schedCache = new Map();
const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
function unitAt(sim, S, u, tau) {
  const [a, w] = S.sched[u.k];
  const f = tau >= 1.2 ? 1 : ease((tau - a) / w);
  const fin = sim.final.units.find(x => x.k === u.k);
  const counted = Math.round(fin.valid * f);
  if (f >= 1) return { f: 1, counted: fin.valid, votes: { ...fin.votes } };
  const amp = 0.06 * (1 - f);
  const w2 = u.cands.map(c => Math.max(0.0001, (fin.votes[c] / (fin.valid || 1)) * (1 + 0) + amp * S.noise[u.k][c] * Math.sqrt(Math.max(0.0001, fin.votes[c] / (fin.valid || 1)))));
  const v = apportion(counted, w2);
  // 不超过最终票数
  const votes = {};
  u.cands.forEach((c, i) => { votes[c] = Math.min(v[i], fin.votes[c]); });
  return { f, counted: Object.values(votes).reduce((a, b) => a + b, 0), votes };
}
export function snapshotAt(sim, pct) {
  const key = sim.id + '|' + (sim.seed || '') + '|' + sim.final.units.reduce((a, u) => a + u.valid, 0);
  let S = schedCache.get(key);
  if (!S) { S = schedule(sim); schedCache.set(key, S); }
  const totalValid = sim.final.units.reduce((a, u) => a + u.valid, 0) || 1;
  const progress = tau => sim.units.reduce((a, u) => a + unitAt(sim, S, u, tau).counted, 0) / totalValid * 100;
  let lo = 0, hi = 1.25;
  if (pct >= 100) lo = hi = 1.25;
  else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (progress(m) < pct) lo = m; else hi = m; }
  const tau = hi;
  const units = {};
  for (const u of sim.units) units[u.k] = unitAt(sim, S, u, tau);
  return buildSnap(sim, units, pct);
}
function buildSnap(sim, units, pct) {
  const cb = candBy(sim);
  const list = sim.units.map(u => ({ k: u.k, votes: units[u.k].votes }));
  const nat = nationalTotals(sim, list);
  // 当选判定
  const status = {};
  for (const u of sim.units) {
    const x = units[u.k];
    const fin = sim.final.units.find(y => y.k === u.k);
    const remaining = fin.valid - x.counted;
    const sorted = Object.entries(x.votes).sort((a, b) => b[1] - a[1]);
    const lead = sorted.slice(0, u.seats);
    const next = sorted[u.seats]?.[1] || 0;
    status[u.k] = { leaders: lead.map(l => l[0]), decided: lead.map(l => x.f >= 1 || l[1] > next + remaining), f: x.f, margin: (lead[0]?.[1] || 0) - (sorted[1]?.[1] || 0) };
  }
  const decided = {}, projected = {};
  for (const u of sim.units) status[u.k].leaders.forEach((c, i) => {
    const p = cb[c].party;
    projected[p] = (projected[p] || 0) + 1;
    if (status[u.k].decided[i]) decided[p] = (decided[p] || 0) + 1;
  });
  let plVotes = null;
  if (sim.partyList?.independent && sim.final.partyList) {
    const f = Math.min(1, pct / 100);
    plVotes = { votes: Object.fromEntries(Object.entries(sim.final.partyList.votes).map(([p, v]) => [p, Math.round(v * f)])) };
  }
  let plSeats = null;
  if (sim.partyList) {
    const sr = seatResult(sim, list, plVotes || sim.final.partyList);
    plSeats = sr.plSeats;
    for (const [p, n] of Object.entries(plSeats || {})) { projected[p] = (projected[p] || 0) + n; if (pct >= 100) decided[p] = (decided[p] || 0) + n; }
  }
  let presStatus = null;
  if (sim.type === 'president') {
    const sorted = Object.entries(nat.byCand).sort((a, b) => b[1] - a[1]);
    const totalValid = sim.final.units.reduce((a, u) => a + u.valid, 0);
    const remaining = totalValid - nat.valid;
    presStatus = { leader: sorted[0]?.[0], decided: pct >= 100 || (sorted[0]?.[1] || 0) - (sorted[1]?.[1] || 0) > remaining };
  }
  return { pct, units, nat, status, decided, projected, plSeats, presStatus };
}

// ---------- 确认结果：生成分支补丁 ----------
export function confirmPlan(b, sim) {
  const cb = candBy(sim);
  const patches = [];
  const start = sim.termStart || sim.date;
  const summary = [];
  if (sim.type === 'president') {
    const w = cb[sim.seats.president];
    patches.push({ t: 'office:president', date: start, v: { p: w.pid || null, name: w.name, party: w.party } });
    patches.push({ t: 'office:vp', date: start, v: { p: w.vpid || null, name: w.vice || '', party: w.party } });
    summary.push(`${start} ${w.name} 就任总统`);
  } else if (sim.type === 'mayor') {
    for (const u of sim.units) {
      const k = sim.seats.winners[u.k][0];
      const c = cb[k];
      if (!c) continue;
      patches.push({ t: 'exec:' + u.k, date: start, v: { p: c.pid || null, name: c.name, party: c.party, how: '模拟选举' } });
      summary.push(`${u.name}：${c.name}`);
    }
  } else if (sim.type === 'ly' || sim.type === 'council') {
    const members = [];
    for (const u of sim.units) for (const k of sim.seats.winners[u.k]) { const c = cb[k]; members.push({ p: c.pid || null, name: c.name, party: c.party, district: u.name }); }
    for (const [p, n] of Object.entries(sim.seats.plSeats || {})) for (let i = 0; i < n; i++) members.push({ p: null, name: `不分区第${i + 1}名`, party: p, district: '全国不分区' });
    patches.push({ t: 'seats:' + sim.inst, date: start, v: { label: sim.name, total: members.length, members, note: '本分支模拟选举结果' } });
    summary.push(`${members.length}席：` + Object.entries(sim.seats.comp).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join('、'));
  }
  return { patches: patches.map(p => ({ ...p, id: uid('pt'), by: 'sim', simId: sim.id })), summary, start };
}
// 模拟结果转为与真实结果相同结构（供地图和面板读取）
export function simToResult(sim) {
  const cb = candBy(sim);
  const fin = sim.final;
  if (sim.type === 'president') {
    const t = nationalTotals(sim, fin.units);
    const byUnit = {}, byTown = {};
    for (const u of sim.units) {
      const f = fin.units.find(x => x.k === u.k);
      byUnit[u.k] = { votes: sim.cands.map(c => f.votes[c.k] || 0), valid: f.valid, voters: f.voters, electorate: u.electorate };
      Object.assign(byTown, townSplit(u, f, sim.cands.map(c => c.k)));
    }
    return { cands: sim.cands.map(c => ({ name: c.name, vice: c.vice, party: c.party, pid: c.pid, vpid: c.vpid, win: c.k === sim.seats.president })), national: { votes: sim.cands.map(c => t.byCand[c.k] || 0), valid: t.valid }, byUnit, byTown };
  }
  if (sim.type === 'mayor') {
    const races = {};
    for (const u of sim.units) {
      const f = fin.units.find(x => x.k === u.k);
      const w = sim.seats.winners[u.k];
      const tb = townSplit(u, f, u.cands);
      races[u.k] = { cands: u.cands.map(k => ({ name: cb[k].name, party: cb[k].party, pid: cb[k].pid, votes: f.votes[k], win: w.includes(k) })), valid: f.valid, voters: f.voters, electorate: u.electorate, byTown: tb };
    }
    return { races };
  }
  const districts = sim.units.map(u => {
    const f = fin.units.find(x => x.k === u.k);
    const w = sim.seats.winners[u.k];
    return { k: u.k, u: u.region?.u, name: u.name, seats: u.seats, towns: u.region?.towns || [], cands: u.cands.map(k => ({ name: cb[k].name, party: cb[k].party, pid: cb[k].pid, votes: f.votes[k], win: w.includes(k) })), valid: f.valid, byTown: townSplit(u, f, u.cands) };
  });
  const out = { districts };
  if (sim.partyList?.independent && fin.partyList) out.partyList = { parties: sim.partyList.parties, national: { votes: sim.partyList.parties.map(p => fin.partyList.votes[p] || 0) }, seats: sim.partyList.parties.map(p => sim.seats.plSeats?.[p] || 0) };
  return out;
}
// 用史实乡镇分布把县市／选区票数按比例拆到乡镇（地图细节用）
function townSplit(u, f, cks) {
  const out = {};
  const tb = u.townBase || {};
  const towns = Object.keys(tb);
  if (!towns.length) return out;
  for (let i = 0; i < cks.length; i++) {
    const c = cks[i];
    const baseTotal = towns.reduce((a, t) => a + (tb[t][i] || 0), 0) || 1;
    for (const t of towns) { (out[t] ||= { votes: Array(cks.length).fill(0) }).votes[i] = Math.round((f.votes[c] || 0) * (tb[t][i] || 0) / baseTotal); }
  }
  return out;
}
