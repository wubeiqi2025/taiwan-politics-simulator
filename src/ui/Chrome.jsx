// 顶部工具条、左侧入口坞、底部时间轴、人物搜索
import { useState, useMemo, useRef } from 'preact/hooks';
import { app, branch, viewDate, prefs, setPrefs, sel, panels, openPanel, closePanel, undo, redo, undoState, shotMode, isSim, previewDate, setRealDate, switchBranch, ask, toast, mutate, uid, panelArgs } from '../core/store.js';
import { IDX, DB } from '../core/db.js';
import { MAP_MODES, allEvents, townInfo, person } from '../core/world.js';
import { MIN_DATE, MAX_DATE, TODAY_REAL, fmtDate, isValidDate, diffDays, toDate } from '../core/dates.js';
import { Icon } from './Icon.jsx';
import { D } from './common.jsx';
import { FlowControl, runFlow } from './Flow.jsx';
import { branchFromHere, ensureEditable } from '../core/actions.js';
import { Panel } from './Panel.jsx';
import { matchName } from '../core/i18n.js';

export function ModeBadge() {
  const b = branch.value;
  if (previewDate.value) return <span class="mode-badge preview"><Icon name="eye" size={13} />回看预览</span>;
  return b.kind === 'real' ? <span class="mode-badge real">真实历史</span> : <span class="mode-badge sim">架空模拟</span>;
}
export function TopBar() {
  const b = branch.value, d = viewDate.value, p = prefs.value, s = sel.value;
  const u = undoState.value;
  const level = s.town ? '乡镇市区' : s.unit ? '县市' : '全台湾';
  const [menu, setMenu] = useState(false);
  return (
    <div class="topbar glass shot-hide">
      <div class="brand">台湾政党斗争</div>
      <div class="vsep" />
      <div class="datebig num" title="当前历史日期">{fmtDate(d, { roc: p.roc })}</div>
      <button class="btn ghost sm" onClick={() => setPrefs({ roc: !p.roc })} title="切换公历／民国纪年">{p.roc ? '公历' : '民国'}</button>
      <button class="btn ghost sm" data-noconv onClick={() => { const order = ['orig', 'simp', 'trad']; const cur = p.script || (p.trad ? 'trad' : 'orig'); const nx = order[(order.indexOf(cur) + 1) % 3]; setPrefs({ script: nx, trad: nx === 'trad' }); }} title="切换简繁体：简体界面·专名原文 → 全部简体 → 全部繁体">{({ orig: '简·原', simp: '简体', trad: '繁體' })[p.script || (p.trad ? 'trad' : 'orig')]}</button>
      <ModeBadge />
      <span style={{ position: 'relative' }}>
        <button class="btn sm" onClick={() => setMenu(m => !m)} title="历史分支／存档"><Icon name="branch" size={14} />{b.name}<Icon name="chevronD" size={11} /></button>
        {menu && <BranchMenu close={() => setMenu(false)} />}
      </span>
      <span class="chip" title="地图着色模式">{MAP_MODES.find(m => m.id === p.mapMode)?.name}</span>
      <span class="chip" title="行政层级">{level}</span>
      <div class="vsep" />
      <button class="btn ghost sm icon" disabled={!u.undo} onClick={undo} title="撤销"><Icon name="undo" size={15} /></button>
      <button class="btn ghost sm icon" disabled={!u.redo} onClick={redo} title="重做"><Icon name="redo" size={15} /></button>
      <button class="btn ghost sm" onClick={() => (shotMode.value = true)} title="截图模式：隐藏工具与编辑按钮"><Icon name="camera" size={15} />截图模式</button>
      <button class="btn ghost sm" onClick={() => openPanel('settings')} title="管理员设置"><Icon name="settings" size={15} />管理员</button>
    </div>
  );
}
function BranchMenu({ close }) {
  const a = app.value;
  const list = Object.values(a.branches).sort((x, y) => (x.kind === 'real' ? -1 : y.kind === 'real' ? 1 : (y.created || '').localeCompare(x.created || '')));
  return (
    <div class="glass glass-strong" style={{ position: 'absolute', top: 34, left: 0, width: 280, padding: 6, zIndex: 50 }} onMouseLeave={close}>
      {list.map(b => (
        <div class={`list-item small ${b.id === a.activeId ? 'active' : ''}`} onClick={() => { switchBranch(b.id); close(); }}>
          <span class={`chip ${b.kind === 'real' ? 'real' : 'sim'}`} style={{ height: 18 }}>{b.kind === 'real' ? '史实' : '架空'}</span>
          <span class="grow ellipsis">{b.name}</span><span class="tiny muted num">{b.date}</span>
        </div>
      ))}
      <div class="sep" />
      <div class="list-item small" onClick={async () => { close(); await branchFromHere(viewDate.value); }}><Icon name="plus" size={13} />从当前日期建立架空分支</div>
      <div class="list-item small" onClick={() => { close(); openPanel('saves'); }}><Icon name="save" size={13} />存档与版本管理</div>
    </div>
  );
}

