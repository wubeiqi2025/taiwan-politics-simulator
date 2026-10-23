// 截图与导出：沿用 SVG 合成，增加对象多选、内容勾选与双版本独立页面
import { useState, useEffect, useRef } from 'preact/hooks';
import { toPng } from 'html-to-image';
import { branch, viewDate, prefs, sel, panelArgs, shotMode, toast, counting, setPrefs, rev } from '../core/store.js';
import { DB, IDX, instName } from '../core/db.js';
import { party, unitsAt, unitInfo, instExists } from '../core/world.js';
import { composeSVG, svgToPng, ASPECTS, exportPageHTML, exportPeople } from '../core/export.js';
import { countView } from '../core/countview.js';
import { snapshotAt, countTargets } from '../core/sim.js';
import { rolesOf } from './PersonCard.jsx';
import { Panel } from './Panel.jsx';
import { Seg } from './common.jsx';
import { Icon } from './Icon.jsx';
import { convertText } from '../core/i18n.js';

const PRESETS = [
  { id: 'mapLY', name: '台湾全图＋立法院', aspect: '16:9' },
  { id: 'region', name: '县市政治详情', aspect: '4:3' },
  { id: 'map', name: '只截地图', aspect: '16:9' },
  { id: 'seats', name: '只截议会席位', aspect: '16:9' },
  { id: 'person', name: '只截人物卡', aspect: '4:3' },
  { id: 'people', name: '导出人物', aspect: '16:9' },
  { id: 'election', name: '只截选举面板', aspect: '16:9' },
];
const REGION_PARTS = [['map', '县市地图'], ['head', '行政首长'], ['council', '地方议会席位及党派'], ['election', '最近县市长选举'], ['ly', '本地区域立委']];
const SEAT_PARTS = [['term', '议会届次'], ['chart', '半圆席位图'], ['parties', '各党席次与过半门槛'], ['leaders', '议长／副议长'], ['members', '完整成员名单']];
const PEOPLE_PARTS = [['party', '党派与代表色'], ['roles', '职务／参选记录'], ['region', '县市名称'], ['birth', '出生资料']];
const fileName = text => text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
function downloadFile(url, name) {
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
}
function blobDataUrl(blob) {
  return new Promise((resolve, reject) => { const f = new FileReader(); f.onload = () => resolve(f.result); f.onerror = () => reject(new Error('读取图片失败')); f.readAsDataURL(blob); });
}
export function ExportPanel() {
  const b = branch.value, d = viewDate.value, p = prefs.value, s = sel.value;
  const saved = p.exportConfig || {};
  const [preset, setPreset] = useState(() => PRESETS.some(x => x.id === saved.preset) ? saved.preset : 'mapLY');
  const [aspect, setAspect] = useState(saved.aspect || '16:9');
  const [scale, setScale] = useState(saved.scale || 2);
  const [o, setO] = useState({ date: true, season: false, region: true, election: true, legend: true, source: true, version: true, badge: true, ...saved.o });
  const [style, setStyle] = useState(() => { if (saved.style) return saved.style; try { return localStorage.getItem('tw-export-style') || 'print'; } catch { return 'print'; } });
  const [unitIds, setUnitIds] = useState(saved.unitIds || (s.unit ? [s.unit] : []));
  const [instIds, setInstIds] = useState(saved.instIds || [panelArgs.value.parliament?.inst || 'LY']);
  const [regionContent, setRegionContent] = useState({ map: true, head: true, council: true, election: true, ly: true, ...saved.regionContent });
  const [seatContent, setSeatContent] = useState({ term: true, chart: true, parties: true, leaders: true, members: false, ...saved.seatContent });
  const [columns, setColumns] = useState(saved.columns || 0);
  const [forceAspect, setForceAspect] = useState(!!saved.forceAspect);
  const [peopleSource, setPeopleSource] = useState(saved.peopleSource || 'mayors');
  const [peopleIds, setPeopleIds] = useState({ mayors: null, important: null, library: [], ...saved.peopleIds });
  const [peopleContent, setPeopleContent] = useState({ party: true, roles: true, region: true, birth: false, ...saved.peopleContent });
  const [details, setDetails] = useState(false);
  const [q, setQ] = useState('');
  const [instCount, setInstCount] = useState(80);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const units = unitsAt(d), insts = DB.insts.filter(i => i.kind === 'elected' && instExists(i, d));
  const selectedUnits = unitIds.filter(id => units.some(u => u.id === id));
  const selectedInsts = instIds.filter(id => insts.some(i => i.id === id));
  const people = preset === 'people' ? exportPeople(b, d, peopleSource) : [];
  const selectedPeople = people.filter(r => peopleIds[peopleSource] == null || peopleIds[peopleSource].includes(r.id));
  const peopleList = people.filter(r => !q || [r.name, r.region, party(b, r.party).name, ...r.roles].some(text => text.includes(q)));
  const list = insts.filter(i => !q || instName(i.id).includes(q) || i.level.includes(q) || (i.region && IDX.unit[i.region]?.name.includes(q)));
  const merged = preset === 'region' || preset === 'seats' || preset === 'people';
  const config = { preset, aspect, scale, o, style, unitIds, instIds, regionContent, seatContent, columns, forceAspect, peopleSource, peopleIds, peopleContent };
  const configJSON = JSON.stringify(config);
  const key = JSON.stringify([config, b.id, d, rev.value, p.roc, p.script, p.trad, p.mapMode, p.lyOpt, p.seasonName, panelArgs.value.person?.pid, counting.value, countView.value?.snap?.pct]);
  const currentKey = useRef(key); currentKey.current = key;
  useEffect(() => { if (JSON.stringify(prefs.peek().exportConfig) !== configJSON) setPrefs({ exportConfig: config }); }, [configJSON]);
  useEffect(() => { setPreview(null); }, [key]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview.url), [preview]);
  const setStyleKeep = value => { setStyle(value); try { localStorage.setItem('tw-export-style', value); } catch { } };
  const pick = id => {
    setPreset(id); setAspect(PRESETS.find(x => x.id === id).aspect); setQ('');
    if (id === 'region' && !unitIds.length && s.unit) setUnitIds([s.unit]);
  };
  const title = PRESETS.find(x => x.id === preset).name;
  const selectedNames = preset === 'people' ? selectedPeople.map(r => r.name + (r.region ? '（' + r.region + '）' : '')) : preset === 'region' ? selectedUnits.map(id => unitInfo(b, id, d).name) : preset === 'seats' ? selectedInsts.map(instName) : [];
  const baseName = fileName(`台湾政党斗争_${title}${merged ? '_' + selectedNames.length + (preset === 'people' ? '人物' : preset === 'region' ? '县市' : '议会') + '合图' : ''}_${d}`);
  const renderVariant = async targetStyle => {
    const size = aspect === 'window' ? [window.innerWidth, window.innerHeight] : ASPECTS[aspect];
    const inst = panelArgs.value.parliament?.inst || 'LY';
    const opts = { ...o, print: targetStyle === 'print', roc: p.roc, size, mapMode: p.mapMode, lyOpt: p.lyOpt, inst, instName: instName(inst), unit: s.unit, regionName: s.unit ? IDX.unit[s.unit]?.name : '', seasonName: p.seasonName, columns, forceAspect };
    if (preset === 'people') {
      if (!selectedPeople.length) throw new Error('请在详细选项中至少勾选一位人物');
      opts.peopleSource = peopleSource; opts.peopleIds = selectedPeople.map(r => r.id); opts.peopleContent = peopleContent;
    }
    if (preset === 'region') {
      if (!selectedUnits.length) throw new Error('请展开详细选项，至少勾选一个县市');
      if (!Object.values(regionContent).some(Boolean)) throw new Error('请至少勾选一项县市内容');
      opts.unitIds = selectedUnits; opts.regionContent = regionContent;
    }
    if (preset === 'seats') {
      if (!selectedInsts.length || selectedInsts.length > 3) throw new Error('请勾选 1 至 3 个议会');
      if (!Object.values(seatContent).some(Boolean)) throw new Error('请至少勾选一项议会内容');
      opts.instIds = selectedInsts; opts.seatContent = seatContent;
    }
    if (preset === 'person') {
      const pid = panelArgs.value.person?.pid;
      if (!pid) throw new Error('请先打开一张人物卡');
      opts.pid = pid; opts.roles = rolesOf(b, pid);
    }
    if (preset === 'election') {
      let cv = countView.value;
      const session = counting.value, sim = session && b.sims?.[session.simId];
      if (!cv && sim) { const targets = countTargets(p); cv = { sim, snap: snapshotAt(sim, session.idx < 0 ? 0 : targets[Math.min(session.idx, targets.length - 1)]) }; }
      if (!cv) throw new Error('请先打开一次逐步开票面板');
      const { sim: election, snap } = cv, isCand = election.type === 'president';
      const cb = Object.fromEntries(election.cands.map(x => [x.k, x])), tot = snap.nat.valid || 1;
      const keys = isCand ? election.cands.map(x => x.k) : Object.keys(snap.nat.byParty);
      opts.rows = keys.map(k => ({ name: isCand ? cb[k].name : party(b, k).name, color: party(b, isCand ? cb[k].party : k).color, pct: (isCand ? snap.nat.byCand[k] : snap.nat.byParty[k]) / tot * 100, extra: isCand ? '' : `确定${snap.decided[k] || 0} 推算${snap.projected[k] || 0}` })).sort((x, y) => y.pct - x.pct);
      opts.progress = snap.pct; opts.counting = true; opts.electionName = election.name; opts.demo = election.source === 'demo';
    }
    const svg = convertText(composeSVG(preset, b, d, opts));
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.localName !== 'svg' || root.querySelector('parsererror')) throw new Error('图片合成内容无效');
    const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
    const factor = Math.min(scale, 16384 / width, 16384 / height, Math.sqrt(64000000 / (width * height)));
    if (!Number.isFinite(factor) || factor < 0.25) throw new Error('所选内容过长，请取消完整成员名单或减少合图对象');
    const blob = await svgToPng(svg, width, height, factor, targetStyle === 'print' ? '#ffffff' : '#e9edf2');
    if (currentKey.current !== key) throw new Error('生成期间选项或历史状态已变化，请重新生成');
    return { blob, width: Math.round(width * factor), height: Math.round(height * factor), factor, style: targetStyle, name: baseName + (targetStyle === 'print' ? '_打印版.png' : '_展示版.png') };
  };
  const build = async () => {
    setBusy(true);
    try {
      const result = await renderVariant(style);
      setPreview({ ...result, key, url: URL.createObjectURL(result.blob) });
      if (result.factor < scale) toast(`长图已按浏览器尺寸限制调整为 ${result.factor.toFixed(2)}×，内容完整保留`);
    } catch (e) { toast('生成失败：' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  const standalone = async saveHTML => {
    const win = saveHTML ? null : window.open('', '_blank');
    if (!saveHTML && !win) { toast('浏览器阻止了新窗口，请允许本页弹出窗口', 'error'); return; }
    if (win) win.document.write('<!doctype html><meta charset="utf-8"><title>导出页面</title><p>正在生成打印版与展示版…</p>');
    setBusy(true);
    try {
      const variants = {};
      for (const targetStyle of ['print', 'glass']) {
        const result = await renderVariant(targetStyle);
        variants[targetStyle] = { name: result.name, width: result.width, height: result.height, dataUrl: await blobDataUrl(result.blob) };
      }
      if (currentKey.current !== key) throw new Error('生成期间选项或历史状态已变化，请重新生成');
      const fields = preset === 'people' ? PEOPLE_PARTS.filter(([id]) => peopleContent[id]).map(([, name]) => name) : preset === 'region' ? REGION_PARTS.filter(([id]) => regionContent[id]).map(([, name]) => name) : preset === 'seats' ? SEAT_PARTS.filter(([id]) => seatContent[id]).map(([, name]) => name) : [];
      const description = convertText([`历史日期：${d}`, b.kind === 'sim' ? '架空模拟（含管理员修改与系统推算）' : '真实历史', `分支：${b.name}`, selectedNames.length ? `对象：${selectedNames.join('、')}` : title, fields.length ? `内容：${fields.join('、')}` : '', `目标比例：${aspect}；${forceAspect ? '强制保持比例，全部内容缩放到固定画幅' : '合图按内容延长画布'}`].filter(Boolean).join(' ｜ '));
      const html = exportPageHTML({ title: convertText(baseName), description, variants, style, landscape: aspect === 'window' ? window.innerWidth >= window.innerHeight : aspect !== '9:16' });
      if (saveHTML) {
        const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        downloadFile(u, baseName + '.html'); setTimeout(() => URL.revokeObjectURL(u), 2000);
        toast('独立页面已保存，包含打印版和展示版，可离线打开', 'ok');
      } else { win.document.open(); win.document.write(html); win.document.close(); }
    } catch (e) { if (win) win.close(); toast('页面生成失败：' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  const T = (k, n) => <label class="chip click"><input type="checkbox" checked={o[k]} disabled={k === 'badge' && b.kind === 'sim'} onChange={e => setO({ ...o, [k]: e.target.checked })} />{n}</label>;
  const toggleInst = id => {
    if (selectedInsts.includes(id)) setInstIds(selectedInsts.filter(x => x !== id));
    else if (selectedInsts.length < 3) setInstIds([...selectedInsts, id]);
    else toast('议会合图最多选择 3 个，请先取消一个', 'error');
  };
  return (
    <Panel id="export" title="截图与导出" sub="高清 PNG · 矢量合成" icon="camera" pos={{ x: 80, y: 100, w: 470, h: 660 }} className="shot-hide">
      <div class="col">
        <div class="row wrap" style={{ gap: 4 }}>{PRESETS.map(x => <button class={`btn sm ${preset === x.id ? 'on' : ''}`} onClick={() => pick(x.id)}>{x.name}</button>)}</div>
        {preset === 'people' && <div class="inner col" style={{ padding: 10 }}>
          <div class="row"><b class="small">已选 {selectedPeople.length} 位人物</b><button class={`btn sm right ${details ? 'on' : ''}`} aria-expanded={details} onClick={() => setDetails(!details)}>{details ? '收起详细选项' : '详细选项'}</button></div>
          <Seg value={peopleSource} onChange={value => { setPeopleSource(value); setQ(''); setInstCount(80); }} options={[{ id: 'mayors', name: '各县市首长' }, { id: 'important', name: '当前重要人物' }, { id: 'library', name: '人物库补选' }]} />
          <div class="tiny muted">按当前日期读取首长、中央要职、党主席、立委及最近一届总统候选人，不作知名度排名；补选名单注明历史任职。党籍采用当前分支修改。</div>
          {details && <>
            <div class="row wrap"><button class="btn sm" onClick={() => setPeopleIds({ ...peopleIds, [peopleSource]: null })}>全选人物</button><button class="btn sm" onClick={() => setPeopleIds({ ...peopleIds, [peopleSource]: [] })}>清空</button></div>
            <input class="input sm" placeholder="搜索姓名、县市、政党或职务" value={q} onInput={e => { setQ(e.target.value); setInstCount(80); }} />
            <div class="col" style={{ maxHeight: 230, overflow: 'auto', gap: 4 }}>{peopleList.slice(0, instCount).map(r => <label class="chip click" style={{ height: 'auto', minHeight: 28, flexShrink: 0, whiteSpace: 'normal' }}><input type="checkbox" checked={selectedPeople.some(x => x.id === r.id)} onChange={e => setPeopleIds({ ...peopleIds, [peopleSource]: e.target.checked ? [...selectedPeople.map(x => x.id), r.id] : selectedPeople.filter(x => x.id !== r.id).map(x => x.id) })} /><span class="dot" style={{ background: party(b, r.party).color }} /><span>{r.name}{r.region ? ' · ' + r.region : ''}<span class="tiny muted"> · {r.party ? party(b, r.party).short : '党籍待补'} · {r.roles.join('；')}</span></span></label>)}{peopleList.length > instCount && <button class="btn sm" onClick={() => setInstCount(instCount + 100)}>显示更多</button>}{!peopleList.length && <div class="empty">当前日期没有符合条件的人物</div>}</div>
            <div class="small bold">人物导出内容（姓名始终显示）</div>
            <div class="row wrap" style={{ gap: 4 }}>{PEOPLE_PARTS.map(([id, name]) => <label class="chip click"><input type="checkbox" checked={peopleContent[id]} onChange={e => setPeopleContent({ ...peopleContent, [id]: e.target.checked })} />{name}</label>)}</div>
            <div class="row wrap"><span class="small muted">排列</span><Seg value={columns} onChange={setColumns} options={[{ id: 0, name: '自动' }, { id: 1, name: '1列' }, { id: 2, name: '2列' }, { id: 3, name: '3列' }]} /></div>
          </>}
        </div>}
        {(preset === 'region' || preset === 'seats') && <div class="inner col" style={{ padding: 10 }}>
          <div class="row"><b class="small">{preset === 'region' ? `已选 ${selectedUnits.length} 个县市` : `已选 ${selectedInsts.length} / 3 个议会`}</b><button class={`btn sm right ${details ? 'on' : ''}`} aria-expanded={details} onClick={() => setDetails(!details)}>{details ? '收起详细选项' : '详细选项'}</button></div>
          {((preset === 'region' ? unitIds.length - selectedUnits.length : instIds.length - selectedInsts.length) > 0) && <div class="tiny muted">部分已选对象在当前日期不存在，不纳入本次导出；切回对应年代后仍保留选择。</div>}
          {details && <>
            <div class="small bold">{preset === 'region' ? '勾选要合并的县市（按当前历史日期）' : '勾选要合并的议会（最多 3 个）'}</div>
            {preset === 'region' ? <>
              <div class="row wrap"><button class="btn sm" onClick={() => setUnitIds(units.map(u => u.id))}>全选县市</button><button class="btn sm" onClick={() => setUnitIds([])}>清空</button>{s.unit && <button class="btn sm" onClick={() => setUnitIds([s.unit])}>仅用当前县市</button>}</div>
              <div class="row wrap" style={{ gap: 4 }}>{units.map(u => <label class="chip click"><input type="checkbox" checked={selectedUnits.includes(u.id)} onChange={e => setUnitIds(e.target.checked ? [...selectedUnits, u.id] : selectedUnits.filter(id => id !== u.id))} />{unitInfo(b, u.id, d).name}</label>)}</div>
            </> : <>
              <div class="row wrap"><button class="btn sm" onClick={() => setInstIds([panelArgs.value.parliament?.inst || 'LY'])}>仅用当前议会</button><button class="btn sm" onClick={() => setInstIds([])}>清空</button></div>
              <input class="input sm" placeholder="搜索议会或地区名称" value={q} onInput={e => { setQ(e.target.value); setInstCount(80); }} />
              <div class="col" style={{ maxHeight: 190, overflow: 'auto', gap: 4 }}>{list.slice(0, instCount).map(i => <label class="chip click" style={{ flexShrink: 0 }}><input type="checkbox" checked={selectedInsts.includes(i.id)} disabled={!selectedInsts.includes(i.id) && selectedInsts.length >= 3} onChange={() => toggleInst(i.id)} />{instName(i.id)}<span class="tiny muted">{i.level}</span></label>)}{list.length > instCount && <button class="btn sm" onClick={() => setInstCount(instCount + 100)}>显示更多</button>}</div>
              <div class="tiny muted">只列出当前日期存在的民选机关；咨询机构不作为议会席位图。</div>
            </>}
            <div class="small bold">合图内容（各对象分别显示）</div>
            <div class="row wrap" style={{ gap: 4 }}>{(preset === 'region' ? REGION_PARTS : SEAT_PARTS).map(([id, name]) => <label class="chip click"><input type="checkbox" checked={(preset === 'region' ? regionContent : seatContent)[id]} onChange={e => preset === 'region' ? setRegionContent({ ...regionContent, [id]: e.target.checked }) : setSeatContent({ ...seatContent, [id]: e.target.checked })} />{name}</label>)}</div>
            <div class="row wrap"><span class="small muted">排列</span><Seg value={columns} onChange={setColumns} options={[{ id: 0, name: '自动' }, { id: 1, name: '1列' }, { id: 2, name: '2列' }, { id: 3, name: '3列' }]} /></div>
            <div class="tiny muted">{forceAspect ? '自动排列会选择更适合固定画幅的列数，所有内容整体缩小，不裁剪。手动列数仍会保留。' : '按画布宽度自动限制列数；内容较多时延长图片，不裁剪名单和资料。完整成员名单可能生成很长的图片。'}</div>
          </>}
        </div>}
        <div class="row wrap"><span class="small muted">比例</span><Seg value={aspect} onChange={setAspect} options={[{ id: '16:9', name: '16:9' }, { id: '4:3', name: '4:3' }, { id: '9:16', name: '9:16' }, { id: 'window', name: '窗口原比例' }]} /><span class="small muted">清晰度</span><Seg value={scale} onChange={setScale} options={[{ id: 1, name: '1×' }, { id: 2, name: '2×' }, { id: 3, name: '3×' }]} /></div>
        {merged && <div class="col" style={{ gap: 4 }}><label class="chip click"><input type="checkbox" checked={forceAspect} onChange={e => setForceAspect(e.target.checked)} />强制保持比例</label><div class="tiny muted">{forceAspect ? '固定所选画幅。例如 16:9 始终输出 16:9，全选县市也不向下扩展。对象越多，内容会越小；可提高清晰度后放大查看。' : '关闭时，合图会按完整内容向下延长。'}</div></div>}
        <div class="row wrap" style={{ gap: 4 }}>{T('date', '历史日期')}{T('season', '赛季名称')}{T('region', '地区名称')}{T('election', '选举名称')}{T('legend', '图例')}{T('source', '资料来源')}{T('version', '分支／版本')}{T('badge', b.kind === 'sim' ? '架空标记（必显）' : '史实／架空标记')}</div>
        {o.season && <input class="input sm" placeholder="赛季名称" value={p.seasonName} onInput={e => setPrefs({ seasonName: e.target.value })} />}
        <div class="row wrap"><span class="small muted">风格</span><Seg value={style} onChange={setStyleKeep} options={[{ id: 'print', name: '打印版（白底黑线）' }, { id: 'glass', name: '展示版（玻璃）' }]} /></div>
        <div class="tiny muted">{style === 'print' ? '打印版：白底、黑字、黑线分隔，不加阴影与磨砂，政党颜色保留。' : '展示版：沿用现有玻璃、圆角与阴影，地图和政党颜色保留。'} 独立页面同时内嵌两版，打印时固定使用打印版。</div>
        <div class="row wrap"><button class="btn primary" onClick={build} disabled={busy}>{busy ? '生成中…' : '生成预览'}</button>{preview && preview.key === key && <button class="btn" disabled={busy} onClick={() => { downloadFile(preview.url, preview.name); toast('PNG 已导出', 'ok'); }}><Icon name="download" size={14} />下载 PNG</button>}<button class="btn" onClick={() => standalone(false)} disabled={busy}><Icon name="doc" size={14} />打开打印／展示页面</button><button class="btn" onClick={() => standalone(true)} disabled={busy}><Icon name="save" size={14} />保存页面 HTML</button></div>
        {preview && preview.key === key && <div class="col"><div class="tiny muted">{preview.style === 'print' ? '打印版' : '展示版'} · {preview.width} × {preview.height} px · {preview.factor.toFixed(2)}×</div><img src={preview.url} style={{ width: '100%', border: preview.style === 'print' ? '1px solid #000' : 'none', borderRadius: preview.style === 'print' ? 0 : 12, boxShadow: preview.style === 'print' ? 'none' : 'var(--shadow-sm)' }} /></div>}
        <div class="tiny muted">选择及内容会随本机存档保留。修改选项、日期或分支后需重新生成预览；架空合图和保存页面均保留架空标记。</div>
        <div class="sep" /><div class="small bold">现场截图</div>
        <div class="row wrap"><button class="btn sm" onClick={() => { shotMode.value = true; toast('纯净展示：按 Esc 或右下角按钮退出'); }}><Icon name="eye" size={13} />纯净全屏展示</button><button class="btn sm" onClick={() => captureLive()}><Icon name="camera" size={13} />导出当前画面</button><button class="btn sm" onClick={() => (regionCapture.value = true)}><Icon name="crop" size={13} />截取指定区域</button></div>
      </div>
    </Panel>
  );
}

// ---------- 现场截图（DOM） ----------
import { signal } from '@preact/signals';
export const regionCapture = signal(false);
export async function captureLive(rect) {
  const wasShot = shotMode.value;
  shotMode.value = true;
  document.body.classList.add('capturing');
  await new Promise(r => setTimeout(r, 380));
  try {
    const dataUrl = await toPng(document.getElementById('app'), { pixelRatio: 2, cacheBust: true, filter: n => !(n.classList?.contains('shot-exit') || n.classList?.contains('region-capture') || n.classList?.contains('toasts')) });
    let out = dataUrl;
    if (rect) {
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = dataUrl; });
      const c = document.createElement('canvas'); c.width = rect.w * 2; c.height = rect.h * 2;
      c.getContext('2d').drawImage(img, rect.x * 2, rect.y * 2, rect.w * 2, rect.h * 2, 0, 0, c.width, c.height);
      out = c.toDataURL('image/png');
    }
    const a = document.createElement('a'); a.href = out; a.download = `台湾政党斗争_截图_${viewDate.value}.png`; a.click();
    toast('截图已导出', 'ok');
  } catch (e) { toast('截图失败：' + e.message, 'error'); }
  document.body.classList.remove('capturing');
  shotMode.value = wasShot;
}
export function RegionCapture() {
  const [r, setR] = useState(null);
  if (!regionCapture.value) return null;
  const down = e => {
    const sx = e.clientX, sy = e.clientY;
    const mv = ev => setR({ x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) });
    const up = async ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      const rect = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) };
      regionCapture.value = false; setR(null);
      if (rect.w > 20 && rect.h > 20) await captureLive(rect);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div class="region-capture" onPointerDown={down} onKeyDown={e => e.key === 'Escape' && (regionCapture.value = false)}>
      <div class="glass glass-strong small" style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px' }}>拖动鼠标框选要截取的区域（按 Esc 取消）</div>
      {r && <div class="rect" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />}
    </div>
  );
}
