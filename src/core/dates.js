// 日期工具：内部统一使用 'YYYY-MM-DD' 字符串
export const MIN_DATE = '1986-01-01';
export const MAX_DATE = '2026-12-31';
export const TODAY_REAL = '2026-10-22'; // 真实资料最后核实日期

const pad = n => String(n).padStart(2, '0');
export const toStr = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const toDate = s => new Date(s + 'T00:00:00Z');
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12

export function addDays(s, n) { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toStr(d); }

// 按单位推进：月、年推进时月末自动对齐（1月31日 + 1月 = 2月28/29日）
export function addDuration(s, n, unit) {
  if (unit === '日') return addDays(s, n);
  if (unit === '周') return addDays(s, n * 7);
  let [y, m, d] = s.split('-').map(Number);
  const months = unit === '年' ? n * 12 : n;
  let total = y * 12 + (m - 1) + months;
  y = Math.floor(total / 12); m = (total % 12) + 1;
  d = Math.min(d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
export const clampDate = s => (s < MIN_DATE ? MIN_DATE : s > MAX_DATE ? MAX_DATE : s);
export const isValidDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(toDate(s)) === s;

// 显示：公历或民国纪年
export function fmtDate(s, opts = {}) {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  const prec = opts.prec || 'd';
  const roc = opts.roc;
  const yy = roc ? `民国${y - 1911}年` : `${y}年`;
  if (prec === 'y') return yy + (opts.mark !== false ? '（日期待核）' : '');
  if (prec === 'm') return `${yy}${m}月` + (opts.mark !== false ? '（日待核）' : '');
  return `${yy}${m}月${d}日`;
}
export const fmtShort = (s, roc) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return roc ? `民${y - 1911}.${m}.${d}` : `${y}.${pad(m)}.${pad(d)}`;
};
export const yearOf = s => +s.slice(0, 4);
export const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
