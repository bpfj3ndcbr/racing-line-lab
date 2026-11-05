import { type Circuit, type GeoLine, type LineCandidate, detectLaps, findCrossings, formatJst, formatLapTime, matchCircuit, metersPerDegree } from '../core';
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
 */

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
function statusOf(l: LoadedLog, o: LoadOption): { cls: 'ok' | 'ng' | 'cur' | ''; text: string } {
  if (o.kind === 'cand' && o.log.id === l.id) return { cls: 'cur', text: '選択中' };
  const line = lineOf(o);
  if (line) return crosses(l, line) ? { cls: 'ok', text: '通ります(ラップあり)' } : { cls: 'ng', text: '選択中の計測ラインを通りません(ラップ無し)' };
  if (o.kind === 'map') return o.log.id === l.id ? { cls: 'cur', text: '選択中(地図の場所)' } : { cls: '', text: '登録後に判定します' };
  if (l.circuit) return { cls: 'ok', text: `${l.circuit.name}(自動判定)` };
  if (l.outside) return { cls: 'ng', text: `${l.outside.name} を通りません(ラップ無し)` };
  return { cls: '', text: '未判定のまま' };
}

/** 一番上の枠: いま選んでいるもの */
function currentHtml(o: LoadOption, name: string): string {
  const line = (k: string, v: string) => `<div class="ld-cur-l"><span>${esc(k)}:</span> ${esc(v)}</div>`;
  let body: string;
  if (o.kind === 'cand') {
    body = line('ファイル', o.log.log.fileName)
      + (o.candidate.source === 'loop'
        ? '<div class="ld-cur-l">計算した計測ライン(1 周分のログの始点と終点から計算)</div>'
        : line('ファイル内のサーキット名', `${o.candidate.name || '(名前なし)'}(セクター ${o.candidate.sectors.length} 本)`))
      + `<label class="ld-cur-l ld-name"><span>登録するサーキット名:</span><input id="ld-name" type="text" value="${esc(name)}" placeholder="例: オートポリス" aria-label="登録するサーキット名"></label>
        <div class="ld-cur-l ld-name-msg" id="ld-name-msg" role="status"></div>`;
  } else if (o.kind === 'circuit') body = line('登録済みのサーキット', o.circuit.name);
  else if (o.kind === 'map') body = `<div class="ld-cur-l">地図で計測ラインを引いて登録(${esc(o.log.log.fileName)} の場所の地図が開きます)</div>`;
  else body = '<div class="ld-cur-l">あとで(未判定のまま)</div>';
  return `<div class="ld-cur-h">現在選択されているサーキット</div>${body}`;
}

const radio = (o: LoadOption, cur: string, html: string) =>
  `<label class="ld-opt"><input type="radio" name="ld-opt" value="${esc(o.key)}"${o.key === cur ? ' checked' : ''}><span>${html}</span></label>`;

