// 历史时点引擎：根据（分支, 日期）计算当时的行政区、首长、议会、政党与地图着色
import { DB, IDX, RESULTS, personName, basePerson } from './db.js';
import { inRange, addDays } from './dates.js';

// ---------- 事件与补丁 ----------
// 补丁目标 ↔ 事件效果目标
export const patchToEffect = t => (t.startsWith('seats:') ? 'inst:' + t.slice(6) : t);
export const effectToPatch = t => (t.startsWith('inst:') ? 'seats:' + t.slice(5) : t);

export function allEvents(b) {
  const custom = (b?.customEvents || []).map(e => ({ ...e, kind: 'custom' }));
  return custom.length ? [...DB.events, ...custom].sort((x, y) => x.date.localeCompare(y.date)) : DB.events;
}
// 某事件对某目标的效果是否在分支中生效
function eventAppliesTo(b, e, target) {
  const d = b.decisions?.[e.id];
  if (!d) return true; // 未冲突即自动生效
  if (d.d === 'applied') return true;
  if (d.d === 'partial') return (d.targets || []).includes(target);
  return false; // kept / manual / replaced
}
const effectIndex = new Map(); // 效果目标 → 真实事件（按日期）
for (const e of DB.events) for (const ef of e.effects || []) {
  if (!effectIndex.has(ef.t)) effectIndex.set(ef.t, []);
  effectIndex.get(ef.t).push(e);
}
// 当前生效的补丁（考虑被之后已应用的史实事件终止）
export function activePatch(b, target, d) {
  if (!b?.patches?.length) return null;
  let last = null;
  for (const p of b.patches) if (p.t === target && p.date <= d && (!last || p.date >= last.date)) last = p;
  if (!last) return null;
  if (last.v === undefined) return null; // 显式清除补丁
  const ef = patchToEffect(target);
  const evs = [...(effectIndex.get(ef) || []), ...(b.customEvents || []).filter(e => e.effects?.some(x => x.t === ef))];
  for (const e of evs) {
    if (e.date > last.date && e.date <= d && e.date <= b.date && eventAppliesTo(b, e, ef)) return null;
  }
  return last;
}
// 用于时间流动：事件到来时与哪些补丁冲突
export function eventConflicts(b, e) {
  const out = [];
  for (const ef of e.effects || []) {
    const pt = effectToPatch(ef.t);
    const p = activePatch({ ...b, date: e.date }, pt, addDays(e.date, -1));
    if (p && p.date < e.date) out.push({ effect: ef, patch: p });
  }
  return out;
}

// ---------- 政党 ----------
export function party(b, id) {
  const base = IDX.party[id] || b?.customParties?.find(p => p.id === id);
  if (!base) return { id, name: id || '未知', short: id || '未知', color: '#b8bcc4', unknown: true };
  const ov = b?.partyOv?.[id];
  return ov ? { ...base, ...ov } : base;
}
export const partyColor = (b, id) => party(b, id).color;
export function allParties(b) { return [...DB.parties, ...(b?.customParties || [])].map(p => party(b, p.id)); }
export function partyExists(b, id, d) {
  if (id === 'IND') return true;
  const p = activePatch(b, 'partyExists:' + id, d);
  if (p) return !!p.v;
  const pt = party(b, id);
  return (!pt.founded || pt.founded <= d) && (!pt.dissolved || d < pt.dissolved);
}
export function chairAt(b, pid, d) {
  const p = activePatch(b, 'chair:' + pid, d);
  if (p) return { p: p.v?.p, name: p.v?.name, patch: true };
  const list = DB.chairs[pid] || [];
  const r = list.find(r => inRange(d, r.from, r.to ? addDays(r.to, -1) : null));
  return r ? { p: r.p, note: r.note } : null;
}

