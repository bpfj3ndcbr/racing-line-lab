import {
  type Circuit, type GeoLine, type LineCandidate, bearingDiff, detectLaps, findCrossings, formatJst, formatLapTime, lineBearing, lineMid,
  lineMoveM, lineMovedTo, lineWithBearing, matchCircuit, metersPerDegree, orderSectors, rotateToward, roundLine, sectorPassTimes, shiftLine,
} from '../core';
import type { LoadedLog, Session } from '../store/session';
import { customDialog } from './dialog';
import type { MapFactory, MapLine, MapTrack, TrackMap } from './mapTypes';

/**
 * 読み込みの確認(案件 3)。走行ログを比較セットに読み込んだあと、サーキットを判定できないログがあるか、
 * 空の比較セットに 2 つ以上のサーキットのログを読み込んだときに出す。
 *
 * ダイアログ全体で、比較セットの計測ラインを 1 つだけ選ぶ。選べるものは同じ形の行に並べる:
 * - 各ファイルの行: そのファイルから作った候補(ファイル内の計測ライン / 1 周分のログから計算した計測ライン)
 * - 「登録済みのサーキット」の行: 読み込んだログが通る、登録済みのサーキット
 * - 「地図で登録」の行 / 「あとで」の行
 * 各ファイルの行のステータスには、選んだ計測ラインでそのファイルがどうなるか(選択中 / 通る / 通らない)を出す。
 * 右上に、選んだ計測ラインの地図のプレビューを出す。候補はこの画面で名前を決めてそのまま登録する(登録画面は開かない)。
 *
 * 候補の計測ラインは、登録する前に「計測ラインを修正」で直せる(案件 15)。ダイアログの中身が修正の画面に切り替わり、
 * 大きな地図で回転(角度の指定・両端のつまみ)と移動(中央のつまみ・矢印キー)ができる。「この位置にする」で元の画面に戻り、
 * 直した線がプレビュー・各ファイルのステータス・登録に使われる。
 *
 * 修正の画面では、セクターも直せる(案件 17)。プレビューの「セクター」の表示では「セクターを修正」になる。
 * 右の欄の線の一覧(計測ライン・S1・S2…)で選んだ線を直す。「セクターを追加」で地図に引いて足し、「×」で消す。
 * セクターの順番は、走行ログが通った順に自動で並べ直す。
 *
 * 読み込んだ直後に出したときは、「読み込みを取り消す」で、いま読み込んだログを外して閉じられる(案件 22。外すのは呼び出し側)。
 */

/** 修正の画面: スライダーで回せる範囲(補正前からの差、度) */
export const FIX_RANGE_DEG = 15;
/** 修正の画面: 矢印キー 1 回の移動量(m。Shift で 10 倍) */
export const FIX_STEP_M = 0.1;

/** 修正の画面の線。before = 補正前(ファイルの線。この画面で足した線は、引いたときの線)、added = この画面で足した線 */
export interface FixLine { before: GeoLine; line: GeoLine; added?: boolean }
/** 候補ごとの、直した計測ラインとセクター。lines[0] が計測ライン、残りがセクター(通った順)。removed = 消したファイルのセクターの本数 */
interface Fixed { lines: FixLine[]; removed: number }
/** 線を補正前から動かしたか(この画面で足した線は、動かさなくても「変えた」) */
export const lineChanged = (f: FixLine) =>
  !!f.added || lineMoveM(f.before, f.line) >= 0.005 || Math.abs(bearingDiff(lineBearing(f.before), lineBearing(f.line))) >= 0.005;
/** セクターの直し方の要約(「修正 1・追加 1・削除 1」。何もしていなければ空) */
export function sectorChanges(lines: FixLine[], removed: number): string {
  const secs = lines.slice(1);
  const moved = secs.filter((f) => !f.added && lineChanged(f)).length, added = secs.filter((f) => f.added).length;
  return [moved && `修正 ${moved}`, added && `追加 ${added}`, removed && `削除 ${removed}`].filter(Boolean).join('・');
}

