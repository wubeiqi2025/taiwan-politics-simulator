// 从中选会选举资料库下载原始 JSON（缓存到 raw/cec）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'https://db.cec.gov.tw/static/elections/';
const OUT = 'raw/cec';
fs.mkdirSync(OUT, { recursive: true });

async function get(rel) {
  const file = path.join(OUT, rel.replace(/[\/]/g, '__'));
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(ROOT + rel);
      if (r.status === 404) { fs.writeFileSync(file, 'null'); return null; }
      if (!r.ok) throw new Error(r.status);
      const t = await r.text();
      fs.writeFileSync(file, t);
      return JSON.parse(t);
    } catch (e) { await new Promise(s => setTimeout(s, 800 * (i + 1))); }
  }
  console.warn('FAIL', rel);
  return null;
}
const first = j => (j ? Object.values(j)[0] : []);
const code = r => `${r.prv_code}_${r.city_code}_00_000_0000`;

const subjects = ['P0', 'L0', 'C1', 'C2', 'T1', 'T2', 'D1', 'D2', 'R1', 'R2', 'N0'];
const manifest = [];
for (const s of subjects) {
  const list = await get(`list/ELC_${s}.json`);
  for (const area of list) for (const t of area.theme_items) {
    const legis = t.legislator_type_id;
    const p = `ELC/${s}/${legis}/${t.theme_id}`;
    const entry = { subject: s, legis, theme: t.theme_id, name: t.theme_name, date: t.vote_date, desc: t.legislator_desc, level: t.data_level, tk: t.data_tckt_seq, pf: t.data_prof_seq, files: [] };
    manifest.push(entry);
    // 先取县市层级概况
    const pfC = t.data_prof_seq.includes('C') ? await get(`data/profiles/${p}/C/00_000_00_000_0000.json`) : null;
    if (t.data_prof_seq.includes('N')) { await get(`data/profiles/${p}/N/00_000_00_000_0000.json`); entry.files.push('profN'); }
    if (pfC) entry.files.push('profC');
    const counties = [...new Set(first(pfC).map(code))];
    const lvl = t.data_tckt_seq[0];
    if (lvl === 'N') {
      await get(`data/tickets/${p}/N/00_000_00_000_0000.json`); entry.files.push('tkN');
      if (t.data_tckt_seq.includes('C')) { await get(`data/tickets/${p}/C/00_000_00_000_0000.json`); entry.files.push('tkC'); }
    } else if (lvl === 'C') {
      await get(`data/tickets/${p}/C/00_000_00_000_0000.json`); entry.files.push('tkC');
    }
    // 总统选举额外抓取乡镇市区层级
    const sub = s === 'P0' ? 'D' : (lvl === 'A' || lvl === 'D') ? lvl : null;
    if (sub) {
      entry.counties = counties;
      await Promise.all(counties.map(c => get(`data/tickets/${p}/${sub}/${c}.json`)));
      if (lvl === 'A') await Promise.all(counties.map(c => get(`data/profiles/${p}/A/${c}.json`)));
      entry.files.push('tk' + sub);
    }
    console.log(s, legis, t.vote_date, t.theme_name, counties.length);
  }
}
fs.writeFileSync('raw/cec-manifest.json', JSON.stringify(manifest, null, 1));
