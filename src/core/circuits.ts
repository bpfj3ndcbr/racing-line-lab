import type { TrackLog } from './types';
import { type GeoLine, type Offset } from './geo';
import { findCrossings } from './laps';

/** 地図の表示位置(登録時に保存する。中心の緯度・経度と拡大率) */
export interface MapView { lat: number; lon: number; zoom: number }

export interface Circuit {
  id: string;
  name: string;
  /** 登録時に決めた地図の表示位置(無ければ走行ラインに合わせて表示する) */
  view?: MapView;
  /** コントロールライン(計測ライン) */
  control: GeoLine;
  /** セクターライン(S1, S2, … の順) */
  sectors: GeoLine[];
}

export interface CircuitMatch { circuit: Circuit; crossings: number }

/**
 * 走行ログがどのサーキットのものかを、コントロールラインの通過回数で判定する。
 * 通過が1回以上ある中で最多のものを返す(同数なら先に登録されたもの)。無ければ null。
 */
export function matchCircuit(log: TrackLog, circuits: Circuit[], offset?: Offset): CircuitMatch | null {
  let best: CircuitMatch | null = null;
  for (const circuit of circuits) {
    const n = findCrossings(log, circuit.control, { offset }).length;
    if (n > 0 && (!best || n > best.crossings)) best = { circuit, crossings: n };
  }
  return best;
}

/** 名前の比較用に正規化(全角/半角、大文字/小文字、前後の空白の違いを無視する) */
export const normalizeName = (s: string): string => s.normalize('NFKC').trim().toLowerCase();

/** 同じ名前のサーキットが既にあるか。exceptId は名前変更時に自分自身を除くために使う。 */
export function nameExists(circuits: Circuit[], name: string, exceptId?: string): boolean {
  const n = normalizeName(name);
  return circuits.some((c) => c.id !== exceptId && normalizeName(c.name) === n);
}
