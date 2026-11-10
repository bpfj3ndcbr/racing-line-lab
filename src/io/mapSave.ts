import { type SaveArea, prefetchTilesOf, tileInAreas } from '../core';
import type { TileStore } from './tileStore';

/**
 * 地図の保存(案件 31)で、保存範囲や設定が変わったとき・起動したときに行うこと。
 * - 保存範囲を service worker に渡す
 * - prune: 範囲の外になったタイルを消す(範囲を変えた・消したとき)
 * - prefetch: 概略の地図(Z15・Z16)のうち、まだ保存していない分を保存する
 * - persist: 保存したデータを消されにくくするよう、ブラウザに頼む(範囲が 1 つ以上あるときだけ)
 * 戻り値は、先読みで保存した・できなかった枚数(先読みしなければ null)
 */
export async function applyAreas(store: TileStore, areas: SaveArea[], o: { prune?: boolean; prefetch: boolean; persist: boolean }):
  Promise<{ saved: number; failed: number } | null> {
  await store.setAreas(areas);
  if (o.prune) await store.remove((t) => !tileInAreas(t, areas));
  if (o.persist && areas.length) await store.persist();
  return o.prefetch && areas.length ? store.prefetch(prefetchTilesOf(areas)) : null;
}
