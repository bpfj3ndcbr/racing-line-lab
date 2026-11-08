import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapCar, MapFactory, MapLine, MapTrack, TrackMap } from './mapTypes';
import type { Slot } from '../core';
import { labelOffset } from './labelDir';

/** 国土地理院「シームレス空中写真」。実画像は Z18 まで。Z19〜20 は Z18 を拡大して表示する(デジタルズーム)。 */
const GSI_PHOTO = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>(シームレス空中写真)';

/**
 * 走行ラインの太さ。地図を縮小すると、コースがぎっしり見えるので、線も細くして
 * コースを埋め尽くさないようにする。基準の拡大率(Z19)で 4px、それより拡大しても 4px のまま、
 * 縮小すると 1段階ごとに半分(実際の道幅に比例)になり、1px より細くはしない。
 */
export const LINE_WIDTH = 4;
export const HEAT_WIDTH = 4;
export const WIDTH_REF_ZOOM = 19;
export const MIN_LINE_WIDTH = 1;

export function lineWidth(zoom: number, base: number): number {
  return Math.max(MIN_LINE_WIDTH, Math.min(base, base * 2 ** (zoom - WIDTH_REF_ZOOM)));
}

const CAR_SIZE = 16;
const carIcon = (slot: Slot) => L.divIcon({
  className: `car car-${slot.toLowerCase()}`,
  html: '<svg class="car-tri" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,1 15,15 1,15"/></svg>',
  iconSize: [CAR_SIZE, CAR_SIZE],
  iconAnchor: [CAR_SIZE / 2, CAR_SIZE / 2],
});

/** 引き出し線と文字。向きは進行方向で変わるので、線と文字の位置は setCars のたびに DOM で更新する */
const labelIcon2 = (slot: Slot) => L.divIcon({
  className: `car-lbl car-lbl-${slot.toLowerCase()}`,
  html: '<svg class="lbl-line" style="left:-100px;top:-100px" width="200" height="200" viewBox="-100 -100 200 200" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0"/></svg><span class="lbl-txt"></span>',
  iconSize: [0, 0],
});