// ---------- 人物 ----------
export function person(b, pid) {
  if (!pid) return null;
  const base = basePerson(pid) || b?.customPeople?.find(p => p.id === pid);
  if (!base) return { id: pid, n: '未知人物', missing: true };
  const ov = b?.personOv?.[pid];
  return ov ? { ...base, ...ov } : base;
}
export const pname = (b, pid) => person(b, pid)?.n || personName(pid) || '（资料待补）';
// 人物在某日的党籍：管理员改党籍补丁优先，否则用任职纪录党籍
export function personPartyAt(b, pid, d, fallback) {
  const p = activePatch(b, 'person:' + pid, d);
  if (p?.v?.party) return p.v.party;
  return fallback;
}

// ---------- 行政区 ----------
export function unitsAt(d) { return DB.units.filter(u => inRange(d, u.from, u.to)); }
export function unitOfTown(b, t, d) {
  const p = activePatch(b, 'admin:' + t, d);
  if (p?.v?.unit) return p.v.unit;
  return (IDX.townUnits[t] || []).find(u => inRange(d, IDX.unit[u].from, IDX.unit[u].to));
}
export function unitInfo(b, u, d) {
  const base = IDX.unit[u];
  const p = activePatch(b, 'admin:' + u, d);
  return p?.v ? { ...base, ...p.v, patched: true } : base;
}
export function townsOfUnit(b, u, d) {
  const base = IDX.unit[u]?.towns || [];
  if (!b?.patches?.some(p => p.t.startsWith('admin:'))) return base;
  return Object.keys(DB.towns).filter(t => unitOfTown(b, t, d) === u);
}
export function townInfo(t, d) {
  const x = DB.towns[t];
  let name = x.n, prec = 'd', note = '';
  for (const [hd, hn, hp, hnote] of x.hist) if (hd <= d) { name = hn; prec = hp; note = hnote; }
  let type;
  if (/鄉$/.test(name)) type = x.mtn ? '山地鄉' : '鄉';
  else if (/鎮$/.test(name)) type = '鎮';
  else if (/市$/.test(name)) type = '縣轄市';
  else if (x.mtn && d >= '2014-12-25') type = '山地原住民區';
  else type = '區';
  return { name, type, prec, note, modern: x.n, county: x.c };
}
export const unitTypeLabel = u => ({ 直轄市: '直辖市', 省轄市: '省辖市', 縣: '县' })[u.type] || u.type;

// ---------- 首长 ----------
export function execAt(b, u, d) {
  const p = activePatch(b, 'exec:' + u, d);
  if (p) return { p: p.v?.p || null, name: p.v?.name, party: p.v?.party || null, how: p.v?.how || '架空设定', patch: p };
  const list = IDX.execsByUnit[u] || [];
  let hit = null;
  for (const e of list) if (inRange(d, e.from, e.to)) hit = e;
  return hit;
}
export function townExecAt(b, t, d) {
  const p = activePatch(b, 'townexec:' + t, d);
  if (p) return { p: p.v?.p || null, party: p.v?.party || null, how: '架空设定', patch: p };
  const list = IDX.townExecsByTown[t] || [];
  let hit = null;
  for (const e of list) if (inRange(d, e.from, e.to)) hit = e;
  return hit;
}
export function officeAt(b, office, d) {
  const p = activePatch(b, 'office:' + office, d);
  if (p) return { p: p.v?.p, party: p.v?.party, patch: p };
  const o = DB.offices[office];
  return o?.list.find(r => inRange(d, r.from, r.to ? addDays(r.to, -1) : null)) || null;
}

