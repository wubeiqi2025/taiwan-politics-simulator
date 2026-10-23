// 原始史料库（只读）与索引。任何分支修改都不会写回这里。
import base from '../data/base.json';
import results from '../data/results.json';
import geo from '../data/geo.json';

export const DB = base;
export const RESULTS = results;
export const GEO = geo;

const groupBy = (arr, f) => { const m = {}; for (const x of arr) (m[f(x)] ||= []).push(x); return m; };

export const IDX = {
  party: Object.fromEntries(DB.parties.map(p => [p.id, p])),
  unit: Object.fromEntries(DB.units.map(u => [u.id, u])),
  inst: Object.fromEntries(DB.insts.map(i => [i.id, i])),
  election: Object.fromEntries(DB.elections.map(e => [e.id, e])),
  event: Object.fromEntries(DB.events.map(e => [e.id, e])),
  termsByInst: groupBy(DB.terms, t => t.inst),
  execsByUnit: groupBy(DB.execs, e => e.u),
  townExecsByTown: groupBy(DB.townExecs, e => e.t),
  townUnits: {},       // 乡镇代码 → 历来所属单位
  roles: {},           // 人物 → 任职列表（反向索引）
  electionsByType: groupBy(DB.elections, e => e.type),
};
for (const u of DB.units) for (const t of u.towns) (IDX.townUnits[t] ||= []).push(u.id);
for (const k in IDX.termsByInst) IDX.termsByInst[k].sort((a, b) => a.from.localeCompare(b.from));
for (const k in IDX.execsByUnit) IDX.execsByUnit[k].sort((a, b) => a.from.localeCompare(b.from));
for (const k in IDX.townExecsByTown) IDX.townExecsByTown[k].sort((a, b) => a.from.localeCompare(b.from));
DB.elections.sort((a, b) => a.date.localeCompare(b.date));

// ---------- 人物任职反向索引 ----------
function addRole(pid, r) { if (pid) (IDX.roles[pid] ||= []).push(r); }
for (const e of DB.execs) addRole(e.p, { kind: 'exec', label: IDX.unit[e.u].name + (IDX.unit[e.u].type === '縣' ? '縣長' : '市長'), region: e.u, from: e.from, to: e.to, party: e.party, how: e.how, el: e.el, src: e.src || 'cec' });
for (const e of DB.townExecs) addRole(e.p, { kind: 'townexec', label: (DB.towns[e.t]?.n || '') + '首長', town: e.t, from: e.from, to: e.to, party: e.party, el: e.el, src: 'cec' });
for (const t of DB.terms) {
  const inst = IDX.inst[t.inst];
  for (const m of t.members || []) {
    const [pid, party, district, from, to] = m;
    addRole(pid, { kind: 'member', label: instName(t.inst) + (t.label ? ' ' + t.label : '') + (t.inst.startsWith('R:') ? '代表' : t.inst === 'LY' ? '立法委員' : t.inst === 'NA' ? '國大代表' : '議員'), inst: t.inst, term: t, district, from: from || t.from, to: to || t.to, party, src: t.src });
  }
}
for (const [k, o] of Object.entries(DB.offices)) for (const r of o.list) addRole(r.p, { kind: 'office', label: o.name, office: k, from: r.from, to: r.to, party: r.party, note: r.note, src: 'common' });
for (const [pid, list] of Object.entries(DB.chairs)) for (const r of list) addRole(r.p, { kind: 'chair', label: IDX.party[pid].name + '主席', party: pid, from: r.from, to: r.to, note: r.note, src: 'common' });
// 参选纪录
export function candidacies(pid) {
  const out = [];
  for (const el of DB.elections) {
    const r = RESULTS[el.id];
    if (!r) continue;
    const scan = (cands, where, total) => { for (const c of cands || []) if (c.pid === pid || c.vpid === pid) out.push({ el, where, party: c.party, votes: c.votes, win: c.win, vice: c.vpid === pid, total }); };
    if (r.cands) scan(r.cands, '全国', r.national?.valid);
    if (r.races) for (const [u, race] of Object.entries(r.races)) scan(race.cands, IDX.unit[u]?.name, race.valid);
    if (r.districts) for (const d of r.districts) scan(d.cands, d.name, d.valid);
    if (r.towns) for (const [t, v] of Object.entries(r.towns)) for (const d of Array.isArray(v) ? v : [v]) scan(d.cands, (DB.towns[t]?.n || '') + (d.name ? ' ' + d.name : ''), d.valid);
  }
  return out;
}
export function instName(id) {
  const i = IDX.inst[id];
  if (!i) return id;
  if (id.startsWith('R:')) { const t = DB.towns[i.town]; return (t ? t.n : '') + (i.level === '山地原住民區' ? '區民代表會' : '民代表會'); }
  return i.name;
}
export const personName = pid => (pid ? DB.people[+pid.slice(1)]?.n : null);
export const basePerson = pid => (pid && pid[0] === 'p' ? DB.people[+pid.slice(1)] : null);
export const SRC = DB.meta.sources;
