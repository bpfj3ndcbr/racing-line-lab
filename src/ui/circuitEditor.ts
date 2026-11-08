import { gsiGeocode, type GeoHit, type Geocoder } from '../io/geocode';
import {
  type GeoLine, LINE_DIGITS, distanceM, formatCln, formatSci, metersPerDegree, parseCln, parseSci, roundLine, sectorPassTimes, shiftLine,
} from '../core';
import type { LoadedLog, Session } from '../store/session';
import { alertDialog } from './dialog';
import { downloadText } from './download';
import type { MapFactory, TrackMap } from './mapTypes';
import type { ThemeController } from './theme';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface CircuitEditorDeps {
  mapFactory: MapFactory;
  theme?: ThemeController;
  /** 登録・保存・キャンセルのあと(元の画面へ戻る) */
  onDone: () => void;
  /** 住所検索(省略時は国土地理院の住所検索)。テストで差し替える */
  geocode?: Geocoder;
  /** 開いたときの地図の倍率(設定の「倍率」。0 = 登録した表示位置・ラインの位置のまま)。比較画面の倍率とは別に管理する */
  zoom?: () => number;
}
export interface CircuitEditor { show(id: string | null, near?: { lat: number; lon: number }, nudgeSector?: boolean): void; hide(): void }

type Key = 'c' | `s${number}`;
type Part = 'a' | 'b' | 'm';
const STEPS = [0.1, 0.5, 1];
/** コースの幅としては長すぎるライン(m)。ほかの場所を通る周回にも反応してしまう目安 */
const LONG_LINE_M = 60;

/**
 * サーキットの登録・編集(大きな画面)。
 * 地図の上でドラッグしてコントロールライン・セクターを引き、端点のつまみや矢印キーで直す。
 * .cln / .sci の読み込み・書き出しにも対応する。いま地図に出ている範囲を「表示位置」として一緒に保存する。
 * id = null なら新規登録、id があればそのサーキットの編集。
 */
