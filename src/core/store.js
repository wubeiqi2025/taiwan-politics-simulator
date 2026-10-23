// 全局状态：分支、偏好、界面；自动存档、撤销重做、版本
import { signal, computed, batch } from '@preact/signals';
import { kvGet, kvSet, versionPut, versionList, versionGet, versionDel, requestPersistent } from './persist.js';
import { MIN_DATE } from './dates.js';

export const DATA_VERSION = '2026.10.22-1';
export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function newBranch({ name, kind = 'sim', startDate = MIN_DATE, from = null }) {
  const b = from ? clone(from) : {
    patches: [], customEvents: [], decisions: {}, seen: {}, partyOv: {}, customParties: [], personOv: {}, customPeople: [],
    sims: {}, confirmed: {}, log: [], pendingFlow: null, flowMarks: [],
  };
  return Object.assign(b, { id: uid('b'), name, kind, created: new Date().toISOString(), startDate: from ? b.startDate : startDate, date: from ? b.date : startDate, parent: from?.id || null });
}

const DEFAULT_PREFS = {
  roc: false, trad: false, mapMode: 'exec', lyOpt: 'seats', motion: 'full', countSpeed: 1, showLegend: true, showTimeline: true,
  countMethod: 'fixed', countStep: 10, countBatches: '3,8,15,25,40,55,70,82,92,100', seasonName: '赛季一',
};
export const app = signal(null);
export const branch = computed(() => app.value ? app.value.branches[app.value.activeId] : null);
export const prefs = computed(() => app.value?.prefs || DEFAULT_PREFS);
export const previewDate = signal(null);          // 架空分支回看（只读预览）
export const viewDate = computed(() => previewDate.value || branch.value?.date || MIN_DATE);
export const isSim = computed(() => branch.value?.kind === 'sim');
export const readOnly = computed(() => !isSim.value || !!previewDate.value);
export const rev = signal(0);                       // 每次修改递增，供缓存失效

// ---------- 界面状态 ----------
export const sel = signal({ unit: null, town: null });
export const hover = signal(null);
export const panels = signal({ parliament: true });
export const panelArgs = signal({});
export const toasts = signal([]);
export const modal = signal(null);
export const shotMode = signal(false);   // 截图／纯净展示模式
export const counting = signal(null);    // 正在开票的会话 {simId, step}
export const highlightParty = signal(null);

// 中栏工作面板彼此替换，避免层层重叠（左栏地区、右栏议会、人物卡不受影响）
const WORKSPACE = ['people', 'party', 'events', 'election', 'editor', 'saves', 'export', 'settings', 'insts', 'count'];
export function openPanel(name, args) {
  batch(() => {
    const next = { ...panels.value };
    if (WORKSPACE.includes(name)) for (const w of WORKSPACE) if (w !== name) delete next[w];
    panels.value = { ...next, [name]: true };
    if (args !== undefined) panelArgs.value = { ...panelArgs.value, [name]: args };
  });
}
export function closePanel(name) { const p = { ...panels.value }; delete p[name]; panels.value = p; }
export function toast(msg, kind = 'info', ms = 2600) {
  const id = uid('t');
  toasts.value = [...toasts.value, { id, msg, kind }];
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, ms);
}
// 通用模态框：返回 Promise
export function ask(spec) { return new Promise(resolve => { modal.value = { ...spec, resolve: v => { modal.value = null; resolve(v); } }; }); }
export const confirmBox = (title, body, okText = '确认', danger = false) => ask({ kind: 'confirm', title, body, okText, danger });

// ---------- 撤销 / 重做 ----------
const undoStacks = {}, redoStacks = {};
export const undoState = signal({ undo: 0, redo: 0 });
const refreshUndo = () => { const id = app.value?.activeId; undoState.value = { undo: undoStacks[id]?.length || 0, redo: redoStacks[id]?.length || 0 }; };

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => kvSet('app', { ...app.value, savedAt: new Date().toISOString(), dataVersion: DATA_VERSION }), 600);
}
export const saveNow = () => kvSet('app', { ...app.value, savedAt: new Date().toISOString(), dataVersion: DATA_VERSION });

