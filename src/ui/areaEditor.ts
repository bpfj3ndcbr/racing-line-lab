import {
  type Circuit, type GeoBox, type SaveArea, type TileId, type TileRect, boxContains, visibleTilesIn, gridLines, rectSizeM, rectToBox, rectWithinLimit, snapBox, tileCounts,
} from '../core';
import type { EditHandle, MapFactory, TrackMap } from './mapTypes';

/**
 * 地図の保存範囲を決める画面(案件 31。「設定」の「地図の保存」から開く)。
 * 保存範囲は黄色の四角 1 つ。四隅のつまみで大きさを、真ん中のつまみで位置を変える(マウスでも指でも)。
 * つまみを離すと、四角の辺は一番近い Z18 の地図の区切り線に吸い付く。地図は四角の外をドラッグして動かす。
 */
export interface AreaEditorOptions {
  mapFactory: MapFactory;
  circuits: Circuit[];
  /** 変更するときの範囲(無ければ追加) */
  area?: SaveArea;
  /** 名前が無いときの名前(「範囲 N」) */
  defaultName: string;
  host?: HTMLElement;
}
export interface AreaEditorResult {
  name: string; rect: TileRect;
  /**
   * この画面の地図に見えていた、範囲の中のタイル。同じ画面の中では、一度表示した地図をブラウザが使い回して
   * 取りに行かない(service worker を通らない)ので、追加したときに、見えていた分を保存するのに使う
   */
  viewed: TileId[];
}

/** 追加のときの最初の四角(地図の表示領域の幅・高さに対する、周りの余白の割合。0.2 = 真ん中の 6 割) */
export const START_INSET = 0.2;
/** タイル 1 枚のおよその大きさ(バイト。容量の目安に使う) */
const TILE_BYTES_GUESS = 20 * 1024;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** サーキットの代表の位置(登録した表示位置、無ければコントロールラインの中心) */
function circuitCenter(c: Circuit): { lat: number; lon: number; zoom: number } {
  if (c.view) return c.view;
  return { lat: (c.control.a.lat + c.control.b.lat) / 2, lon: (c.control.a.lon + c.control.b.lon) / 2, zoom: 15 };
}

/** 範囲の大きさと枚数の説明 */
export function areaInfo(r: TileRect): string {
  const { w, h } = rectSizeM(r), c = tileCounts(r);
  const total = c[15] + c[16] + c[17] + c[18];
  return `保存範囲: ${km(w)} × ${km(h)}(Z18 で ${r.x1 - r.x0} × ${r.y1 - r.y0} 枚。Z15〜18 をすべて見ると、合わせて ${total} 枚・約 ${mb(total * TILE_BYTES_GUESS)})`;
}

