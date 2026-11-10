import { Prefs, RATE_CHOICES, SPEED_RANGE, ZOOM_CHOICES, type PrefKey, type PrefValues } from '../store/prefs';
import { type Circuit, type SaveArea, type TileId, tileInRect } from '../core';
import type { MapAreas } from '../store/mapAreas';
import type { TileStore } from '../io/tileStore';
import { applyAreas } from '../io/mapSave';
import { openAreaEditor } from './areaEditor';
import { confirmDialog } from './dialog';
import type { MapFactory } from './mapTypes';

const ZOOM_STOPS = [0, ...ZOOM_CHOICES];   // スライダーの位置 → 倍率(0 = サーキット全体)
const zoomText = (z: number) => (z === 0 ? 'サーキット全体' : `Z${z}`);
/** 速度レンジの最高速度のつまみの文字(右端は「自動」) */
const hiText = (v: number) => (v >= SPEED_RANGE.max ? '自動' : `${v} km/h`);
const rangeText = (lo: number, hi: number) => (hi >= SPEED_RANGE.max ? `${lo} km/h 〜 自動` : `${lo} 〜 ${hi} km/h`);
/** バーの上の位置(0〜1) */
const rangePos = (v: number) => (v - SPEED_RANGE.min) / (SPEED_RANGE.max - SPEED_RANGE.min);

type Opt = { v: string; label: string };
type Plain = { name: string; kind: 'yrange' | 'startpos' | 'autoload' | 'analytics' | 'mapAreas' | 'mapPrefetch' | 'mapPersist'; hint?: string };
type Row =
  | { key: PrefKey; name: string; kind: 'seg'; opts: Opt[]; hint?: string }
  | { key: PrefKey; name: string; kind: 'switch'; on: string; off: string; hint?: string }
  | { key: PrefKey; name: string; kind: 'zoom'; hint?: string };

