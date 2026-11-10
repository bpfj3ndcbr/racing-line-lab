import { type SaveArea, type TileId, TILE_AREAS_FILE, TILE_BYTES_HEADER, TILE_CACHE, TILE_META_CACHE, parseTileUrl, tileUrl } from '../core';

/**
 * Web 版の地図の保存先(案件 31)。表示したタイルを保存するのは service worker(src/sw/sw.ts)で、
 * 画面からは、保存範囲を渡す・保存したタイルの一覧と容量・削除・概略の地図の先読み・消されにくくする依頼を行う。
 * 保存先はブラウザの Cache Storage。デスクトップ版では使わない(案件 2 で別に扱う)。
 */
export interface SavedTile extends TileId { bytes: number }
export interface TileStore {
  /** 保存範囲を service worker に渡す(範囲の外は保存しない) */
  setAreas(areas: SaveArea[]): Promise<void>;
  /** 保存したタイルの一覧 */
  list(): Promise<SavedTile[]>;
  /** 条件に合うタイルを消す。消した枚数を返す */
  remove(match: (t: TileId) => boolean): Promise<number>;
  /** 保存した地図をすべて消す(保存範囲も渡し直す必要はない) */
  clear(): Promise<void>;
  /** まだ保存していないタイルを、ネットから取って保存する(概略の地図の先読み) */
  prefetch(tiles: TileId[]): Promise<{ saved: number; failed: number }>;
  /** 端末の空きが少ないときに、ブラウザが保存したデータを消さないよう頼む。認められたら true */
  persist(): Promise<boolean>;
}

/** タイルを、容量の見出しを付けて保存する形にする */
async function toStored(res: Response): Promise<Response> {
  const blob = await res.blob();
  return new Response(blob, { headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg', [TILE_BYTES_HEADER]: String(blob.size) } });
}

/** Cache Storage を使う保存先。使えない環境(Cache Storage が無い、デスクトップ版)では null */
export function openTileStore(): TileStore | null {
  if (window.rllNative || typeof caches === 'undefined' || typeof fetch === 'undefined') return null;
  const tiles = () => caches.open(TILE_CACHE);
  const each = async (fn: (req: Request, t: TileId, cache: Cache) => Promise<void>) => {
    const c = await tiles();
    for (const req of await c.keys()) { const t = parseTileUrl(req.url); if (t) await fn(req, t, c); }
  };
  return {
    async setAreas(areas) {
      const meta = await caches.open(TILE_META_CACHE);
      await meta.put(new URL(TILE_AREAS_FILE, document.baseURI).href, new Response(JSON.stringify(areas), { headers: { 'content-type': 'application/json' } }));
      navigator.serviceWorker?.controller?.postMessage({ type: 'rll-areas' });       // 覚えている範囲を読み直させる
    },
    async list() {
      const out: SavedTile[] = [];
      await each(async (req, t, c) => {
        const res = await c.match(req);
        out.push({ ...t, bytes: Number(res?.headers.get(TILE_BYTES_HEADER)) || 0 });
      });
      return out;
    },
    async remove(match) {
      let n = 0;
      await each(async (req, t, c) => { if (match(t)) { await c.delete(req); n++; } });
      return n;
    },
    async clear() { await caches.delete(TILE_CACHE); },
    async prefetch(list) {
      const c = await tiles();
      let saved = 0, failed = 0;
      for (const t of list) {
        const url = tileUrl(t);
        if (await c.match(url)) continue;
        try {
          const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (!res.ok) { failed++; continue; }
          await c.put(url, await toStored(res));
          saved++;
        } catch { failed++; }
      }
      return { saved, failed };
    },
    async persist() {
      try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { return false; }
    },
  };
}

/** テスト用: メモリに持つ保存先 */
export class MemoryTileStore implements TileStore {
  areas: SaveArea[] = [];
  tiles = new Map<string, SavedTile>();
  prefetched: TileId[] = [];
  persistCalls = 0;
  offline = false;
  key(t: TileId) { return `${t.z}/${t.x}/${t.y}`; }
  /** service worker が、表示したタイルを保存したことにする */
  save(t: TileId, bytes = 20000) { this.tiles.set(this.key(t), { ...t, bytes }); }
  async setAreas(areas: SaveArea[]) { this.areas = areas.map((a) => ({ ...a })); }
  async list() { return [...this.tiles.values()]; }
  async remove(match: (t: TileId) => boolean) {
    let n = 0;
    for (const [k, t] of this.tiles) if (match(t)) { this.tiles.delete(k); n++; }
    return n;
  }
  async clear() { this.tiles.clear(); }
  async prefetch(list: TileId[]) {
    let saved = 0, failed = 0;
    for (const t of list) {
      if (this.tiles.has(this.key(t))) continue;
      if (this.offline) { failed++; continue; }
      this.prefetched.push(t); this.save(t); saved++;
    }
    return { saved, failed };
  }
  async persist() { this.persistCalls++; return true; }
}