export const createLeafletMap: MapFactory = (el): TrackMap => {
  // keyboard:false … 矢印キー・+/- で地図が動かないようにする(キーは再生の操作に使う)
  const map = L.map(el, { preferCanvas: true, minZoom: 10, maxZoom: 20, zoomControl: false, keyboard: false });
  L.control.zoom({ position: 'bottomleft', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(map);
  map.setView([33.0385, 130.9735], 15);
  L.tileLayer(GSI_PHOTO, { maxNativeZoom: 18, maxZoom: 20, attribution: GSI_ATTRIBUTION }).addTo(map);

  const trackLayer = L.layerGroup().addTo(map);
  const lineLayer = L.layerGroup().addTo(map);
  const cars = new Map<Slot, L.Marker>();
  const labels = new Map<Slot, L.Marker>();
  let bounds: L.LatLngBounds | null = null;
  let lineBounds: L.LatLngBounds | null = null;
  let widthLayers: { layer: L.Polyline; base: number }[] = [];
  const applyWidths = () => { const z = map.getZoom(); for (const t of widthLayers) t.layer.setStyle({ weight: lineWidth(z, t.base) }); };
  map.on('zoom', applyWidths);
  map.on('zoomend', applyWidths);

  const labelIcon = (text: string, cls: string) =>
    L.divIcon({ className: `map-label ${cls}`, html: `<span>${text}</span>`, iconSize: [0, 0] });

  // 位置補正: ドラッグでラインを動かす(地図は動かさない)
  let editCb: ((dLat: number, dLon: number) => void) | null = null;
  let lastPos: L.LatLng | null = null;
  const stopDrag = () => { lastPos = null; };
  map.on('mousedown', (e) => { if (editCb) lastPos = e.latlng; });
  map.on('mousemove', (e) => {
    if (!editCb || !lastPos) return;
    editCb(e.latlng.lat - lastPos.lat, e.latlng.lng - lastPos.lng);
    lastPos = e.latlng;
  });
  map.on('mouseup', stopDrag);
  window.addEventListener('mouseup', stopDrag);

  // ラインを引く(ドラッグで始点〜終点)
  let drawCb: ((a: { lat: number; lon: number }, b: { lat: number; lon: number }) => void) | null = null;
  let drawFrom: L.LatLng | null = null;
  let drawTo: L.LatLng | null = null;
  let rubber: L.Polyline | null = null;
  const clearRubber = () => { rubber?.remove(); rubber = null; drawFrom = null; drawTo = null; };
  map.on('mousedown', (e) => { if (drawCb) { drawFrom = e.latlng; drawTo = e.latlng; } });
  map.on('mousemove', (e) => {
    if (!drawCb || !drawFrom) return;
    drawTo = e.latlng;
    if (rubber) rubber.setLatLngs([drawFrom, drawTo]);
    else rubber = L.polyline([drawFrom, drawTo], { color: '#00e5ff', weight: 3, dashArray: '6 4', interactive: false }).addTo(map);
  });
  map.on('mouseup', () => {
    const a = drawFrom, b = drawTo, cb = drawCb;
    clearRubber();
    // 1m 未満(クリックだけ)は、ラインとして扱わない
    if (cb && a && b && a.distanceTo(b) >= 1) cb({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
  });
  window.addEventListener('mouseup', clearRubber);

  // 編集用のつまみ(端点・線の中心)
  const handleLayer = L.layerGroup().addTo(map);

  return {
    setDrawMode(cb) {
      drawCb = cb; clearRubber();
      if (cb) map.dragging.disable(); else if (!editCb) map.dragging.enable();
      el.classList.toggle('draw-mode', !!cb);
    },
    setHandles(handles, onMove) {
      handleLayer.clearLayers();
      for (const h of handles) {
        const icon = L.divIcon({ className: `edit-handle${h.mid ? ' mid' : ''}`, html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
        const m = L.marker([h.lat, h.lon], { icon, draggable: true, keyboard: false, zIndexOffset: 2000 }).addTo(handleLayer);
        m.on('drag', () => { const p = m.getLatLng(); onMove(h.id, p.lat, p.lng, false); });
        m.on('dragend', () => { const p = m.getLatLng(); onMove(h.id, p.lat, p.lng, true); });
      }
    },
    setEditDrag(cb) {
      editCb = cb; lastPos = null;
      if (cb) map.dragging.disable(); else map.dragging.enable();
      el.classList.toggle('edit-drag', !!cb);
    },
    setTracks(tracks: MapTrack[]) {
      trackLayer.clearLayers();
      bounds = null;
      widthLayers = [];
      for (const t of tracks) {
        const ll = t.points.map(([lat, lon]) => L.latLng(lat, lon));
        if (!ll.length) continue;
        if (t.heat) {
          // ヒートマップ: 縁取り無しで、加減速の色だけを細く描く(車の見分けは三角形の色で)
          for (const r of t.heat) {
            const layer = L.polyline(ll.slice(r.from, r.to + 1), { color: r.color, weight: HEAT_WIDTH, opacity: 1, interactive: false, lineCap: 'butt' }).addTo(trackLayer);
            widthLayers.push({ layer, base: HEAT_WIDTH });
          }
        } else {
          const layer = L.polyline(ll, { color: t.color, weight: LINE_WIDTH, opacity: 1, interactive: false }).addTo(trackLayer);
          widthLayers.push({ layer, base: LINE_WIDTH });
        }
        const b = L.latLngBounds(ll);
        bounds = bounds ? bounds.extend(b) : b;
      }
      applyWidths();
    },
    setLines(lines: MapLine[]) {
      lineLayer.clearLayers();
      lineBounds = null;
      for (const l of lines) {
        const a = L.latLng(l.line.a.lat, l.line.a.lon), b = L.latLng(l.line.b.lat, l.line.b.lon);
        lineBounds = lineBounds ? lineBounds.extend(a).extend(b) : L.latLngBounds([a, b]);
        if (l.before) {
          // 補正前: 灰色の破線(補正後の線の下に描くため、配列の先に置くこと)。名前は出さない
          L.polyline([a, b], { color: '#000', weight: 5, opacity: 0.35, interactive: false }).addTo(lineLayer);
          L.polyline([a, b], { color: '#d0d0d0', weight: 3, opacity: 1, dashArray: '6 5', interactive: false }).addTo(lineLayer);
          continue;
        }
        const color = l.selected ? '#00e5ff' : l.kind === 'control' ? '#ffd23f' : '#ffffff';
        L.polyline([a, b], { color: '#000', weight: 6, opacity: 0.4, interactive: false }).addTo(lineLayer);
        L.polyline([a, b], { color, weight: l.selected ? 4 : 3, opacity: 1, interactive: false }).addTo(lineLayer);
        L.marker(b, { icon: labelIcon(l.label, l.kind), interactive: false, keyboard: false }).addTo(lineLayer);
      }
    },
    setCars(list: MapCar[]) {
      const live = new Set(list.map((c) => c.slot));
      for (const [slot, m] of cars) if (!live.has(slot)) { m.remove(); cars.delete(slot); }
      for (const c of list) {
        const pos = L.latLng(c.lat, c.lon);
        let m = cars.get(c.slot);
        if (m) m.setLatLng(pos);
        else {
          m = L.marker(pos, { icon: carIcon(c.slot), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
          cars.set(c.slot, m);
        }
        // 三角形を進行方向へ向ける
        const tri = m.getElement()?.querySelector<SVGElement>('.car-tri');
        if (tri) tri.style.transform = `rotate(${Math.round(c.heading)}deg)`;
        // 引き出し線と文字(画面上の位置は車からの一定のずれなので、地図を動かしても付いてくる)
        let lm = labels.get(c.slot);
        if (c.label === undefined) { if (lm) { lm.remove(); labels.delete(c.slot); } continue; }
        if (lm) lm.setLatLng(pos);
        else {
          lm = L.marker(pos, { icon: labelIcon2(c.slot), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map);
          labels.set(c.slot, lm);
        }
        const el = lm.getElement();
        const txt = el?.querySelector<HTMLElement>('.lbl-txt');
        if (txt && txt.textContent !== c.label) txt.textContent = c.label;
        const [dx, dy] = labelOffset(c.slot, c.heading);
        const ln = el?.querySelector<SVGLineElement>('line');
        if (ln) { ln.setAttribute('x2', String(dx)); ln.setAttribute('y2', String(dy)); }
        if (txt) {
          txt.style.left = `${dx}px`; txt.style.top = `${dy}px`;
          txt.style.transform = `translate(${dx < -8 ? '-100%' : dx > 8 ? '0' : '-50%'},${Math.abs(dx) <= 8 ? (dy < 0 ? '-100%' : '0') : '-50%'})`;
        }
      }
      for (const [slot, lm] of labels) if (!live.has(slot)) { lm.remove(); labels.delete(slot); }
    },
    setCenter(lat: number, lon: number) { map.panTo(L.latLng(lat, lon), { animate: false }); },
    onUserDrag(cb: () => void) { map.on('dragstart', cb); },
    fit() { const b = bounds ?? lineBounds; if (b) map.fitBounds(b, { padding: [32, 32], maxZoom: 18, animate: false }); },
    setView(lat, lon, zoom) { map.setView([lat, lon], zoom, { animate: false }); },
    getView() { const c = map.getCenter(); return { lat: c.lat, lon: c.lng, zoom: map.getZoom() }; },
    onZoomChange(cb: (zoom: number) => void) { map.on('zoomend', () => cb(map.getZoom())); },
    invalidate() { map.invalidateSize(); },
    destroy() { window.removeEventListener('mouseup', stopDrag); window.removeEventListener('mouseup', clearRubber); map.remove(); },
  };
};
