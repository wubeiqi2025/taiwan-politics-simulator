// 全部议会／民意机关目录：按层级、年份、名称、存续状态、届次筛选
import { useState, useMemo } from 'preact/hooks';
import { branch, viewDate, openPanel } from '../core/store.js';
import { DB, IDX, instName } from '../core/db.js';
import { instExists, termAt, seatsAt } from '../core/world.js';
import { Panel } from './Panel.jsx';
import { D } from './common.jsx';

const LEVELS = ['全部', '中央', '省', '直轄市', '縣市', '鄉鎮市', '山地原住民區'];
const KIND = { elected: '民选', consultative: '咨询性质', constitutional: '宪政机关' };
export function InstDirectory() {
  const d = viewDate.value;
  const [q, setQ] = useState('');
  const [lv, setLv] = useState('全部');
  const [year, setYear] = useState(d.slice(0, 4));
  const [onlyExist, setOnlyExist] = useState(true);
  const [n, setN] = useState(80);
  const at = year && /^\d{4}$/.test(year) ? (year === d.slice(0, 4) ? d : year + '-07-01') : d;
  const list = useMemo(() => DB.insts.filter(i => {
    if (lv !== '全部' && i.level !== lv) return false;
    if (onlyExist && !instExists(i, at)) return false;
    if (q && !instName(i.id).includes(q) && !(i.town && DB.towns[i.town]?.c.includes(q)) && !(i.region && IDX.unit[i.region]?.name.includes(q))) return false;
    return true;
  }), [q, lv, at, onlyExist]);
  return (
    <Panel id="insts" title="全部议会／民意机关" sub={`${list.length} 个机关 · 以 ${at} 判定`} icon="parliament" pos={{ x: 80, y: 120, w: 400, h: 560 }}>
      <div class="col" style={{ gap: 6 }}>
        <input class="input" placeholder="搜索机关或地区名称" value={q} onInput={e => setQ(e.target.value)} />
        <div class="row wrap" style={{ gap: 4 }}>{LEVELS.map(l => <button class={`btn sm ${lv === l ? 'on' : ''}`} onClick={() => setLv(l)}>{l === '直轄市' ? '直辖市' : l === '縣市' ? '县市' : l === '鄉鎮市' ? '乡镇市' : l === '山地原住民區' ? '原住民区' : l}</button>)}</div>
        <div class="row small"><label class="row" style={{ gap: 4 }}><input type="checkbox" checked={onlyExist} onChange={e => setOnlyExist(e.target.checked)} />仅显示当时存在</label><span class="right muted">年份</span><input class="input sm num" style={{ width: 70 }} value={year} onInput={e => setYear(e.target.value)} /></div>
      </div>
      <div class="list" style={{ marginTop: 6 }}>
        {list.slice(0, n).map(i => {
          const t = termAt(i.id, at);
          const terms = IDX.termsByInst[i.id]?.length || 0;
          const ex = instExists(i, at);
          return (
            <div class="list-item small" onClick={() => openPanel('parliament', { inst: i.id })}>
              <div class="grow">
                <div class="ellipsis"><b>{instName(i.id)}</b> {i.town && <span class="muted tiny">{DB.towns[i.town].c}</span>}</div>
                <div class="tiny muted">{KIND[i.kind]} · {i.level === '縣市' ? '县市' : i.level} · {ex ? (t ? `${t.label || ''} ${t.missing ? '资料待补' : Object.values(t.comp || {}).reduce((a, x) => a + x, 0) + '席'}` : '在任届次资料待补') : '当时不存在'} · 收录{terms}届</div>
              </div>
              {i.pred && <span class="chip tiny" title="有前身机关">承继</span>}
            </div>
          );
        })}
        {list.length > n && <button class="btn sm ghost" onClick={() => setN(n + 150)}>显示更多（{list.length - n}）</button>}
        {!list.length && <div class="empty">没有符合条件的机关</div>}
      </div>
      <div class="tiny muted" style={{ marginTop: 6 }}>说明：国民大会2005年废除；台湾省议会1998年12月改为咨询性质的省咨议会；直辖市一般区与省辖市区不设独立议会；山地原住民区民代表会自2014年12月25日设立。</div>
    </Panel>
  );
}
