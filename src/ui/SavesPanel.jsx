// 存档、多分支、历史版本回退、备份导出导入
import { useState, useEffect } from 'preact/hooks';
import { app, branch, versions, refreshVersions, saveVersion, versionGet, versionDel, setBranches, switchBranch, ask, toast, newBranch, DATA_VERSION, saveNow, uid } from '../core/store.js';
import { assetAll, assetPut, kvSet } from '../core/persist.js';
import { Panel } from './Panel.jsx';
import { D } from './common.jsx';
import { Icon } from './Icon.jsx';
import { EditGear } from './EditMenu.jsx';

const clone = o => JSON.parse(JSON.stringify(o));
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function SavesPanel() {
  const a = app.value, cur = branch.value;
  const [tab, setTab] = useState('branches');
  const [filter, setFilter] = useState('cur');
  useEffect(() => { refreshVersions(); }, []);
  const vlist = versions.value.filter(v => filter === 'all' || v.branchId === cur.id).filter(v => tab !== 'versions' || true);
  const rename = async b => { const n = await ask({ kind: 'prompt', title: '重命名分支', value: b.name }); if (!n) return; setBranches({ ...a.branches, [b.id]: { ...b, name: n } }); };
  const dup = b => { const nb = newBranch({ name: b.name + '（副本）', from: b }); setBranches({ ...a.branches, [nb.id]: nb }); toast('已复制存档'); };
  const del = async b => {
    if (b.id === 'real') return;
    if (!(await ask({ kind: 'confirm', title: `删除分支「${b.name}」？`, body: '删除前会自动保存一个版本，之后可从版本列表恢复。', danger: true, okText: '删除' }))) return;
    await saveVersion('删除前自动备份', true, b);
    const bs = { ...a.branches }; delete bs[b.id];
    setBranches(bs, a.activeId === b.id ? 'real' : a.activeId);
    toast('分支已删除（已保留备份版本）');
  };
  const manual = async () => { const n = await ask({ kind: 'prompt', title: '手动命名存档', placeholder: '例如：第三回合结束', value: `${cur.name} ${cur.date}` }); if (!n) return; await saveVersion(n, false); toast('已保存版本', 'ok'); };
  const restore = async v => {
    const full = await versionGet(v.id);
    if (!full) { toast('版本资料遗失', 'error'); return; }
    const target = a.branches[v.branchId];
    const st = full.state;
    const diff = target ? `目前：日期 ${target.date}，补丁 ${target.patches.length}，事件 ${target.customEvents.length}\n版本：日期 ${st.date}，补丁 ${st.patches.length}，事件 ${st.customEvents.length}` : '原分支已不存在。';
    const r = await ask({ kind: 'choose', title: `恢复版本「${v.name}」`, body: <div class="small" style={{ whiteSpace: 'pre-wrap' }}>{diff}{'\n\n'}恢复将改变该分支的日期、修改、选举与事件进度。建议先“另建为新分支”以免覆盖后来的内容。</div>,
      options: [{ id: null, name: '取消' }, { id: 'new', name: '另建为新分支', primary: true }, ...(target ? [{ id: 'over', name: '覆盖原分支', danger: true }] : [])] });
    if (!r) return;
    if (r === 'new') {
      const nb = { ...clone(st), id: uid('b'), name: `${st.name}（恢复自 ${v.time.slice(0, 16).replace('T', ' ')}）`, parent: st.id };
      setBranches({ ...a.branches, [nb.id]: nb }, nb.id); switchBranch(nb.id);
    } else {
      if (!(await ask({ kind: 'confirm', title: '确认覆盖？', body: '覆盖前会先自动保存目前状态为一个版本。', danger: true, okText: '覆盖并恢复' }))) return;
      await saveVersion('恢复前自动备份', true, target);
      setBranches({ ...a.branches, [st.id]: clone(st) }, st.id); switchBranch(st.id);
    }
    toast('版本已恢复', 'ok');
  };
  const exportAll = async () => {
    const full = [];
    for (const v of versions.value) { const x = await versionGet(v.id); if (x) full.push(x); }
    const assets = await assetAll();
    const payload = { format: 'tw-politics-sandbox-backup', created: new Date().toISOString(), dataVersion: DATA_VERSION, app: a, versions: full, assets };
    download(`台湾政党斗争备份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload));
    toast('备份已导出', 'ok');
  };
  const importAll = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        if (data.format !== 'tw-politics-sandbox-backup') throw new Error('不是本网站的备份文件');
        const bs = Object.values(data.app.branches);
        const exist = bs.filter(b => a.branches[b.id]);
        const r = await ask({ kind: 'choose', title: '导入备份预览', body: <div class="small col">
          <div>备份建立：{data.created?.slice(0, 19).replace('T', ' ')}　资料版本：{data.dataVersion}{data.dataVersion !== DATA_VERSION && <span style={{ color: 'var(--warn)' }}>（与当前 {DATA_VERSION} 不同）</span>}</div>
          <div>分支 {bs.length} 条（其中 {exist.length} 条与现有同名编号）· 版本 {data.versions?.length || 0} 个 · 图片 {Object.keys(data.assets || {}).length} 张</div>
          {bs.map(b => <div class="tiny">· {b.name}（{b.kind === 'real' ? '史实' : '架空'}，{b.date}）{a.branches[b.id] ? ' — 重复' : ''}</div>)}
        </div>, options: [{ id: null, name: '取消' }, { id: 'merge', name: '合并（重复者另存副本）', primary: true }, { id: 'replace', name: '覆盖全部现有存档', danger: true }] });
        if (!r) return;
        if (r === 'replace' && !(await ask({ kind: 'confirm', title: '确认覆盖全部存档？', body: '现有所有分支将被替换（版本列表保留）。', danger: true }))) return;
        let branches = r === 'replace' ? {} : { ...a.branches };
        for (const b of bs) { if (branches[b.id] && b.id !== 'real') { const nb = { ...b, id: uid('b'), name: b.name + '（导入）' }; branches[nb.id] = nb; } else if (!branches[b.id] || r === 'replace') branches[b.id] = b; }
        for (const [k, v] of Object.entries(data.assets || {})) await assetPut(k, v);
        for (const v of data.versions || []) await import('../core/persist.js').then(m => m.versionPut(v));
        setBranches(branches, branches[a.activeId] ? a.activeId : 'real');
        await refreshVersions();
        toast('备份已导入', 'ok');
      } catch (e) { toast('导入失败：' + e.message, 'error'); }
    };
    inp.click();
  };
  const clean = async () => {
    const autos = versions.value.filter(v => v.auto);
    if (!(await ask({ kind: 'confirm', title: '清理自动版本？', body: `将删除 ${autos.length} 个自动版本（手动存档保留）。`, danger: true }))) return;
    for (const v of autos) await versionDel(v.id);
    await refreshVersions();
  };
  return (
    <Panel id="saves" title="存档与历史版本" sub={`自动保存于本机浏览器 · 资料版本 ${DATA_VERSION}`} icon="save" pos={{ x: 80, y: 110, w: 430, h: 600 }}>
      <div class="row wrap" style={{ gap: 6 }}>
        <div class="seg"><button class={tab === 'branches' ? 'on' : ''} onClick={() => setTab('branches')}>历史分支</button><button class={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>版本（{versions.value.length}）</button><button class={tab === 'backup' ? 'on' : ''} onClick={() => setTab('backup')}>备份</button></div>
        <button class="btn sm primary right" onClick={manual}><Icon name="save" size={13} />手动存档</button>
      </div>
      {tab === 'branches' && <div class="list" style={{ marginTop: 8 }}>
        {Object.values(a.branches).map(b => (
          <div class={`list-item ${b.id === a.activeId ? 'active' : ''}`} style={{ alignItems: 'flex-start' }}>
            <div class="grow" onClick={() => switchBranch(b.id)}>
              <div class="row small"><span class={`chip ${b.kind === 'real' ? 'real' : 'sim'}`} style={{ height: 18 }}>{b.kind === 'real' ? '史实' : '架空'}</span><b>{b.name}</b></div>
              <div class="tiny muted">模拟日期 {b.date}{b.kind === 'sim' ? ` · 起点 ${b.startDate} · 补丁 ${b.patches.length} · 自定义事件 ${b.customEvents.length} · 模拟选举 ${Object.keys(b.sims || {}).length}` : ''}</div>
            </div>
            {b.id !== 'real' && <EditGear title={b.name} items={[
              { icon: 'edit', name: '重命名分支', desc: '修改此历史分支／存档的名称', run: () => rename(b) },
              { icon: 'copy', name: '复制存档', desc: '复制出一条内容相同、互相独立的新分支', run: () => dup(b) },
              { icon: 'trash', name: '删除分支', desc: '删除前自动保存一个版本，可从版本列表恢复', run: () => del(b), danger: true },
            ]} />}
          </div>
        ))}
        <div class="tiny muted" style={{ marginTop: 6 }}>各分支的地图、选举、人物资料彼此独立；“真实历史”始终保留可核查的原始记录。</div>
      </div>}
      {tab === 'versions' && <div style={{ marginTop: 8 }}>
        <div class="row"><div class="seg"><button class={filter === 'cur' ? 'on' : ''} onClick={() => setFilter('cur')}>当前分支</button><button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>全部</button></div><button class="btn sm ghost right" onClick={clean}>清理自动版本</button></div>
        <div class="list" style={{ marginTop: 6 }}>
          {vlist.map(v => (
            <div class="list-item" style={{ alignItems: 'flex-start' }} onClick={() => restore(v)}>
              <div class="grow">
                <div class="small"><b>{v.name}</b> {v.auto ? <span class="chip" style={{ height: 16 }}>自动</span> : <span class="chip real" style={{ height: 16 }}>手动</span>}</div>
                <div class="tiny muted">{v.time.slice(0, 19).replace('T', ' ')} · {v.branchName} · 模拟日期 {v.simDate}</div>
                <div class="tiny muted">{v.summary}</div>
              </div>
              <Icon name="restart" size={14} />
            </div>
          ))}
          {!vlist.length && <div class="empty">尚无版本。时间流动、确认选举等操作会自动产生版本。</div>}
        </div>
      </div>}
      {tab === 'backup' && <div class="col" style={{ marginTop: 8 }}>
        <div class="small">建议定期导出备份，以免清理浏览器资料造成整个赛季资料遗失。备份档案注明建立日期与资料版本。</div>
        <button class="btn" onClick={exportAll}><Icon name="download" size={14} />导出全部存档（含版本与图片）</button>
        <button class="btn" onClick={importAll}><Icon name="upload" size={14} />导入备份（导入前预览）</button>
        <button class="btn" onClick={() => { saveNow(); toast('已立即保存', 'ok'); }}><Icon name="save" size={14} />立即保存</button>
        <div class="tiny muted">存档使用浏览器 IndexedDB，离线时仍可读取；页面刷新或意外关闭后会恢复最近进度。</div>
      </div>}
    </Panel>
  );
}