/** 角度の表示(0.1° 単位) */
const fmtDeg = (d: number) => `${(Math.round(d * 10) / 10).toFixed(1)}°`;
/** 角度の差の表示(+1.2° / −0.3° / 0.0°) */
function fmtDiff(d: number): string {
  const r = Math.round(d * 10) / 10;
  return r === 0 ? '0.0°' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}°`;
}
/** 補正の内容(「角度 +1.2°・移動 0.6 m」) */
export function fixSummary(before: GeoLine, after: GeoLine): string {
  return `角度 ${fmtDiff(bearingDiff(lineBearing(before), lineBearing(after)))}・移動 ${lineMoveM(before, after).toFixed(1)} m`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 選べるもの */
export type LoadOption =
  | { kind: 'cand'; key: string; log: LoadedLog; candidate: LineCandidate }
  | { kind: 'circuit'; key: string; circuit: Circuit }
  | { kind: 'map'; key: string; log: LoadedLog }
  | { kind: 'later'; key: string };

export interface LoadPlan {
  logs: LoadedLog[];
  options: LoadOption[];
  /** 初期値(options の key) */
  initial: string;
}

/** 候補のボタン・ダイアログの文言 */
export function candidateLabel(c: LineCandidate): string {
  if (c.source === 'loop') return '計算した計測ラインで登録';
  return c.name ? `ファイル内のサーキット名「${c.name}」で登録` : 'ファイル内の計測ラインで登録';
}
function candidateNote(c: LineCandidate): string {
  return c.source === 'loop' ? '1 周分のログの始点と終点から計算(セクターなし)' : `RaceChrono の計測ライン(セクター ${c.sectors.length} 本)`;
}

/** ログ l が、線 line(計測ライン)を通るか */
const crosses = (l: LoadedLog, line: GeoLine) => findCrossings(l.log, line, { offset: l.offset }).length > 0;
function lineOf(o: LoadOption): GeoLine | null {
  return o.kind === 'cand' ? o.candidate.control : o.kind === 'circuit' ? o.circuit.control : null;
}

/**
 * ダイアログに出す内容を決める。出す必要が無ければ null。
 * ids = いま読み込んだログ、wasEmpty = 読み込む前の比較セットが空だったか
 */
export function planLoad(session: Session, set: number, ids: string[], wasEmpty: boolean): LoadPlan | null {
  const w = session.sets[set];
  if (!w) return null;
  const logs = ids.map((id) => w.logs.find((l) => l.id === id)).filter((l): l is LoadedLog => !!l);
  if (!logs.length) return null;
  const unmatched = logs.filter((l) => !l.circuit && !l.outside);
  // 空のセットで、サーキットを選んでいないのに、通らないログ(別のサーキット)が出たとき
  const split = wasEmpty && !w.selectedCircuitId && logs.some((l) => l.outside);
  if (!unmatched.length && !split) return null;

  const options: LoadOption[] = [];
  for (const l of logs) if (l.candidate) options.push({ kind: 'cand', key: `cand:${l.id}`, log: l, candidate: l.candidate });
  const circuits: Circuit[] = [];
  for (const l of logs) {
    const m = matchCircuit(l.log, session.circuits, l.offset)?.circuit;
    if (m && !circuits.includes(m)) circuits.push(m);
  }
  for (const c of circuits) options.push({ kind: 'circuit', key: `circuit:${c.id}`, circuit: c });
  options.push({ kind: 'map', key: 'map', log: unmatched[0] ?? logs[0] });
  options.push({ kind: 'later', key: 'later' });

  // 初期値: 通るログが最も多いもの。同じなら、登録済みのサーキット → ファイル内の計測ライン → 計算した計測ライン、
  // さらに同じなら先のもの。どれも無ければ「地図で登録」
  const rank = (o: LoadOption) => (o.kind === 'circuit' ? 0 : o.kind === 'cand' && o.candidate.source === 'laptiming' ? 1 : 2);
  let initial = 'map', best = 0, bestRank = 9;
  for (const o of options) {
    const line = lineOf(o);
    if (!line) continue;
    const n = logs.filter((l) => crosses(l, line)).length;
    if (n > best || (n === best && n > 0 && rank(o) < bestRank)) { best = n; bestRank = rank(o); initial = o.key; }
  }
  return { logs, options, initial };
}

/** ファイルの行のステータス: 選んだもの(o)で、そのファイルがどうなるか */
function statusOf(l: LoadedLog, o: LoadOption, line: GeoLine | null): { cls: 'ok' | 'ng' | 'cur' | ''; text: string } {
  if (o.kind === 'cand' && o.log.id === l.id) return { cls: 'cur', text: '選択中' };
  if (line) return crosses(l, line) ? { cls: 'ok', text: '通ります(ラップあり)' } : { cls: 'ng', text: '選択中の計測ラインを通りません(ラップ無し)' };
  if (o.kind === 'map') return o.log.id === l.id ? { cls: 'cur', text: '選択中(地図の場所)' } : { cls: '', text: '登録後に判定します' };
  if (l.circuit) return { cls: 'ok', text: `${l.circuit.name}(自動判定)` };
  if (l.outside) return { cls: 'ng', text: `${l.outside.name} を通りません(ラップ無し)` };
  return { cls: '', text: '未判定のまま' };
}

/** 一番上の枠: いま選んでいるもの */
function currentHtml(o: LoadOption, name: string, fixed: Fixed | undefined): string {
  const line = (k: string, v: string) => `<div class="ld-cur-l"><span>${esc(k)}:</span> ${esc(v)}</div>`;
  let body: string;
  if (o.kind === 'cand') {
    body = line('ファイル', o.log.log.fileName)
      + (o.candidate.source === 'loop'
        ? '<div class="ld-cur-l">計算した計測ライン(1 周分のログの始点と終点から計算)</div>'
        : line('ファイル内のサーキット名', `${o.candidate.name || '(名前なし)'}(セクター ${o.candidate.sectors.length} 本)`))
      + `<label class="ld-cur-l ld-name"><span>登録するサーキット名:</span><input id="ld-name" type="text" value="${esc(name)}" placeholder="例: オートポリス" aria-label="登録するサーキット名"></label>
        <div class="ld-cur-l ld-name-msg" id="ld-name-msg" role="status"></div>`
      + line('計測ライン', fixed && lineChanged(fixed.lines[0]) ? `修正あり(${fixSummary(o.candidate.control, fixed.lines[0].line)})`
        : o.candidate.source === 'loop' ? '計算したまま(修正なし)' : 'ファイルのまま(修正なし)')
      + line('セクター', (() => {
        const n = fixed ? fixed.lines.length - 1 : o.candidate.sectors.length;
        const ch = fixed ? sectorChanges(fixed.lines, fixed.removed) : '';
        return ch ? `修正あり(${n} 本。${ch})` : n ? `ファイルのまま(${n} 本)` : 'なし';
      })());
  } else if (o.kind === 'circuit') body = line('登録済みのサーキット', o.circuit.name);
  else if (o.kind === 'map') body = `<div class="ld-cur-l">地図で計測ラインを引いて登録(${esc(o.log.log.fileName)} の場所の地図が開きます)</div>`;
  else body = '<div class="ld-cur-l">あとで(未判定のまま)</div>';
  return `<div class="ld-cur-h">現在選択されているサーキット</div>${body}`;
}

const radio = (o: LoadOption, cur: string, html: string) =>
  `<label class="ld-opt"><input type="radio" name="ld-opt" value="${esc(o.key)}"${o.key === cur ? ' checked' : ''}><span>${html}</span></label>`;

function listHtml(plan: LoadPlan, cur: LoadOption, line: GeoLine | null): string {
  const files = plan.logs.map((l) => {
    const st = statusOf(l, cur, line);
    const len = l.log.t[(l.log.loop?.n ?? l.log.t.length) - 1] - l.log.t[0];
    const meta = `${l.log.startEpochMs ? formatJst(l.log.startEpochMs) : '日時不明'} ・ 長さ ${formatLapTime(len)}`;
    const own = plan.options.find((o) => o.kind === 'cand' && o.log.id === l.id);
    const opt = own && own.kind === 'cand'
      ? radio(own, cur.key, `${esc(candidateLabel(own.candidate))}<span class="from">${esc(candidateNote(own.candidate))}</span>`)
      : '<span class="sub">このファイルには計測ラインの情報がありません</span>';
    return `<div class="ld-row" data-log="${esc(l.id)}"><div><div class="fn">${esc(l.log.fileName)}</div><div class="meta">${esc(meta)}</div></div>`
      + `<div class="st">${st.text ? `<span class="tag ${st.cls}">${esc(st.text)}</span>` : ''}</div><div class="res">${opt}</div></div>`;
  });
  const circuits = plan.options.filter((o) => o.kind === 'circuit');
  const extra = (title: string, meta: string, opts: string) =>
    `<div class="ld-row ld-extra"><div><div class="fn">${esc(title)}</div><div class="meta">${esc(meta)}</div></div><div class="st"></div><div class="res">${opts}</div></div>`;
  const map = plan.options.find((o) => o.kind === 'map')!;
  const later = plan.options.find((o) => o.kind === 'later')!;
  return files.join('')
    + (circuits.length ? extra('登録済みのサーキット', '読み込んだログが通る、登録済みのサーキットを使います',
      circuits.map((o) => radio(o, cur.key, `「${esc(o.kind === 'circuit' ? o.circuit.name : '')}」を使う`)).join('')) : '')
    + extra('地図で登録', `${map.kind === 'map' ? map.log.log.fileName : ''} の場所の地図で、計測ラインを自分で引きます`, radio(map, cur.key, '地図で計測ラインを引いて登録'))
    + extra('あとで', 'サーキットを決めずに閉じます。あとから、ログの枠や「はじめかた」のボタンで登録できます', radio(later, cur.key, 'あとで(未判定のまま)'));
}

/** 計測ラインの中心から radiusM 以内の走行ライン(とぎれごとに別の線。最大 maxRuns 本・1 本 maxPts 点まで間引く) */
export function trackNear(l: LoadedLog, center: { lat: number; lon: number }, radiusM = 400, maxRuns = 6, maxPts = 400): [number, number][][] {
  const m = metersPerDegree(center.lat);
  const dLat = radiusM / m.lat, dLon = radiusM / m.lon;
  const n = l.log.loop?.n ?? l.log.t.length;
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  const { lat, lon } = l.log;
  const off = { lat: l.offset.north / m.lat, lon: l.offset.east / m.lon };
  for (let i = 0; i < n && runs.length < maxRuns; i++) {
    const y = lat[i] + off.lat, x = lon[i] + off.lon;
    if (Math.abs(y - center.lat) <= dLat && Math.abs(x - center.lon) <= dLon) cur.push([y, x]);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length && runs.length < maxRuns) runs.push(cur);
  return runs.map((r) => (r.length <= maxPts ? r : r.filter((_, k) => k % Math.ceil(r.length / maxPts) === 0)));
}

/** プレビューの「セクター」で描く走行ライン: 線 line で区切った最初の完了ラップ(無ければログ全体)を、maxPts 点まで間引く */
export function lapTrack(l: LoadedLog, line: GeoLine, maxPts = 1500): [number, number][] {
  const lap = detectLaps(l.log, line, [], { offset: l.offset, partial: 'never' }).find((x) => x.complete);
  const from = lap?.startIndex ?? 0, to = lap?.endIndex ?? (l.log.loop?.n ?? l.log.t.length) - 1;
  const m = metersPerDegree(l.log.lat[from]);
  const off = { lat: l.offset.north / m.lat, lon: l.offset.east / m.lon };
  const step = Math.max(1, Math.ceil((to - from + 1) / maxPts));
  const pts: [number, number][] = [];
  for (let i = from; i <= to; i += step) pts.push([l.log.lat[i] + off.lat, l.log.lon[i] + off.lon]);
  return pts;
}

export interface LoadDialogDeps {
  /** プレビューの地図(無ければプレビューを出さない) */
  mapFactory?: MapFactory;
  /** 同じ名前のサーキットが既にあるか */
  nameTaken?: (name: string) => boolean;
  /** 「読み込みを取り消す」を出す(読み込んだ直後に出したとき。前に読み込んだログの確認では出さない) */
  canUndo?: boolean;
}
/**
 * ダイアログの結果: 選んだもの(Esc なら「あとで」)と、候補を登録するときのサーキット名。
 * control は、候補の計測ラインを修正したときの、直した線(修正していなければ無し)
 * sectors は、セクターを直した・足した・消したときの、セクター(通った順。直していなければ無し)
 * undo は「読み込みを取り消す」を押したとき(option は「あとで」)
 */
export interface LoadResult { option: LoadOption; name: string; control?: GeoLine; sectors?: GeoLine[]; undo?: boolean }

/** 読み込みの確認ダイアログ */
export function loadDialog(plan: LoadPlan, deps: LoadDialogDeps = {}, host: HTMLElement = document.body): Promise<LoadResult> {
  const later = plan.options.find((o) => o.kind === 'later')!;
  let map: TrackMap | null = null;
  /** 修正の画面の地図 */
  let fixMap: TrackMap | null = null;
  return customDialog<LoadResult>((box, close) => {
    box.classList.add('wide', 'ld');
    let cur = plan.options.find((o) => o.key === plan.initial) ?? later;
    /** 候補ごとのサーキット名(入力した値を、選び直しても残す) */
    const names = new Map<string, string>();
    const nameOf = (o: LoadOption) => o.kind !== 'cand' ? '' : names.get(o.key)
      ?? (o.candidate.name || o.log.log.fileName.replace(/\.vbo$/i, ''));
    /** 候補ごとの、直した計測ラインとセクター(「この位置にする」で決めたもの。直していなければ無し) */
    const fixes = new Map<string, Fixed>();
    /** 選んだものの計測ライン(直していれば、直した線) */
    const lineFor = (o: LoadOption) => fixes.get(o.key)?.lines[0].line ?? lineOf(o);
    /** 選んだもののセクター(直していれば、直したもの) */
    const sectorsFor = (o: LoadOption): GeoLine[] => fixes.get(o.key)?.lines.slice(1).map((f) => f.line)
      ?? (o.kind === 'cand' ? o.candidate.sectors : o.kind === 'circuit' ? o.circuit.sectors : []);
    box.innerHTML = `<h3 id="ld-t">読み込んだ走行ログの確認</h3>
      <div class="ld-main">
      <p>この比較セットで使う計測ライン(サーキット)を 1 つ選んでください。ほかのサーキットのログは、ラップの無いログとして入ります。</p>
      <div class="ld-top"><div class="ld-cur" role="status"></div>${deps.mapFactory ? '<div class="ld-prev" aria-label="計測ラインのプレビュー"><div class="map"></div><div class="ld-prev-none" hidden></div><button type="button" class="btn ld-prev-fix" data-fix="open" hidden>計測ラインを修正</button><span class="seg sm ld-prev-mode" role="group" aria-label="プレビューの範囲"><button type="button" data-zoom="near" class="on" aria-pressed="true">計測ライン付近</button><button type="button" data-zoom="all" aria-pressed="false">セクター</button></span></div>' : ''}</div>
      <div class="ld-list" role="radiogroup" aria-label="計測ライン(サーキット)の選択"></div>
      <p class="ld-note">選んだ計測ラインを通るログは、まとめて判定されます。ファイルの計測ラインは、この画面で登録します(向きや位置は、登録の前に「計測ラインを修正」「セクターを修正」で直せます。セクターは足したり消したりもできます)。</p>
      </div>
      <div class="ld-fix" hidden></div>
      <div class="modal-actions">${deps.canUndo ? '<button type="button" class="btn ld-undo" data-dialog="undo" title="いま読み込んだ走行ログを比較セットから外して、読み込む前に戻します">読み込みを取り消す</button>' : ''}<button type="button" class="btn" data-fix="cancel" hidden disabled>キャンセル</button><button type="button" class="btn pri" data-fix="apply" hidden disabled>この位置にする</button><button type="button" class="btn pri" data-dialog="ok"></button></div>`;
    box.setAttribute('aria-labelledby', 'ld-t');
    const list = box.querySelector<HTMLElement>('.ld-list')!, head = box.querySelector<HTMLElement>('.ld-cur')!;
    const ok = box.querySelector<HTMLButtonElement>('[data-dialog="ok"]')!;
    const prevMap = box.querySelector<HTMLElement>('.ld-prev .map'), prevNone = box.querySelector<HTMLElement>('.ld-prev-none');
    const fixBtn = box.querySelector<HTMLButtonElement>('.ld-prev-fix');
    const main = box.querySelector<HTMLElement>('.ld-main')!, fixEl = box.querySelector<HTMLElement>('.ld-fix')!;
    const fixCancel = box.querySelector<HTMLButtonElement>('[data-fix="cancel"]')!, fixApply = box.querySelector<HTMLButtonElement>('[data-fix="apply"]')!;
    const undo = box.querySelector<HTMLButtonElement>('[data-dialog="undo"]');

    /** プレビューの範囲: near = 計測ラインの付近、all = 「セクター」(1 周分の走行ラインとセクターが入る範囲) */
    let zoom: 'near' | 'all' = 'near';
    const modeEl = box.querySelector<HTMLElement>('.ld-prev-mode');
    modeEl?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
      if (!b) return;
      zoom = b.dataset.zoom as 'near' | 'all';
      modeEl.querySelectorAll<HTMLElement>('[data-zoom]').forEach((x) => {
        const on = x.dataset.zoom === zoom;
        x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on));
      });
      preview();
    });
    const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f6fd1';
    function preview() {
      if (!prevMap || !prevNone) return;
      const line = lineFor(cur);
      prevNone.hidden = !!line;
      if (modeEl) modeEl.hidden = !line;
      if (fixBtn) {
        // 直せるのは候補だけ。名前はプレビューの表示に合わせる(どちらから開いても、計測ラインとセクターを直せる)
        fixBtn.hidden = cur.kind !== 'cand';
        fixBtn.textContent = zoom === 'near' ? '計測ラインを修正' : 'セクターを修正';
      }
      prevNone.textContent = cur.kind === 'map' ? '計測ラインは、次の画面で地図に引きます' : 'プレビューはありません';
      if (!line) return;
      if (!map) { map = deps.mapFactory!(prevMap); }
      const sectors = sectorsFor(cur);
      const lines: MapLine[] = [{ label: '計測ライン', line, kind: 'control' }, ...sectors.map((s, i) => ({ label: `S${i + 1}`, line: s, kind: 'sector' as const }))];
      map.setLines(lines);
      const c = lineMid(line);
      const src = cur.kind === 'cand' ? cur.log : plan.logs.find((l) => crosses(l, line));
      const runs = !src ? [] : zoom === 'all' ? [lapTrack(src, line)] : trackNear(src, c);
      const tracks: MapTrack[] = runs.map((points) => ({ slot: 'A', points, color: accent() }));
      map.setTracks(tracks);
      map.invalidate();
      if (zoom === 'all') {
        // 全体が入る範囲に合わせると、小さい地図ではコースが小さくなりすぎるので、1 段階だけ拡大する
        map.fit();
        const v = map.getView();
        map.setView(v.lat, v.lon, v.zoom + 1);
      } else map.setView(c.lat, c.lon, 18);
    }
    function checkName() {
      const msg = box.querySelector<HTMLElement>('#ld-name-msg');
      if (cur.kind !== 'cand') { ok.disabled = false; return; }
      const n = nameOf(cur).trim();
      const taken = !!n && !!deps.nameTaken?.(n);
      ok.disabled = !n || taken;
      if (msg) msg.textContent = !n ? 'サーキット名を入力してください' : taken ? '既に名前が存在します。別の名前にしてください' : '';
    }
    /** 文字の部分(上の枠・一覧・ボタン)。地図のプレビューは preview() */
    const renderText = () => {
      head.innerHTML = currentHtml(cur, nameOf(cur), fixes.get(cur.key));
      list.innerHTML = listHtml(plan, cur, lineFor(cur));
      ok.textContent = cur.kind === 'later' ? '閉じる' : cur.kind === 'circuit' ? 'このサーキットを使う'
        : cur.kind === 'cand' ? 'この計測ラインで登録' : '次へ(地図で登録)';
      checkName();
    };
    const render = () => { renderText(); preview(); };

    // ---------- 計測ライン・セクターの修正(案件 15・17) ----------
    /**
     * 修正中の候補: lines[0] = 計測ライン、残り = セクター(通った順)。sel = 選んでいる線、removed = 消したファイルのセクターの本数、
     * drawing = 「セクターを追加」で線を引いている途中
     */
    let fixing: { o: Extract<LoadOption, { kind: 'cand' }>; lines: FixLine[]; removed: number; sel: number; drawing: boolean } | null = null;
    const $f = <T extends HTMLElement>(sel: string) => fixEl.querySelector<T>(sel)!;
    const nameAt = (i: number) => (i === 0 ? '計測ライン' : `S${i}`);
    const selLine = () => fixing!.lines[fixing!.sel];
    function openFix() {
      if (cur.kind !== 'cand') return;
      const saved = fixes.get(cur.key);
      const lines = saved ? saved.lines.map((f) => ({ ...f }))
        : [cur.candidate.control, ...cur.candidate.sectors].map((l) => ({ before: l, line: l }));
      // 「計測ライン付近」から開いたときは計測ライン、「セクター」から開いたときは S1(無ければ計測ライン)を選ぶ
      const fromSectors = zoom === 'all';
      fixing = { o: cur, lines, removed: saved?.removed ?? 0, sel: fromSectors && lines.length > 1 ? 1 : 0, drawing: false };
      const src = cur.candidate.source === 'loop' ? '計算した計測ライン' : `ファイル内の計測ライン${cur.candidate.name ? `「${esc(cur.candidate.name)}」` : ''}`;
      fixEl.innerHTML = `<div class="ld-fix-h">計測ライン・セクターの修正<span>${src}(${esc(cur.log.log.fileName)})・登録前</span></div>
        <div class="ld-fix-body">
          <div class="ld-fix-map"><div class="map"></div></div>
          <div class="ld-fix-side">
            <div class="ld-fix-g ld-fix-lines"><div class="ld-fix-gh">ライン</div>
              <div class="ld-fix-list" role="list" aria-label="計測ラインとセクター"></div>
              <button type="button" class="btn sm ld-fix-draw" data-fix="draw" aria-pressed="false">セクターを追加</button>
              <div class="sub ld-fix-draw-hint" hidden>地図の上でドラッグして、セクターの線を引きます(Esc でやめる)</div>
              <div class="sub">セクターは、走行ログが通った順に自動で並べ替えます</div></div>
            <div class="ld-fix-g"><div class="ld-fix-gh">角度<span class="ld-fix-of"></span></div><div class="sub">北から時計回り(0.1° 刻み)</div>
              <input type="range" class="slider ld-fix-range" min="${-FIX_RANGE_DEG}" max="${FIX_RANGE_DEG}" step="0.1" aria-label="角度(補正前からの差)">
              <div class="ld-fix-ang"><input type="number" class="ld-fix-deg" step="0.1" min="0" max="359.9" aria-label="角度(度)"><span>°</span>
                <button type="button" class="ib" data-fix="dec" aria-label="角度を 0.1° 小さく" title="−0.1°">−</button><button type="button" class="ib" data-fix="inc" aria-label="角度を 0.1° 大きく" title="+0.1°">+</button></div>
              <dl class="ld-fix-tbl"><dt>補正前</dt><dd class="ld-fix-b0"></dd><dt>補正後</dt><dd class="ld-fix-b1"></dd><dt>差</dt><dd class="ld-fix-d"></dd></dl></div>
            <div class="ld-fix-g"><div class="ld-fix-gh">移動</div><div class="sub">中央のつまみをドラッグするか、矢印キーで動かします(Shift で 10 倍)。両端のつまみで回せます(長さは変わりません)</div>
              <dl class="ld-fix-tbl"><dt>補正前から</dt><dd class="ld-fix-mv"></dd></dl></div>
            <button type="button" class="btn ld-fix-reset" data-fix="reset">選んだ線を補正前に戻す</button>
          </div>
        </div>
        <div class="ld-fix-leg"><span><i class="after"></i>選んでいる線</span><span><i class="before"></i>補正前</span></div>`;
      // 元の画面の入力欄は消しておく(隠れた入力欄にフォーカスが移らないように。戻るときに作り直す)
      head.innerHTML = ''; list.innerHTML = '';
      main.hidden = true; fixEl.hidden = false;
      ok.hidden = true; ok.disabled = true;
      if (undo) undo.hidden = true;                                           // 修正の画面では出さない
      for (const b of [fixCancel, fixApply]) { b.hidden = false; b.disabled = false; }
      if (deps.mapFactory) {
        fixMap = deps.mapFactory($f('.ld-fix-map .map'));
        const control = fixing.lines[0].before;
        fixMap.setTracks([lapTrack(cur.log, control), ...trackNear(cur.log, lineMid(control))].map((points) => ({ slot: 'A', points, color: accent() })));
        fixMap.invalidate();
        if (fromSectors) fixMap.fit();
        else { const c = lineMid(fixing.lines[0].line); fixMap.setView(c.lat, c.lon, 19); }
      }
      renderFixList();
      drawFix(true);
      $f<HTMLInputElement>(fromSectors ? '.ld-fix-list [aria-pressed="true"]' : '.ld-fix-deg').focus();
    }
    /** 修正の画面を閉じて、元の画面に戻る。apply = 「この位置にする」 */
    function closeFix(apply: boolean) {
      if (!fixing) return;
      if (apply) {
        const changed = fixing.removed > 0 || fixing.lines.some(lineChanged);
        if (changed) fixes.set(fixing.o.key, { lines: fixing.lines, removed: fixing.removed }); else fixes.delete(fixing.o.key);
      }
      setDrawing(false);
      fixing = null;
      fixMap?.destroy(); fixMap = null;
      fixEl.innerHTML = ''; fixEl.hidden = true; main.hidden = false;
      for (const b of [fixCancel, fixApply]) { b.hidden = true; b.disabled = true; }
      ok.hidden = false;
      if (undo) undo.hidden = false;
      render();
      fixBtn?.focus();
    }
    /** セクターを、走行ログが通った順に並べ直す(選んでいる線はそのまま選ぶ) */
    function orderFix() {
      if (!fixing) return;
      const keep = selLine();
      const secs = fixing.lines.slice(1);
      const order = orderSectors(fixing.o.log.log, fixing.lines[0].line, secs.map((f) => f.line));
      secs.sort((p, q) => order.indexOf(p.line) - order.indexOf(q.line));
      fixing.lines = [fixing.lines[0], ...secs];
      fixing.sel = Math.max(0, fixing.lines.indexOf(keep));
    }
    /** 線の一覧(計測ライン・S1…)。状態: 修正済み / 追加 / 走行ログが通らない */
    function renderFixList() {
      if (!fixing) return;
      const { lines, sel } = fixing;
      const times = sectorPassTimes(fixing.o.log.log, lines[0].line, lines.slice(1).map((f) => f.line));
      const listEl = $f('.ld-fix-list');
      // 一覧のボタンで操作していたら(矢印キーで動かすなど)、描き直したあとも、選んでいる線のボタンにフォーカスを戻す
      const hadFocus = listEl.contains(document.activeElement);
      listEl.innerHTML = lines.map((f, i) => {
        const miss = i > 0 && !!times && times[i - 1] === Infinity;
        const st = miss ? '<span class="ld-fix-st ng" title="走行ログが、この線を通りません">通りません</span>'
          : f.added ? '<span class="ld-fix-st add">追加</span>' : lineChanged(f) ? '<span class="ld-fix-st mod">修正済み</span>' : '<span class="ld-fix-st"></span>';
        return `<div class="ld-fix-row${i === sel ? ' sel' : ''}" role="listitem">
          <button type="button" class="btn sm ld-fix-name" data-fix="sel" data-i="${i}" aria-pressed="${i === sel}">${nameAt(i)}</button>${st}
          ${i === 0 ? '<span class="ld-fix-gap"></span>' : `<button type="button" class="ib" data-fix="del" data-i="${i}" aria-label="${nameAt(i)} を削除" title="削除">×</button>`}</div>`;
      }).join('');
      if (hadFocus) listEl.querySelector<HTMLElement>(`[data-fix="sel"][data-i="${sel}"]`)?.focus();
    }
    /** 修正の画面の地図と数字。handles = つまみも置き直す(ドラッグ中は置き直さない)。src = いま操作している入力欄(値を書き換えない) */
    function drawFix(handles: boolean, src?: HTMLElement) {
      if (!fixing) return;
      const { lines, sel } = fixing;
      const { before, line } = lines[sel];
      fixMap?.setLines([
        // 選んでいる線の補正前(灰色の破線)。この画面で足した線には、補正前は無い
        ...(lines[sel].added ? [] : [{ label: '補正前', line: before, kind: sel === 0 ? 'control' as const : 'sector' as const, before: true }]),
        ...lines.map((f, i): MapLine => ({ label: nameAt(i), line: f.line, kind: i === 0 ? 'control' : 'sector', selected: i === sel })),
      ]);
      if (handles && fixMap) {
        const m = lineMid(line);
        fixMap.setHandles(fixing.drawing ? [] : [
          { id: 'a', lat: line.a.lat, lon: line.a.lon }, { id: 'b', lat: line.b.lat, lon: line.b.lon }, { id: 'm', lat: m.lat, lon: m.lon, mid: true },
        ], onFixHandle);
      }
      $f('.ld-fix-of').textContent = `(${nameAt(sel)})`;
      const b0 = lineBearing(before), b1 = lineBearing(line), d = bearingDiff(b0, b1);
      $f('.ld-fix-b0').textContent = fmtDeg(b0);
      $f('.ld-fix-b1').textContent = fmtDeg(b1);
      $f('.ld-fix-d').textContent = fmtDiff(d);
      $f('.ld-fix-mv').textContent = `${lineMoveM(before, line).toFixed(1)} m`;
      const deg = $f<HTMLInputElement>('.ld-fix-deg');
      if (src !== deg) deg.value = (Math.round(b1 * 10) / 10 % 360).toFixed(1);
      const range = $f<HTMLInputElement>('.ld-fix-range');
      if (src !== range) range.value = String(Math.max(-FIX_RANGE_DEG, Math.min(FIX_RANGE_DEG, Math.round(d * 10) / 10)));
    }
    /**
     * 選んでいる線を置き換える。handles = つまみも置き直す(ドラッグ中は置き直さない)。
     * order = 操作の区切り(つまみを離した・数値を確定した)。区切りでセクターを並べ直し、一覧を描き直す
     */
    function setFixLine(line: GeoLine, o: { handles?: boolean; order?: boolean; src?: HTMLElement } = {}) {
      if (!fixing) return;
      const { handles = true, order = true, src } = o;
      fixing.lines[fixing.sel] = { ...selLine(), line };
      if (order) { orderFix(); renderFixList(); }
      drawFix(handles, src);
    }
    function onFixHandle(id: string, lat: number, lon: number, final: boolean) {
      if (!fixing) return;
      const p = { lat, lon }, line = selLine().line;
      setFixLine(id === 'm' ? lineMovedTo(line, p) : rotateToward(line, id === 'a' ? 'a' : 'b', p), { handles: final, order: final });
    }
    const setBearing = (deg: number, src?: HTMLElement, order = true) => {
      if (fixing && Number.isFinite(deg)) setFixLine(lineWithBearing(selLine().line, deg), { order, src });
    };
    function selectFix(i: number) {
      if (!fixing || !fixing.lines[i]) return;
      fixing.sel = i;
      renderFixList();
      drawFix(true);
      if (fixMap) {
        const c = lineMid(fixing.lines[i].line);
        fixMap.setView(c.lat, c.lon, Math.max(fixMap.getView().zoom, 18));
      }
      $f<HTMLElement>(`.ld-fix-list [data-i="${i}"][data-fix="sel"]`).focus();
    }
    /** 「セクターを追加」: 地図の上でドラッグして引く。引き終わったら、足した線を選ぶ */
    function setDrawing(on: boolean) {
      if (!fixing) return;
      fixing.drawing = on;
      const b = fixEl.querySelector<HTMLElement>('.ld-fix-draw');
      if (b) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('pri', on); }
      const hint = fixEl.querySelector<HTMLElement>('.ld-fix-draw-hint');
      if (hint) hint.hidden = !on;
      fixMap?.setDrawMode(on ? (a, b2) => {
        if (!fixing) return;
        const line = roundLine({ a, b: b2 });
        fixing.lines.push({ before: line, line, added: true });
        fixing.sel = fixing.lines.length - 1;
        setDrawing(false);
        orderFix();
        renderFixList();
        drawFix(true);
      } : null);
      drawFix(true);
    }
    // スライダーは動かしている間も回す(スライダー自身の値は書き換えない)。数値入力は確定(Enter・フォーカスを外す)で回す
    fixEl.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (fixing && t.classList.contains('ld-fix-range')) setBearing(lineBearing(selLine().before) + Number(t.value), t, false);
    });
    fixEl.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (!fixing) return;
      if (t.classList.contains('ld-fix-deg')) setBearing(Number(t.value));
      else if (t.classList.contains('ld-fix-range')) { orderFix(); renderFixList(); }      // スライダーを離したとき
    });
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fix]');
      if (!b) return;
      const act = b.dataset.fix;
      if (act === 'open') openFix();
      else if (act === 'cancel') closeFix(false);
      else if (act === 'apply') closeFix(true);
      else if (!fixing) return;
      else if (act === 'sel') selectFix(Number(b.dataset.i));
      else if (act === 'del') {
        const i = Number(b.dataset.i);
        const f = fixing.lines[i];
        if (!f || i === 0) return;
        fixing.lines.splice(i, 1);
        if (!f.added) fixing.removed++;
        if (fixing.sel >= i) fixing.sel = Math.max(0, fixing.sel - 1);
        renderFixList();
        drawFix(true);
      } else if (act === 'draw') setDrawing(!fixing.drawing);
      else if (act === 'reset') setFixLine(selLine().before);
      else if (act === 'dec' || act === 'inc') setBearing(lineBearing(selLine().line) + (act === 'inc' ? 0.1 : -0.1));
    });
    box.addEventListener('keydown', (e) => {
      if (!fixing) return;
      // 修正の画面の Esc は、線を引いている途中ならそれをやめ、そうでなければ修正をやめて元の画面に戻る(ダイアログは閉じない)
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (fixing.drawing) setDrawing(false); else closeFix(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;               // スライダー・数値入力の矢印キーは、そちらで使う
      const k = (e.shiftKey ? 10 : 1) * FIX_STEP_M;
      const d = ({ ArrowUp: [0, k], ArrowDown: [0, -k], ArrowRight: [k, 0], ArrowLeft: [-k, 0] } as Record<string, [number, number]>)[e.key];
      if (!d) return;
      e.preventDefault();
      setFixLine(shiftLine(selLine().line, d[0], d[1]));
    });

    box.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id !== 'ld-name' || cur.kind !== 'cand') return;
      names.set(cur.key, t.value);
      checkName();
    });
    box.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name !== 'ld-opt') return;
      cur = plan.options.find((o) => o.key === t.value) ?? later;
      render();
      box.querySelector<HTMLInputElement>(`input[name="ld-opt"][value="${cur.key.replace(/["\\]/g, '\\$&')}"]`)?.focus();
    });
    const finish = (o: LoadOption) => {
      map?.destroy(); map = null;
      const f = fixes.get(o.key);
      const secs = f && (f.removed > 0 || f.lines.slice(1).some(lineChanged)) ? f.lines.slice(1).map((x) => x.line) : undefined;
      close({
        option: o, name: nameOf(o).trim(),
        ...(f && lineChanged(f.lines[0]) ? { control: f.lines[0].line } : {}),
        ...(secs ? { sectors: secs } : {}),
      });
    };
    ok.addEventListener('click', () => { if (!ok.disabled) finish(cur); });
    undo?.addEventListener('click', () => { map?.destroy(); map = null; close({ option: later, name: '', undo: true }); });
    // 地図は、ダイアログが画面に入ってから作る(大きさが決まってから)
    renderText();
    setTimeout(preview, 0);
    return ok;
  }, { option: later, name: '' }, host).finally(() => { map?.destroy(); map = null; fixMap?.destroy(); fixMap = null; });
}
