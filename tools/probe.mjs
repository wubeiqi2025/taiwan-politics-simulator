const base = 'https://db.cec.gov.tw/static/elections/data/tickets/ELC/';
const tries = process.argv.slice(2);
for (const p of tries) {
  const r = await fetch(base + p);
  const t = await r.text();
  console.log(p, r.status, t.length, t.slice(0, 400).replace(/\s+/g, ' '));
  if (r.ok) { const j = JSON.parse(t); console.log('keys', Object.keys(j).slice(0, 20), Object.keys(j).length); }
}
