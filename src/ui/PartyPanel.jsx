// 政党库：资料、存在时期、党主席、历届席次、架空编辑（名称、颜色、成立／解散、新建）
import { useState } from 'preact/hooks';
import { branch, viewDate, panelArgs, openPanel, mutate, uid, toast, ask, highlightParty } from '../core/store.js';
import { IDX, DB } from '../core/db.js';
import { allParties, party, partyExists, chairAt, seatsAt, pname, execAt, unitsAt, activePatch } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { PersonLink, D, SourceNote, DataClass } from './common.jsx';
import { PartySelect } from './pickers.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable } from '../core/actions.js';
import { EditGear } from './EditMenu.jsx';

export function PartyPanel() {
  const b = branch.value, d = viewDate.value;
  const [filter, setFilter] = useState('exist');
  const id = panelArgs.value.party?.id;
  const list = allParties(b).filter(p => (filter === 'all' ? true : filter === 'minor' ? p.minor : !p.minor && partyExists(b, p.id, d))).sort((x, y) => (x.order ?? 50) - (y.order ?? 50));
  const create = async () => {
    if (!(await ensureEditable('新建架空政党'))) return;
    const v = await ask({ kind: 'custom', Comp: PartyEditor, props: { p: { name: '', short: '', color: '#8e7cc3', founded: branch.value.date, fictional: true } } });
    if (!v) return;
    const nid = uid('FP');
    mutate(br => { br.customParties.push({ ...v, id: nid, fictional: true, order: 48 }); }, `新建政党 ${v.name}`);
    openPanel('party', { id: nid });
  };
  return (
    <Panel id="party" title="政党与党派" sub={D(d)} icon="party" pos={{ x: 80, y: 120, w: 380, h: 560 }}>
      <div class="row" style={{ marginBottom: 6 }}>
        <div class="seg"><button class={filter === 'exist' ? 'on' : ''} onClick={() => setFilter('exist')}>此日存在</button><button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>全部</button><button class={filter === 'minor' ? 'on' : ''} onClick={() => setFilter('minor')}>小党</button></div>
        <button class="btn sm right shot-hide" onClick={create}><Icon name="plus" size={13} />新建</button>
      </div>
      {id && <PartyDetail id={id} />}
      <div class="list" style={{ marginTop: 6 }}>
        {list.map(p => (
          <div class={`list-item small ${p.id === id ? 'active' : ''}`} onClick={() => openPanel('party', { id: p.id })}>
            <span class="swatch" style={{ background: p.color }} /><span class="grow">{p.name}</span>
            {p.fictional && <span class="chip sim" style={{ height: 16 }}>架空</span>}
            {!partyExists(b, p.id, d) && <span class="tiny muted">未存在</span>}
            <span class="tiny muted">{p.founded ? p.founded.slice(0, 4) : ''}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
function PartyDetail({ id }) {
  const b = branch.value, d = viewDate.value;
  const p = party(b, id);
  const ex = partyExists(b, id, d);
  const ly = seatsAt(b, 'LY', d);
  const lyN = ly?.comp?.[id] || 0;
  const chair = chairAt(b, id, d);
  const execs = unitsAt(d).filter(u => execAt(b, u.id, d)?.party === id);
  const terms = (IDX.termsByInst.LY || []).filter(t => t.comp?.[id]);
  const edit = async () => {
    if (!(await ensureEditable('修改政党资料'))) return;
    const v = await ask({ kind: 'custom', Comp: PartyEditor, props: { p } });
    if (!v) return;
    mutate(br => {
      if (br.customParties.some(x => x.id === id)) br.customParties = br.customParties.map(x => (x.id === id ? { ...x, ...v } : x));
      else br.partyOv[id] = { ...(br.partyOv[id] || {}), ...v };
    }, `修改政党 ${p.name}`);
    toast('政党资料已更新：地图、席位图与人物卡同步变化', 'ok');
  };
  const toggleExist = async () => {
    if (!(await ensureEditable('改变政党存续状态'))) return;
    const ok = await ask({ kind: 'confirm', title: ex ? `宣布${p.name}解散／不存在？` : `让${p.name}自此日起存在？`, body: `自分支当前日期起生效。${ex ? '若真实历史之后有该党相关事件，将在时间流动时提示冲突。' : ''}` });
    if (!ok) return;
    mutate(br => { br.patches.push({ id: uid('pt'), t: 'partyExists:' + id, date: br.date, by: 'admin', v: !ex }); }, `${p.name} ${ex ? '解散' : '成立'}`);
  };
  const merge = async () => {
    if (!(await ensureEditable('批量替换党派'))) return;
    const to = await ask({ kind: 'custom', Comp: MergeDialog, props: { from: id } });
    if (!to) return;
    const members = (ly?.members || []).filter(m => m.party === id && m.p);
    const units = unitsAt(b.date).filter(u => execAt(b, u.id, b.date)?.party === id);
    mutate(br => {
      for (const m of members) br.patches.push({ id: uid('pt'), t: 'person:' + m.p, date: br.date, by: 'admin', v: { ...(activePatch(br, 'person:' + m.p, br.date)?.v || {}), party: to } });
      for (const u of units) { const e = execAt(br, u.id, br.date); br.patches.push({ id: uid('pt'), t: 'exec:' + u.id, date: br.date, by: 'admin', v: { p: e.p, name: e.name, party: to, how: e.how } }); }
    }, `${p.name} 成员并入 ${party(b, to).name}`);
    toast(`已改动 ${members.length} 位立委与 ${units.length} 位县市长党籍`, 'ok');
  };
  return (
    <div class="inner" style={{ padding: 10 }}>
      <div class="row">
        <span class="swatch" style={{ background: p.color, width: 18, height: 18, borderRadius: 5 }} />
        <div class="grow"><b style={{ fontSize: 15 }}>{p.name}</b> <span class="muted small">{p.short}</span></div>
        <EditGear title={p.name} items={[
          { icon: 'edit', name: '编辑政党资料', desc: '全称、简称、代表色（全站统一）、成立与解散日期', run: edit },
          { icon: 'flag', name: ex ? '设为解散／不存在' : '设为存在（自此日成立）', desc: '自分支当前日期起生效；与史实冲突时，时间流动会询问', run: toggleExist },
          { icon: 'party', name: '批量并入他党', desc: '把该党现任立委与县市长的党籍一次改为另一政党', run: merge, danger: true },
        ]} />
      </div>
      <div class="kv" style={{ marginTop: 8 }}>
        <span>状态</span><span>{ex ? '存在' : '此日尚未成立或已解散'}{p.fictional && <span class="chip sim" style={{ height: 16, marginLeft: 4 }}>架空政党</span>}</span>
        <span>成立</span><span>{p.founded ? D(p.founded, p.prec) : '—'}</span>
        {p.dissolved && <><span>解散</span><span>{D(p.dissolved)}</span></>}
        {chair && <><span>党主席</span><span>{chair.p ? <PersonLink pid={chair.p} /> : chair.name || '—'}{chair.note ? <span class="tiny muted"> {chair.note}</span> : ''}</span></>}
        <span>立法院席次</span><span><a href="#" onClick={e => { e.preventDefault(); highlightParty.value = id; openPanel('parliament', { inst: 'LY' }); }}>{lyN} 席</a></span>
        <span>执政县市</span><span>{execs.length ? execs.map(u => u.name).join('、') : '无'}</span>
      </div>
      {terms.length > 0 && <div style={{ marginTop: 8 }}>
        <div class="section-title">历届立法院席次</div>
        <div class="row" style={{ alignItems: 'flex-end', gap: 3, height: 64 }}>
          {terms.map(t => { const tot = Object.values(t.comp).reduce((a, x) => a + x, 0); const n = t.comp[id]; return <div title={`${t.label || ''} ${t.from.slice(0, 4)}：${n}/${tot}`} style={{ flex: 1, height: Math.max(3, n / tot * 64) + 'px', background: p.color, borderRadius: '3px 3px 0 0', opacity: 0.9 }} />; })}
        </div>
        <div class="row tiny muted" style={{ justifyContent: 'space-between' }}><span>{terms[0].from.slice(0, 4)}</span><span>{terms[terms.length - 1].from.slice(0, 4)}</span></div>
      </div>}
      <SourceNote src={p.fictional ? 'admin' : 'common'} verified={p.verified} prec={p.prec} />
    </div>
  );
}
export function PartyEditor({ resolve, p }) {
  const [v, setV] = useState({ name: p.name, short: p.short, color: p.color.startsWith('#') ? p.color : '#888888', founded: p.founded || '', dissolved: p.dissolved || '' });
  return (
    <>
      <div class="modal-head">{p.name ? '编辑政党' : '新建架空政党'}</div>
      <div class="modal-body col">
        <label class="field">全称<input class="input" value={v.name} onInput={e => setV({ ...v, name: e.target.value })} /></label>
        <label class="field">简称<input class="input" value={v.short} onInput={e => setV({ ...v, short: e.target.value })} /></label>
        <label class="field">代表色（全站统一）<div class="row"><input type="color" value={v.color} onInput={e => setV({ ...v, color: e.target.value })} style={{ width: 44, height: 30, border: 0, background: 'none' }} /><input class="input" value={v.color} onInput={e => setV({ ...v, color: e.target.value })} /></div></label>
        <div class="row"><label class="field grow">成立日期<input class="input" type="date" value={v.founded} onInput={e => setV({ ...v, founded: e.target.value })} /></label><label class="field grow">解散日期<input class="input" type="date" value={v.dissolved} onInput={e => setV({ ...v, dissolved: e.target.value })} /></label></div>
        <div class="tiny muted">修改只作用于当前架空分支；原始史料库不变。</div>
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn primary" disabled={!v.name} onClick={() => resolve({ ...v, short: v.short || v.name, dissolved: v.dissolved || undefined, founded: v.founded || undefined })}>保存</button></div>
    </>
  );
}
function MergeDialog({ resolve, from }) {
  const [to, setTo] = useState('IND');
  const b = branch.value;
  return (
    <>
      <div class="modal-head">批量替换党派</div>
      <div class="modal-body col">
        <div class="small">将 <b>{party(b, from).name}</b> 现任立委与县市长的党籍，自 {D(b.date)} 起改为：</div>
        <PartySelect value={to} onChange={setTo} small={false} />
        <div class="notice">此为批量操作，可用撤销或版本回退恢复。</div>
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn danger fill" onClick={() => resolve(to)}>确认批量替换</button></div>
    </>
  );
}