const DOCK = [
  ['parliament', '议会', 'parliament'], ['people', '人物', 'person'], ['election', '选举', 'ballot'], ['events', '事件', 'history'],
  ['party', '政党', 'party'], ['layers', '图层', 'layers'], ['editor', '后台', 'edit'], ['saves', '存档', 'save'], ['export', '导出', 'camera'],
];
export function Dock() {
  const ps = panels.value, p = prefs.value;
  return (
    <div class="dock glass shot-hide">
      {DOCK.map(([id, name, icon]) => {
        const on = id === 'layers' ? p.showLegend : !!ps[id];
        return (
          <button class={on ? 'on' : ''} title={name} onClick={() => {
            if (id === 'layers') { setPrefs({ showLegend: !p.showLegend }); return; }
            if (ps[id]) closePanel(id); else openPanel(id, id === 'election' && !panelArgs.value.election ? {} : undefined);
          }}><Icon name={icon} size={19} />{name}</button>
        );
      })}
    </div>
  );
}

// ---------- 时间轴 ----------
const PRESETS = ['1986-01-01', '1987-07-15', '1991-05-01', '1994-12-25', '1996-05-20', '1998-12-21', '2000-05-20', '2005-06-10', '2008-05-20', '2010-12-25', '2014-12-25', '2016-05-20', '2020-05-20', '2024-05-20', TODAY_REAL];
const span = diffDays(MIN_DATE, MAX_DATE);
const pos = d => (diffDays(MIN_DATE, d) / span) * 100;
const fromPos = f => { const t = toDate(MIN_DATE); t.setUTCDate(t.getUTCDate() + Math.round(f * span)); return t.toISOString().slice(0, 10); };
export function Timeline() {
  const b = branch.value, d = viewDate.value, p = prefs.value;
  const [input, setInput] = useState('');
  const trackRef = useRef();
  if (!p.showTimeline) return <button class="btn glass shot-hide" style={{ position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }} onClick={() => setPrefs({ showTimeline: true })}><Icon name="clock" size={14} />显示时间轴</button>;
  const evs = allEvents(b);
  const major = evs.filter(e => e.imp >= 3);
  const prevEv = [...evs].reverse().find(e => e.date <= d && e.imp >= 2);
  const nextEv = evs.find(e => e.date > d && e.imp >= 2);
  const goto = async target => {
    if (!isValidDate(target)) { toast('日期格式应为 YYYY-MM-DD', 'error'); return; }
    if (target < MIN_DATE || target > MAX_DATE) { toast(`日期范围为 ${MIN_DATE} 至 ${MAX_DATE}`, 'error'); return; }
    setInput('');
    if (b.kind === 'real') { setRealDate(target); return; }
    if (target === b.date) { previewDate.value = null; return; }
    if (target < b.date) { previewDate.value = target; toast('进入回看预览：不会改变分支进度'); return; }
    previewDate.value = null;
    const ok = await ask({ kind: 'confirm', title: '向后推进架空分支？', body: `架空分支只能通过时间流动向后推进，以便依序处理 ${D(b.date)} 至 ${D(target)} 之间的史实事件与冲突。`, okText: '开始流动' });
    if (ok) await runFlow(target);
  };
  const onTrack = e => {
    const r = trackRef.current.getBoundingClientRect();
    goto(fromPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))));
  };
  const years = [];
  for (let y = 1986; y <= 2026; y++) years.push(y);
  return (
    <div class="timeline glass shot-hide">
      <div class="row wrap" style={{ gap: 6 }}>
        <button class="btn ghost sm icon" title="上一个关键节点" onClick={() => prevEv && goto(prevEv.date === d ? ([...evs].reverse().find(e => e.date < d && e.imp >= 2)?.date || d) : prevEv.date)}><Icon name="chevronL" size={14} /></button>
        <div class="small ellipsis" style={{ maxWidth: 230 }}><span class="muted">上一节点</span> {prevEv ? `${prevEv.date} ${prevEv.title}` : '—'}</div>
        <div class="small ellipsis" style={{ maxWidth: 230 }}><span class="muted">下一事件</span> {nextEv ? `${nextEv.date} ${nextEv.title}` : '—'}</div>
        <button class="btn ghost sm icon" title="下一个关键节点" onClick={() => nextEv && goto(nextEv.date)}><Icon name="chevronR" size={14} /></button>
        <div class="right row" style={{ gap: 4 }}>
          <input class="input sm num" style={{ width: 104 }} placeholder={d} value={input} onInput={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && goto(input)} />
          <button class="btn sm" onClick={() => goto(input || d)}>跳转</button>
          <select class="select sm" value="" onChange={e => e.target.value && goto(e.target.value)}><option value="">关键年份</option>{PRESETS.map(x => <option value={x}>{x}</option>)}</select>
        </div>
      </div>
      <div class="tl-track" ref={trackRef} onClick={onTrack}>
        <div class="tl-axis" />
        <div class="tl-fill" style={{ width: pos(b.date) + '%', background: b.kind === 'real' ? 'var(--accent)' : 'var(--sim)' }} />
        {years.map(y => <div class={`tl-tick ${y % 5 === 0 ? 'major' : ''}`} style={{ left: pos(`${y}-01-01`) + '%' }} />)}
        {major.map(e => <div class="tl-ev" title={`${e.date} ${e.title}`} style={{ left: pos(e.date) + '%', background: e.kind === 'custom' ? 'var(--sim)' : e.cat === '选举' ? 'var(--accent)' : e.cat === '党争' ? 'var(--warn)' : '#8e8e93' }} onClick={ev => { ev.stopPropagation(); openPanel('events', { focus: e.id }); }} />)}
        {previewDate.value && <div class="tl-knob" style={{ left: pos(previewDate.value) + '%', background: 'var(--accent)', opacity: 0.8 }} />}
        <div class="tl-knob" style={{ left: pos(b.date) + '%' }} title={`分支进度 ${b.date}`} />
      </div>
      <div class="tl-years">{years.filter(y => y % 5 === 1 || y === 2026).map(y => <span style={{ left: pos(`${y}-01-01`) + '%' }}>{p.roc ? `民${y - 1911}` : y}</span>)}</div>
      <div class="row wrap" style={{ marginTop: 4, gap: 8 }}>
        <FlowControl />
        {previewDate.value && <><span class="mode-badge preview">回看 {previewDate.value}</span><button class="btn sm" onClick={() => (previewDate.value = null)}>返回分支进度</button><button class="btn sm" onClick={() => branchFromHere(previewDate.value)}>从此日建立分支</button></>}
        <button class="btn ghost sm right" onClick={() => setPrefs({ showTimeline: false })}><Icon name="min" size={13} />隐藏</button>
      </div>
    </div>
  );
}

