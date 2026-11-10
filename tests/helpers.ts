import type { TrackLog } from '../src/core';
import type { MapCar, MapGuide, MapLine, MapTrack, TrackMap } from '../src/ui/mapTypes';
import { type GeoBox, latToTileY, lonToTileX, tileXToLon, tileYToLat } from '../src/core';

/**
 * ログの先頭から ratio の割合だけを取り出す。始点と終点が離れるので、1 周分のログ(輪)としては扱われない。
 * 1 周分のテスト用のログ(20260913140139_UTC.vbo)で、「完了ラップが無いログ」の動作を確かめるのに使う
 */
export function headOf(log: TrackLog, ratio: number): TrackLog {
  const n = Math.floor(log.t.length * ratio);
  const cut = (a: Float64Array | undefined) => a?.slice(0, n);
  return {
    ...log, t: log.t.slice(0, n), lat: log.lat.slice(0, n), lon: log.lon.slice(0, n), speed: log.speed.slice(0, n),
    heading: cut(log.heading), height: cut(log.height), longAcc: cut(log.longAcc), latAcc: cut(log.latAcc),
  };
}

/** 地図の代わりに、呼ばれた内容を覚えておくだけの偽物(Leaflet を使わずに画面を試験する) */
export class FakeMap implements TrackMap {
  tracks: MapTrack[] = [];
  lines: MapLine[] = [];
  cars: MapCar[] = [];
  centers: [number, number][] = [];
  dragCb: (() => void) | null = null;
  fitted = 0;
  invalidated = 0;
  destroyed = false;
  setTracks(t: MapTrack[]) { this.tracks = t; }
  setLines(l: MapLine[]) { this.lines = l; }
  setCars(c: MapCar[]) { this.cars = c; }
  setCenter(lat: number, lon: number) { this.centers.push([lat, lon]); }
  onUserDrag(cb: () => void) { this.dragCb = cb; }
  /** 利用者が地図をドラッグした、という操作を再現する */
  userDrags() { this.dragCb?.(); }
  editCb: ((dLat: number, dLon: number) => void) | null = null;
  setEditDrag(cb: ((dLat: number, dLon: number) => void) | null) { this.editCb = cb; }
  /** 位置補正で、地図の上をドラッグした(緯度・経度の変化量)を再現する */
  dragTrack(dLat: number, dLon: number) { this.editCb?.(dLat, dLon); }
  handles: { id: string; lat: number; lon: number }[] = [];
  handleCb: ((id: string, lat: number, lon: number, final: boolean) => void) | null = null;
  setHandles(h: { id: string; lat: number; lon: number }[], cb: (id: string, lat: number, lon: number, final: boolean) => void) { this.handles = h; this.handleCb = cb; }
  /** つまみをドラッグした(途中は final=false、離したら true)を再現する */
  moveHandle(id: string, lat: number, lon: number, final = true) { this.handleCb?.(id, lat, lon, final); }
  drawCb: ((a: { lat: number; lon: number }, b: { lat: number; lon: number }) => void) | null = null;
  setDrawMode(cb: ((a: { lat: number; lon: number }, b: { lat: number; lon: number }) => void) | null) { this.drawCb = cb; }
  /** 地図の上で始点から終点までドラッグして、ラインを引いた */
  drawLine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) { this.drawCb?.(a, b); }
  view = { lat: 33.0385, lon: 130.9735, zoom: 15 };
  viewSet: [number, number, number][] = [];
  setView(lat: number, lon: number, zoom: number) { this.view = { lat, lon, zoom }; this.viewSet.push([lat, lon, zoom]); }
  getView() { return this.view; }
  fit() { this.fitted++; }
  zoomCb: ((zoom: number) => void) | null = null;
  onZoomChange(cb: (zoom: number) => void) { this.zoomCb = cb; }
  /** 利用者が地図を拡大・縮小した、を再現する */
  userZooms(z: number) { this.zoomCb?.(z); }
  /** 地図の表示領域の大きさ(containerToLatLon の計算に使う) */
  size = { w: 800, h: 600 };
  viewCb: (() => void) | null = null;
  onViewChange(cb: () => void) { this.viewCb = cb; }
  /** 利用者が地図を動かした・拡大縮小した、を再現する */
  userMoves(lat: number, lon: number, zoom = this.view.zoom) { this.view = { lat, lon, zoom }; this.viewCb?.(); }
  containerToLatLon(x: number, y: number) {
    const { lat, lon, zoom } = this.view;
    const px = lonToTileX(lon, zoom) * 256 + (x - this.size.w / 2), py = latToTileY(lat, zoom) * 256 + (y - this.size.h / 2);
    return { lat: tileYToLat(py / 256, zoom), lon: tileXToLon(px / 256, zoom) };
  }
  boxesFitted: GeoBox[] = [];
  fitBox(b: GeoBox) { this.boxesFitted.push(b); this.view = { ...this.view, lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2 }; }
  guide: MapGuide | null = null;
  setGuide(g: MapGuide | null) { this.guide = g; }
  invalidate() { this.invalidated++; }
  destroy() { this.destroyed = true; }
}