// ---------- 民意机关 ----------
export function instsFor(b, d, { unit, town } = {}) {
  return DB.insts.filter(i => {
    if (unit && i.region !== unit) return false;
    if (town && i.town !== town) return false;
    return instExists(i, d);
  });
}
export function instExists(i, d) {
  if (!inRange(d, i.from, i.to)) return false;
  if (i.gap && inRange(d, i.gap[0], i.gap[1])) return false;
  if (i.town) { const ti = townInfo(i.town, d); if (ti.type === '區') return false; }
  return true;
}
export function termAt(inst, d) {
  const list = IDX.termsByInst[inst] || [];
  let hit = null;
  for (const t of list) if (inRange(d, t.from, t.to)) hit = t;
  return hit;
}
// 席位资料：{label, total, members:[{p, party, district, role, vacant}], comp, note, missing, src, patch}
export function seatsAt(b, inst, d) {
  const p = activePatch(b, 'seats:' + inst, d);
  if (p) {
    const v = p.v;
    const members = v.members.map(m => ({ ...m, party: m.p ? personPartyAt(b, m.p, d, m.party) : m.party }));
    return finish({ label: v.label || '架空届次', total: v.total, members, note: v.note, patch: p, src: 'admin', from: p.date, speaker: v.speaker, deputy: v.deputy }, b, d);
  }
  const t = termAt(inst, d);
  if (!t) return null;
  if (t.missing || !t.comp) return { label: t.label, total: 0, members: [], missing: true, note: t.note, from: t.from, to: t.to, src: t.src };
  let members;
  if (t.members?.length && t.inst === 'LY') {
    members = t.members.filter(m => m[3] <= d && m[4] >= d).map(([pid, party, district]) => ({ p: pid, party: personPartyAt(b, pid, d, party), district }));
  } else if (t.members?.length && !t.compSrc) {
    members = t.members.map(([pid, party, district]) => ({ p: pid, party: personPartyAt(b, pid, d, party), district }));
  } else {
    // 仅有党派席次：生成姓名待补的席位
    members = [];
    for (const [party, n] of Object.entries(t.comp)) for (let i = 0; i < n; i++) members.push({ p: null, party, district: null, unnamed: true });
  }
  let total = t.seatsTotal || Object.values(t.comp).reduce((a, c) => a + c, 0);
  if (members.length > total) total = members.length;
  const extra = {};
  if (inst === 'LY') { const s = officeAt(b, 'speaker', d), dp = officeAt(b, 'deputySpeaker', d); extra.speaker = s?.p; extra.deputy = dp?.p; }
  return finish({ label: t.label, total, members, note: t.note, src: t.src, from: t.from, to: t.to, el: t.el, verified: t.verified, ...extra }, b, d);
}
function finish(s, b, d) {
  const vac = Math.max(0, s.total - s.members.length);
  const members = [...s.members];
  for (let i = 0; i < vac; i++) members.push({ p: null, party: null, vacant: true });
  const comp = {};
  for (const m of members) if (!m.vacant) comp[m.party || 'IND'] = (comp[m.party || 'IND'] || 0) + 1;
  return { ...s, members, comp, vacant: vac };
}
export function sortedComp(b, comp) {
  return Object.entries(comp || {}).sort((x, y) => (party(b, x[0]).order ?? 50) - (party(b, y[0]).order ?? 50));
}
export function largest(comp) {
  const e = Object.entries(comp || {}).sort((a, b) => b[1] - a[1]);
  if (!e.length) return null;
  const top = e.filter(x => x[1] === e[0][1]).map(x => x[0]);
  return { parties: top, n: e[0][1], total: e.reduce((a, x) => a + x[1], 0) };
}

// ---------- 选举结果（含分支内已确认的模拟结果） ----------
export function electionResult(b, id) {
  const c = b?.confirmed?.[id];
  if (c) return { ...c.result, simulated: true, simName: c.name };
  return RESULTS[id];
}
export function latestElection(b, d, pred) {
  // 分支确认的模拟选举可以替代同一场真实选举或新增架空选举
  const list = [...DB.elections.filter(e => !e.summary || pred.allowSummary), ...Object.values(b?.confirmed || {}).filter(c => c.standalone).map(c => c.meta)];
  let hit = null;
  for (const e of list) if (e.date <= d && pred(e) && (!hit || e.date >= hit.date)) hit = e;
  return hit;
}
const sumVotes = arr => arr.reduce((a, v) => (v ? a.map((x, i) => x + (v.votes[i] || 0)) : a), null);
export function unitAgg(res, u, b, d) {
  if (res.byUnit?.[u]) return res.byUnit[u];
  const towns = townsOfUnit(b, u, d).map(t => res.byTown?.[t]).filter(Boolean);
  if (!towns.length) return null;
  return { votes: towns.reduce((acc, t) => (acc ? acc.map((x, i) => x + t.votes[i]) : [...t.votes]), null), agg: true };
}
const argmax = v => { let m = -1, i = -1, tie = false; v.forEach((x, k) => { if (x > m) { m = x; i = k; tie = false; } else if (x === m) tie = true; }); return { i, tie, m }; };