export function openAreaEditor(o: AreaEditorOptions): Promise<AreaEditorResult | null> {
  const host = o.host ?? document.body;
  const editing = !!o.area;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal area-ed" role="dialog" aria-modal="true" aria-labelledby="area-ed-h">
    <h3 id="area-ed-h">${editing ? '保存範囲を変更' : '保存範囲を追加'}</h3>
    <p class="area-ed-hint">黄色の四角の角(丸いつまみ)をつまんで、保存したい範囲に合わせてください。真ん中のつまみで四角を動かせます。</p>
    ${o.circuits.length ? `<label class="area-ed-goto"><span>サーキットへ移動</span><select data-area-goto aria-label="サーキットへ移動">
      <option value="">選んでください</option>${o.circuits.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    <div class="area-ed-map"><div class="map" data-area-map></div></div>
    <p class="area-ed-info" data-area-info></p>
    <p class="area-ed-warn" data-area-warn hidden>範囲が広すぎます(一辺 5 km まで)。四角を小さくしてください。</p>
    <label class="modal-field"><span>名前</span><input type="text" data-area-name maxlength="30" value="${esc(o.area?.name ?? '')}"></label>
    <div class="modal-actions"><button type="button" class="btn" data-area-cancel>キャンセル</button>
      <button type="button" class="btn pri" data-area-ok>${editing ? 'この範囲に変更' : 'この範囲を追加'}</button></div>
  </div>`;
  host.appendChild(back);
  const $ = <T extends HTMLElement>(sel: string) => back.querySelector<T>(sel)!;
  const mapEl = $('[data-area-map]'), nameEl = $<HTMLInputElement>('[data-area-name]');
  const map: TrackMap = o.mapFactory(mapEl);
  let nameTouched = !!o.area;

  /** 地図の表示領域の大きさ(jsdom では 0 なので、仮の大きさ) */
  const size = () => ({ w: mapEl.clientWidth || 800, h: mapEl.clientHeight || 600 });
  /** 地図に見えている範囲 */
  function viewBox(): GeoBox {
    const { w, h } = size();
    const tl = map.containerToLatLon(0, 0), br = map.containerToLatLon(w, h);
    return { north: tl.lat, west: tl.lon, south: br.lat, east: br.lon };
  }
  /** 見えている範囲の真ん中の 6 割を、区切りにそろえた四角 */
  function startRect(): TileRect {
    const { w, h } = size();
    const a = map.containerToLatLon(w * START_INSET, h * START_INSET), b = map.containerToLatLon(w * (1 - START_INSET), h * (1 - START_INSET));
    return snapBox({ north: a.lat, west: a.lon, south: b.lat, east: b.lon });
  }

  // 最初の表示位置と四角: 変更なら保存してある範囲、追加なら(最初の)サーキットの位置で、見えている範囲の真ん中の 6 割
  if (o.area) map.fitBox(rectToBox(o.area), 0.15);
  else { const c = o.circuits[0]; if (c) { const v = circuitCenter(c); map.setView(v.lat, v.lon, v.zoom); } }
  let rect: TileRect = o.area ? { x0: o.area.x0, y0: o.area.y0, x1: o.area.x1, y1: o.area.y1 } : startRect();
  /** つまみを動かしている途中の四角(区切りにそろえる前)。動かしていなければ null */
  let dragging: GeoBox | null = null;

  /** 四角の中にコントロールラインがある登録済みサーキットの名前 */
  const circuitIn = (r: TileRect) => {
    const b = rectToBox(r);
    return o.circuits.find((c) => boxContains(b, (c.control.a.lat + c.control.b.lat) / 2, (c.control.a.lon + c.control.b.lon) / 2))?.name ?? null;
  };

  /** つまみ: 四隅(大きさ)と真ん中(位置) */
  function handles(): EditHandle[] {
    const b = rectToBox(rect);
    return [
      { id: 'nw', lat: b.north, lon: b.west }, { id: 'ne', lat: b.north, lon: b.east },
      { id: 'sw', lat: b.south, lon: b.west }, { id: 'se', lat: b.south, lon: b.east },
      { id: 'c', lat: (b.north + b.south) / 2, lon: (b.west + b.east) / 2, mid: true },
    ];
  }
  /** つまみを (lat, lon) へ動かしたときの四角(区切りにそろえる前) */
  function moved(id: string, lat: number, lon: number): GeoBox {
    const b = rectToBox(rect);
    if (id === 'c') {
      const dLat = lat - (b.north + b.south) / 2, dLon = lon - (b.west + b.east) / 2;
      return { north: b.north + dLat, south: b.south + dLat, west: b.west + dLon, east: b.east + dLon };
    }
    // 動かした角と、その対角(動かない)で四角を作る。角を追い越しても、向きをそろえる
    const fixLat = id[0] === 'n' ? b.south : b.north, fixLon = id[1] === 'w' ? b.east : b.west;
    return { north: Math.max(lat, fixLat), south: Math.min(lat, fixLat), west: Math.min(lon, fixLon), east: Math.max(lon, fixLon) };
  }
  function onHandle(id: string, lat: number, lon: number, final: boolean) {
    const b = moved(id, lat, lon);
    if (!final) { dragging = b; update(); return; }          // 動かしている途中は、つまみを作り直さない
    dragging = null;
    if (id === 'c') {
      // 移動は、大きさを変えずに、区切りの数だけずらす
      const s = snapBox(b), w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
      const cx = Math.round((s.x0 + s.x1 - w) / 2), cy = Math.round((s.y0 + s.y1 - h) / 2);
      rect = { x0: cx, y0: cy, x1: cx + w, y1: cy + h };
    } else rect = snapBox(b);
    map.setHandles(handles(), onHandle);
    update();
  }

  function update() {
    const shown = dragging ? snapBox(dragging) : rect;           // 説明は、離したときの四角で出す
    map.setGuide({ grid: map.getView().zoom >= 15 ? gridLines(viewBox()) : [], box: dragging ?? rectToBox(rect) });
    const ok = rectWithinLimit(shown);
    $('[data-area-info]').textContent = areaInfo(shown);
    $('[data-area-warn]').hidden = ok;
    $<HTMLButtonElement>('[data-area-ok]').disabled = !ok || !!dragging;
    if (!nameTouched) nameEl.value = circuitIn(shown) ?? o.defaultName;
  }

  map.setHandles(handles(), onHandle);
  map.onViewChange(() => update());                          // 地図を動かしても、四角(保存範囲)は変わらない。区切り線だけ描き直す
  update();
  requestAnimationFrame(() => { map.invalidate(); update(); });

  return new Promise((resolve) => {
    const close = (v: AreaEditorResult | null) => {
      document.removeEventListener('keydown', onKey, true);
      map.destroy();
      back.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    nameEl.addEventListener('input', () => { nameTouched = true; });
    back.querySelector<HTMLSelectElement>('[data-area-goto]')?.addEventListener('change', (e) => {
      const c = o.circuits.find((x) => x.id === (e.target as HTMLSelectElement).value);
      if (!c) return;
      const v = circuitCenter(c);
      map.setView(v.lat, v.lon, v.zoom);
      rect = startRect();                                     // 移った先で、四角を作り直す
      map.setHandles(handles(), onHandle);
      update();
    });
    $('[data-area-cancel]').addEventListener('click', () => close(null));
    $('[data-area-ok]').addEventListener('click', () => {
      if (!rectWithinLimit(rect)) return;
      close({ name: nameEl.value.trim() || o.defaultName, rect, viewed: visibleTilesIn(viewBox(), map.getView().zoom, rect) });
    });
  });
}
