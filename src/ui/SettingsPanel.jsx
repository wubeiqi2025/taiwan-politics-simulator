// 管理员设置：动效、繁简、纪年、开票、资料说明
import { prefs, setPrefs, ask, app, toast } from '../core/store.js';
import { DB } from '../core/db.js';
import { kvSet } from '../core/persist.js';
import { Panel } from './Panel.jsx';
import { Seg } from './common.jsx';
import { CountSettings } from './ElectionPanel.jsx';
import { TODAY_REAL } from '../core/dates.js';

export function SettingsPanel() {
  const p = prefs.value;
  const reset = async () => {
    if (!(await ask({ kind: 'confirm', title: '清除全部本地存档？', body: '所有分支、版本与上传图片将被删除，且无法恢复。建议先在“存档→备份”导出。', danger: true, okText: '清除并重新载入' }))) return;
    await kvSet('app', null);
    indexedDB.deleteDatabase('tw-politics-sandbox');
    location.reload();
  };
  return (
    <Panel id="settings" title="管理员设置" icon="settings" pos={{ x: -12, y: 100, w: 380, h: 600 }}>
      <div class="col">
        <div class="section-title">显示</div>
        <div class="col" style={{ gap: 4 }}><span class="small">简繁体（全部文字：界面、地图标注、人名地名、提示与导出图片）</span><Seg value={p.script || (p.trad ? 'trad' : 'orig')} onChange={v => setPrefs({ script: v, trad: v === 'trad' })} options={[{ id: 'orig', name: '简体界面·专名原文' }, { id: 'simp', name: '全部简体' }, { id: 'trad', name: '全部繁体' }]} /></div>
        <div class="row"><span class="small grow">纪年</span><Seg value={p.roc ? 'r' : 'g'} onChange={v => setPrefs({ roc: v === 'r' })} options={[{ id: 'g', name: '公历' }, { id: 'r', name: '民国纪年' }]} /></div>
        <div class="row"><span class="small grow">动态效果</span><Seg value={p.motion} onChange={v => setPrefs({ motion: v })} options={[{ id: 'full', name: '完整' }, { id: 'reduced', name: '减弱' }, { id: 'off', name: '关闭' }]} /></div>
        <label class="field">赛季名称（截图可选显示）<input class="input sm" value={p.seasonName} onInput={e => setPrefs({ seasonName: e.target.value })} /></label>
        <div class="section-title">开票</div>
        <CountSettings />
        <div class="section-title">资料说明</div>
        <div class="small">真实资料最后核实日期：{TODAY_REAL}。史料分为四类：可核实史实、管理员修改的模拟状态、系统推算的模拟数据、缺资料或未核实，界面中以标签区分。</div>
        <div class="col" style={{ gap: 3 }}>{Object.values(DB.meta.sources).filter(s => s.url).map(s => <a class="small" href={s.url} target="_blank" rel="noreferrer">{s.name}</a>)}</div>
        <div class="tiny muted">收录：{DB.elections.length} 场选举、{DB.people.length.toLocaleString()} 位人物、{DB.terms.length} 个民意机关届次、{DB.events.length} 条史实事件。1998年前县市议员、2010年前乡镇市民代表等中选会资料库未收录者标为“资料待补”。</div>
        <div class="section-title">危险操作</div>
        <button class="btn danger" onClick={reset}>清除全部本地存档</button>
      </div>
    </Panel>
  );
}
