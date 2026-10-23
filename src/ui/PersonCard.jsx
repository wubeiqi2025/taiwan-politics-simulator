// 人物卡：肖像、党籍、历任职务时间线、参选纪录、架空编辑
import { useState, useEffect } from 'preact/hooks';
import { branch, viewDate, panelArgs, openPanel, mutate, uid, toast, readOnly, ask, sel } from '../core/store.js';
import { IDX, candidacies, instName } from '../core/db.js';
import { person, party, personPartyAt, activePatch, pname } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { PartyTag, D, fmtN, fmtP, SourceNote, DataClass } from './common.jsx';
import { PartySelect } from './pickers.jsx';
import { Icon } from './Icon.jsx';
import { ensureEditable } from '../core/actions.js';
import { assetGet, assetPut } from '../core/persist.js';
import { EditGear } from './EditMenu.jsx';

export function rolesOf(b, pid) {
  const base = IDX.roles[pid] || [];
  // 架空分支中的任职（来自补丁）
  const extra = [];
  for (const p of b?.patches || []) {
    if (p.t.startsWith('exec:') && p.v?.p === pid) extra.push({ kind: 'exec', label: IDX.unit[p.t.slice(5)]?.name + '首长（架空）', from: p.date, party: p.v.party, sim: true });
    if (p.t.startsWith('office:') && p.v?.p === pid) extra.push({ kind: 'office', label: p.t.slice(7) + '（架空）', from: p.date, party: p.v.party, sim: true });
    if (p.t.startsWith('seats:')) for (const m of p.v?.members || []) if (m.p === pid) extra.push({ kind: 'member', label: instName(p.t.slice(6)) + '（架空）', from: p.date, party: m.party, district: m.district, sim: true });
    if (p.t === 'person:' + pid && p.v?.party) extra.push({ kind: 'party', label: '党籍变更为' + party(b, p.v.party).name, from: p.date, party: p.v.party, sim: true });
    if (p.t === 'person:' + pid && p.v?.status) extra.push({ kind: 'status', label: p.v.status, from: p.date, sim: true });
  }
  for (const e of b?.customEvents || []) if (e.people?.includes(pid)) extra.push({ kind: 'event', label: '事件：' + e.title, from: e.date, sim: true });
  return [...base, ...extra].sort((a, c) => (a.from || '').localeCompare(c.from || ''));
}