export function mountCircuitEditor(root: HTMLElement, session: Session, deps: CircuitEditorDeps): CircuitEditor {
  root.innerHTML = `
    <div class="corr ce">
      <div class="corr-map-wrap">
        <div class="ce-head">
          <span class="ce-head-t" id="ce-title">サーキットの登録</span><span class="ce-head-s">計測ライン・セクターの設定</span><span class="grow"></span>
          <label class="ce-head-name"><span>サーキット名:</span><input id="ce-name" type="text" placeholder="例: オートポリス" aria-label="サーキット名"></label>
          <button class="btn pri" id="ce-save" data-act="ce-save">登録完了</button>
          <button class="btn" id="ce-cancel" data-act="ce-cancel">キャンセル</button>
        </div>
        <div class="map" id="ce-map"></div>
        <form class="geo" id="ce-geo" role="search" autocomplete="off">
          <input id="ce-geo-q" type="search" placeholder="住所で検索..." aria-label="住所で検索" enterkeyhint="search">
          <div class="geo-res" id="ce-geo-res" role="listbox" aria-label="検索結果" hidden></div>
        </form>
        <div class="map-hint" id="ce-hint" hidden></div>
      </div>
      <aside class="corr-side" aria-label="サーキットの登録・編集">
        <div class="msg" id="ce-msg" role="status"></div>
        <section class="ce-group" aria-labelledby="ce-g1">
          <h3 id="ce-g1">ラインの追加・削除</h3>
          <div class="ce-draw">
            <button class="btn" id="ce-draw-control" data-act="ce-draw" data-kind="control" aria-pressed="false">計測ラインを引く</button>
            <button class="btn" id="ce-draw-sector" data-act="ce-draw" data-kind="sector" aria-pressed="false">セクターを追加</button>
          </div>
          <div class="ce-draft" id="ce-draft" hidden>
            <div id="ce-draft-text"></div>
            <div class="btn-row">
              <button class="btn pri" id="ce-confirm" data-act="ce-confirm" title="仮のラインを確定します [Enter]">確定</button>
              <button class="btn" id="ce-discard" data-act="ce-discard" title="仮のラインを捨てます">破棄</button>
            </div>
          </div>
          <div class="ce-list-h" id="ce-list-h"><span>登録済みライン</span><button class="btn sm ce-sort" id="ce-sort" data-act="ce-sort">セクター整列</button></div>
          <div id="ce-list" class="ce-list" role="list" aria-label="ラインの一覧"></div>
          <div class="corr-laps" id="ce-lines" role="status"></div>
        </section>
        <section class="ce-group" aria-labelledby="ce-g2">
          <h3 id="ce-g2">ライン移動</h3>
          <div class="sub" id="ce-fine-empty">ラインを選ぶか、新しく引くと、ここで動かせます。</div>
          <div id="ce-fine" class="ce-fine" hidden>
            <div class="sub" id="ce-len"></div>
            <span class="seg sm" role="group" aria-label="動かす場所">
              <button data-act="ce-part" data-part="a" aria-pressed="false">始点</button>
              <button data-act="ce-part" data-part="b" aria-pressed="false">終点</button>
              <button data-act="ce-part" data-part="m" aria-pressed="true" class="on">線全体</button>
            </span>
            <div class="corr-pad" role="group" aria-label="矢印で動かす">
              <button class="ib" data-act="ce-nudge" data-dir="N" aria-label="北へ" title="北へ [↑]">↑</button>
              <button class="ib" data-act="ce-nudge" data-dir="W" aria-label="西へ" title="西へ [←]">←</button>
              <button class="ib" data-act="ce-nudge" data-dir="E" aria-label="東へ" title="東へ [→]">→</button>
              <button class="ib" data-act="ce-nudge" data-dir="S" aria-label="南へ" title="南へ [↓]">↓</button>
            </div>
            <div class="corr-step"><span class="sub">1回の移動量</span>
              <span class="seg sm" role="group" aria-label="1回の移動量">${STEPS.map((s) =>
                `<button data-act="ce-step" data-step="${s}" aria-pressed="${s === 0.1}" class="${s === 0.1 ? 'on' : ''}">${s} m</button>`).join('')}</span>
            </div>
          </div>
        </section>
        <section class="ce-group" aria-labelledby="ce-g3">
          <h3 id="ce-g3">ファイルの読み込み・書き出し</h3>
          <label class="frow2 col"><span>コントロールライン(.cln)を読み込む</span><input id="ce-cln" type="file" accept=".cln" aria-label="コントロールラインのファイル"></label>
          <label class="frow2 col"><span>セクター(.sci)を読み込む</span><input id="ce-sci" type="file" accept=".sci" aria-label="セクターのファイル"></label>
          <div class="btn-row">
            <button class="btn" id="ce-export-cln" data-act="ce-export" data-kind="cln">.cln を書き出す</button>
            <button class="btn" id="ce-export-sci" data-act="ce-export" data-kind="sci">.sci を書き出す</button>
          </div>
        </section>
        <div class="sub">地図を動かして拡大率と位置を決めてください。いま地図に出ている範囲が、このサーキットの表示位置として保存されます。</div>
      </aside>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  let map: TrackMap | null = null;
  let visible = false;
  let editId: string | null = null;
  let control: GeoLine | null = null;
  let sectors: GeoLine[] = [];
  let selected: Key | null = null;
  let nudgeSector = false;               // 比較画面の「セクターを追加・編集…」から来たとき、「セクターを追加」を青にする
  /** 引いたばかりの、まだ確定していないライン(「確定」で一覧に入る) */
  let draft: { kind: 'control' | 'sector'; line: GeoLine } | null = null;
  let drawing: 'control' | 'sector' | null = null;
  let part: Part = 'm';
  let step = 0.1;
  const msg = (t: string) => { $('ce-msg').textContent = t; };

  const label = (k: Key) => (k === 'c' ? '計測ライン' : `S${Number(k.slice(1)) + 1}`);
  const lineOf = (k: Key | null): GeoLine | null => (k === null ? null : k === 'c' ? control : sectors[Number(k.slice(1))] ?? null);
  const setLine = (k: Key, l: GeoLine) => { if (k === 'c') control = l; else sectors[Number(k.slice(1))] = l; };
  const keys = (): Key[] => [...(control ? ['c' as Key] : []), ...sectors.map((_, i) => `s${i}` as Key)];
  /** いま動かす対象: 仮のラインがあればそれ、なければ選んでいるライン */
  const cur = (): GeoLine | null => draft?.line ?? lineOf(selected);
  const setCur = (l: GeoLine) => { if (draft) draft = { ...draft, line: l }; else if (selected) setLine(selected, l); };
  const draftLabel = () => (!draft ? '' : draft.kind === 'control' ? '計測ライン' : `S${sectors.length + 1}`);
  const mid = (l: GeoLine) => ({ lat: (l.a.lat + l.b.lat) / 2, lon: (l.a.lon + l.b.lon) / 2 });

  // ---------- 地図 ----------
  function pushLines(fit = false) {
    const lines = keys().map((k) => ({
      label: label(k), line: lineOf(k)!, kind: k === 'c' ? 'control' as const : 'sector' as const, selected: !draft && k === selected,
    }));
    if (draft) lines.push({ label: `${draftLabel()}(仮)`, line: draft.line, kind: draft.kind, selected: true });
    map?.setLines(lines);
    if (fit && control) map?.fit();
  }
  /** 選んでいるラインのつまみ(始点・終点・線全体)。ドラッグ中は作り直さない */
  function pushHandles() {
    const l = !drawing ? cur() : null;
    if (!map) return;
    if (!l) { map.setHandles([], onHandle); return; }
    const m = mid(l);
    map.setHandles([
      { id: 'a', lat: l.a.lat, lon: l.a.lon }, { id: 'b', lat: l.b.lat, lon: l.b.lon }, { id: 'm', lat: m.lat, lon: m.lon, mid: true },
    ], onHandle);
  }
  function onHandle(id: string, lat: number, lon: number, final: boolean) {
    const l = cur();
    if (!l) return;
    if (id === 'a') setCur({ ...l, a: { lat, lon } });
    else if (id === 'b') setCur({ ...l, b: { lat, lon } });
    else {
      const m = mid(l), dLat = lat - m.lat, dLon = lon - m.lon;
      setCur({ a: { lat: l.a.lat + dLat, lon: l.a.lon + dLon }, b: { lat: l.b.lat + dLat, lon: l.b.lon + dLon } });
    }
    pushLines();
    if (final) { pushHandles(); renderInfo(); }
  }

  // ---------- セクター整列(案件 21) ----------
  /**
   * 並べ替えに使う走行ログ: 表示中の比較セットのログを先に、無ければほかのセットのログから、
   * 計測ラインを通って 1 周を走り切ったラップがある最初のログ。位置補正は、ラインを逆にずらして判定する。
   * 一覧を描き直すたびに調べるので、計測ラインと読み込み済みのログが変わらない間は、結果を使い回す
   */
  let sortCache: { key: string; log: LoadedLog | null } | null = null;
  const back = (l: LoadedLog, g: GeoLine) => shiftLine(g, -l.offset.east, -l.offset.north);
  function sortLog(): LoadedLog | null {
    if (!control) return null;
    const seen = new Set<string>();
    const logs = [session.active, ...session.sets.filter((w) => w !== session.active)].flatMap((w) => w.logs)
      .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
    const key = JSON.stringify([control, logs.map((l) => [l.id, l.offset.east, l.offset.north])]);
    if (sortCache?.key !== key) {
      const c = control;
      sortCache = { key, log: logs.find((l) => sectorPassTimes(l.log, back(l, c), []) !== null) ?? null };
    }
    return sortCache.log;
  }
  /** 「セクター整列」を押せない理由(押せるなら空) */
  function sortBlocked(): string {
    if (!control) return '計測ラインを引いてから使えます';
    if (sectors.length < 2) return 'セクターが 2 本以上あるときに使えます';
    if (draft) return '引いたラインを「確定」か「破棄」してから使えます';
    if (!sortLog()) return '計測ラインを通る走行ログ(1 周を走り切ったもの)が読み込まれていないため、使えません';
    return '';
  }
  /** セクターを、走行ログが通った順に並べ替える(通らないセクターは最後に、元の順で)。選んでいるラインは選んだまま */
  function sortSectors() {
    const log = sortLog();
    if (!log || !control || sortBlocked()) return;
    const times = sectorPassTimes(log.log, back(log, control), sectors.map((g) => back(log, g)));
    if (!times) return;
    const keep = selected && selected !== 'c' ? sectors[Number(selected.slice(1))] : null;
    const order = sectors.map((line, k) => ({ line, k, t: times[k] })).sort((p, q) => p.t - q.t || p.k - q.k);
    const missed = order.filter((x) => x.t === Infinity);
    const same = order.every((x, i) => x.k === i);
    sectors = order.map((x) => x.line);
    if (keep) selected = `s${sectors.indexOf(keep)}`;
    refresh();
    const name = log.log.fileName;
    const miss = missed.length ? ` ${missed.map((x) => `S${sectors.indexOf(x.line) + 1}`).join('・')} は走行ログが通らないため、最後にしました。` : '';
    msg(same ? `すでに通った順です(走行ログ: ${name})。${miss}` : `セクターを通った順に並べ替えました(走行ログ: ${name})。${miss}`);
  }

  // ---------- 表示 ----------
  function renderList() {
    $('ce-list').innerHTML = keys().map((k) => {
      const sec = k !== 'c';
      const i = sec ? Number(k.slice(1)) : -1;
      const l = label(k);
      const lock = draft ? ' disabled' : '';
      return `<div class="ce-row${k === selected ? ' sel' : ''}" role="listitem">
        <button class="btn sm ce-name" data-act="ce-select" data-key="${k}" aria-pressed="${k === selected}"${lock}>${l}</button>
        ${sec ? `<button class="ib" data-act="ce-move" data-key="${k}" data-d="-1" aria-label="${l} を前へ(S${i} と入れ替え)" title="前へ"${i === 0 || draft ? ' disabled' : ''}>↑</button>
        <button class="ib" data-act="ce-move" data-key="${k}" data-d="1" aria-label="${l} を後ろへ" title="後ろへ"${i === sectors.length - 1 || draft ? ' disabled' : ''}>↓</button>` : '<span class="ce-gap"></span><span class="ce-gap"></span>'}
        <button class="ib" data-act="ce-del" data-key="${k}" aria-label="${l} を削除" title="削除"${lock}>×</button></div>`;
    }).join('');
  }
  function renderInfo() {
    $('ce-lines').textContent = control ? `計測ライン あり ・ セクター ${sectors.length} 本` : '計測ライン: 未設定';
    const l = cur();
    $('ce-fine').hidden = !l;
    $('ce-fine-empty').hidden = !!l;
    if (l) {
      const len = distanceM(l.a, l.b);
      const name = draft ? `${draftLabel()}(未確定)` : label(selected!);
      $('ce-len').textContent = `${name} ・ 長さ ${len.toFixed(1)} m${len > LONG_LINE_M ? '(長めです。コースの幅ほどにすると、別の場所の通過を拾いません)' : ''}`;
    }
    $('ce-draft').hidden = !draft;
    if (draft) $('ce-draft-text').textContent = `${draftLabel()} を引きました(未確定)。つまみや矢印キーで直して、「確定」を押してください。`;
    $<HTMLButtonElement>('ce-export-cln').disabled = !control;
    $<HTMLButtonElement>('ce-export-sci').disabled = sectors.length === 0;
    const blocked = sortBlocked();
    $<HTMLButtonElement>('ce-sort').disabled = !!blocked;
    $('ce-sort').title = blocked || 'セクターを、読み込み済みの走行ログが通った順に並べ替えます';
    $<HTMLButtonElement>('ce-draw-control').disabled = !!control;
    $('ce-draw-control').classList.toggle('pri', !control);
    $('ce-draw-sector').classList.toggle('pri', nudgeSector && !!control && !drawing);          // 計測ラインは必ず必要なので、まだ無いうちは青で案内する
    $('ce-draw-control').title = control ? '引き直すときは、一覧の計測ラインの「×」で消してください' : '';
    for (const kind of ['control', 'sector'] as const) {
      const b = $('ce-draw-' + kind);
      b.setAttribute('aria-pressed', String(drawing === kind));
      b.classList.toggle('on', drawing === kind);
    }
    const hint = $('ce-hint');
    hint.hidden = !drawing && !draft;
    hint.textContent = drawing
      ? `地図の上で、${drawing === 'control' ? '計測ライン' : `S${sectors.length + 1}`} の始点から終点までドラッグしてください(拡大して引くと正確です)`
      : draft ? '仮のラインです。直したら、右の欄の「確定」を押してください(Enter でも確定)' : '';
  }
  function refresh(fit = false) {
    renderList(); renderInfo(); pushLines(fit); pushHandles();
    root.querySelectorAll<HTMLElement>('[data-act="ce-part"]').forEach((b) => {
      const on = b.dataset.part === part;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }

  // ---------- 引く → 直す → 確定 ----------
  function setDrawing(kind: 'control' | 'sector' | null) {
    if (kind === 'control' && control) return;                     // 計測ラインは、「×」で消すまで引き直せない
    drawing = kind;
    if (kind) { draft = null; selected = null; nudgeSector = false; }                 // 引き直すときは、前の仮のラインは捨てる
    map?.setDrawMode(kind ? (a, b) => {
      draft = { kind, line: roundLine({ a, b }) };               // 引いただけでは、まだ一覧に入らない
      selected = null;
      drawing = null;
      map?.setDrawMode(null);
      refresh();
    } : null);
    refresh();
  }
  function confirmDraft() {
    if (!draft) return;
    if (draft.kind === 'control') control = draft.line;
    else sectors = [...sectors, draft.line];
    selected = null;                                              // 確定したら選択も外す(そのまま動かせないように)
    draft = null;
    msg('');
    refresh();
    blurFocus();
  }
  function discardDraft() { draft = null; refresh(); blurFocus(); }
  /** 確定・破棄のあと、ボタンのフォーカスを外す(そのまま矢印キーで動かせて確定していないように見えるため) */
  function blurFocus() {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body) a.blur();
  }

  // ---------- 矢印キー・つまみ以外の微調整 ----------
  function nudge(dEast: number, dNorth: number) {
    const l = cur();
    if (!l) return;
    const m = metersPerDegree(l.a.lat);
    const dLat = dNorth / m.lat, dLon = dEast / m.lon;
    const mv = (p: { lat: number; lon: number }) => ({ lat: p.lat + dLat, lon: p.lon + dLon });
    setCur(part === 'a' ? { ...l, a: mv(l.a) } : part === 'b' ? { ...l, b: mv(l.b) } : { a: mv(l.a), b: mv(l.b) });
    pushLines(); pushHandles(); renderInfo();
  }
  const dirDelta = (dir: string, k = 1): [number, number] =>
    dir === 'N' ? [0, step * k] : dir === 'S' ? [0, -step * k] : dir === 'E' ? [step * k, 0] : [-step * k, 0];
  const onKey = (e: KeyboardEvent) => {
    if (!visible || e.ctrlKey || e.metaKey || e.altKey || !cur()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.modal')) return;
    if (e.key === 'Enter' && draft && t?.tagName !== 'BUTTON') { e.preventDefault(); confirmDraft(); return; }
    const dir = ({ ArrowUp: 'N', ArrowDown: 'S', ArrowRight: 'E', ArrowLeft: 'W' } as Record<string, string>)[e.key];
    if (!dir) return;
    e.preventDefault();
    const [x, y] = dirDelta(dir, e.shiftKey ? 10 : 1);
    nudge(x, y);
  };

  // ---------- 住所検索 ----------
  const geocode = deps.geocode ?? gsiGeocode;
  const geoRes = $('ce-geo-res');
  let geoSeq = 0;
  function geoClose() { geoRes.hidden = true; geoRes.innerHTML = ''; }
  function geoNote(text: string) { geoRes.innerHTML = `<div class="geo-note">${esc(text)}</div>`; geoRes.hidden = false; }
  function geoGo(h: GeoHit) {
    geoClose();
    map?.setView(h.lat, h.lon, 17);
  }
  $('ce-geo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $<HTMLInputElement>('ce-geo-q').value.trim();
    if (!q) { geoClose(); return; }
    const seq = ++geoSeq;
    geoNote('検索中...');
    let hits: GeoHit[];
    try { hits = await geocode(q); }
    catch { if (seq === geoSeq) geoNote('検索できませんでした(ネットワークを確認してください)'); return; }
    if (seq !== geoSeq) return;
    if (hits.length === 0) { geoNote('見つかりませんでした'); return; }
    if (hits.length === 1) { geoGo(hits[0]); return; }
    geoRes.innerHTML = hits.map((h, i) => `<button type="button" role="option" class="geo-hit" data-hit="${i}">${esc(h.title)}</button>`).join('');
    geoRes.hidden = false;
    geoRes.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-hit]');
      if (b) geoGo(hits[Number(b.dataset.hit)]);
    };
  });
  $('ce-geo-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { geoSeq++; geoClose(); } e.stopPropagation(); });
  $('ce-geo-q').addEventListener('input', () => { if (!$<HTMLInputElement>('ce-geo-q').value.trim()) { geoSeq++; geoClose(); } });

  // ---------- ファイル ----------
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'ce-cln' && t.id !== 'ce-sci') return;
    const f = t.files?.[0];
    if (!f) return;
    const text = await f.text();
    t.blur();
    if (t.id === 'ce-cln') {
      const line = parseCln(text)[0];
      if (!line) { msg('.cln からコントロールラインを読み取れませんでした。'); return; }
      control = roundLine(line);
      if (!selected) selected = 'c';
      const name = $<HTMLInputElement>('ce-name');
      if (!editId && !name.value) name.value = f.name.replace(/\.cln$/i, '').replace(/^cl_/i, '');
    } else {
      const found = parseSci(text).map((x) => roundLine(x.line));
      if (!found.length) { msg('.sci からセクターを読み取れませんでした。'); return; }
      sectors = found;
      if (selected && selected !== 'c') selected = null;
    }
    msg('');
    refresh(true);
  });

  function exportFile(kind: 'cln' | 'sci') {
    const base = $<HTMLInputElement>('ce-name').value.trim() || 'circuit';
    if (kind === 'cln' && control) downloadText(`cl_${base}.cln`, formatCln([control]));
    if (kind === 'sci' && sectors.length) downloadText(`${base}.sci`, formatSci(sectors));
  }

  // ---------- 保存 ----------
  async function dupWarn(name: string) {
    await alertDialog({ title: '既に名前が存在します', detail: `「${name.trim()}」は登録済みです。別の名前にしてください。` });
    $('ce-name').focus();
  }
  async function save() {
    const name = $<HTMLInputElement>('ce-name').value;
    const view = map?.getView();
    if (draft) { msg('引いたラインを「確定」するか「破棄」してください。'); return; }
    if (!control) { msg('計測ラインを引くか、.cln ファイルを読み込んでください。'); return; }
    if (!editId) {
      const r = session.registerCircuit(name, formatCln([control], LINE_DIGITS), formatSci(sectors, 1, LINE_DIGITS), view);
      if (!r.ok && r.reason === 'duplicate') { msg(''); await dupWarn(name); return; }
      if (!r.ok) { msg(r.message); return; }
      session.message = r.message;
      deps.onDone();
      return;
    }
    const c = session.circuits.find((x) => x.id === editId);
    if (!c) { deps.onDone(); return; }
    if (name.trim() !== c.name) {
      const r = session.renameCircuit(editId, name);
      if (!r.ok && r.reason === 'duplicate') { await dupWarn(name); return; }
      if (!r.ok) { msg(r.message); return; }
    }
    session.setCircuitLines(editId, control, sectors);
    if (view) session.setCircuitView(editId, view);
    deps.onDone();
  }

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'ce-save': void save(); break;
      case 'ce-cancel': deps.onDone(); break;
      case 'ce-draw': setDrawing(drawing === d.kind ? null : (d.kind as 'control' | 'sector')); break;
      case 'ce-select': selected = d.key as Key; setDrawing(null); break;
      case 'ce-confirm': confirmDraft(); break;
      case 'ce-discard': discardDraft(); break;
      case 'ce-del': {
        const k = d.key as Key;
        if (k === 'c') control = null; else sectors = sectors.filter((_, i) => i !== Number(k.slice(1)));
        selected = null;
        refresh();
        break;
      }
      case 'ce-sort': sortSectors(); break;
      case 'ce-move': {
        const i = Number(d.key!.slice(1)), j = i + Number(d.d);
        if (j < 0 || j >= sectors.length) break;
        const next = [...sectors];
        [next[i], next[j]] = [next[j], next[i]];
        sectors = next;
        selected = `s${j}`;
        refresh();
        break;
      }
      case 'ce-part': part = d.part as Part; refresh(); break;
      case 'ce-step':
        step = Number(d.step);
        root.querySelectorAll<HTMLElement>('[data-act="ce-step"]').forEach((b) => {
          const on = Number(b.dataset.step) === step;
          b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
        });
        break;
      case 'ce-nudge': { const [x, y] = dirDelta(d.dir!); nudge(x, y); break; }
      case 'ce-export': exportFile(d.kind as 'cln' | 'sci'); break;
    }
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (visible) map?.invalidate(); }).observe($('ce-map'));
  }

  return {
    show(id: string | null, near?: { lat: number; lon: number }, nudge = false) {
      nudgeSector = nudge;
      const c = id ? session.circuits.find((x) => x.id === id) : undefined;
      if (id && !c) { deps.onDone(); return; }
      visible = true;
      document.addEventListener('keydown', onKey);
      editId = id;
      control = c?.control ?? null;
      sectors = [...(c?.sectors ?? [])];
      selected = null; drawing = null; draft = null; part = 'm';
      $('ce-title').textContent = c ? 'サーキットの編集' : 'サーキットの登録';
      $('ce-save').textContent = c ? '保存' : '登録完了';
      $<HTMLInputElement>('ce-name').value = c?.name ?? '';
      $<HTMLInputElement>('ce-cln').value = '';
      $<HTMLInputElement>('ce-sci').value = '';
      msg('');
      $<HTMLInputElement>('ce-geo-q').value = ''; geoSeq++; geoClose();
      map ??= deps.mapFactory($('ce-map'));
      map.setDrawMode(null);
      refresh();
      map.invalidate();
      const z = deps.zoom?.() ?? 0;
      if (z > 0) {                                   // 設定の倍率(数値)。中心は、登録した表示位置・ライン・走行ログの位置
        if (c?.view) map.setView(c.view.lat, c.view.lon, z);
        else if (control) { map.fit(); const v = map.getView(); map.setView(v.lat, v.lon, z); }
        else if (near) map.setView(near.lat, near.lon, z);
      } else if (c?.view) map.setView(c.view.lat, c.view.lon, c.view.zoom);
      else if (control) map.fit();
      else if (near) map.setView(near.lat, near.lon, 16);
    },
    hide() {
      visible = false;
      draft = null;
      document.removeEventListener('keydown', onKey);
      map?.setDrawMode(null);
      map?.setHandles([], onHandle);
    },
  };
}
