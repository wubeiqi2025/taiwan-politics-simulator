// 将原始资料（中选会、立法院、维基、人工整理）整理为网站使用的数据文件
import fs from 'node:fs';
import { feature } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import * as C from './curated.mjs';
import { parse as parseWikiMayors } from './parse-wiki-mayors.mjs';

const OUT = 'src/data';
fs.mkdirSync(OUT, { recursive: true });
const N = s => (s || '').replace(/台/g, '臺').trim();
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

// ---------- 地图与乡镇 ----------
// 适度简化边界（约保留六成节点），减轻缩放时的绘制负担
const topo = (() => { const t = presimplify(JSON.parse(fs.readFileSync('raw/towns-10t.json', 'utf8'))); const s = simplify(t, quantile(t, 0.55)); const r = v => Math.round(v * 1e5) / 1e5; if (!s.transform) s.arcs = s.arcs.map(a => a.map(p => [r(p[0]), r(p[1])])); return s; })();
delete topo.objects.nation;
delete topo.objects.counties;
const towns = {};          // code -> {c, n, hist, mtn}
const townByCountyName = {}; // '臺中市|豐原區' -> code
for (const g of topo.objects.towns.geometries) {
  const p = g.properties;
  const c = N(p.COUNTYNAME), n = N(p.TOWNNAME), code = p.TOWNCODE;
  g.id = code;
  g.properties = { c, n };
  townByCountyName[c + '|' + n] = code;
  const hist = [];
  const pre = C.MERGE_PRE_NAMES[c]?.[n];
  const ch = C.TOWN_CHANGES[c + '|' + n];
  if (ch) for (const [d, name, prec, note] of ch) hist.push([d, name, prec || 'd', note || '']);
  else if (pre) hist.push(['1986-01-01', pre, 'd', '']);
  const mergeDate = { 新北市: '2010-12-25', 臺中市: '2010-12-25', 臺南市: '2010-12-25', 高雄市: '2010-12-25', 桃園市: '2014-12-25' }[c];
  if (mergeDate && (pre || ch) && !/區$/.test(hist[0]?.[1] || '') ) hist.push([mergeDate, n, 'd', '']);
  if (c === '臺南市' && n === '中西區') hist.length = 1;
  towns[code] = { c, n, hist, mtn: C.MOUNTAIN_DISTRICTS.includes(c + '|' + n) || undefined };
}
// 现代县市 → 乡镇代码
const modernTowns = {};
for (const [code, t] of Object.entries(towns)) (modernTowns[t.c] ||= []).push(code);
// 历史县市单位 → 乡镇代码
const units = C.UNITS.map(u => ({ ...u }));
for (const u of units) {
  const all = modernTowns[u.modern];
  if (u.towns === 'ALL') u.towns = all;
  else if (Array.isArray(u.towns)) u.towns = u.towns.map(n => townByCountyName[u.modern + '|' + n]);
}
for (const u of units) if (u.towns === 'REST') {
  const taken = new Set(units.filter(x => x.modern === u.modern && Array.isArray(x.towns) && x.id !== u.id && x.towns.length < modernTowns[u.modern].length).flatMap(x => x.towns));
  u.towns = modernTowns[u.modern].filter(c => !taken.has(c));
}
const unitById = Object.fromEntries(units.map(u => [u.id, u]));
function unitByName(name, date) {
  name = N(name);
  let m = units.filter(u => u.name === name && inRange(date, u.from, u.to));
  // 改制前举行、改制后就任的选举（如2010年五都、2014年桃园）归属新单位
  const later = units.filter(u => u.name === name && u.from && u.from > date && u.from <= addDays(date, 90));
  if (later.length === 1) m = later;
  if (m.length !== 1) throw new Error(`单位无法识别 ${name} ${date} ${m.length}`);
  return m[0].id;
}
const stem = n => n.replace(/(鄉|鎮|市|區)$/, '');
function townCode(unitId, name) {
  const u = unitById[unitId];
  name = N(name);
  if (unitId === 'KHH_X' && /^三民/.test(name)) return townByCountyName['高雄市|那瑪夏區'];
  if (unitId === 'CYQ' && /^吳鳳/.test(name)) return townByCountyName['嘉義縣|阿里山鄉'];
  if (unitId === 'TNN_C' && (name === '中區' || name === '西區')) return townByCountyName['臺南市|中西區'];
  const s = stem(name);
  const hit = u.towns.filter(c => stem(towns[c].n) === s);
  if (hit.length === 1) return hit[0];
  throw new Error(`乡镇无法识别 ${unitId} ${name} (${hit.length})`);
}

// ---------- 政党 ----------
const parties = C.PARTIES.map(p => ({ ...p }));
const partyAlias = {};
for (const p of parties) for (const a of p.aliases) partyAlias[a] = p.id;
let autoParty = 0;
function partyId(name) {
  name = (name || '').trim();
  if (!name) return 'IND';
  if (partyAlias[name]) return partyAlias[name];
  const id = 'P' + (++autoParty);
  const hue = (autoParty * 47) % 360;
  parties.push({ id, name, short: name.replace(/黨$/, '党'), color: `hsl(${hue} 25% 58%)`, founded: null, order: 45, aliases: [name], minor: true, verified: false });
  partyAlias[name] = id;
  return id;
}