export function PersonCard() {
  const b = branch.value, d = viewDate.value;
  const pid = panelArgs.value.person?.pid;
  const pr = person(b, pid);
  const [pic, setPic] = useState(null);
  const [tab, setTab] = useState('roles');
  useEffect(() => { setPic(null); if (pr?.picAsset) assetGet(pr.picAsset).then(setPic); }, [pid, pr?.picAsset]);
  if (!pid || !pr) return null;
  const roles = rolesOf(b, pid);
  const curRoles = roles.filter(r => r.from <= d && (!r.to || r.to >= d));
  const lastParty = [...roles].reverse().find(r => r.party && r.from <= d)?.party || roles[0]?.party;
  const curParty = personPartyAt(b, pid, d, lastParty);
  const cands = tab === 'cands' ? candidacies(pid) : null;
  const statusPatch = activePatch(b, 'person:' + pid, d);
  const changeParty = async () => {
    if (!(await ensureEditable('修改人物党籍'))) return;
    const v = await ask({ kind: 'custom', Comp: PartyChange, props: { pid, cur: curParty } });
    if (!v) return;
    mutate(br => { br.patches.push({ id: uid('pt'), t: 'person:' + pid, date: br.date, by: 'admin', v: { ...(activePatch(br, 'person:' + pid, br.date)?.v || {}), party: v } }); }, `${pr.n} 改党籍`);
    toast(`${pr.n} 党籍已改为 ${party(b, v).name}，席位图与地图已同步`, 'ok');
  };
  const setStatus = async () => {
    if (!(await ensureEditable('设定人物状态'))) return;
    const r = await ask({ kind: 'choose', title: `设定 ${pr.n} 的状态（${D(b.date)} 起）`, body: <div class="small">此为架空分支纪录，不会抹除既有任职史。退出政坛、辞职等状态会显示在人物卡与时间线。</div>, options: [{ id: null, name: '取消' }, ...['就任', '辞职', '免职', '退休', '退出政坛', '逝世'].map(s => ({ id: s, name: s }))] });
    if (!r) return;
    mutate(br => { br.patches.push({ id: uid('pt'), t: 'person:' + pid, date: br.date, by: 'admin', v: { ...(activePatch(br, 'person:' + pid, br.date)?.v || {}), status: r } }); }, `${pr.n} ${r}`);
  };
  const uploadPic = async () => {
    if (!(await ensureEditable('上传人物照片'))) return;
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const url = await downscale(f, 360);
      const id = uid('img'); await assetPut(id, url);
      mutate(br => { br.personOv[pid] = { ...(br.personOv[pid] || {}), picAsset: id }; }, `${pr.n} 更换照片`);
      toast('照片已保存到本地', 'ok');
    };
    inp.click();
  };
  const editInfo = async () => {
    if (!(await ensureEditable('编辑人物资料'))) return;
    const v = await ask({ kind: 'custom', Comp: InfoEditor, props: { pr } });
    if (!v) return;
    mutate(br => {
      if (br.customPeople.some(x => x.id === pid)) br.customPeople = br.customPeople.map(x => (x.id === pid ? { ...x, ...v } : x));
      else br.personOv[pid] = { ...(br.personOv[pid] || {}), ...v };
    }, `编辑人物资料 ${v.n}`);
    toast('人物资料已更新（仅本分支）', 'ok');
  };
  const imgSrc = pic || pr.pic;
  const gear = (
    <EditGear title={pr.n} items={[
      { icon: 'party', name: '修改党籍', desc: '自分支当前日期起生效，席位图、地图同步；旧任职党籍保留', run: changeParty },
      { icon: 'flag', name: '设定状态', desc: '就任、辞职、免职、退休、退出政坛、逝世', run: setStatus },
      { icon: 'upload', name: '上传／更换照片', desc: '存于本机浏览器，可随备份导出', run: uploadPic },
      { icon: 'edit', name: '编辑基本资料', desc: '姓名、外文名、出生年、性别', run: editInfo },
    ]} />
  );
  return (
    <Panel id="person" title={pr.n} sub={pr.en || (pr.fictional ? '架空人物' : '')} icon="person" pos={{ x: 380, y: 120, w: 380 }} actions={gear}>
      <div class="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div class="avatar">{imgSrc ? <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} /> : <Icon name="person" size={30} />}</div>
        <div class="grow col" style={{ gap: 5 }}>
          <div class="row wrap" style={{ gap: 6 }}>{curParty && <PartyTag id={curParty} short={false} />}{pr.fictional && <span class="chip sim">架空人物</span>}{statusPatch?.v?.status && <span class="chip warn">{statusPatch.v.status}</span>}</div>
          <div class="kv">
            {pr.b && <><span>出生</span><span>{pr.b}年</span></>}
            {pr.sex && <><span>性别</span><span>{pr.sex === '1' ? '男' : '女'}</span></>}
            <span>当前职务</span><span>{curRoles.length ? curRoles.map(r => r.label).join('；') : <span class="muted">无（{D(d)}）</span>}</span>
          </div>
          {!pr.pic && !pic && <div class="tiny muted">无经授权照片时显示中性占位图，可上传自有图片。</div>}
        </div>
      </div>
      <div class="seg" style={{ marginTop: 10 }}>
        <button class={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')}>履历时间线</button>
        <button class={tab === 'cands' ? 'on' : ''} onClick={() => setTab('cands')}>参选纪录</button>
      </div>
      {tab === 'roles' && (
        <div class="timeline-list" style={{ marginTop: 8 }}>
          {roles.map(r => (
            <div class="tli" style={{ '--c': r.party ? party(b, r.party).color : '#9aa0a6' }}>
              <div class="small"><b>{r.label}</b>{r.sim && <span class="chip sim" style={{ height: 16, marginLeft: 4 }}>架空</span>}</div>
              <div class="tiny muted">{D(r.from)} — {r.to ? D(r.to) : r.sim ? '' : '至今'}{r.party ? ' · ' + party(b, r.party).short : ''}{r.district ? ' · ' + r.district : ''}{r.how && r.how !== '民选' ? ' · ' + r.how : ''}{r.note ? ' · ' + r.note : ''}</div>
            </div>
          ))}
          {!roles.length && <div class="empty">暂无收录任职资料</div>}
        </div>
      )}
      {tab === 'cands' && (
        <table class="table" style={{ marginTop: 8 }}>
          <thead><tr><th>选举</th><th>地区</th><th>党籍</th><th>得票</th><th>结果</th></tr></thead>
          <tbody>{cands.map(c => <tr class="click" onClick={() => openPanel('election', { view: c.el.id })}><td>{c.el.name}{c.vice ? '（副）' : ''}</td><td class="ellipsis" style={{ maxWidth: 90 }}>{c.where}</td><td>{party(b, c.party).short}</td><td class="num">{fmtN(c.votes)}{c.total ? <span class="tiny muted"> {fmtP(c.votes / c.total * 100, 1)}</span> : ''}</td><td>{c.win ? <span class="status-tag won">当选</span> : <span class="muted tiny">落选</span>}</td></tr>)}</tbody>
          {!cands.length && <caption class="empty" style={{ captionSide: 'bottom' }}>资料库中无参选纪录</caption>}
        </table>
      )}
      <SourceNote src={pr.fictional ? 'admin' : roles.some(r => r.src === 'ly') ? 'ly' : 'cec'} extra={<DataClass kind={pr.fictional ? 'admin' : 'real'} />} />
      <div class="tiny muted" style={{ marginTop: 4 }}>同名人物以姓名＋出生年区分；仅有姓名者为推定对应，派系与政治立场未收录（无可靠来源前不显示）。</div>
    </Panel>
  );
}
function InfoEditor({ resolve, pr }) {
  const [v, setV] = useState({ n: pr.n || '', en: pr.en || '', b: pr.b || '', sex: pr.sex || '' });
  return (
    <>
      <div class="modal-head">编辑基本资料 · {pr.n}</div>
      <div class="modal-body col">
        <label class="field">姓名<input class="input" value={v.n} onInput={e => setV({ ...v, n: e.target.value })} /></label>
        <label class="field">外文名<input class="input" value={v.en} onInput={e => setV({ ...v, en: e.target.value })} /></label>
        <div class="row">
          <label class="field grow">出生年<input class="input num" value={v.b} onInput={e => setV({ ...v, b: e.target.value })} /></label>
          <label class="field grow">性别<select class="select" value={v.sex} onChange={e => setV({ ...v, sex: e.target.value })}><option value="">未知</option><option value="1">男</option><option value="2">女</option></select></label>
        </div>
        {!pr.fictional && <div class="tiny muted">真实人物的修改只作用于本架空分支，原始史料不变。</div>}
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn primary" disabled={!v.n.trim()} onClick={() => resolve({ ...v, n: v.n.trim() })}>保存</button></div>
    </>
  );
}
function PartyChange({ resolve, pid, cur }) {
  const [v, setV] = useState(cur || 'IND');
  const b = branch.value;
  return (
    <>
      <div class="modal-head">修改党籍 · {pname(b, pid)}</div>
      <div class="modal-body col">
        <div class="small muted">自分支当前日期 {D(b.date)} 起生效，旧任职纪录与当时党籍保留不变。</div>
        <PartySelect value={v} onChange={setV} small={false} />
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>取消</button><button class="btn primary" onClick={() => resolve(v)}>确认改党籍</button></div>
    </>
  );
}
export function downscale(file, max) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    img.src = URL.createObjectURL(file);
  });
}
