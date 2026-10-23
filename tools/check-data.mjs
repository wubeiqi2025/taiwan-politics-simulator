// 数据自检：输出各类数量与关键时点状态
import fs from 'node:fs';
const B = JSON.parse(fs.readFileSync('src/data/base.json', 'utf8'));
const R = JSON.parse(fs.readFileSync('src/data/results.json', 'utf8'));
const P = id => B.people[+id.slice(1)]?.n;
const cnt = {};
for (const t of B.terms) { const k = t.inst.split(':')[0]; cnt[k] = (cnt[k] || 0) + 1; }
console.log('届次', cnt);
for (const t of B.terms.filter(t => t.inst === 'LY' || t.inst === 'NA' || t.inst === 'TPA')) console.log(t.inst, t.n, t.from, t.to, JSON.stringify(t.comp), t.members?.length);
for (const d of ['1986-06-01', '1995-01-01', '2005-01-01', '2012-06-01', '2026-10-22']) {
  const live = B.execs.filter(e => e.from <= d && (!e.to || e.to >= d));
  console.log(d, live.length, live.map(e => e.u + ':' + (e.p ? P(e.p) : '?') + '/' + e.party).join(' '));
}
const rt = B.terms.filter(t => t.inst.startsWith('R:'));
console.log('代表会届次', rt.length, rt.slice(0, 3).map(t => t.inst + ' ' + t.from + ' ' + JSON.stringify(t.comp)));
const ct = B.terms.filter(t => t.inst === 'C:TPE');
console.log(ct.map(t => `${t.from}~${t.to} ${JSON.stringify(t.comp)}`).join('\n'));
console.log(B.elections.map(e => e.id).join(' '));
const ly = R['L0-2024-01-13'];
console.log('2024立委选区', ly.districts.length, ly.districts[0].name, ly.districts[0].towns.length, ly.partyList?.parties);
