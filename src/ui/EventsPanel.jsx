// 历史事件：按年分组、分类过滤、详情、定位，自定义事件增删改
import { useState, useMemo, useEffect } from 'preact/hooks';
import { branch, viewDate, panelArgs, openPanel, mutate, uid, toast, ask, sel, isSim } from '../core/store.js';
import { IDX, DB } from '../core/db.js';
import { allEvents, party, pname } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { PersonLink, PartyTag, D, SourceNote, DataClass } from './common.jsx';
import { PartySelect, PersonPicker } from './pickers.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable } from '../core/actions.js';
import { assetGet, assetPut } from '../core/persist.js';
import { downscale } from './PersonCard.jsx';
import { EditGear } from './EditMenu.jsx';

export const CATS = ['全部', '选举', '党争', '制度', '人事', '行政区划', '两岸', '社会'];
export function decisionLabel(b, e) {
  if (e.date > b.date) return e.planned ? '计划／待发生' : '尚未到达';
  const d = b.decisions?.[e.id];
  if (!d) return b.kind === 'real' ? '已发生' : '已触发，效果已应用';
  return { applied: '已触发，按真实历史应用', kept: '历史事件已触发，架空分支未应用效果', partial: '已触发，仅应用不冲突部分', manual: '已触发，效果经手动编辑', replaced: '已触发，本分支以模拟选举结果为准' }[d.d] || '已触发';
}
export function EventsPanel() {
  const b = branch.value, d = viewDate.value;
  const args = panelArgs.value.events || {};
  const [cat, setCat] = useState('全部');
  const [imp, setImp] = useState(1);
  const [src, setSrc] = useState('all');
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(args.focus || null);
  const [range, setRange] = useState('past');
  useEffect(() => { if (args.focus) setFocus(args.focus); }, [args.focus]);
  const evs = useMemo(() => allEvents(b).filter(e => (cat === '全部' || e.cat === cat) && e.imp >= imp && (src === 'all' || (src === 'custom' ? e.kind === 'custom' : e.kind !== 'custom')) && (!q || e.title.includes(q) || e.desc?.includes(q)) && (range === 'all' || (range === 'past' ? e.date <= d : e.date > d))), [b, cat, imp, src, q, d, range]);
  const byYear = {};
  for (const e of evs) (byYear[e.date.slice(0, 4)] ||= []).push(e);
  const years = Object.keys(byYear).sort((a, c) => (range === 'future' ? a.localeCompare(c) : c.localeCompare(a)));
  const fe = focus && (IDX.event[focus] || b.customEvents.find(e => e.id === focus));
  const create = async () => {
    if (!(await ensureEditable('新建自定义事件'))) return;
    const v = await ask({ kind: 'custom', wide: true, Comp: EventEditor, props: { ev: { date: branch.value.date, title: '', desc: '', cat: '党争', imp: 2, people: [], parties: [], regions: [], effects: [], oneTime: true } } });
    if (!v) return;
    const id = uid('ce');
    mutate(br => { br.customEvents.push({ ...v, id, kind: 'custom' }); }, `新建事件 ${v.title}`);
    setFocus(id);
  };
  return (
    <Panel id="events" title="历史事件" sub={`${evs.length} 条 · 当前 ${D(d)}`} icon="history" pos={{ x: 80, y: 110, w: 420, h: 600 }}
      actions={<button class="btn sm shot-hide" onClick={create}><Icon name="plus" size={13} />自定义事件</button>}>
      {fe && <EventDetail e={fe} onClose={() => setFocus(null)} />}
      <div class="col" style={{ gap: 6, marginTop: fe ? 8 : 0 }}>
        <div class="row wrap" style={{ gap: 4 }}>{CATS.map(c => <button class={`btn sm ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
        <div class="row wrap">
          <div class="seg"><button class={range === 'past' ? 'on' : ''} onClick={() => setRange('past')}>已发生</button><button class={range === 'future' ? 'on' : ''} onClick={() => setRange('future')}>之后</button><button class={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>全部</button></div>
          <div class="seg"><button class={imp === 1 ? 'on' : ''} onClick={() => setImp(1)}>全部</button><button class={imp === 2 ? 'on' : ''} onClick={() => setImp(2)}>重点</button><button class={imp === 3 ? 'on' : ''} onClick={() => setImp(3)}>重大</button></div>
          <select class="select sm" value={src} onChange={e => setSrc(e.target.value)}><option value="all">史实＋自定义</option><option value="real">仅史实</option><option value="custom">仅自定义</option></select>
        </div>
        <input class="input sm" placeholder="搜索事件" value={q} onInput={e => setQ(e.target.value)} />
      </div>
      <div style={{ marginTop: 6 }}>
        {years.map(y => (
          <div>
            <div class="section-title" style={{ position: 'sticky', top: -4, background: 'var(--glass-bg-strong)', padding: '3px 0', zIndex: 1 }}>{y}年 · {byYear[y].length}条</div>
            {(range === 'future' ? byYear[y] : [...byYear[y]].reverse()).map(e => (
              <div class={`list-item small ${focus === e.id ? 'active' : ''}`} onClick={() => setFocus(e.id)}>
                <span class="num tiny muted" style={{ width: 40 }}>{e.date.slice(5)}</span>
                <span class="dot" style={{ background: e.imp === 3 ? 'var(--danger)' : e.imp === 2 ? 'var(--warn)' : '#c7ccd3' }} />
                <span class="grow ellipsis">{e.title}</span>
                {e.kind === 'custom' && <span class="chip sim" style={{ height: 16 }}>架空</span>}
                {e.planned && <span class="chip warn" style={{ height: 16 }}>计划</span>}
              </div>
            ))}
          </div>
        ))}
        {!years.length && <div class="empty">没有符合条件的事件</div>}
      </div>
    </Panel>
  );
}
function EventDetail({ e, onClose }) {
  const b = branch.value;
  const [img, setImg] = useState(null);
  useEffect(() => { setImg(null); if (e.imgAsset) assetGet(e.imgAsset).then(setImg); }, [e.id]);
  const edit = async () => {
    if (!(await ensureEditable('修改自定义事件'))) return;
    const v = await ask({ kind: 'custom', wide: true, Comp: EventEditor, props: { ev: e } });
    if (!v) return;
    mutate(br => { br.customEvents = br.customEvents.map(x => (x.id === e.id ? { ...x, ...v } : x)); }, `修改事件 ${v.title}`);
  };
  const del = async () => {
    if (!(await ensureEditable('删除自定义事件'))) return;
    if (!(await ask({ kind: 'confirm', title: '删除自定义事件？', body: `「${e.title}」将从本分支删除（可撤销）。真实史实事件不受影响。`, danger: true, okText: '删除' }))) return;
    mutate(br => { br.customEvents = br.customEvents.filter(x => x.id !== e.id); }, `删除事件 ${e.title}`);
    onClose();
  };
  const locate = r => { const u = IDX.unit[r]; if (u) sel.value = { unit: r, town: null }; };
  const els = e.els || (e.el ? [e.el] : []);
  return (
    <div class="inner" style={{ padding: 10 }}>
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <div class="grow">
          <div class="row wrap" style={{ gap: 4 }}><span class="chip">{e.cat}</span>{e.kind === 'custom' ? <span class="chip sim">架空事件</span> : <span class="chip real">史实记录</span>}{e.planned && <span class="chip warn">计划／待发生</span>}</div>
          <div class="bold" style={{ fontSize: 14.5, marginTop: 4 }}>{e.title}</div>
          <div class="small muted">{D(e.date, e.prec)}</div>
        </div>
        {e.kind === 'custom' && <EditGear title={e.title} items={[
          { icon: 'edit', name: '编辑事件', desc: '日期、内容、分类、相关人物／政党／地区、模拟效果、配图', run: edit },
          { icon: 'trash', name: '删除事件', desc: '只删除本分支的自定义事件，史实记录不受影响（可撤销）', run: del, danger: true },
        ]} />}
        <button class="btn ghost sm icon" onClick={onClose}><Icon name="close" size={13} /></button>
      </div>
      {img && <img src={img} style={{ width: '100%', borderRadius: 10, marginTop: 6 }} />}
      {e.desc && <p class="small" style={{ margin: '6px 0' }}>{e.desc}</p>}
      <div class="row wrap" style={{ gap: 4 }}>
        {(e.people || []).map(p => <span class="chip"><PersonLink pid={p} /></span>)}
        {(e.parties || []).map(p => <PartyTag id={p} />)}
        {(e.regions || []).filter(r => IDX.unit[r]).map(r => <span class="chip click" onClick={() => locate(r)}><Icon name="locate" size={11} />{IDX.unit[r].name}</span>)}
      </div>
      {els.length > 0 && <div class="row wrap" style={{ gap: 4, marginTop: 6 }}>{els.map(id => <button class="btn sm" onClick={() => openPanel('election', { view: id })}><Icon name="ballot" size={13} />{IDX.election[id]?.name || '选举'}</button>)}</div>}
      <div class="tiny" style={{ marginTop: 6 }}><b>本分支状态：</b>{decisionLabel(b, e)}</div>
      {e.effects?.length > 0 && <div class="tiny muted">模拟效果：{e.effects.map(x => x.t).join('、')}</div>}
      <SourceNote src={e.kind === 'custom' ? 'admin' : e.src} prec={e.prec} />
    </div>
  );
}
// 自定义事件编辑器
export function EventEditor({ resolve, ev }) {
  const b = branch.value;
  const [v, setV] = useState({ ...ev, people: [...(ev.people || [])], parties: [...(ev.parties || [])], regions: [...(ev.regions || [])], effects: [...(ev.effects || [])] });
  const [eff, setEff] = useState({ type: 'exec', unit: 'TPE', party: 'KMT', pid: null, name: '' });
  const set = p => setV({ ...v, ...p });
  const addEffect = () => {
    let x;
    if (eff.type === 'exec') x = { t: 'exec:' + eff.unit, v: { p: eff.pid, name: eff.name, party: eff.party, how: '事件' } };
    if (eff.type === 'control') x = { t: 'control:' + eff.unit, v: eff.party };
    if (eff.type === 'partyOn') x = { t: 'partyExists:' + eff.party, v: true };
    if (eff.type === 'partyOff') x = { t: 'partyExists:' + eff.party, v: false };
    set({ effects: [...v.effects, x] });
  };
  const uploadImg = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const url = await downscale(f, 900); const id = uid('img'); await assetPut(id, url); set({ imgAsset: id }); toast('配图已保存'); };
    inp.click();
  };
  return (
    <>
      <div class="modal-head">{ev.id ? '编辑自定义事件' : '新建自定义事件'}<div class="small muted" style={{ fontWeight: 400 }}>自定义事件只存在于本分支，不影响原始史实记录</div></div>
      <div class="modal-body col">
        <div class="row wrap">
          <label class="field">日期<input class="input" type="date" min="1986-01-01" max="2030-12-31" value={v.date} onInput={e => set({ date: e.target.value })} /></label>
          <label class="field grow">标题<input class="input" value={v.title} onInput={e => set({ title: e.target.value })} /></label>
        </div>
        <label class="field">内容<textarea class="input" rows="3" value={v.desc} onInput={e => set({ desc: e.target.value })} /></label>
        <div class="row wrap">
          <label class="field">分类<select class="select" value={v.cat} onChange={e => set({ cat: e.target.value })}>{CATS.slice(1).map(c => <option>{c}</option>)}</select></label>
          <label class="field">重要性<select class="select" value={v.imp} onChange={e => set({ imp: +e.target.value })}><option value="1">普通</option><option value="2">重点</option><option value="3">重大</option></select></label>
          <label class="field">次数<select class="select" value={v.oneTime ? '1' : '0'} onChange={e => set({ oneTime: e.target.value === '1' })}><option value="1">一次性</option><option value="0">可重复显示</option></select></label>
          <label class="field">触发条件<select class="select" value={v.cond?.party || ''} onChange={e => set({ cond: e.target.value ? { party: e.target.value } : null })}><option value="">无条件</option>{['DPP', 'KMT', 'NP', 'PFP', 'TPP', 'NPP', 'TSU'].map(p => <option value={p}>需{party(b, p).short}存在</option>)}</select></label>
        </div>
        <div class="row wrap" style={{ gap: 6 }}>
          <span class="small muted">相关人物</span>
          {v.people.map(p => <span class="chip">{pname(b, p)}<a href="#" onClick={e => { e.preventDefault(); set({ people: v.people.filter(x => x !== p) }); }}>×</a></span>)}
          <PersonPicker onPick={x => x.pid && set({ people: [...v.people, x.pid] })} placeholder="添加人物" style={{ width: 140 }} />
        </div>
        <div class="row wrap" style={{ gap: 6 }}>
          <span class="small muted">相关政党</span>
          {v.parties.map(p => <span class="chip">{party(b, p).short}<a href="#" onClick={e => { e.preventDefault(); set({ parties: v.parties.filter(x => x !== p) }); }}>×</a></span>)}
          <PartySelect value="" onChange={p => p && set({ parties: [...v.parties, p] })} />
          <span class="small muted">影响地区</span>
          {v.regions.map(r => <span class="chip">{IDX.unit[r]?.name}<a href="#" onClick={e => { e.preventDefault(); set({ regions: v.regions.filter(x => x !== r) }); }}>×</a></span>)}
          <select class="select sm" value="" onChange={e => e.target.value && set({ regions: [...v.regions, e.target.value] })}><option value="">添加地区</option>{DB.units.map(u => <option value={u.id}>{u.name}{u.to ? `（至${u.to.slice(0, 4)}）` : ''}</option>)}</select>
        </div>
        <div class="inner" style={{ padding: 8 }}>
          <div class="small bold">模拟效果（时间流动到此日时生效，可与现状冲突时提示）</div>
          {v.effects.map((x, i) => <div class="row small" style={{ marginTop: 4 }}><code class="tiny">{x.t}</code><span class="muted">{typeof x.v === 'object' ? (x.v?.party ? party(b, x.v.party).short : '') + (x.v?.name ? ' ' + x.v.name : '') : String(x.v)}</span><button class="btn ghost sm icon right" onClick={() => set({ effects: v.effects.filter((_, j) => j !== i) })}><Icon name="trash" size={12} /></button></div>)}
          <div class="row wrap" style={{ marginTop: 6 }}>
            <select class="select sm" value={eff.type} onChange={e => setEff({ ...eff, type: e.target.value })}><option value="exec">更换县市首长</option><option value="control">指定控制党</option><option value="partyOn">政党成立</option><option value="partyOff">政党解散</option></select>
            {(eff.type === 'exec' || eff.type === 'control') && <select class="select sm" value={eff.unit} onChange={e => setEff({ ...eff, unit: e.target.value })}>{DB.units.map(u => <option value={u.id}>{u.name}</option>)}</select>}
            {eff.type === 'exec' && <PersonPicker onPick={x => setEff({ ...eff, pid: x.pid || null, name: x.name || '' })} placeholder="首长人选" style={{ width: 120 }} />}
            <PartySelect value={eff.party} onChange={p => setEff({ ...eff, party: p })} />
            <button class="btn sm" onClick={addEffect}>加入效果</button>
          </div>
        </div>
        <div class="row"><button class="btn sm" onClick={uploadImg}><Icon name="upload" size={13} />{v.imgAsset ? '更换配图' : '上传配图'}</button>{v.imgAsset && <span class="tiny muted">已附配图</span>}</div>
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn primary" disabled={!v.title || !v.date} onClick={() => resolve(v)}>保存</button></div>
    </>
  );
}
