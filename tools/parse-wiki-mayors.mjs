// 解析维基百科 1985/1989/1993 县市长选举各县市候选人表格
import fs from 'node:fs';

const PARTY = [
  [/\{\{\s*kmt\s*\}\}|中國國民黨/i, 'KMT'], [/\{\{\s*dpp\s*\}\}|民主進步黨/i, 'DPP'], [/\{\{\s*nonp\s*\}\}|無黨籍/i, 'IND'],
  [/青年黨/, 'CYP'], [/民主社會黨|民社黨/, 'CDSP'], [/工黨/, 'LAB'], [/勞動黨/, 'LP'], [/新國家連線/, 'NNA'],
  [/\{\{\s*np\s*\}\}|新黨/i, 'NP'],
];
const party = s => { for (const [re, id] of PARTY) if (re.test(s)) return id; return null; };
const clean = s => s.replace(/'''/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/align="[^"]*"\|/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').trim();

export function parse(file) {
  const t = fs.readFileSync(file, 'utf8');
  const out = [];
  const parts = t.split(/\n\|\+/).slice(1);
  for (const p of parts) {
    const cap = p.split('\n')[0];
    const m = cap.match(/\[\[([^\]|]+?)(?:縣長|市長)\]\]/);
    if (!m) continue;
    const region = m[1].replace(/^台/, '臺');
    const body = p.split(/\n\|\}/)[0];
    const cands = [];
    for (const row of body.split(/\n\|-/)) {
      const line = row.split('\n').filter(l => l.startsWith('|') && !l.startsWith('|+')).join('||');
      if (!line) continue;
      const cells = line.replace(/^\|/, '').split('||').map(s => s.trim());
      const pid = cells.map(party).find(Boolean);
      if (!pid) continue;
      const votesCell = cells.find(c => /^(align="right"\|)?\s*[\d,]{3,}\s*$/.test(c));
      const pctCell = cells.find(c => /[\d.]+\s*%/.test(c));
      const nameCell = cells.find(c => !party(c) && /\[\[|[一-鿿]{2,}/.test(c) && !/File:|%|^\d/.test(clean(c)) && clean(c).length >= 2 && clean(c).length <= 8);
      if (!nameCell) continue;
      cands.push({
        name: clean(nameCell), party: pid,
        votes: votesCell ? +clean(votesCell).replace(/,/g, '') : null,
        pct: pctCell ? +pctCell.match(/([\d.]+)\s*%/)[1] : null,
        win: /Vote1/.test(line),
      });
    }
    if (cands.length) out.push({ region, cands });
  }
  return out;
}

if (process.argv[2]) {
  const r = parse(process.argv[2]);
  for (const x of r) console.log(x.region, x.cands.map(c => `${c.name}/${c.party}/${c.votes}/${c.pct}${c.win ? '*' : ''}`).join(' '));
}
