// 常用操作：确保架空分支、写入补丁、建立分支
import { app, branch, mutate, newBranch, setBranches, switchBranch, ask, toast, uid, viewDate, previewDate, saveVersion, isSim } from './store.js';
import { fmtDate } from './dates.js';

// 编辑前检查：真实历史与回看预览均不可直接修改
export async function ensureEditable(what = '这项修改') {
  if (previewDate.value) {
    const r = await ask({ kind: 'choose', title: '当前为回看预览', body: `你正在回看 ${fmtDate(previewDate.value)} 的状态（分支进度为 ${fmtDate(branch.value.date)}）。预览中不能修改，以免覆盖后来的档案。`, options: [{ id: 'cancel', name: '取消' }, { id: 'branch', name: '从此日建立新分支', primary: true }] });
    if (r !== 'branch') return false;
    await branchFromHere(previewDate.value);
    return true;
  }
  if (isSim.value) return true;
  const r = await ask({ kind: 'choose', title: '真实历史为只读', body: `真实历史资料不能被改写。${what}需要在架空分支中进行。是否以 ${fmtDate(viewDate.value)} 为起点建立新的架空分支？`, options: [{ id: 'cancel', name: '取消' }, { id: 'branch', name: '建立架空分支并继续', primary: true }] });
  if (r !== 'branch') return false;
  await branchFromHere(viewDate.value);
  return true;
}
export async function branchFromHere(date, name) {
  const cur = branch.value;
  const nm = name || `${date.slice(0, 4)}架空${String.fromCharCode(65 + Object.values(app.value.branches).filter(b => b.kind === 'sim').length % 26)}线`;
  let b;
  if (cur.kind === 'sim') {
    // 从架空分支某日分出：复制补丁中该日以前的部分
    b = newBranch({ name: nm, from: cur });
    b.patches = b.patches.filter(p => p.date <= date);
    b.customEvents = b.customEvents.filter(e => e.date <= date || e.future);
    b.date = date;
    b.parent = cur.id;
    b.log = [];
  } else {
    b = newBranch({ name: nm, kind: 'sim', startDate: date });
    b.parent = 'real';
  }
  setBranches({ ...app.value.branches, [b.id]: b }, b.id);
  switchBranch(b.id);
  await saveVersion('分支建立', true, b);
  toast(`已建立架空分支「${nm}」，起点 ${fmtDate(date)}`, 'ok');
  return b;
}
// 写入补丁（同日同目标覆盖）
export function putPatch(t, v, label, date) {
  return mutate(b => {
    const d = date || b.date;
    b.patches = b.patches.filter(p => !(p.t === t && p.date === d));
    b.patches.push({ id: uid('pt'), t, v, date: d, by: 'admin' });
  }, label);
}
