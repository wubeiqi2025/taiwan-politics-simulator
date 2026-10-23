// 简繁切换：作用于整个页面（界面、地图标注、人名地名、悬浮提示、弹窗）以及导出图片
// 模式：orig＝简体界面＋专名保留原文；simp＝全部简体；trad＝全部繁体（台湾用字）
import { ConverterFactory } from 'opencc-js/core';
import STCharacters from 'opencc-js/dict/STCharacters';
import TSCharacters from 'opencc-js/dict/TSCharacters';
import TWVariants from 'opencc-js/dict/TWVariants';
import TWVariantsRev from 'opencc-js/dict/TWVariantsRev';

const toT = ConverterFactory([STCharacters], [TWVariants]);
const toS = ConverterFactory([TWVariantsRev], [TSCharacters]);
const orig = new WeakMap();   // 文字节点 → 原文
let observer = null;
let conv = null;
export let scriptMode = 'orig';

const SKIP = 'input, textarea, [data-noconv]';
function apply(n) {
  const p = n.parentNode;
  if (!p || (p.closest && p.closest(SKIP))) return;
  const src = orig.has(n) ? orig.get(n) : n.nodeValue;
  if (!src || !/[㐀-鿿]/.test(src)) return;
  const c = conv(src);
  if (c !== n.nodeValue) { if (!orig.has(n)) orig.set(n, src); n.nodeValue = c; }
}
function walk(root, f) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) f(n);
}
function restoreAll() { walk(document.body, n => { if (orig.has(n)) { n.nodeValue = orig.get(n); orig.delete(n); } }); }
// 属性中的文字（title、placeholder）
const ATTRS = ['title', 'placeholder', 'aria-label'];
const origAttr = new WeakMap();
function applyAttrs(root) {
  const els = root.querySelectorAll ? root.querySelectorAll('[title],[placeholder]') : [];
  for (const el of [root, ...els]) {
    if (!el.getAttribute) continue;
    let m = origAttr.get(el);
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || !/[㐀-鿿]/.test(v)) continue;
      if (!m) { m = {}; origAttr.set(el, m); }
      const src = m[a] ?? v;
      const c = conv ? conv(src) : src;
      if (c !== v) { m[a] = src; el.setAttribute(a, c); }
    }
  }
}
export function setScriptMode(mode) {
  scriptMode = mode;
  observer?.disconnect();
  observer = null;
  restoreAll();
  conv = mode === 'trad' ? toT : mode === 'simp' ? toS : null;
  if (!conv) return;
  walk(document.body, apply);
  applyAttrs(document.body);
  observer = new MutationObserver(muts => {
    observer.disconnect();
    for (const m of muts) {
      if (m.type === 'characterData') { orig.delete(m.target); apply(m.target); }
      else if (m.type === 'attributes') applyAttrs(m.target);
      else for (const node of m.addedNodes) { if (node.nodeType === 3) apply(node); else if (node.nodeType === 1) { walk(node, apply); applyAttrs(node); } }
    }
    observer.observe(document.body, OBS);
  });
  observer.observe(document.body, OBS);
}
const OBS = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS };
// 供导出图片等非 DOM 文字使用
export const convertText = s => (conv ? conv(s) : s);

// 搜索用：简繁不敏感比较
export const normS = s => toS(String(s || ''));
export const matchName = (name, q) => !q || normS(name).includes(normS(q));