function listHtml(plan: LoadPlan, cur: LoadOption): string {
  const files = plan.logs.map((l) => {
    const st = statusOf(l, cur);
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
}
/** ダイアログの結果: 選んだもの(Esc なら「あとで」)と、候補を登録するときのサーキット名 */
export interface LoadResult { option: LoadOption; name: string }

/** 読み込みの確認ダイアログ */
export function loadDialog(plan: LoadPlan, deps: LoadDialogDeps = {}, host: HTMLElement = document.body): Promise<LoadResult> {
  const later = plan.options.find((o) => o.kind === 'later')!;
  let map: TrackMap | null = null;
  return customDialog<LoadResult>((box, close) => {
    box.classList.add('wide', 'ld');
    let cur = plan.options.find((o) => o.key === plan.initial) ?? later;
    /** 候補ごとのサーキット名(入力した値を、選び直しても残す) */
    const names = new Map<string, string>();
    const nameOf = (o: LoadOption) => o.kind !== 'cand' ? '' : names.get(o.key)
      ?? (o.candidate.name || o.log.log.fileName.replace(/\.vbo$/i, ''));
    box.innerHTML = `<h3 id="ld-t">読み込んだ走行ログの確認</h3>
      <p>この比較セットで使う計測ライン(サーキット)を 1 つ選んでください。ほかのサーキットのログは、ラップの無いログとして入ります。</p>
      <div class="ld-top"><div class="ld-cur" role="status"></div>${deps.mapFactory ? '<div class="ld-prev" aria-label="計測ラインのプレビュー"><div class="map"></div><div class="ld-prev-none" hidden></div><span class="seg sm ld-prev-mode" role="group" aria-label="プレビューの範囲"><button type="button" data-zoom="near" class="on" aria-pressed="true">計測ライン付近</button><button type="button" data-zoom="all" aria-pressed="false">セクター</button></span></div>' : ''}</div>
      <div class="ld-list" role="radiogroup" aria-label="計測ライン(サーキット)の選択"></div>
      <p class="ld-note">選んだ計測ラインを通るログは、まとめて判定されます。ファイルの計測ラインは、この画面でそのまま登録します(位置は、あとから「登録済みサーキット」の編集で直せます)。</p>
      <div class="modal-actions"><button type="button" class="btn pri" data-dialog="ok"></button></div>`;
    box.setAttribute('aria-labelledby', 'ld-t');
    const list = box.querySelector<HTMLElement>('.ld-list')!, head = box.querySelector<HTMLElement>('.ld-cur')!;
    const ok = box.querySelector<HTMLButtonElement>('[data-dialog="ok"]')!;
    const prevMap = box.querySelector<HTMLElement>('.ld-prev .map'), prevNone = box.querySelector<HTMLElement>('.ld-prev-none');

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
    function preview() {
      if (!prevMap || !prevNone) return;
      const line = lineOf(cur);
      prevNone.hidden = !!line;
      if (modeEl) modeEl.hidden = !line;
      prevNone.textContent = cur.kind === 'map' ? '計測ラインは、次の画面で地図に引きます' : 'プレビューはありません';
      if (!line) return;
      if (!map) { map = deps.mapFactory!(prevMap); }
      const sectors = cur.kind === 'cand' ? cur.candidate.sectors : cur.kind === 'circuit' ? cur.circuit.sectors : [];
      const lines: MapLine[] = [{ label: '計測ライン', line, kind: 'control' }, ...sectors.map((s, i) => ({ label: `S${i + 1}`, line: s, kind: 'sector' as const }))];
      map.setLines(lines);
      const c = { lat: (line.a.lat + line.b.lat) / 2, lon: (line.a.lon + line.b.lon) / 2 };
      const src = cur.kind === 'cand' ? cur.log : plan.logs.find((l) => crosses(l, line));
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f6fd1';
      const runs = !src ? [] : zoom === 'all' ? [lapTrack(src, line)] : trackNear(src, c);
      const tracks: MapTrack[] = runs.map((points) => ({ slot: 'A', points, color }));
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
      head.innerHTML = currentHtml(cur, nameOf(cur));
      list.innerHTML = listHtml(plan, cur);
      ok.textContent = cur.kind === 'later' ? '閉じる' : cur.kind === 'circuit' ? 'このサーキットを使う'
        : cur.kind === 'cand' ? 'この計測ラインで登録' : '次へ(地図で登録)';
      checkName();
    };
    const render = () => { renderText(); preview(); };
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
    const finish = (o: LoadOption) => { map?.destroy(); map = null; close({ option: o, name: nameOf(o).trim() }); };
    ok.addEventListener('click', () => { if (!ok.disabled) finish(cur); });
    // 地図は、ダイアログが画面に入ってから作る(大きさが決まってから)
    renderText();
    setTimeout(preview, 0);
    return ok;
  }, { option: later, name: '' }, host).finally(() => { map?.destroy(); map = null; });
}