// ---------- 人物搜索 ----------
export function PeoplePanel() {
  const b = branch.value;
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [n, setN] = useState(60);
  const list = useMemo(() => {
    const out = [];
    const all = [...(b.customPeople || []), ...DB.people];
    for (const p of all) {
      if (q && !matchName(p.n, q)) continue;
      const roles = IDX.roles[p.id] || [];
      if (role !== 'all') { if (role === 'fiction' ? !p.fictional : !roles.some(r => r.kind === role || (role === 'ly' && r.inst === 'LY'))) continue; }
      out.push({ p, roles });
      if (out.length > 600) break;
    }
    if (!q && role === 'all') out.sort((x, y) => (y.roles.length - x.roles.length));
    return out;
  }, [q, role, b.customPeople]);
  const create = async () => {
    if (!(await ensureEditable('新建架空人物'))) return;
    const name = await ask({ kind: 'prompt', title: '新建架空人物', placeholder: '姓名', body: '建立后可在人物卡编辑党籍、照片与状态，并指派为候选人或议员。' });
    if (!name) return;
    const id = uid('f');
    mutate(br => { br.customPeople.push({ id, n: name, fictional: true, created: br.date }); }, `新建人物 ${name}`);
    openPanel('person', { pid: id });
  };
  return (
    <Panel id="people" title="人物库" sub={`收录 ${DB.people.length.toLocaleString()} 人${b.customPeople?.length ? ' · 架空 ' + b.customPeople.length : ''}`} icon="person" pos={{ x: 80, y: 120, w: 360, h: 560 }}
      actions={<button class="btn sm shot-hide" onClick={create}><Icon name="plus" size={13} />新建</button>}>
      <input class="input" placeholder="输入姓名搜索" value={q} onInput={e => setQ(e.target.value)} />
      <div class="row wrap" style={{ gap: 4, margin: '6px 0' }}>{[['all', '全部'], ['office', '中央要职'], ['exec', '县市长'], ['ly', '立委'], ['member', '议员／代表'], ['townexec', '乡镇首长'], ['chair', '党主席'], ['fiction', '架空人物']].map(([id, nm]) => <button class={`btn sm ${role === id ? 'on' : ''}`} onClick={() => setRole(id)}>{nm}</button>)}</div>
      <div class="list">
        {list.slice(0, n).map(({ p, roles }) => (
          <div class="list-item small" onClick={() => openPanel('person', { pid: p.id })}>
            <span class="grow"><b>{p.n}</b>{p.b && <span class="tiny muted">（{p.b}）</span>}{p.fictional && <span class="chip sim" style={{ height: 16, marginLeft: 4 }}>架空</span>}<div class="tiny muted ellipsis" style={{ maxWidth: 280 }}>{roles.slice(-2).map(r => r.label).join('；')}</div></span>
          </div>
        ))}
        {list.length > n && <button class="btn sm ghost" onClick={() => setN(n + 100)}>显示更多</button>}
        {!list.length && <div class="empty">没有找到人物</div>}
      </div>
    </Panel>
  );
}