// ---------- 人物 ----------
const people = [];             // {id, n, b, sex, pic, src}
const personKey = {};          // name|birth -> id
const personByName = {};       // name -> [ids]
function person(name, birth, extra = {}) {
  name = (name || '').trim();
  if (!name) return null;
  const key = name + '|' + (birth || '');
  if (personKey[key]) { const p = people[personKey[key]]; Object.assign(p, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && p[k(v)] == null))); return p.id; }
  if (!birth) {
    // 无出生年：若同名者只有一人，视为同一人（标记推定）
    const ids = personByName[name] || [];
    if (ids.length === 1) return ids[0];
  }
  const id = 'p' + people.length;
  people.push({ id, n: name, b: birth || undefined, ...extra });
  personKey[key] = people.length - 1;
  (personByName[name] ||= []).push(id);
  return id;
}
function k(v) { return v; }
const pIdx = id => +id.slice(1);

// ---------- 读取中选会 ----------
const man = JSON.parse(fs.readFileSync('raw/cec-manifest.json', 'utf8'));
function rd(subject, legis, theme, kind, level, code = '00_000_00_000_0000') {
  const f = `raw/cec/data__${kind}__ELC__${subject}__${legis}__${theme}__${level}__${code}.json`;
  if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return j ? Object.values(j).flat() : null;
}
const countyName = {}; // 'prv_city@date' 不同年代编码可能不同，由 profiles C 名称决定
const elections = [];  // 选举索引
const results = {};    // id -> 详细结果
const execs = [];      // 县市首长任期
const townExecs = [];  // 乡镇市长／原住民区长
const terms = [];      // 民意机关届次

const START = {
  P0: d => ({ 1996: '1996-05-20', 2000: '2000-05-20', 2004: '2004-05-20', 2008: '2008-05-20', 2012: '2012-05-20', 2016: '2016-05-20', 2020: '2020-05-20', 2024: '2024-05-20' })[d.slice(0, 4)],
  C1: d => d.slice(0, 4) + '-12-25',
  C2: d => (+d.slice(0, 4) >= 2014 ? d.slice(0, 4) + '-12-25' : d.slice(0, 4) + '-12-20'),
  T1: d => d.slice(0, 4) + '-12-25',
  T2: d => ({ '1998-01-24': '1998-03-01', '2002-01-26': '2002-03-01', '2005-12-03': '2006-03-01', '2009-12-05': '2010-03-01' })[d] || d.slice(0, 4) + '-12-25',
  D2: d => ({ '1998-01-24': '1998-03-01', '2002-01-26': '2002-03-01', '2005-12-03': '2006-03-01', '2009-12-05': '2009-12-20' })[d] || d.slice(0, 4) + '-12-25',
  D1: d => d.slice(0, 4) + '-12-25',
  R1: d => d.slice(0, 4) + '-12-25',
  R2: d => (d === '2010-06-12' ? '2010-08-01' : d.slice(0, 4) + '-12-25'),
  L0: d => ({ '1995-12-02': '1996-02-01', '1998-12-05': '1999-02-01', '2001-12-01': '2002-02-01', '2004-12-11': '2005-02-01', '2008-01-12': '2008-02-01', '2012-01-14': '2012-02-01', '2016-01-16': '2016-02-01', '2020-01-11': '2020-02-01', '2024-01-13': '2024-02-01' })[d],
  N0: d => (d === '1996-03-23' ? '1996-05-20' : '2005-05-30'),
};
const fixStart = (s, d) => (s === '2022-12-25' && d === '2022-12-18' ? '2022-12-25' : s);

function candRows(rows) {
  // 合并正副候选人，返回候选人列表（按号次）
  const by = new Map();
  for (const r of rows) {
    const key = r.cand_no;
    if (!by.has(key)) by.set(key, { no: r.cand_no });
    const c = by.get(key);
    if (r.is_vice === 'Y') c.vice = r.cand_name;
    else Object.assign(c, { name: r.cand_name, party: partyId(r.party_name), birth: r.cand_birthyear, sex: r.cand_sex, win: r.is_victor === '*' || r.is_victor === '!' });
  }
  return [...by.values()].filter(c => c.name);
}
function groupBy(rows, f) { const m = new Map(); for (const r of rows || []) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }
const cc = r => `${r.prv_code}_${r.city_code}`;
const prof = r => r ? { valid: r.valid_ticket, invalid: r.invalid_ticket, voters: r.vote_ticket, electorate: r.votable_population, turnout: r.vote_to_elect } : null;

// 选举类型中文
const TYPE = { P0: 'president', L0: 'ly', C1: 'mayor', C2: 'mayor', T1: 'council', T2: 'council', D1: 'township', D2: 'township', R1: 'townrep', R2: 'townrep', N0: 'na' };

