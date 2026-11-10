// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TileId, rectAtZoom, tileInAreas, tileUrl } from '../src/core';
import { openNativeTileStore } from '../src/io/tileStore';
import type { NativeBridge } from '../src/io/storage';

// デスクトップ版の地図の保存(案件 2): メイン側(electron/tileCache.cjs)と、画面側の窓口
type Cache = {
  dir: string; setAreas(v: unknown): void; inAreas(t: TileId): boolean; get(t: TileId): Buffer | null; put(t: TileId, b: Buffer): void;
  list(): (TileId & { bytes: number })[]; remove(l: unknown): number; clear(): void;
};
type Served = { status: number; body: Buffer | null };
const mod = createRequire(import.meta.url)('../electron/tileCache.cjs') as {
  TileCache: new (dir: string) => Cache;
  serveTile(c: Cache, f: (u: string) => Promise<Response>, url: string): Promise<Served>;
  prefetchTiles(c: Cache, f: (u: string) => Promise<Response>, l: unknown): Promise<{ saved: number; failed: number }>;
  tileInAreas(t: TileId, a: unknown[]): boolean;
  TILE_URL: string;
};

/** オートポリス付近の Z18 の四角(4×3 枚) */
const AREA = { id: 'a1', name: 'AP', x0: 233080, y0: 105320, x1: 233084, y1: 105323 };
const IN18: TileId = { z: 18, x: 233081, y: 105321 };
const OUT18: TileId = { z: 18, x: 233000, y: 105321 };
const req = (t: TileId) => `rll-tile://tile/${t.z}/${t.x}/${t.y}.jpg`;

