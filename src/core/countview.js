// 开票中的地图着色来源
import { signal } from '@preact/signals';
import { townsOfUnit } from './world.js';

export const countView = signal(null); // {sim, snap, step, updated:Set(unitKey)}

export function countValue(b, d, u, t) {
  const cv = countView.value;
  if (!cv) return null;
  const { sim, snap } = cv;
  const cb = Object.fromEntries(sim.cands.map(c => [c.k, c]));
  let unit = null;
  if (sim.type === 'president' || sim.type === 'mayor') unit = sim.units.find(x => x.k === u);
  else if (t) unit = sim.units.find(x => x.region?.towns?.includes(t));
  if (!unit && !t && sim.type !== 'president' && sim.type !== 'mayor') {
    // 县市层级：以该县市内各选区领先者的多数党着色
    const us = sim.units.filter(x => x.region?.u === u || x.region?.towns?.some(tt => townsOfUnit(b, u, d).includes(tt)));
    if (!us.length) return { kind: 'none', label: '本场选举不含此地' };
    const comp = {};
    for (const x of us) for (const c of snap.status[x.k].leaders) comp[cb[c].party] = (comp[cb[c].party] || 0) + 1;
    const top = Object.entries(comp).sort((a, b) => b[1] - a[1])[0];
    const f = us.reduce((a, x) => a + snap.units[x.k].f, 0) / us.length;
    return { kind: 'party', party: top[0], label: `领先席次最多 · 已开 ${(f * 100).toFixed(0)}%`, alpha: 0.35 + 0.65 * f, updated: us.some(x => cv.updated?.has(x.k)) };
  }
  if (!unit) return { kind: 'none', label: '本场选举不含此地' };
  const st = snap.status[unit.k];
  const x = snap.units[unit.k];
  if (!x || x.f <= 0) return { kind: 'none', label: '尚未开票', unit: unit.k };
  const lead = cb[st.leaders[0]];
  const decided = st.decided[0];
  return { kind: 'party', party: lead.party, label: `${lead.name}${decided ? ' 确定当选' : ' 暂时领先'} · 已开 ${(x.f * 100).toFixed(0)}%`, alpha: decided ? 1 : 0.35 + 0.55 * x.f, updated: cv.updated?.has(unit.k), unit: unit.k };
}