// 每个主题组（同一日期同一类别）合并为一个选举
const groups = groupBy(man, e => e.subject + '|' + e.date);
for (const [, list] of groups) {
  const e0 = list[0];
  const { subject: S, date } = e0;
  const yr = date.slice(0, 4);
  const id = `${S}-${date}`;
  const start = fixStart(START[S](date), date);
  const el = { id, date, type: TYPE[S], subject: S, name: e0.name.replace(/\(.*\)/, ''), start, src: 'cec' };
  const res = { id };

  if (S === 'P0') {
    const t = e0.theme;
    const nRows = rd(S, '00', t, 'tickets', 'N');
    const cands = candRows(nRows);
    res.cands = cands.map(c => ({ name: c.name, vice: c.vice, party: c.party, win: c.win, pid: person(c.name, c.birth, { sex: c.sex }), vpid: person(c.vice, null) }));
    const tot = {}; for (const r of nRows) if (r.is_vice !== 'Y') tot[r.cand_no] = r.ticket_num;
    res.national = { votes: cands.map(c => tot[c.no]), ...prof(rd(S, '00', t, 'profiles', 'N')?.[0]) };
    const cRows = rd(S, '00', t, 'tickets', 'C');
    const cProf = rd(S, '00', t, 'profiles', 'C') || [];
    res.byUnit = {};
    for (const [code, rows] of groupBy(cRows.filter(r => r.is_vice !== 'Y'), cc)) {
      const u = unitByName(rows[0].area_name, date);
      countyName[code + '@' + date] = u;
      const p = cProf.find(x => cc(x) === code);
      res.byUnit[u] = { votes: cands.map(c => rows.find(r => r.cand_no === c.no)?.ticket_num || 0), ...prof(p) };
    }
    res.byTown = {};
    for (const code of Object.keys(groupBy(cRows, cc))) {
      const u = countyName[code + '@' + date];
      const rows = rd(S, '00', t, 'tickets', 'D', code + '_00_000_0000') || [];
      for (const [, tr] of groupBy(rows.filter(r => r.is_vice !== 'Y'), r => r.dept_code)) {
        const tc = townCode(u, tr[0].area_name);
        const prev = res.byTown[tc];
        const v = cands.map(c => tr.find(r => r.cand_no === c.no)?.ticket_num || 0);
        res.byTown[tc] = prev ? { votes: prev.votes.map((x, i) => x + v[i]) } : { votes: v };
      }
    }
    el.office = 'president';
  }

  if (S === 'C1' || S === 'C2') {
    const t = e0.theme;
    const cRows = rd(S, '00', t, 'tickets', 'C') || [];
    const cProf = rd(S, '00', t, 'profiles', 'C') || [];
    res.races = {};
    for (const [code, rows] of groupBy(cRows, cc)) {
      const u = unitByName(rows[0].area_name, date);
      const cands = candRows(rows).map(c => ({ name: c.name, party: c.party, win: c.win, votes: rows.find(r => r.cand_no === c.no && r.is_vice !== 'Y').ticket_num, pid: person(c.name, c.birth, { sex: c.sex }) }));
      const race = { cands, ...prof(cProf.find(x => cc(x) === code)), byTown: {} };
      const tRows = rd(S, '00', t, 'tickets', 'D', code + '_00_000_0000') || [];
      for (const [, tr] of groupBy(tRows, r => r.dept_code)) {
        try {
          const tc = townCode(u, tr[0].area_name);
          race.byTown[tc] = { votes: cands.map(c => tr.find(r => r.cand_name === c.name)?.ticket_num || 0) };
        } catch { }
      }
      res.races[u] = race;
      const w = cands.find(c => c.win);
      if (w) execs.push({ u, p: w.pid, party: w.party, from: start, how: '民选', el: id });
    }
    el.office = 'mayor';
  }

  if (S === 'L0') {
    res.districts = [];
    for (const e of list) {
      const t = e.theme;
      if (e.legis === 'L1') {
        for (const cnt of e.counties) {
          const rows = rd(S, 'L1', t, 'tickets', 'A', cnt) || [];
          const profs = rd(S, 'L1', t, 'profiles', 'A', cnt) || [];
          const pfC = rd(S, 'L1', t, 'profiles', 'C') || [];
          const cname = pfC.find(x => cc(x) === cnt.slice(0, 6))?.area_name;
          const u = unitByName(cname, date);
          for (const [area, ar] of groupBy(rows, r => r.area_code)) {
            const cands = candRows(ar).map(c => ({ name: c.name, party: c.party, win: c.win, votes: ar.find(r => r.cand_no === c.no).ticket_num, pid: person(c.name, c.birth, { sex: c.sex }) }));
            const d = { k: `${u}-${area}`, u, name: ar[0].area_name, kind: '区域', seats: cands.filter(c => c.win).length, cands, ...prof(profs.find(p => p.area_code === area)), towns: [], byTown: {} };
            const dRows = (rd(S, 'L1', t, 'tickets', 'D', cnt) || []).filter(r => r.area_code === area);
            for (const [, tr] of groupBy(dRows, r => r.dept_code)) {
              let tc; try { tc = townCode(u, tr[0].area_name); } catch { continue; }
              if (!d.towns.includes(tc)) d.towns.push(tc);
              const v = cands.map(c => tr.find(r => r.cand_name === c.name)?.ticket_num || 0);
              d.byTown[tc] = d.byTown[tc] ? { votes: d.byTown[tc].votes.map((x, i) => x + v[i]) } : { votes: v };
            }
            res.districts.push(d);
          }
        }
      } else if (e.legis === 'L2' || e.legis === 'L3') {
        const rows = rd(S, e.legis, t, 'tickets', 'N') || [];
        const cands = candRows(rows).map(c => ({ name: c.name, party: c.party, win: c.win, votes: rows.find(r => r.cand_no === c.no).ticket_num, pid: person(c.name, c.birth, { sex: c.sex }) }));
        res.districts.push({ k: e.legis, u: null, name: e.legis === 'L2' ? '平地原住民' : '山地原住民', kind: e.desc, seats: cands.filter(c => c.win).length, cands, ...prof(rd(S, e.legis, t, 'profiles', 'N')?.[0]) });
      } else if (e.legis === 'L4') {
        const rows = rd(S, 'L4', t, 'tickets', 'N') || [];
        const list4 = rows.map(r => ({ party: partyId(r.party_name), votes: r.ticket_num, pct: r.ticket_percent }));
        const byUnit = {};
        for (const [code, cr] of groupBy(rd(S, 'L4', t, 'tickets', 'C') || [], cc)) {
          const u = unitByName(cr[0].area_name, date);
          byUnit[u] = { votes: list4.map(p => cr.find(r => partyId(r.party_name) === p.party)?.ticket_num || 0) };
          const tRows = rd(S, 'L4', t, 'tickets', 'D', code + '_00_000_0000') || [];
          for (const [, tr] of groupBy(tRows, r => r.dept_code)) {
            try { const tc = townCode(u, tr[0].area_name); (res.partyByTown ||= {})[tc] = { votes: list4.map(p => tr.find(r => partyId(r.party_name) === p.party)?.ticket_num || 0) }; } catch { }
          }
        }
        res.partyList = { parties: list4.map(p => p.party), national: { votes: list4.map(p => p.votes) }, seats: rows.map(r => r.elected_num || 0), byUnit, ...prof(rd(S, 'L4', t, 'profiles', 'N')?.[0]) };
      }
    }
    el.inst = 'LY';
  }

  if (S === 'T1' || S === 'T2' || S === 'R1' || S === 'R2' || S === 'N0') {
    // 议员／代表：按县市汇整当选人
    const byInst = {};
    res.districts = [];
    for (const e of list) {
      const t = e.theme;
      const level = e.tk[0];
      const pfC = rd(S, e.legis, t, 'profiles', 'C') || [];
      const sources = level === 'A' ? (e.counties || []).map(c => [c, rd(S, e.legis, t, 'tickets', 'A', c) || [], rd(S, e.legis, t, 'profiles', 'A', c) || []])
        : [['00_000', rd(S, e.legis, t, 'tickets', level) || [], []]];
      for (const [cnt, rows, profs] of sources) {
        for (const [key, ar] of groupBy(rows, r => cc(r) + '|' + r.area_code + '|' + (r.dept_code || '000'))) {
          const r0 = ar[0];
          let u = null, tc = null;
          const cname = pfC.find(x => cc(x) === cc(r0))?.area_name || (level === 'C' ? r0.area_name : null);
          if (cname && cname !== '全國') { try { u = unitByName(cname, date); } catch { } }
          const pf = profs.find(p => p.area_code === r0.area_code && (p.dept_code === r0.dept_code || r0.dept_code === '000'));
          if (S === 'R1' || S === 'R2') {
            const tname = (pf?.area_name || r0.area_name).replace(/第\d+選舉區.*$/, '').replace(/(平地|山地)原住民.*$/, '');
            const dept = pf?.dept_code || r0.dept_code;
            try { tc = townCode(u, tname); } catch { const hit = u && unitById[u].towns.find(c => c.endsWith(dept)); tc = hit || null; }
            if (!tc) continue;
          }
          const cands = candRows(ar).map(c => ({ name: c.name, party: c.party, win: c.win, votes: ar.find(r => r.cand_no === c.no && r.is_vice !== 'Y')?.ticket_num, pid: c.win || S === 'N0' ? person(c.name, c.birth, { sex: c.sex }) : undefined }));
          const instId = S === 'N0' ? 'NA' : (S === 'R1' || S === 'R2') ? 'R:' + tc : 'C:' + u;
          const d = { k: key, inst: instId, u, t: tc, name: (pf?.area_name || r0.area_name), kind: e.desc || '', seats: cands.filter(c => c.win).length, cands, ...prof(pf) };
          if (S === 'T1' || S === 'T2' || S === 'N0') res.districts.push(d);
          else (res.towns ||= {}), (res.towns[tc] ||= []).push(d);
          const b = (byInst[instId] ||= []);
          for (const c of cands.filter(c => c.win)) b.push([c.pid, c.party, d.name]);
        }
      }
    }
    for (const [inst, members] of Object.entries(byInst)) {
      const comp = {}; for (const m of members) comp[m[1]] = (comp[m[1]] || 0) + 1;
      terms.push({ inst, from: start, comp, members, el: id, src: 'cec' });
    }
    if (S === 'N0' && date === '2005-05-14') {
      const rows = rd(S, '00', e0.theme, 'tickets', 'N') || [];
      res.partyList = { parties: rows.map(r => partyId(r.party_name)), national: { votes: rows.map(r => r.ticket_num) } };
      const seat = {}; for (const r of rows) if (r.elected_num) seat[partyId(r.party_name)] = (seat[partyId(r.party_name)] || 0) + r.elected_num;
      res.partyList.seats = seat;
      const t = terms.find(x => x.inst === 'NA' && x.el === id);
      if (t) Object.assign(t, { comp: seat, to: '2005-06-10', label: '任務型國大', note: '依政党比例代表制选出300席，仅为复决第七次修宪案召集，2005年6月7日完成复决。' });
      else terms.push({ inst: 'NA', from: start, to: '2005-06-10', label: '任務型國大', comp: seat, members: [], el: id, src: 'cec', note: '依政党比例代表制选出300席，仅为复决修宪案召集。' });
    }
    if (S === 'N0' && date === '1996-03-23') {
      const t = terms.find(x => x.inst === 'NA' && x.el === id);
      Object.assign(t, { n: 3, label: '第3屆', to: '2000-05-19', comp: { KMT: 183, DPP: 99, NP: 46, IND: 6 }, compSrc: 'wiki', note: '席次合计334席（含全国不分区与侨选，“无党籍”项合并其他小党6席，待核）；成员名单仅含中选会资料库收录的区域当选人。' });
    }
    el.inst = S === 'N0' ? 'NA' : S[0] === 'T' ? 'county-councils' : 'town-councils';
  }

  if (S === 'D1' || S === 'D2') {
    const t = e0.theme;
    const pfC = rd(S, '00', t, 'profiles', 'C') || [];
    res.towns = {};
    for (const cnt of e0.counties || []) {
      const rows = rd(S, '00', t, 'tickets', 'D', cnt) || [];
      const u = unitByName(pfC.find(x => cc(x) === cnt.slice(0, 6)).area_name, date);
      for (const [, tr] of groupBy(rows, r => r.dept_code)) {
        let tc; try { tc = townCode(u, tr[0].area_name); } catch (err) { console.warn(err.message); continue; }
        const cands = candRows(tr).map(c => ({ name: c.name, party: c.party, win: c.win, votes: tr.find(r => r.cand_no === c.no).ticket_num, pid: person(c.name, c.birth, { sex: c.sex }) }));
        res.towns[tc] = { cands };
        const w = cands.find(c => c.win);
        if (w) townExecs.push({ t: tc, u, p: w.pid, party: w.party, from: start, el: id });
      }
    }
    el.office = 'township';
  }

  elections.push(el);
  results[id] = res;
}