/** 地理院の代わり。offline なら例外、status を指定すればその応答 */
function upstream(o: { offline?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const f = async (u: string) => {
    calls.push(u);
    if (o.offline) throw new Error('offline');
    if (o.status) return new Response(null, { status: o.status });
    return new Response(Buffer.from(`jpg:${u}`), { status: 200 });
  };
  return { f, calls };
}
const fresh = () => { const c = new mod.TileCache(join(mkdtempSync(join(tmpdir(), 'rll-tiles-')), 'tiles')); c.setAreas([AREA]); return c; };

describe('メイン側の地図の保存', () => {
  it('範囲の中は、取って保存し、2 回目からは保存したものを返す(ネットが無くても)', async () => {
    const c = fresh(), u = upstream();
    const a = await mod.serveTile(c, u.f, req(IN18));
    expect(a.status).toBe(200);
    expect(u.calls).toEqual([tileUrl(IN18)]);                       // 取得先は地理院に固定
    expect(c.list()).toEqual([{ ...IN18, bytes: a.body!.length }]);
    const off = upstream({ offline: true });
    const b = await mod.serveTile(c, off.f, req(IN18));
    expect(b.status).toBe(200);
    expect(b.body!.equals(a.body!)).toBe(true);
    expect(off.calls).toEqual([]);                                    // 保存済みは取り直さない
  });

  it('範囲の外・保存しない倍率は、取るだけで保存しない', async () => {
    const c = fresh(), u = upstream();
    expect((await mod.serveTile(c, u.f, req(OUT18))).status).toBe(200);
    expect((await mod.serveTile(c, u.f, req({ z: 14, x: 14567, y: 6582 }))).status).toBe(200);
    expect(u.calls).toHaveLength(2);
    expect(c.list()).toEqual([]);
  });

  it('ネットが無い・地理院がエラーのときは、保存しない(504 / 404 / 502)', async () => {
    const c = fresh();
    expect((await mod.serveTile(c, upstream({ offline: true }).f, req(IN18))).status).toBe(504);
    expect((await mod.serveTile(c, upstream({ status: 404 }).f, req(IN18))).status).toBe(404);
    expect((await mod.serveTile(c, upstream({ status: 500 }).f, req(IN18))).status).toBe(502);
    expect(c.list()).toEqual([]);
  });

  it('おかしな要求は、取りに行かずに 404(別のホスト・.. ・桁あふれ・倍率 19・範囲外の番号)', async () => {
    const c = fresh(), u = upstream();
    for (const url of ['rll-tile://other/18/1/1.jpg', 'rll-tile://tile/18/../1.jpg', 'rll-tile://tile/18/123456789/1.jpg',
      'rll-tile://tile/19/1/1.jpg', 'rll-tile://tile/2/4/1.jpg', 'https://example.com/18/1/1.jpg', 'not a url']) {
      expect((await mod.serveTile(c, u.f, url)).status).toBe(404);
    }
    expect(u.calls).toEqual([]);
  });

  it('範囲の判定は、画面側(core/tiles.ts)と同じ', () => {
    for (const z of [14, 15, 16, 17, 18]) {
      const q = rectAtZoom(AREA, z);
      for (const t of [{ z, x: q.x0, y: q.y0 }, { z, x: q.x1 - 1, y: q.y1 - 1 }, { z, x: q.x1, y: q.y0 }, { z, x: q.x0 - 1, y: q.y0 }]) {
        expect(mod.tileInAreas(t, [AREA])).toBe(tileInAreas(t, [AREA]));
      }
    }
  });

  it('先読み: まだ無いものだけ取って保存する。取れなかった枚数も返す', async () => {
    const c = fresh(), u = upstream();
    await mod.serveTile(c, u.f, req(IN18));
    const r = await mod.prefetchTiles(c, u.f, [IN18, { z: 15, x: 29135, y: 13165 }, { z: 99, x: 0, y: 0 }]);
    expect(r).toEqual({ saved: 1, failed: 0 });
    expect(u.calls).toHaveLength(2);
    expect((await mod.prefetchTiles(c, upstream({ offline: true }).f, [{ z: 16, x: 58270, y: 26330 }]))).toEqual({ saved: 0, failed: 1 });
  });

  it('一覧・指定したものの削除・すべて削除。保存範囲の値は確かめてから使う', async () => {
    const c = fresh(), u = upstream();
    await mod.prefetchTiles(c, u.f, [IN18, { z: 18, x: 233082, y: 105321 }]);
    expect(c.list()).toHaveLength(2);
    expect(c.remove([IN18, { z: 18, x: 1, y: 1 }, '../x'])).toBe(1);
    expect(c.list().map((t) => t.x)).toEqual([233082]);
    expect(readdirSync(join(c.dir, '18', '233082'))).toEqual(['105321.jpg']);   // 一時ファイルは残らない
    expect(readdirSync(join(c.dir, '18'))).toEqual(['233082']);                // 空になったフォルダは消す
    expect(c.remove([{ z: 18, x: 233082, y: 105321 }])).toBe(1);
    expect(readdirSync(c.dir)).toEqual([]);
    c.clear();
    expect(existsSync(c.dir)).toBe(false);
    expect(c.list()).toEqual([]);
    c.setAreas([{ x0: 1, y0: 1, x1: 1, y1: 2 }, 'x', { x0: -1, y0: 0, x1: 2, y1: 2 }]);
    expect(c.inAreas({ z: 18, x: 1, y: 1 })).toBe(false);                        // 壊れた範囲は捨てる
  });
});

describe('画面側の窓口(デスクトップ版)', () => {
  const base = (): NativeBridge => ({
    storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
    getPathForFile: () => '', readTextFile: async () => null,
  });

  it('窓口に地図の保存が無ければ使わない(古い版)', () => {
    expect(openNativeTileStore(base())).toBeNull();
  });

  it('窓口があれば使う。範囲は四角の数字だけ渡し、削除は一覧から選んで渡す', async () => {
    const sent: unknown[] = [];
    let removed: TileId[] = [];
    const n: NativeBridge = {
      ...base(), tileUrl: mod.TILE_URL,
      tilesSetAreas: async (a) => { sent.push(a); return true; },
      tilesList: async () => [{ ...IN18, bytes: 10 }, { ...OUT18, bytes: 20 }],
      tilesRemove: async (l) => { removed = l; return l.length; },
      tilesClear: async () => true,
      tilesPrefetch: async (l) => ({ saved: l.length, failed: 0 }),
    };
    expect(n.tileUrl).toBe('rll-tile://tile/{z}/{x}/{y}.jpg');
    const s = openNativeTileStore(n)!;
    expect(s.durable).toBe(true);
    await s.setAreas([AREA]);
    expect(sent).toEqual([[{ x0: AREA.x0, y0: AREA.y0, x1: AREA.x1, y1: AREA.y1 }]]);
    expect(await s.remove((t) => !tileInAreas(t, [AREA]))).toBe(1);
    expect(removed).toEqual([OUT18]);
    expect(await s.persist()).toBe(true);
  });

  it('preload が渡す URL は、メイン側が受け付ける形と同じ(preload は sandbox のため、自前のファイルを読めないので値を書き写している)', () => {
    expect(readFileSync('electron/preload.cjs', 'utf8')).toContain(`tileUrl: '${mod.TILE_URL}'`);
  });
});