// ---------- 地图着色 ----------
// 返回 {kind:'party'|'tie'|'none'|'missing'|'special'|'plain', party, parties, label, detail}
export const MAP_MODES = [
  { id: 'exec', name: '县市长党籍' },
  { id: 'president', name: '最近总统选举' },
  { id: 'ly', name: '最近立委选举' },
  { id: 'council', name: '地方议会最大党' },
  { id: 'control', name: '模拟控制党' },
  { id: 'count', name: '开票实时／最终' },
  { id: 'plain', name: '无颜色底图' },
];
export const LY_OPTS = [{ id: 'seats', name: '当选席位最多' }, { id: 'top', name: '最高票候选人' }, { id: 'party', name: '政党票第一' }];

export function regionValue(b, d, mode, u, t, opts = {}) {
  if (mode === 'plain') return { kind: 'plain' };
  if (mode === 'exec') {
    if (t) {
      const ti = townInfo(t, d);
      if (ti.type === '區') {
        // 直辖市／省辖市之区：区长由市长任命，随市长党籍以浅色显示
        const m = execAt(b, u, d);
        if (!m?.party) return { kind: 'none', label: '区长官派，不设民选首长' };
        return { kind: 'party', party: m.party, alpha: 0.55, label: `区长由市长任命（随${pname(b, m.p) || '市长'}党籍）` };
      }
      const e = townExecAt(b, t, d);
      if (!e) return { kind: 'missing', label: '乡镇市长资料待补（中选会资料库自1998年起）' };
      return { kind: 'party', party: e.party, label: pname(b, e.p), detail: e };
    }
    const e = execAt(b, u, d);
    if (!e) return { kind: 'missing', label: '首长资料待补' };
    if (!e.p && !e.party) return { kind: 'special', label: e.note || '官派（资料待补）' };
    return { kind: 'party', party: e.party, label: (e.p ? pname(b, e.p) : e.name || '') + (e.how && e.how !== '民选' ? `（${e.how}）` : ''), detail: e };
  }
  if (mode === 'president') {
    const el = latestElection(b, d, e => e.type === 'president');
    if (!el) return { kind: 'none', label: '1996年前尚无总统直选' };
    const res = electionResult(b, el.id);
    const v = t ? res.byTown?.[t] : unitAgg(res, u, b, d);
    if (!v) return { kind: 'missing', label: '该层级无资料' };
    const { i, tie } = argmax(v.votes);
    const c = res.cands[i];
    return tie ? { kind: 'tie', parties: [], label: '票数相同' } : { kind: 'party', party: c.party, label: `${c.name} ${(v.votes[i] / v.votes.reduce((a, x) => a + x, 0) * 100).toFixed(1)}%`, el };
  }
  if (mode === 'ly') return lyValue(b, d, u, t, opts.lyOpt || 'seats');
  if (mode === 'council') {
    if (t) {
      const ti = townInfo(t, d);
      const inst = IDX.inst['R:' + t];
      if (!inst || !instExists(inst, d)) return { kind: 'none', label: ti.type === '區' ? '直辖市区不设民选代表会' : '无代表会' };
      const s = seatsAt(b, 'R:' + t, d);
      if (!s || s.missing) return { kind: 'missing', label: '代表会资料待补（中选会资料库自2010年起）' };
      return compValue(s.comp, s.label);
    }
    const s = seatsAt(b, 'C:' + u, d);
    if (!s || s.missing) return { kind: 'missing', label: '议会资料待补' };
    return compValue(s.comp, s.label);
  }
  if (mode === 'control') {
    const p = activePatch(b, 'control:' + (t || u), d);
    if (p) return { kind: 'party', party: p.v, label: '管理员指定控制党' };
    const v = regionValue(b, d, 'exec', u, t);
    return { ...v, label: (v.label || '') + '（未指定，沿用首长党籍）', fallback: true };
  }
  if (mode === 'count') {
    const f = opts.countValue;
    return (f && f(u, t)) || { kind: 'none', label: '当前没有开票中的选举' };
  }
  return { kind: 'plain' };
}
// 放大到县市后的乡镇着色：乡镇层级缺资料或不设该类选举时，沿用县市层级党色（浅色），缺资料者另加斜线标记
export function townValue(b, d, mode, u, t, opts, unitVal) {
  const v = regionValue(b, d, mode, u, t, opts);
  if (!v || (v.kind !== 'missing' && v.kind !== 'none')) return v;
  if (mode === 'plain' || mode === 'count' || mode === 'president' || mode === 'ly') return v;
  const uv = unitVal || regionValue(b, d, mode, u, null, opts);
  if (uv?.kind !== 'party') return v;
  return { kind: 'party', party: uv.party, alpha: v.kind === 'missing' ? 0.62 : 0.5, hatch: v.kind === 'missing', label: `${v.label}；以县市层级着色（${uv.label || ''}）`, fallback: true };
}
function compValue(comp, label) {
  const l = largest(comp);
  if (!l) return { kind: 'missing', label: '无席次资料' };
  const maj = l.n * 2 > l.total;
  if (l.parties.length > 1) return { kind: 'tie', parties: l.parties, label: `并列最多（各${l.n}席）` };
  return { kind: 'party', party: l.parties[0], label: `${label || ''} 最大党 ${l.n}/${l.total}席${maj ? '（过半）' : '（未过半）'}` };
}
function lyValue(b, d, u, t, opt) {
  const el = latestElection(b, d, e => e.type === 'ly' && !e.summary);
  const early = latestElection(b, d, Object.assign(e => e.type === 'ly', { allowSummary: true }));
  if (!el || (early && early.date > el.date)) return { kind: 'missing', label: early ? `${early.name}：分区资料待补` : '无立委选举资料' };
  const res = electionResult(b, el.id);
  if (opt === 'party') {
    const pl = res.partyList;
    if (!pl) return { kind: 'none', label: '该届无独立政党票（2008年起实施两票制）' };
    const v = t ? res.partyByTown?.[t] : (pl.byUnit?.[u] || unitAgg({ byTown: res.partyByTown }, u, b, d));
    if (!v) return { kind: 'missing', label: '无资料' };
    const { i } = argmax(v.votes);
    const tot = v.votes.reduce((a, x) => a + x, 0);
    return { kind: 'party', party: pl.parties[i], label: `政党票第一 ${(v.votes[i] / tot * 100).toFixed(1)}%` };
  }
  const towns = t ? [t] : townsOfUnit(b, u, d);
  const ds = res.districts.filter(x => x.towns?.some(tt => towns.includes(tt)) || (!t && x.u === u));
  if (!ds.length) return { kind: 'missing', label: '无对应选区资料' };
  if (opt === 'top') {
    let best = null;
    for (const x of ds) for (const c of x.cands) { const v = t && x.byTown?.[t] ? x.byTown[t].votes[x.cands.indexOf(c)] : c.votes; if (!best || v > best.v) best = { v, c }; }
    return { kind: 'party', party: best.c.party, label: `最高票：${best.c.name}` };
  }
  const comp = {};
  for (const x of ds) for (const c of x.cands) if (c.win) comp[c.party] = (comp[c.party] || 0) + 1;
  const multi = ds.some(x => x.seats > 1);
  const v = compValue(comp, multi ? '复数选区' : '单一选区');
  if (t && ds.length > 1) v.label += '（该乡镇横跨多个选区）';
  return v;
}

// 全局摘要（顶部与截图）
export function nationalSummary(b, d) {
  return {
    president: officeAt(b, 'president', d), vp: officeAt(b, 'vp', d), premier: officeAt(b, 'premier', d), speaker: officeAt(b, 'speaker', d), governor: officeAt(b, 'governor', d),
  };
}
