// 下载维基百科原始 wikitext（仅作为待核对辅助来源）
import fs from 'node:fs';
fs.mkdirSync('raw/wiki', { recursive: true });
for (const title of process.argv.slice(2)) {
  const url = `https://zh.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`;
  const r = await fetch(url, { headers: { 'User-Agent': 'tw-sandbox-research/1.0' } });
  const t = await r.text();
  fs.writeFileSync(`raw/wiki/${title}.txt`, t);
  console.log(title, r.status, t.length);
}
