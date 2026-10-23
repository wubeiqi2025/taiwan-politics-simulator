// 主界面：全屏地图为背景，其余功能均为悬浮面板
import { useEffect } from 'preact/hooks';
import { app, panels, prefs, shotMode, sel, openPanel, closePanel, undo, redo, branch, counting } from './core/store.js';
import { MapView } from './ui/MapView.jsx';
import { Tooltip, Breadcrumb, LayerSwitch, Legend } from './ui/MapChrome.jsx';
import { TopBar, Dock, Timeline, PeoplePanel, ModeBadge } from './ui/Chrome.jsx';
import { ParliamentPanel } from './ui/ParliamentPanel.jsx';
import { RegionPanel } from './ui/RegionPanel.jsx';
import { PersonCard } from './ui/PersonCard.jsx';
import { PartyPanel } from './ui/PartyPanel.jsx';
import { InstDirectory } from './ui/InstDirectory.jsx';
import { EventsPanel } from './ui/EventsPanel.jsx';
import { ElectionPanel } from './ui/ElectionPanel.jsx';
import { CountBoard } from './ui/CountBoard.jsx';
import { EditorPanel } from './ui/EditorPanel.jsx';
import { SavesPanel } from './ui/SavesPanel.jsx';
import { ExportPanel, RegionCapture } from './ui/ExportPanel.jsx';
import { SettingsPanel } from './ui/SettingsPanel.jsx';
import { ModalHost, Toasts } from './ui/common.jsx';
import { Icon } from './ui/Icon.jsx';
import { setScriptMode } from './core/i18n.js';
import { fmtDate } from './core/dates.js';
import { viewDate } from './core/store.js';

export function App() {
  const ps = panels.value, p = prefs.value;
  useEffect(() => { document.body.classList.toggle('reduced-motion', p.motion !== 'full'); }, [p.motion]);
  useEffect(() => { setScriptMode(p.script || (p.trad ? 'trad' : 'orig')); }, [p.script, p.trad]);
  useEffect(() => { document.body.classList.toggle('shot', shotMode.value); }, [shotMode.value]);
  useEffect(() => {
    const key = e => {
      if (e.target.closest?.('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { if (shotMode.value) shotMode.value = false; }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // 选中县市时打开地区详情
  // 地区面板在缩放动画结束后再挂载，避免与镜头动画争用主线程
  useEffect(() => {
    if (!sel.value.unit) { closePanel('region'); return; }
    if (panels.peek().region) return;
    let done = false;
    const open = () => { if (done) return; done = true; window.removeEventListener('map-zoom-end', open); if (sel.peek().unit) openPanel('region'); };
    window.addEventListener('map-zoom-end', open);
    const t = setTimeout(open, 1200);
    return () => { done = true; clearTimeout(t); window.removeEventListener('map-zoom-end', open); };
  }, [sel.value.unit]);
  if (!app.value) return <div class="empty" style={{ paddingTop: '40vh' }}>正在载入存档…</div>;
  return (
    <div class={shotMode.value ? 'shot' : ''}>
      <MapView />
      <TopBar />
      <Dock />
      <Breadcrumb />
      <LayerSwitch />
      <Legend />
      <Timeline />
      {ps.parliament && <ParliamentPanel />}
      {ps.region && <RegionPanel />}
      {ps.person && <PersonCard />}
      {ps.people && <PeoplePanel />}
      {ps.party && <PartyPanel />}
      {ps.insts && <InstDirectory />}
      {ps.events && <EventsPanel />}
      {ps.election && <ElectionPanel />}
      {ps.count && counting.value && <CountBoard />}
      {ps.editor && <EditorPanel />}
      {ps.saves && <SavesPanel />}
      {ps.export && <ExportPanel />}
      {ps.settings && <SettingsPanel />}
      <Tooltip />
      <ShotStamp />
      <ModalHost />
      <Toasts />
      <RegionCapture />
      {shotMode.value && <button class="btn glass shot-exit" onClick={() => (shotMode.value = false)}><Icon name="eyeOff" size={14} />退出纯净展示</button>}
    </div>
  );
}
// 截图模式下的日期与状态标记（避免架空数据被误认为史实）
function ShotStamp() {
  if (!shotMode.value) return null;
  const b = branch.value;
  return (
    <div class="watermark glass" style={{ left: 16, top: 14, padding: '8px 14px', borderRadius: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
      <b style={{ fontSize: 16 }}>台湾政党斗争</b>
      <span class="num bold">{fmtDate(viewDate.value, { roc: prefs.value.roc })}</span>
      <ModeBadge />
      {b.kind === 'sim' && <span class="small muted">{b.name}</span>}
    </div>
  );
}