const GROUPS: { title: string; rows: (Row | Plain)[] }[] = [
  { title: '外観', rows: [
    { key: 'theme', name: 'テーマ', kind: 'seg', opts: [{ v: 'light', label: 'ライト' }, { v: 'dark', label: 'ダーク' }] },
  ] },
  { title: 'マップ', rows: [
    { key: 'mapMode', name: '描画', kind: 'seg', opts: [{ v: 'line', label: '走行ライン' }, { v: 'speed', label: '速度' }, { v: 'accel', label: '加減速' }] },
    { key: 'labels', name: '引き出し線の表示', kind: 'seg', opts: [{ v: 'off', label: '非表示' }, { v: 'speed', label: '速度・差' }, { v: 'name', label: 'カード名' }] },
    { key: 'zoom', name: '倍率', kind: 'zoom', hint: '「サーキット全体」は、比較画面では走行ライン全体が入る倍率、サーキット登録の地図では登録した表示位置です。数値は地図のズームで、比較画面とサーキット登録の地図の両方に使います(それぞれ別に管理します)。' },
    { name: '初期位置', kind: 'startpos', hint: '地図を開いたときの中心です。「地図の中心」は、登録した表示位置(無ければ走行ライン全体)の中心、「コントロールライン」はその線の中心です。' },
    { key: 'follow', name: '追従', kind: 'seg', opts: [{ v: 'fixed', label: '固定' }, { v: 'leader', label: '先頭追従' }, { v: 'A', label: 'A' }, { v: 'B', label: 'B' }, { v: 'C', label: 'C' }, { v: 'D', label: 'D' }],
      hint: '割り当ての無い枠を選んだときは「固定」になります。' },
  ] },
  { title: '地図の保存', rows: [
    { name: '保存範囲', kind: 'mapAreas', hint: '範囲の中で表示した地図(倍率 15〜18)を、この端末に保存し、ネットが無いときにも表示します。範囲を追加したら、ネットのある所で一度、その範囲を見ておいてください。Web 版のみ使えます。' },
    { name: '概略の地図は表示前に保存する', kind: 'mapPrefetch', hint: '概略の地図(倍率 15・16。サーキット全体を見るときの粗い航空写真)を、保存範囲を追加・変更したときに、表示する前にまとめて保存します。無効のときは、ほかの倍率と同じく、表示したときに保存します。' },
    { name: '保存したデータを消されにくくする', kind: 'mapPersist', hint: '端末の空きが少ないときに、ブラウザが保存したデータ(アプリと地図)を消さないよう頼みます(地図の保存範囲があるときだけ)。一度認められると、アプリからは取り消せません(ブラウザの設定で、このサイトのデータを消すと元に戻ります)。' },
  ] },
  { title: '速度グラフ', rows: [
    { name: '速度レンジ', kind: 'yrange', hint: '縦軸の範囲です。左のつまみで最低速度、右のつまみで最高速度を決めます。最高速度を右端にすると「自動」(走行データに合わせて決まります)。' },
    { key: 'xKind', name: '横軸', kind: 'seg', opts: [{ v: 'dist', label: '距離' }, { v: 'time', label: '時間' }],
      hint: '「距離」のときは、地図の再生も距離ベースになります(全車が、基準の車と同じ走行距離の位置に出て、速度だけを比べます)。「時間」のときは、全車が同じ経過時間の位置に出て、タイム差も出ます。' },
  ] },
  { title: '再生・セクター', rows: [
    { key: 'rate', name: '再生速度', kind: 'seg', opts: RATE_CHOICES.map((r) => ({ v: String(r), label: `${r}x` })) },
    { key: 'sync', name: 'セクターボタンの動作', kind: 'seg', opts: [{ v: 'leader', label: '先頭車両' }, { v: 'all', label: '全車一致' }] },
  ] },
  { title: '起動時', rows: [
    { name: '最後の走行データを自動で読み込む', kind: 'autoload', hint: '前回読み込んだファイルと、A〜D の割り当てを元に戻します。ファイルの場所を覚えるので、Electron 版のみ使えます。移動・削除したファイルは読み込まれません。' },
  ] },
  { title: 'プライバシー', rows: [
    { name: '利用状況の送信', kind: 'analytics', hint: 'Web 版では、アプリの改善のため、Google アナリティクスで利用状況(ページの表示、使っている環境など)を送ります。走行ログの中身や位置、ファイル名は送りません。オフにすると送りません。デスクトップ版(Electron)では送りません。' },
  ] },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * 設定タブ。各項目は「最初の状態」を選ぶ。「最後の状態を記憶する」にチェックすると、その項目は前回の状態で始まるので、
 * 選ぶ部分は押せなくなる。
 */
/** 地図の保存(案件 31)に使うもの。store が null(デスクトップ版・使えない環境)なら、項目は押せない */
export interface MapSaveDeps { store: TileStore | null; areas: MapAreas; mapFactory: MapFactory; circuits: () => Circuit[] }

const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function mountSettingsView(root: HTMLElement, prefs: Prefs, onChange: (key: PrefKey | 'yRange' | 'startPos' | 'autoLoad' | 'analytics') => void, onFactoryReset: () => void = () => {}, mapSave?: MapSaveDeps): { refresh(): void } {
  let resetArmed = false;
  let wipeArmed = false;
  const tiles = mapSave?.store ?? null;
  /** 保存範囲ごとの、保存したタイルの枚数と容量(集計中は null) */
  let stats: Map<string, { n: number; bytes: number }> | null = null;
  /** 地図の保存の結果などの案内 */
  let mapMsg = '';
  let busy = false;

  async function refreshStats() {
    if (!tiles || !mapSave) return;
    const list = await tiles.list().catch(() => [] as (TileId & { bytes: number })[]);
    const next = new Map<string, { n: number; bytes: number }>();
    for (const a of mapSave.areas.list()) {
      let n = 0, bytes = 0;
      for (const t of list) if (tileInRect(t, a)) { n++; bytes += t.bytes; }
      next.set(a.id, { n, bytes });
    }
    stats = next;
    render();
  }

  /** 保存範囲が変わったとき・設定を変えたとき: service worker に渡し、範囲の外を消し、必要なら概略の地図を保存する */
  async function sync(o: { prune?: boolean; prefetch?: boolean; viewed?: TileId[] }) {
    if (!tiles || !mapSave) return;
    busy = true; render();
    try {
      // 範囲を決める画面で見えていた地図(表示した地図)を保存する。表示したばかりなので、ほとんどはブラウザの手元から取れる
      if (o.viewed?.length) await tiles.prefetch(o.viewed).catch(() => null);
      const r = await applyAreas(tiles, mapSave.areas.list(), { prune: o.prune, prefetch: (o.prefetch ?? true) && prefs.mapPrefetch, persist: prefs.mapPersist });
      if (r) mapMsg = r.failed ? `概略の地図のうち ${r.failed} 枚を保存できませんでした(ネットにつながっているときに、もう一度開くと保存します)。` : r.saved ? `概略の地図を保存しました(${r.saved} 枚)。` : '';
    } catch { mapMsg = '地図の保存の設定を反映できませんでした。'; }
    busy = false;
    await refreshStats();
  }

  async function editArea(area?: SaveArea) {
    if (!mapSave) return;
    const r = await openAreaEditor({ mapFactory: mapSave.mapFactory, circuits: mapSave.circuits(), area, defaultName: mapSave.areas.defaultName() });
    if (!r) return;
    if (area) mapSave.areas.update(area.id, r.name, r.rect); else mapSave.areas.add(r.name, r.rect);
    mapMsg = '';
    await sync({ prune: !!area, viewed: r.viewed });
  }

  function areasHtml(): string {
    if (!mapSave) return '';
    const list = mapSave.areas.list();
    if (!list.length) return `<div class="map-areas"><div class="map-areas-empty">保存範囲はまだありません。</div></div>`;
    const dis = tiles && !busy ? '' : ' disabled';
    return `<div class="map-areas">${list.map((a) => {
      const st = stats?.get(a.id);
      const size = !tiles ? '' : !st ? '集計中…' : st.n ? `${mb(st.bytes)}(${st.n} 枚)` : 'まだ保存なし';
      return `<div class="marea" data-area="${esc(a.id)}"><span class="marea-name">${esc(a.name)}</span><span class="marea-size">${size}</span>
        <span class="marea-btns"><button type="button" class="btn" data-area-edit="${esc(a.id)}"${dis}>変更</button><button type="button" class="btn" data-area-del="${esc(a.id)}"${dis}>削除</button></span></div>`;
    }).join('')}
      <div class="map-areas-foot"><button type="button" class="btn" data-area-clear${dis}>保存した地図をすべて消す</button></div></div>`;
  }

  function control(r: Row, value: unknown, disabled: boolean): string {
    const dis = disabled ? ' disabled' : '';
    if (r.kind === 'seg') {
      return `<span class="seg slide" role="radiogroup" aria-label="${esc(r.name)}">${r.opts.map((o) =>
        `<button type="button" role="radio" data-set="${r.key}" data-v="${esc(o.v)}" aria-checked="${String(value) === o.v}" class="${String(value) === o.v ? 'on' : ''}"${dis}>${esc(o.label)}</button>`).join('')}</span>`;
    }
    if (r.kind === 'switch') {
      const on = value === true;
      return `<button type="button" role="switch" class="switch${on ? ' on' : ''}" data-switch="${r.key}" aria-checked="${on}" aria-label="${esc(r.name)}"${dis}><i></i></button>`
        + `<span class="swl">${on ? r.on : r.off}</span>`;
    }
    const idx = Math.max(0, ZOOM_STOPS.indexOf(value as number));
    return `<input type="range" class="slider" data-zoom min="0" max="${ZOOM_STOPS.length - 1}" step="1" value="${idx}" aria-label="倍率" aria-valuetext="${zoomText(ZOOM_STOPS[idx])}"${dis}>`
      + `<span class="swl" data-zoom-text>${zoomText(ZOOM_STOPS[idx])}</span>`;
  }

  function render() {
    root.innerHTML = `<div class="settings">
      <p class="sub">各項目で、起動したときの最初の状態を選びます。「最後の状態を記憶する」にチェックした項目は、前回の状態で始まります(チェック中は選べません)。</p>
      ${GROUPS.map((g) => `<section class="ce-group set-group"><h3>${g.title}</h3>${g.rows.map((r) => {
        if (r.kind === 'startpos') {
          const cur = prefs.startPos;
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><span class="seg slide" role="radiogroup" aria-label="初期位置">${
            ([['center', '地図の中心'], ['control', 'コントロールライン']] as const).map(([v, l]) =>
              `<button type="button" role="radio" data-startpos="${v}" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (r.kind === 'autoload') {
          const can = !!window.rllNative, on = prefs.autoLoad && can;
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><button type="button" role="switch" class="switch${on ? ' on' : ''}" data-autoload aria-checked="${on}" aria-label="${r.name}"${can ? '' : ' disabled'}><i></i></button>`
            + `<span class="swl">${on ? '有効' : '無効'}${can ? '' : '(Electron 版のみ)'}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (r.kind === 'analytics') {
          const can = !window.rllNative, on = prefs.analytics && can;      // デスクトップ版は「オフ」のまま変えられない
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><button type="button" role="switch" class="switch${on ? ' on' : ''}" data-analytics aria-checked="${on}" aria-label="${r.name}"${can ? '' : ' disabled'}><i></i></button>`
            + `<span class="swl">${on ? '送信する' : '送信しない'}${can ? '' : '(デスクトップ版では送りません)'}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (r.kind === 'mapAreas') {
          const can = !!tiles && !busy;
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><button type="button" class="btn" data-area-add${can ? '' : ' disabled'}>＋ 範囲を追加</button>`
            + `${tiles ? '' : '<span class="swl">(Web 版のみ)</span>'}</div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}${areasHtml()}`
            + `${mapMsg ? `<div class="shint" data-map-msg>${esc(mapMsg)}</div>` : ''}</div>`;
        }
        if (r.kind === 'mapPrefetch' || r.kind === 'mapPersist') {
          const can = !!tiles && !busy, on = (r.kind === 'mapPrefetch' ? prefs.mapPrefetch : prefs.mapPersist) && !!tiles;
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><button type="button" role="switch" class="switch${on ? ' on' : ''}" data-${r.kind === 'mapPrefetch' ? 'map-prefetch' : 'map-persist'} aria-checked="${on}" aria-label="${r.name}"${can ? '' : ' disabled'}><i></i></button>`
            + `<span class="swl">${on ? '有効' : '無効'}${tiles ? '' : '(Web 版のみ)'}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (r.kind === 'yrange') {
          const { min, max, step } = SPEED_RANGE, lo = prefs.yMin, hi = prefs.yMax ?? max;
          const input = (which: 'min' | 'max', v: number, label: string, text: string) =>
            `<input type="range" data-yrange="${which}"${which === 'min' && rangePos(v) > 0.5 ? ' class="top"' : ''} min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${label}" aria-valuetext="${text}">`;
          const ticks = [0, 100, 200, 300, max].map((v) => `<span style="--at:${rangePos(v)}">${v >= max ? '自動' : v}</span>`).join('');
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl">
            <div class="yrange"><div class="yrange-bar" style="--lo:${rangePos(lo)};--hi:${rangePos(hi)}"><div class="yrange-trk"></div><div class="yrange-fill"></div>
              ${input('min', lo, '最低速度', `${lo} km/h`)}${input('max', hi, '最高速度', hiText(hi))}</div>
              <div class="yrange-ticks" aria-hidden="true">${ticks}</div></div>
            <span class="swl" data-yrange-text>${rangeText(lo, hi)}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (!('key' in r)) return '';
        const it = prefs.get(r.key);
        return `<div class="srow${it.remember ? ' remembered' : ''}" data-key="${r.key}"><div class="sname">${r.name}</div>
          <div class="sctl">${control(r, it.value, it.remember)}</div>
          <label class="srem"><input type="checkbox" data-rem="${r.key}"${it.remember ? ' checked' : ''}> 最後の状態を記憶する</label>
          ${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
      }).join('')}</section>`).join('')}
      <div class="btn-row reset-row"><button type="button" class="btn" data-reset>${resetArmed ? 'もう一度押すと、すべて初期値に戻します' : 'すべて初期値に戻す'}</button>
      <button type="button" class="btn danger wipe-btn" data-wipe>${wipeArmed ? 'もう一度押すと、アプリを初期状態に戻します' : 'アプリを初期状態に戻す'}</button></div>
    </div>`;
  }

  const setVal = (key: PrefKey, raw: string) => {
    const v: unknown = key === 'rate' ? Number(raw) : raw;
    prefs.setValue(key, v as PrefValues[PrefKey]);
    onChange(key);
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const seg = t.closest<HTMLButtonElement>('[data-set]');
    if (seg && !seg.disabled) { resetArmed = false; setVal(seg.dataset.set as PrefKey, seg.dataset.v!); render(); return; }
    const sp = t.closest<HTMLButtonElement>('[data-startpos]');
    if (sp) { resetArmed = false; prefs.setStartPos(sp.dataset.startpos as 'center' | 'control'); onChange('startPos'); render(); return; }
    const al = t.closest<HTMLButtonElement>('[data-autoload]');
    if (al && !al.disabled) { resetArmed = false; prefs.setAutoLoad(!prefs.autoLoad); onChange('autoLoad'); render(); return; }
    const an = t.closest<HTMLButtonElement>('[data-analytics]');
    if (an && !an.disabled) { resetArmed = false; prefs.setAnalytics(!prefs.analytics); onChange('analytics'); render(); return; }
    if (mapSave && tiles && !busy) {
      if (t.closest('[data-area-add]:not([disabled])')) { resetArmed = false; void editArea(); return; }
      const ed = t.closest<HTMLButtonElement>('[data-area-edit]:not([disabled])');
      if (ed) { const a = mapSave.areas.get(ed.dataset.areaEdit!); if (a) void editArea(a); return; }
      const del = t.closest<HTMLButtonElement>('[data-area-del]:not([disabled])');
      if (del) {
        const a = mapSave.areas.get(del.dataset.areaDel!);
        if (a) void confirmDialog({ title: `保存範囲「${a.name}」を削除しますか?`, detail: 'この範囲で保存した地図も消します(ほかの保存範囲と重なる部分は残します)。', ok: '削除する', cancel: 'キャンセル' })
          .then((ok) => { if (ok) { mapSave.areas.remove(a.id); mapMsg = ''; void sync({ prune: true, prefetch: false }); } });
        return;
      }
      if (t.closest('[data-area-clear]:not([disabled])')) {
        void confirmDialog({ title: '保存した地図をすべて消しますか?', detail: '保存範囲は残ります。保存範囲の地図は、次に表示したときに、また保存します。', ok: 'すべて消す', cancel: 'キャンセル' })
          .then(async (ok) => { if (ok) { await tiles.clear(); mapMsg = '保存した地図をすべて消しました。'; await refreshStats(); } });
        return;
      }
      if (t.closest('[data-map-prefetch]:not([disabled])')) {
        resetArmed = false; prefs.setMapPrefetch(!prefs.mapPrefetch); mapMsg = ''; render();
        if (prefs.mapPrefetch) void sync({});
        return;
      }
      if (t.closest('[data-map-persist]:not([disabled])')) {
        resetArmed = false; prefs.setMapPersist(!prefs.mapPersist); render();
        if (prefs.mapPersist && mapSave.areas.list().length) void tiles.persist();
        return;
      }
    }
    const sw = t.closest<HTMLButtonElement>('[data-switch]');
    if (sw && !sw.disabled) {
      resetArmed = false;
      const key = sw.dataset.switch as PrefKey;
      prefs.setValue(key, (!(prefs.get(key).value as unknown as boolean)) as never);
      onChange(key); render(); return;
    }
    if (t.closest('[data-wipe]')) {
      if (!wipeArmed) { wipeArmed = true; resetArmed = false; render(); return; }
      wipeArmed = false;
      onFactoryReset();
      return;
    }
    if (t.closest('[data-reset]')) {
      wipeArmed = false;
      if (!resetArmed) { resetArmed = true; render(); return; }
      resetArmed = false;
      prefs.reset();
      render();
      (['theme', 'mapMode', 'labels', 'zoom', 'follow', 'xKind', 'sync', 'rate', 'yRange', 'startPos', 'autoLoad', 'analytics'] as const).forEach((k) => onChange(k));
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-rem]')) {
      resetArmed = false;
      prefs.setRemember(t.dataset.rem as PrefKey, t.checked);
      onChange(t.dataset.rem as PrefKey);
      render();
    }
  });

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-zoom]')) {
      const z = ZOOM_STOPS[Number(t.value)];
      prefs.setValue('zoom', z);
      t.setAttribute('aria-valuetext', zoomText(z));
      root.querySelector('[data-zoom-text]')!.textContent = zoomText(z);
      onChange('zoom');
    } else if (t.matches('[data-yrange]')) {
      // 2 つのつまみは、SPEED_RANGE.gap より近づけない(動かしたほうのつまみを止める)
      const { max, gap } = SPEED_RANGE;
      const loEl = root.querySelector<HTMLInputElement>('[data-yrange="min"]')!, hiEl = root.querySelector<HTMLInputElement>('[data-yrange="max"]')!;
      let lo = Number(loEl.value), hi = Number(hiEl.value);
      if (t === loEl && lo > hi - gap) { lo = hi - gap; loEl.value = String(lo); }
      if (t === hiEl && hi < lo + gap) { hi = lo + gap; hiEl.value = String(hi); }
      prefs.setSpeedRange(lo, hi >= max ? null : hi);
      loEl.setAttribute('aria-valuetext', `${lo} km/h`);
      hiEl.setAttribute('aria-valuetext', hiText(hi));
      const bar = loEl.parentElement!;
      bar.style.setProperty('--lo', String(rangePos(lo)));
      bar.style.setProperty('--hi', String(rangePos(hi)));
      // 重なったときに、右端に寄った最低速度のつまみもつかめるように、右半分では最低速度を上にする
      loEl.classList.toggle('top', rangePos(lo) > 0.5);
      root.querySelector('[data-yrange-text]')!.textContent = rangeText(lo, hi);
      onChange('yRange');
    }
  });

  render();
  void refreshStats();
  return { refresh: () => { render(); void refreshStats(); } };
}