// ---------- 1985/1989/1993 县市长（维基） ----------
for (const y of [1985, 1989, 1993]) {
  const date = { 1985: '1985-11-16', 1989: '1989-12-02', 1993: '1993-11-27' }[y];
  const start = y + '-12-20';
  const id = `C2-${date}`;
  const res = { id, races: {} };
  for (const r of parseWikiMayors(`raw/wiki/${y}年中華民國縣市長選舉.txt`)) {
    let u; try { u = unitByName(r.region, date); } catch { console.warn('wiki unit', r.region); continue; }
    const cands = r.cands.map(c => ({ name: c.name, party: c.party, win: c.win, votes: c.votes, pid: person(c.name, null) }));
    res.races[u] = { cands };
  }
  for (const [u, [name, party]] of Object.entries(C.MAYOR_FIX[y] || {})) if (!res.races[u]) res.races[u] = { cands: [{ name, party, win: true, votes: null, pid: person(name, null) }], partial: true };
  for (const [u, race] of Object.entries(res.races)) {
    const w = race.cands.find(c => c.win);
    if (w) execs.push({ u, p: w.pid, party: w.party, from: start, how: '民选', el: id });
  }
  elections.push({ id, date, type: 'mayor', subject: 'C2', name: `${y}年縣市長選舉`, start, src: 'wiki', office: 'mayor', verified: false });
  results[id] = res;
}