// 修改当前分支：fn(draft)；返回 fn 的返回值
export function mutate(fn, label = '修改', { undo = true } = {}) {
  const a = app.value, id = a.activeId;
  const before = a.branches[id];
  const draft = clone(before);
  const ret = fn(draft);
  draft.log = [...(draft.log || []).slice(-199), { at: new Date().toISOString(), msg: label, simDate: draft.date }];
  if (undo) { (undoStacks[id] ||= []).push({ snap: before, label }); if (undoStacks[id].length > 80) undoStacks[id].shift(); redoStacks[id] = []; }
  app.value = { ...a, branches: { ...a.branches, [id]: draft } };
  rev.value++;
  refreshUndo();
  scheduleSave();
  return ret;
}
export function undo() {
  const a = app.value, id = a.activeId, s = undoStacks[id];
  if (!s?.length) return;
  const { snap, label } = s.pop();
  (redoStacks[id] ||= []).push({ snap: a.branches[id], label });
  app.value = { ...a, branches: { ...a.branches, [id]: snap } };
  rev.value++; refreshUndo(); scheduleSave();
  toast('已撤销：' + label);
}
export function redo() {
  const a = app.value, id = a.activeId, s = redoStacks[id];
  if (!s?.length) return;
  const { snap, label } = s.pop();
  (undoStacks[id] ||= []).push({ snap: a.branches[id], label });
  app.value = { ...a, branches: { ...a.branches, [id]: snap } };
  rev.value++; refreshUndo(); scheduleSave();
  toast('已重做：' + label);
}
export function setPrefs(p) { app.value = { ...app.value, prefs: { ...app.value.prefs, ...p } }; rev.value++; scheduleSave(); }
export function setBranches(branches, activeId) {
  app.value = { ...app.value, branches, activeId: activeId || app.value.activeId };
  previewDate.value = null; rev.value++; refreshUndo(); scheduleSave();
}
export function switchBranch(id) {
  batch(() => { app.value = { ...app.value, activeId: id }; previewDate.value = null; counting.value = null; rev.value++; });
  refreshUndo(); scheduleSave();
}
// 设置日期（真实历史模式可自由跳转；架空分支只能经时间流动推进，向前查看为预览）
export function setRealDate(d) {
  const a = app.value, id = a.activeId;
  app.value = { ...a, branches: { ...a.branches, [id]: { ...a.branches[id], date: d } } };
  rev.value++; scheduleSave();
}

// ---------- 版本 ----------
export const versions = signal([]);
export async function refreshVersions() { versions.value = (await versionList()).sort((a, b) => b.time.localeCompare(a.time)); }
export async function saveVersion(name, auto = false, branchObj = null) {
  const b = branchObj || branch.value;
  const v = { id: uid('v'), time: new Date().toISOString(), name: name || (auto ? '自动版本' : '手动存档'), auto, branchId: b.id, branchName: b.name, simDate: b.date, kind: b.kind,
    summary: `补丁${b.patches.length}项·自定义事件${b.customEvents.length}项·模拟选举${Object.keys(b.sims || {}).length}场`, dataVersion: DATA_VERSION, state: clone(b) };
  await versionPut(v);
  // 自动版本每个分支保留最近 40 个
  const all = (await versionList()).filter(x => x.auto && x.branchId === b.id).sort((a, b) => b.time.localeCompare(a.time));
  for (const old of all.slice(40)) await versionDel(old.id);
  await refreshVersions();
  return v;
}
export { versionGet, versionDel };

// ---------- 启动 ----------
export async function boot() {
  requestPersistent();
  let saved = await kvGet('app');
  if (!saved || !saved.branches) {
    const real = newBranch({ name: '真实历史', kind: 'real', startDate: '1986-01-01' });
    real.id = 'real';
    saved = { branches: { real }, activeId: 'real', prefs: DEFAULT_PREFS };
  }
  saved.prefs = { ...DEFAULT_PREFS, ...saved.prefs };
  if (!saved.branches.real) { const real = newBranch({ name: '真实历史', kind: 'real' }); real.id = 'real'; saved.branches.real = real; }
  app.value = saved;
  refreshUndo();
  refreshVersions();
}
