import type { GeoLine, Slot } from '../core';

/** 地図に引く走行ライン。色は呼び出し側が CSS 変数から読んで渡す(地図の線は CSS で色を変えられないため)。 */
/** ヒートマップ用の色分け区間(points の from〜to 番目を color で描く) */
export interface HeatRun { from: number; to: number; color: string }
export interface MapTrack { slot: Slot; points: [number, number][]; color: string; heat?: HeatRun[] }
export interface MapLine {
  label: string; line: GeoLine; kind: 'sector' | 'control';
  /** 編集中に選んでいるライン(目立つ色で描く) */ selected?: boolean;
  /** 補正前のライン(灰色の破線で描き、名前は出さない。案件 15) */ before?: boolean;
}
/** 編集用のつまみ(ドラッグで動かす点) */
export interface EditHandle { id: string; lat: number; lon: number; /** 線全体を動かすつまみ */ mid?: boolean }
/** heading = 進行方向(度、北=0、時計回り)。三角形の向きに使う */
export interface MapCar { slot: Slot; lat: number; lon: number; heading: number; /** 引き出し線の先に出す文字(例: 104kph/+0.22s)。無ければ出さない */ label?: string }

/**
 * 画面が地図に求めることだけを並べた窓口。Leaflet に依存するのは trackMap.ts だけにして、
 * 画面のロジックは地図なしでテストできるようにしている。
 */
export interface TrackMap {
  setTracks(tracks: MapTrack[]): void;
  setLines(lines: MapLine[]): void;
  setCars(cars: MapCar[]): void;
  /** ズームはそのままで、地図の中心を動かす(追従用。アニメーション無し) */
  setCenter(lat: number, lon: number): void;
  /** 利用者が地図をドラッグして動かしたとき */
  onUserDrag(cb: () => void): void;
  /**
   * 位置補正用: 関数を渡すと、地図のドラッグで地図が動かなくなり、代わりにマウスの動きが
   * 緯度・経度の変化量として通知される(ラインを動かすため)。null で通常のドラッグ(地図の移動)に戻る。
   */
  setEditDrag(cb: ((dLat: number, dLon: number) => void) | null): void;
  /**
   * ラインの端点などを動かすつまみを出す(空配列で消す)。ドラッグ中は final=false で何度も、
   * 離したときに final=true で 1 度通知される(ドラッグ中はつまみを作り直さないこと)。
   */
  setHandles(handles: EditHandle[], onMove: (id: string, lat: number, lon: number, final: boolean) => void): void;
  /** ラインを引く: 関数を渡すと、地図の上のドラッグが「始点から終点まで」として通知される(地図は動かない)。null で解除 */
  setDrawMode(cb: ((a: { lat: number; lon: number }, b: { lat: number; lon: number }) => void) | null): void;
  /** 地図の表示位置(中心と拡大率)を指定する / 取得する */
  setView(lat: number, lon: number, zoom: number): void;
  getView(): { lat: number; lon: number; zoom: number };
  /** 走行ラインが全部入るように表示を合わせる */
  fit(): void;
  /** 地図の拡大率が変わったとき(利用者の操作も、プログラムからの変更も通知される) */
  onZoomChange(cb: (zoom: number) => void): void;
  /** 表示領域の大きさが変わったとき(非表示から表示に戻したときなど)に呼ぶ */
  invalidate(): void;
  destroy(): void;
}

export type MapFactory = (el: HTMLElement) => TrackMap;
