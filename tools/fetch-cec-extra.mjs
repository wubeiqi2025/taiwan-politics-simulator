// 补抓：立委区域选区的乡镇市区明细（用于选区—乡镇对应）、不分区政党票乡镇明细、县市长乡镇明细
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'https://db.cec.gov.tw/static/elections/';
const OUT = 'raw/cec';
async function get(rel) {
  const file = path.join(OUT, rel.replace(/[\/]/g, '__'));
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(ROOT + rel);
      if (r.status === 404) { fs.writeFileSync(file, 'null'); return null; }
      if (!r.ok) throw new Error(r.status);
      const t = await r.text(); fs.writeFileSync(file, t); return JSON.parse(t);
    } catch { await new Promise(s => setTimeout(s, 800 * (i + 1))); }
  }
  console.warn('FAIL', rel); return null;
}
const first = j => (j ? Object.values(j)[0] : []);
const man = JSON.parse(fs.readFileSync('raw/cec-manifest.json', 'utf8'));
for (const e of man) {
  const p = `ELC/${e.subject}/${e.legis}/${e.theme}`;
  if (e.subject === 'L0' && e.legis === 'L1') {
    for (const c of e.counties) {
      await get(`data/tickets/${p}/D/${c}.json`);
    }
    console.log('L1', e.date);
  }
  if ((e.subject === 'L0' && e.legis === 'L4') || e.subject === 'C1' || e.subject === 'C2') {
    const pf = first(await get(`data/profiles/${p}/C/00_000_00_000_0000.json`));
    const cs = [...new Set(pf.map(r => `${r.prv_code}_${r.city_code}_00_000_0000`))];
    await Promise.all(cs.map(c => get(`data/tickets/${p}/D/${c}.json`)));
    await Promise.all(cs.map(c => get(`data/profiles/${p}/D/${c}.json`)));
    console.log(e.subject, e.legis, e.date, cs.length);
  }
}
