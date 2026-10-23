// 议会浮层：默认立法院，可切换任一民意机关；含重要人物摘要、名册、历届变化
import { useState } from 'preact/hooks';
import { branch, viewDate, panelArgs, openPanel, highlightParty, sel, readOnly, ask } from '../core/store.js';
import { IDX, DB, instName } from '../core/db.js';
import { seatsAt, party, pname, officeAt, instsFor, sortedComp, termAt, instExists } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { SeatChart, CompLegend } from './SeatChart.jsx';
import { PersonLink, PartyDot, D, SourceNote, Missing, DataClass } from './common.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable } from '../core/actions.js';
import { SeatEditor } from './SeatEditor.jsx';
import { EditGear } from './EditMenu.jsx';

const KIND_NOTE = { consultative: '咨询性质机构：咨议员由任命产生，并非民选议会，不提供选举席位图。', constitutional: '宪政机关：不属于民选议会，不以议员席位图呈现。' };

export function ParliamentPanel() {
  const b = branch.value, d = viewDate.value;
  const inst = panelArgs.value.parliament?.inst || 'LY';
  const info = IDX.inst[inst];
  const s = sel.value;
  const exists = info && instExists(info, d);
  const seats = exists && info.kind === 'elected' ? seatsAt(b, inst, d) : null;
  const [showRoster, setShowRoster] = useState(false);
  const hp = highlightParty.value;
  // 快捷切换：中央机关 + 当前选取地区
  const quick = [{ id: 'LY', name: '立法院' }];
  if (instExists(IDX.inst.NA, d)) quick.push({ id: 'NA', name: '国民大会' });
  if (instExists(IDX.inst.TPA, d)) quick.push({ id: 'TPA', name: '台湾省议会' });
  if (s.unit && IDX.inst['C:' + s.unit]) quick.push({ id: 'C:' + s.unit, name: IDX.unit[s.unit].name + '议会' });
  if (s.town && IDX.inst['R:' + s.town] && instExists(IDX.inst['R:' + s.town], d)) quick.push({ id: 'R:' + s.town, name: '代表会' });
  const setInst = id => { highlightParty.value = null; openPanel('parliament', { inst: id }); };
  const edit = async () => {
    if (!(await ensureEditable('修改议会席位'))) return;
    ask({ kind: 'custom', wide: true, Comp: SeatEditor, props: { inst } });
  };
  return (
    <Panel id="parliament" title={instName(inst)} sub={seats ? `${seats.label || ''} · ${D(d)}` : D(d)} icon="parliament" pos={{ x: -12, y: 112, w: 360 }}
      actions={<>
        <button class="btn ghost sm shot-hide" onClick={() => openPanel('insts')} title="全部议会／民意机关目录"><Icon name="search" size={14} />目录</button>
        {info && exists && info.kind === 'elected' && <EditGear title={instName(inst)} items={[
          { icon: 'parliament', name: '编辑席位', desc: '总席数、增减议员、党籍、选区、辞职／补选／递补／缺额、议长与副议长、批量改党', run: edit },
          { icon: 'person', name: '批量更改议员党籍', desc: '在后台“人物批量”中勾选多人一次改党', run: () => openPanel('editor') },
          { icon: 'upload', name: '导入议员名单（Excel／CSV）', desc: '导入前预览栏位对应、重复与验证结果', run: () => openPanel('editor') },
        ]} />}
      </>}>
      <div class="row wrap shot-hide" style={{ gap: 4, marginBottom: 8 }}>
        {quick.map(q => <button class={`btn sm ${q.id === inst ? 'on' : ''}`} onClick={() => setInst(q.id)}>{q.name}</button>)}
      </div>
      {!info && <Missing>未知机关</Missing>}
      {info && !exists && <div class="notice">该机关于此日期不存在（存续期间：{info.from ? D(info.from) : '1986年以前'}—{info.to ? D(info.to) : '至今'}）。{info.succ && <a href="#" onClick={e => { e.preventDefault(); setInst(info.succ); }}>查看承继机关</a>}</div>}
      {info && exists && info.kind !== 'elected' && <div class="notice info">{info.note || KIND_NOTE[info.kind]}</div>}
      {seats?.missing && <Missing><div class="bold">{seats.label} 资料待补</div><div class="tiny" style={{ marginTop: 4 }}>{seats.note}</div><div class="tiny" style={{ marginTop: 4 }}>任期：{D(seats.from)}—{D(seats.to)}</div></Missing>}
      {seats && !seats.missing && (
        <>
          {seats.patch && <div class="notice sim" style={{ marginBottom: 6 }}>架空修改：自 {D(seats.from)} 起采用管理员设定的席位组成</div>}
          <SeatChart seats={seats} width={330} />
          <div class="row small" style={{ justifyContent: 'space-between', margin: '4px 0 6px' }}>
            <span class="muted">任期 {D(seats.from)} — {seats.to ? D(seats.to) : '—'}</span>
          </div>
          <CompLegend comp={seats.comp} total={seats.total} onParty={() => setShowRoster(true)} />
          {(seats.speaker || seats.deputy) && <div class="kv" style={{ marginTop: 8 }}>
            {seats.speaker && <><span>院长／议长</span><PersonLink pid={seats.speaker} /></>}
            {seats.deputy && <><span>副院长／副议长</span><PersonLink pid={seats.deputy} /></>}
          </div>}
          {seats.note && <div class="tiny muted" style={{ marginTop: 6 }}>{seats.note}</div>}
          <div class="row" style={{ marginTop: 6 }}>
            <DataClass kind={seats.patch ? 'admin' : seats.verified === false ? 'missing' : 'real'} />
            <button class="btn ghost sm shot-hide right" onClick={() => setShowRoster(r => !r)}>{showRoster ? '收起名册' : `名册（${seats.members.filter(m => !m.vacant).length}）`}</button>
          </div>
          {showRoster && <Roster seats={seats} hp={hp} />}
          <TermHistory inst={inst} />
          <SourceNote src={seats.patch ? 'admin' : seats.src} verified={seats.verified} />
        </>
      )}
      {inst === 'LY' && <KeyPeople />}
    </Panel>
  );
}
function Roster({ seats, hp }) {
  const b = branch.value;
  const [q, setQ] = useState('');
  const [n, setN] = useState(120);
  let list = seats.members.filter(m => !m.vacant && (!hp || m.party === hp));
  if (q) list = list.filter(m => (m.p ? pname(b, m.p) : m.name || '').includes(q) || (m.district || '').includes(q));
  return (
    <div style={{ marginTop: 6 }}>
      <input class="input sm" style={{ width: '100%' }} placeholder="搜索议员或选区" value={q} onInput={e => setQ(e.target.value)} />
      <div class="list" style={{ marginTop: 4 }}>
        {list.slice(0, n).map(m => (
          <div class="list-item small" onClick={() => m.p && openPanel('person', { pid: m.p })}>
            <PartyDot id={m.party} /><span class="grow ellipsis">{m.p ? pname(b, m.p) : m.name || '（姓名待补）'}</span><span class="muted tiny ellipsis" style={{ maxWidth: 140 }}>{m.district || ''}</span>
          </div>
        ))}
        {list.length > n && <button class="btn sm ghost" onClick={() => setN(n + 200)}>显示更多（{list.length - n}）</button>}
        {!list.length && <div class="empty">无符合条件的成员</div>}
      </div>
    </div>
  );
}
// 历届党派席次变化（小型堆叠条）
function TermHistory({ inst }) {
  const b = branch.value;
  const terms = (IDX.termsByInst[inst] || []).filter(t => t.comp && Object.keys(t.comp).length);
  const [open, setOpen] = useState(false);
  if (terms.length < 2) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button class="btn ghost sm shot-hide" onClick={() => setOpen(o => !o)}><Icon name={open ? 'chevronD' : 'chevronR'} size={12} />历届党派席次变化（{terms.length}届）</button>
      {open && <div class="col" style={{ gap: 4, marginTop: 4 }}>
        {terms.map(t => { const tot = Object.values(t.comp).reduce((a, x) => a + x, 0); return (
          <div class="row tiny" style={{ gap: 6 }}>
            <span style={{ width: 92 }} class="muted ellipsis">{t.label || t.from.slice(0, 4)} {t.from.slice(0, 4)}</span>
            <div class="row grow" style={{ height: 8, gap: 1, borderRadius: 3, overflow: 'hidden' }}>{sortedComp(b, t.comp).map(([p, n]) => <div title={`${party(b, p).short} ${n}`} style={{ width: n / tot * 100 + '%', background: party(b, p).color, height: '100%' }} />)}</div>
            <span class="num" style={{ width: 26, textAlign: 'right' }}>{tot}</span>
          </div>); })}
      </div>}
    </div>
  );
}
export function KeyPeople() {
  const b = branch.value, d = viewDate.value;
  const rows = [['总统', 'president'], ['副总统', 'vp'], ['行政院长', 'premier'], ['立法院长', 'speaker'], ['台湾省主席／省长', 'governor']];
  return (
    <div style={{ marginTop: 10 }}>
      <div class="section-title">重要政治人物</div>
      <div class="kv">
        {rows.map(([label, k]) => { const o = officeAt(b, k, d); if (!o && k === 'governor') return null; return <><span>{label}</span><span>{o?.p ? <PersonLink pid={o.p} party={o.party} /> : o?.name ? o.name : <span class="muted">{o?.note || (o ? '缺位' : '—')}</span>}{o?.patch && <span class="chip sim" style={{ height: 16, marginLeft: 4 }}>架空</span>}</span></>; })}
        {['KMT', 'DPP'].map(p => <PartyChair p={p} />)}
      </div>
    </div>
  );
}
import { chairAt, partyExists } from '../core/world.js';
function PartyChair({ p }) {
  const b = branch.value, d = viewDate.value;
  if (!partyExists(b, p, d)) return null;
  const c = chairAt(b, p, d);
  return <><span>{party(b, p).short}主席</span><span>{c?.p ? <PersonLink pid={c.p} party={p} /> : <span class="muted">资料待补</span>}{c?.note && <span class="tiny muted"> {c.note}</span>}</span></>;
}