// ---------- 早期选举摘要 ----------
for (const e of C.EARLY_ELECTIONS) {
  elections.push({ id: e.id, date: e.date, type: e.type, name: e.name, inst: e.inst, src: e.src, note: e.note, verified: false, summary: true, office: e.exec });
  results[e.id] = { id: e.id, seats: e.seats, partyVotes: e.votes, turnout: e.turnout, cands: e.cands?.map(([name, party, votes, pct, win]) => ({ name, party, votes, pct, win, pid: person(name, null) })) };
}

// ---------- 直辖市长官派、代理、补选 ----------
for (const [u, name, party, from, to, how, note, prec] of C.EXTRA_EXEC) execs.push({ u, p: name ? person(name, null) : null, party, from, to, how, note, prec, src: 'wiki', verified: false });

// 首长任期结束日：同一单位下一任开始前一日或单位存续结束
function closeTerms(list, keyF, endOf) {
  const by = groupBy(list, keyF);
  for (const [k, arr] of by) {
    arr.sort((a, b) => a.from.localeCompare(b.from));
    // 将显式给出终止日期的“代理”记录插入：普通任期遇到代理时截断
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.to) continue;
      const nxt = arr.slice(i + 1).find(b => b.from > a.from);
      a.to = nxt ? addDays(nxt.from, -1) : endOf(k, a);
    }
  }
}
const unitEnd = u => unitById[u]?.to || null;
const PLANNED_END = { '2022-12-25': '2026-12-24' };
closeTerms(execs, e => e.u, (u, a) => unitEnd(u) || PLANNED_END[a.from] || null);
// 代理任期覆盖原任期：将原任期在代理开始前截断，并在代理结束后不再延续（由下一笔民选资料接续）
execs.sort((a, b) => a.u.localeCompare(b.u) || a.from.localeCompare(b.from));
for (const a of execs) for (const b of execs) if (a !== b && a.u === b.u && b.from > a.from && b.from <= a.to && a.how !== '官派') a.to = addDays(b.from, -1);
for (const e of execs) if (unitEnd(e.u) && e.to > unitEnd(e.u)) e.to = unitEnd(e.u);
closeTerms(townExecs, e => e.t, (t, a) => {
  const u = unitById[a.u]; return u?.to || PLANNED_END[a.from] || null;
});
for (const e of townExecs) { const ue = unitById[e.u]?.to; if (ue && e.to > ue) e.to = ue; }

