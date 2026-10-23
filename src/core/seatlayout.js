// 半圆议会席位排布：每个圆点对应一个实际席位
export function seatLayout(n, W = 300) {
  if (n <= 0) return { pts: [], r: 0, W, H: W / 2 };
  const rows = n <= 3 ? 1 : n <= 11 ? 2 : n <= 24 ? 3 : n <= 45 ? 4 : n <= 70 ? 5 : n <= 100 ? 6 : n <= 140 ? 7 : n <= 190 ? 8 : n <= 250 ? 9 : n <= 330 ? 11 : 13;
  const R = W / 2 - 4;
  const r0 = rows === 1 ? 0.62 : rows === 2 ? 0.5 : rows <= 4 ? 0.4 : 0.32;
  const radii = Array.from({ length: rows }, (_, i) => R * (rows === 1 ? 0.8 : r0 + (1 - r0) * i / (rows - 1)));
  const sum = radii.reduce((a, b) => a + b, 0);
  // 按半径比例分配每排座位数
  let per = radii.map(r => Math.max(1, Math.round(n * r / sum)));
  let diff = n - per.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) { if (diff > 0) { per[i]++; diff--; } else if (per[i] > 1) { per[i]--; diff++; } }
  const pts = [];
  radii.forEach((r, i) => {
    const m = per[i];
    for (let j = 0; j < m; j++) {
      const a = m === 1 ? Math.PI / 2 : Math.PI * (1 - j / (m - 1));
      pts.push({ a, r, x: W / 2 + r * Math.cos(a), y: R + 4 - r * Math.sin(a) });
    }
  });
  // 由左至右（角度大到小），同角度由内到外
  pts.sort((p, q) => q.a - p.a || p.r - q.r);
  const rowGap = rows > 1 ? (radii[1] - radii[0]) : R * 0.4;
  const arcGap = Math.min(...radii.map((r, i) => (per[i] > 1 ? Math.PI * r / (per[i] - 1) : R)));
  const dot = Math.max(1.6, Math.min(rowGap, arcGap) * 0.42);
  return { pts, r: dot, W, H: R + 4 + dot + 2 };
}