// ---------- 立法院（立法院开放资料） ----------
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const lyRows = parseCSV(fs.readFileSync('raw/ly16.csv', 'utf8').replace(/^﻿/, ''));
const H = lyRows[0];
const LY_TERMS = { 2: ['1993-02-01', '1996-01-31', 'LY-1992'], 3: ['1996-02-01', '1999-01-31', 'L0-1995-12-02'], 4: ['1999-02-01', '2002-01-31', 'L0-1998-12-05'], 5: ['2002-02-01', '2005-01-31', 'L0-2001-12-01'], 6: ['2005-02-01', '2008-01-31', 'L0-2004-12-11'], 7: ['2008-02-01', '2012-01-31', 'L0-2008-01-12'], 8: ['2012-02-01', '2016-01-31', 'L0-2012-01-14'], 9: ['2016-02-01', '2020-01-31', 'L0-2016-01-16'], 10: ['2020-02-01', '2024-01-31', 'L0-2020-01-11'], 11: ['2024-02-01', '2028-01-31', 'L0-2024-01-13'] };
// 立委当选人姓名 → 人物（按届次对应的选举）
const lyWinnerByName = {};
for (const [, [, , elId]] of Object.entries(LY_TERMS)) {
  const r = results[elId];
  for (const d of r?.districts || []) for (const c of d.cands) if (c.win) (lyWinnerByName[elId + c.name] = c.pid);
}
const lyMembers = {};
for (const r of lyRows.slice(1)) {
  const o = Object.fromEntries(H.map((h, i) => [h, r[i]]));
  const n = +o.term;
  if (!LY_TERMS[n] || !o.name) continue;
  const [from, to, elId] = LY_TERMS[n];
  const name = o.name.trim();
  let pid = lyWinnerByName[elId + name];
  if (!pid) pid = person(name, null);
  const p = people[pIdx(pid)];
  if (o.picUrl) p.pic = o.picUrl.replace('http://www.ly.gov.tw//', 'https://www.ly.gov.tw/');
  if (o.ename && !p.en) p.en = o.ename;
  if (o.sex && !p.sex) p.sex = o.sex === '男' ? '1' : '2';
  const on = o.onboardDate.replace(/\//g, '-') || from;
  const off = o.leaveFlag === '是' && o.leaveDate ? addDays(o.leaveDate.replace(/\//g, '-'), -1) : to;
  (lyMembers[n] ||= []).push([pid, partyId(o.party), N(o.areaName), on, off, o.leaveReason || undefined]);
}
for (const [n, [from, to, elId]] of Object.entries(LY_TERMS)) {
  const members = lyMembers[n] || [];
  const comp = {}; for (const m of members) if (m[3] <= from && m[4] >= from) comp[m[1]] = (comp[m[1]] || 0) + 1;
  terms.push({ inst: 'LY', n: +n, label: `第${n}屆`, from, to, comp, members, el: elId, src: 'ly', seatsTotal: Object.values(comp).reduce((a, b) => a + b, 0) });
}

// ---------- 早期届次 ----------
for (const t of C.EARLY_TERMS) {
  if (t.useCec) {
    const cecTerm = terms.find(x => x.inst === t.inst && x.from.startsWith(String(t.useCec)));
    if (cecTerm) { Object.assign(cecTerm, { n: t.n, label: t.label, to: t.to, note: '中选会资料：' + JSON.stringify(t.comp) }); continue; }
  }
  terms.push({ ...t, src: t.src, verified: false, el: t.electionId });
}

// ---------- 民意机关清单 ----------
const insts = [
  { id: 'LY', name: '立法院', level: '中央', kind: 'elected', from: null, to: null, note: '1992年前包含未改选之资深立委；2008年起113席。' },
  { id: 'NA', name: '國民大會', level: '中央', kind: 'elected', from: null, to: '2005-06-10', note: '2000年修宪后改为任务型，平时不设代表；2005年第七次修宪后废除。' },
  { id: 'TPA', name: '臺灣省議會', level: '省', kind: 'elected', from: null, to: '1998-12-20' },
  { id: 'TPCA', name: '臺灣省諮議會', level: '省', kind: 'consultative', from: '1998-12-21', to: '2018-12-31', note: '咨询性质，咨议员由行政院长提请总统任命，并非民选议会；成员资料待补。' },
  { id: 'CY', name: '監察院', level: '中央', kind: 'constitutional', from: null, to: null, note: '1993年以前监察委员由省市议会选举产生；1993年起改由总统提名、立法院（1992—2000年为国民大会）同意。不属民选议会，不提供议员席位图。' },
];
for (const u of units) insts.push({ id: 'C:' + u.id, name: u.name + '議會', level: u.type === '直轄市' ? '直轄市' : '縣市', kind: 'elected', region: u.id, from: u.from, to: u.to, pred: u.pred?.map(x => 'C:' + x), succ: u.succ ? 'C:' + u.succ : undefined });
// 乡镇市民代表会与山地原住民区民代表会
for (const [code, t] of Object.entries(towns)) {
  const u = units.filter(x => x.towns.includes(code));
  const muniFrom = u.find(x => x.type === '直轄市' && x.from)?.from;
  const countyUnit = u.find(x => x.type !== '直轄市' || !x.from);
  if (u.length === 1 && u[0].type === '直轄市' && u[0].id !== 'TPE' && u[0].id !== 'KHH') { /* noop */ }
  const isMuniOnly = ['TPE', 'KHH_C'].some(id => unitById[id].towns.includes(code)) || ['臺中市', '臺南市'].includes(t.c) && unitById[t.c === '臺中市' ? 'TXG_C' : 'TNN_C'].towns.includes(code) || ['基隆市', '新竹市', '嘉義市'].includes(t.c);
  if (isMuniOnly) continue; // 省辖市／直辖市原辖区不设代表会
  const to = t.mtn ? null : (muniFrom ? addDays(muniFrom, -1) : null);
  insts.push({ id: 'R:' + code, name: '民代表會', level: t.mtn ? '山地原住民區' : '鄉鎮市', kind: 'elected', town: code, from: null, to, gap: t.mtn && muniFrom ? [muniFrom, '2014-12-24'] : undefined });
}

// 县市议会届次闭合
const instById = Object.fromEntries(insts.map(i => [i.id, i]));
for (const t of terms) if (!instById[t.inst]) console.warn('未知机关', t.inst);
closeTerms(terms.filter(t => !t.to), t => t.inst, (inst, a) => instById[inst]?.to || PLANNED_END[a.from] || ({ '2010-08-01': '2014-12-24' })[a.from] || null);
for (const t of terms) { const i = instById[t.inst]; if (i?.to && t.to > i.to) t.to = i.to; }
// 早期县市议会（1986—1998）占位：资料待补
for (const u of units) {
  if (u.to && u.to < '1998-03-01') continue;
  if (u.type === '直轄市') continue;
  const has = terms.some(t => t.inst === 'C:' + u.id && t.from < '1998-03-01');
  if (has) continue;
  for (const [n, from, to] of [[10, '1982-03-01', '1986-02-28'], [11, '1986-03-01', '1990-02-28'], [12, '1990-03-01', '1994-02-28'], [13, '1994-03-01', '1998-02-28']])
    terms.push({ inst: 'C:' + u.id, n, label: `第${n}屆`, from, to, comp: null, members: [], missing: true, note: '该届议员名单与党派席次资料待补（中选会资料库未收录1998年以前县市议员选举）。' });
}

// ---------- 事件 ----------
const events = C.EVENTS.map(([date, title, cat, imp, desc, ppl, pts, regions, effects, src, prec, el, planned], i) => ({
  id: 'h' + i, date, title, cat, imp, desc, people: ppl.map(n => person(n, null)), parties: pts, regions, effects, src, prec: prec || 'd', el: el || undefined, planned: planned || undefined, kind: 'real',
}));
// 自动事件：选举投票与就任、届次开始、政党成立
const PN = Object.fromEntries(parties.map(p => [p.id, p.short]));
for (const el of elections) {
  if (events.some(e => e.date === el.date && e.cat === '选举' && e.el === el.id)) continue;
  const same = events.find(e => e.date === el.date && e.cat === '选举' && !e.el && !e.auto);
  if (same) { same.el = same.el || el.id; same.els = [...(same.els || []), el.id]; continue; }
  const ex = events.find(e => e.date === el.date && e.auto === 'vote');
  if (ex) { ex.els.push(el.id); ex.title = ex.title.replace(/投票$/, '') + '、' + el.name.replace(/^\d+年/, '') + '投票'; continue; }
  events.push({ id: 'v' + el.id, date: el.date, title: el.name + '投票', cat: '选举', imp: el.type === 'president' || el.type === 'ly' ? 3 : el.type === 'mayor' ? 2 : 1, desc: '', people: [], parties: [], regions: [], effects: [], src: el.src, prec: 'd', el: el.id, els: [el.id], kind: 'real', auto: 'vote' });
}
for (const el of elections) for (const e of events) if (e.el === el.id && !e.els) e.els = [el.id];
// 县市长就任事件（按日期合并）
const execStarts = groupBy(execs.filter(e => e.how === '民选'), e => e.from);
for (const [date, list] of execStarts) {
  events.push({ id: 'x' + date, date, title: `${list.length}位县市长就职`, cat: '人事', imp: 1, desc: list.map(e => unitById[e.u].name + '：' + (people[pIdx(e.p)]?.n || '') + `（${PN[e.party] || ''}）`).join('；'), people: list.map(e => e.p), parties: [], regions: list.map(e => e.u), effects: list.map(e => ({ t: 'exec:' + e.u, v: e.p, party: e.party })), src: 'cec', prec: 'd', kind: 'real', auto: 'inaug' });
}
for (const e of execs.filter(e => e.how !== '民选' && e.p)) {
  events.push({ id: 'xe' + e.u + e.from, date: e.from, title: `${unitById[e.u].name}首长异动：${people[pIdx(e.p)].n}${e.how}`, cat: '人事', imp: 1, desc: e.note || '', people: [e.p], parties: [e.party], regions: [e.u], effects: [{ t: 'exec:' + e.u, v: e.p, party: e.party }], src: 'wiki', prec: e.prec || 'd', kind: 'real', auto: 'exec' });
}
// 届次开始（立法院、国大、省议会）
for (const t of terms.filter(t => ['LY', 'NA', 'TPA'].includes(t.inst))) {
  if (t.from < '1986-01-02') continue;
  events.push({ id: 'tm' + t.inst + t.from, date: t.from, title: `${instById[t.inst].name}${t.label || ''}就职`, cat: '制度', imp: t.inst === 'LY' ? 2 : 1, desc: t.comp ? Object.entries(t.comp).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${PN[p] || p} ${n}`).join('、') : '', people: [], parties: [], regions: [], effects: [{ t: 'inst:' + t.inst }], src: t.src, prec: 'd', kind: 'real', auto: 'term' });
}
// 地方议会换届（合并为一则）
const localTerms = groupBy(terms.filter(t => t.inst.startsWith('C:') && t.from >= '1986-01-02' && !t.missing), t => t.from);
for (const [date, list] of localTerms) events.push({ id: 'tc' + date, date, title: `${list.length}个县市议会新届就职`, cat: '制度', imp: 1, desc: '', people: [], parties: [], regions: list.map(t => t.inst.slice(2)), effects: list.map(t => ({ t: 'inst:' + t.inst })), src: 'cec', prec: 'd', kind: 'real', auto: 'term' });
// 总统等中央职务交替
for (const [office, o] of Object.entries(C.NATIONAL_OFFICES)) for (const [name, party, from] of o.list) {
  if (from < '1986-01-02' || !name) continue;
  if (events.some(e => e.date === from && e.effects.some(x => x.t === 'office:' + office))) continue;
  events.push({ id: 'o' + office + from, date: from, title: `${name}就任${o.name}`, cat: '人事', imp: office === 'president' ? 3 : office === 'premier' ? 2 : 1, desc: '', people: [person(name, null)], parties: [party], regions: [], effects: [{ t: 'office:' + office, v: name }], src: 'common', prec: 'd', kind: 'real', auto: 'office' });
}
events.sort((a, b) => a.date.localeCompare(b.date) || b.imp - a.imp);

// ---------- 输出 ----------
// 中央职务姓名 → 人物
const offices = Object.fromEntries(Object.entries(C.NATIONAL_OFFICES).map(([k, o]) => [k, { name: o.name, list: o.list.map(([n, party, from, to, note]) => ({ p: n ? person(n, null) : null, party, from, to, note })) }]));
const chairs = Object.fromEntries(Object.entries(C.PARTY_CHAIRS).map(([k, l]) => [k, l.map(([n, from, to, note]) => ({ p: person(n, null), from, to, note }))]));
for (const p of parties) delete p.aliases;

const base = {
  meta: { built: new Date().toISOString().slice(0, 10), lastVerified: '2026-10-22', sources: C.SRC, taipeiNote: C.TAIPEI_NOTE },
  parties, chairs, units: units.map(u => ({ ...u })), towns, offices, execs, townExecs, insts, terms, people, elections, events,
};
fs.writeFileSync(`${OUT}/geo.json`, JSON.stringify(topo));
fs.writeFileSync(`${OUT}/base.json`, JSON.stringify(base));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results));
const sz = f => (fs.statSync(`${OUT}/${f}`).size / 1e6).toFixed(2) + 'MB';
console.log('人物', people.length, '选举', elections.length, '届次', terms.length, '首长', execs.length, '乡镇首长', townExecs.length, '事件', events.length, '机关', insts.length);
console.log('geo', sz('geo.json'), 'base', sz('base.json'), 'results', sz('results.json'));
