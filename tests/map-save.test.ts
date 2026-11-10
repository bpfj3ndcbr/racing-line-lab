// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { MemoryTileStore } from '../src/io/tileStore';
import { Session } from '../src/store/session';
import { Prefs } from '../src/store/prefs';
import { MapAreas } from '../src/store/mapAreas';
import { mountApp } from '../src/ui/app';
import { openAreaEditor } from '../src/ui/areaEditor';
import { ThemeController } from '../src/ui/theme';
import { type Circuit, PREFETCH_ZOOMS, prefetchTilesOf, rectToBox, tilesOf } from '../src/core';
import { FakeMap } from './helpers';

// Web 版の地図の保存(案件 31): 「設定」の「地図の保存」
const flush = () => new Promise((r) => setTimeout(r, 30));
let store: MemoryStore, root: HTMLElement, tiles: MemoryTileStore, maps: FakeMap[], session: Session, reloaded: number;
let app: { dispose(): void } | null = null;
/** true なら、保存先は渡さず、窓口(window.rllNative)から作らせる(デスクトップ版) */
let useNative = false;

function boot() {
  app?.dispose();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  maps = [];
  app = mountApp(root, session, new ThemeController(store), () => { const m = new FakeMap(); maps.push(m); return m; },
    { tiles: useNative ? undefined : tiles, resume: null, reload: () => { reloaded++; } });
  return session;
}
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const nav = (v: string) => root.querySelector<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`)!.click();
const editorMap = () => maps.at(-1)!;
async function addArea(name?: string) {
  $<HTMLButtonElement>('[data-area-add]').click();
  await flush();
  if (name !== undefined) { const n = $<HTMLInputElement>('[data-area-name]'); n.value = name; n.dispatchEvent(new Event('input')); }
  $<HTMLButtonElement>('[data-area-ok]').click();
  await flush();
}

beforeEach(() => { store = new MemoryStore(); tiles = new MemoryTileStore(); reloaded = 0; useNative = false; });
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; delete (window as { rllNative?: NativeBridge }).rllNative; });

describe('地図の保存(設定)', () => {
  it('範囲を追加すると、一覧に出て、service worker に渡す。消されにくくするよう頼む(初期値は有効)。概略の地図の先読みは初期値で無効', async () => {
    boot(); nav('settings');
    expect($('[data-area-add]').hasAttribute('disabled')).toBe(false);
    expect(root.querySelector('.map-areas-empty')!.textContent).toContain('保存範囲はまだありません');
    $<HTMLButtonElement>('[data-area-add]').click();
    await flush();
    expect($('.area-ed h3').textContent).toBe('保存範囲を追加');
    expect($('[data-area-info]').textContent).toMatch(/^保存範囲: .+ × .+[(（]Z18 で \d+ × \d+ 枚/);
    expect($<HTMLInputElement>('[data-area-name]').value).toBe('範囲 1');
    expect(editorMap().guide?.box).not.toBeNull();
    $<HTMLButtonElement>('[data-area-ok]').click();
    await flush();
    expect(document.querySelector('.area-ed')).toBeNull();
    const areas = new MapAreas(session).list();
    expect(areas.map((a) => a.name)).toEqual(['範囲 1']);
    expect(tiles.areas).toEqual(areas);
    expect(tiles.persistCalls).toBe(1);
    // 先読みはしない。ただし、範囲を決める画面で見えていた地図(Z15 で表示中)は、見た地図として保存する
    expect(tiles.prefetched.length).toBeGreaterThan(0);
    expect(tiles.prefetched.every((t) => t.z === 15)).toBe(true);
    expect(root.querySelector('.marea')!.textContent).toMatch(/KB|MB/);
  });

  it('保存したタイルの枚数と容量を、範囲ごとに出す(設定を開き直すと数え直す)', async () => {
    boot(); nav('settings');
    await addArea('FSW');
    const a = new MapAreas(session).list()[0];
    tiles.tiles.clear();
    tilesOf(a, [18]).slice(0, 3).forEach((t) => tiles.save(t, 512 * 1024));
    tiles.save({ z: 18, x: a.x1 + 5, y: a.y0 });                   // 範囲の外(数えない)
    nav('import'); nav('settings'); await flush();
    expect(root.querySelector('.marea')!.textContent).toContain('1.5 MB(3 枚)');
  });

  it('「概略の地図は表示前に保存する」を有効にすると、保存範囲の Z15・Z16 をまとめて保存する', async () => {
    boot(); nav('settings');
    await addArea();
    $<HTMLButtonElement>('[data-map-prefetch]').click();
    await flush();
    const want = prefetchTilesOf(new MapAreas(session).list());
    expect(want.every((t) => (PREFETCH_ZOOMS as readonly number[]).includes(t.z))).toBe(true);
    expect(want.every((t) => tiles.tiles.has(tiles.key(t)))).toBe(true);
    expect(new Prefs(session).mapPrefetch).toBe(true);
    expect(root.querySelector('[data-map-msg]')!.textContent).toMatch(/^概略の地図を保存しました[(（]\d+ 枚[)）]。$/);
    // 有効のまま範囲を足すと、その分も保存する
    await addArea('2 つ目');
    expect(tiles.prefetched.length).toBeGreaterThanOrEqual(want.length);
  });

  it('ネットが無くて先読みできなかったときは、そのことを知らせる', async () => {
    boot(); nav('settings');
    new Prefs(session).setMapPrefetch(true);
    tiles.offline = true;
    await addArea();
    expect(root.querySelector('[data-map-msg]')!.textContent).toMatch(/^概略の地図のうち \d+ 枚を保存できませんでした/);
  });

  it('範囲を変更すると、範囲の外になったタイルを消す', async () => {
    boot(); nav('settings');
    await addArea('AP');
    const a = new MapAreas(session).list()[0];
    const inside = tilesOf(a, [18])[0];
    tiles.save(inside);
    $<HTMLButtonElement>(`[data-area-edit="${a.id}"]`).click();
    await flush();
    expect($('.area-ed h3').textContent).toBe('保存範囲を変更');
    expect($<HTMLInputElement>('[data-area-name]').value).toBe('AP');
    expect(editorMap().boxesFitted).toHaveLength(1);
    const before = new MapAreas(session).list()[0];
    // 地図を動かしても、範囲は変わらない
    const b = rectToBox(a);
    editorMap().userMoves(b.north + 0.05, b.east + 0.05);
    expect(editorMap().guide!.box).toEqual(b);
    // 真ん中のつまみで、四角を元の範囲から外れるところまで動かす
    editorMap().moveHandle('c', b.north + 0.05, b.east + 0.05);
    $<HTMLButtonElement>('[data-area-ok]').click();
    await flush();
    const after = new MapAreas(session).list()[0];
    expect(after.name).toBe('AP');
    expect(after).not.toEqual(before);
    expect(tiles.tiles.has(tiles.key(inside))).toBe(false);
  });

  it('範囲の削除は確かめてから。保存した地図も消す', async () => {
    boot(); nav('settings');
    await addArea('AP');
    const a = new MapAreas(session).list()[0];
    tiles.save(tilesOf(a, [17])[0]);
    $<HTMLButtonElement>(`[data-area-del="${a.id}"]`).click();
    await flush();
    expect($('.modal h3').textContent).toBe('保存範囲「AP」を削除しますか?');
    $<HTMLButtonElement>('[data-dialog="ok"]').click();
    await flush();
    expect(new MapAreas(session).list()).toEqual([]);
    expect(tiles.areas).toEqual([]);
    expect(tiles.tiles.size).toBe(0);
  });

  it('「保存した地図をすべて消す」: 地図だけを消し、保存範囲は残す', async () => {
    boot(); nav('settings');
    await addArea('AP');
    tiles.save(tilesOf(new MapAreas(session).list()[0], [18])[0]);
    $<HTMLButtonElement>('[data-area-clear]').click();
    await flush();
    $<HTMLButtonElement>('[data-dialog="ok"]').click();
    await flush();
    expect(tiles.tiles.size).toBe(0);
    expect(new MapAreas(session).list()).toHaveLength(1);
    expect(root.querySelector('[data-map-msg]')!.textContent).toBe('保存した地図をすべて消しました。');
  });

  it('「アプリを初期状態に戻す」では、保存した地図と保存範囲も消してから読み直す', async () => {
    boot(); nav('settings');
    await addArea('AP');
    tiles.save(tilesOf(new MapAreas(session).list()[0], [18])[0]);
    $<HTMLButtonElement>('[data-wipe]').click();
    $<HTMLButtonElement>('[data-wipe]').click();
    await flush();
    expect(reloaded).toBe(1);
    expect(tiles.tiles.size).toBe(0);
    expect(tiles.areas).toEqual([]);
    expect(new MapAreas(session).list()).toEqual([]);
  });

  it('起動時に、保存範囲を service worker に渡し直す。先読みが有効なら足りない分を保存する', async () => {
    const s = new Session(store);
    new MapAreas(s).add('AP', { x0: 232700, y0: 103000, x1: 232710, y1: 103006 });
    new Prefs(s).setMapPrefetch(true);
    boot();
    await flush();
    expect(tiles.areas).toHaveLength(1);
    expect(tiles.prefetched.length).toBe(prefetchTilesOf(tiles.areas).length);
  });

  it('窓口に地図の保存が無い(古い版のデスクトップ版)ときは使えない: ボタン・スイッチは押せず、「Web 版のみ」と出る', () => {
    (window as { rllNative?: NativeBridge }).rllNative = {
      storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
      getPathForFile: () => '', readTextFile: async () => null,
    };
    useNative = true;
    boot(); nav('settings');
    expect($('[data-area-add]').hasAttribute('disabled')).toBe(true);
    expect($('[data-map-prefetch]').hasAttribute('disabled')).toBe(true);
    expect($('[data-map-persist]').hasAttribute('disabled')).toBe(true);
    expect($('[data-area-add]').closest('.srow')!.textContent).toContain('(Web 版のみ)');
  });
});

describe('地図の保存(デスクトップ版。案件 2)', () => {
  it('窓口に地図の保存があれば使える。「消されにくくする」だけは押せず「Web 版のみ」。範囲の追加・初期状態に戻すは Web 版と同じ', async () => {
    const saved = new Map<string, { z: number; x: number; y: number; bytes: number }>();
    let areas: unknown[] = [];
    (window as { rllNative?: NativeBridge }).rllNative = {
      storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
      getPathForFile: () => '', readTextFile: async () => null,
      tileUrl: 'rll-tile://tile/{z}/{x}/{y}.jpg',
      tilesSetAreas: async (a) => { areas = a; return true; },
      tilesList: async () => [...saved.values()],
      tilesRemove: async (l) => { l.forEach((t) => saved.delete(`${t.z}/${t.x}/${t.y}`)); return l.length; },
      tilesClear: async () => { saved.clear(); return true; },
      tilesPrefetch: async (l) => { l.forEach((t) => saved.set(`${t.z}/${t.x}/${t.y}`, { ...t, bytes: 100 })); return { saved: l.length, failed: 0 }; },
    };
    useNative = true;
    boot(); nav('settings');
    expect($('[data-area-add]').hasAttribute('disabled')).toBe(false);
    expect($('[data-area-add]').closest('.srow')!.textContent).not.toContain('Web 版のみ');
    expect($('[data-map-prefetch]').hasAttribute('disabled')).toBe(false);
    expect($('[data-map-persist]').hasAttribute('disabled')).toBe(true);
    expect($('[data-map-persist]').getAttribute('aria-checked')).toBe('false');
    expect($('[data-map-persist]').closest('.srow')!.textContent).toContain('(Web 版のみ)');
    await addArea('AP');
    expect(areas).toHaveLength(1);                                              // メイン側に範囲を渡す
    expect(Object.keys(areas[0] as object).sort()).toEqual(['x0', 'x1', 'y0', 'y1']);
    saved.set('18/1/1', { z: 18, x: 1, y: 1, bytes: 100 });
    // 「アプリを初期状態に戻す」: 保存した地図と範囲も消す
    $<HTMLButtonElement>('[data-wipe]').click(); $<HTMLButtonElement>('[data-wipe]').click();
    await flush();
    expect(saved.size).toBe(0);
    expect(areas).toEqual([]);
    expect(reloaded).toBe(1);
  });
});

describe('保存範囲を決める画面', () => {
  const circuit: Circuit = {
    id: 'c1', name: 'オートポリス', control: { a: { lat: 33.0390, lon: 130.9735 }, b: { lat: 33.0385, lon: 130.9730 } }, sectors: [],
  };

  it('枠の中に登録済みサーキットがあれば、その名前を初期値にする。名前を書き換えたら、そのまま使う', async () => {
    const maps: FakeMap[] = [];
    const p = openAreaEditor({ mapFactory: () => { const m = new FakeMap(); maps.push(m); return m; }, circuits: [circuit], defaultName: '範囲 1' });
    expect($<HTMLInputElement>('[data-area-name]').value).toBe('オートポリス');
    expect(maps[0].viewSet.at(-1)).toEqual([33.03875, 130.97325, 15]);        // サーキットの位置から始める
    const n = $<HTMLInputElement>('[data-area-name]');
    n.value = 'AP 本コース'; n.dispatchEvent(new Event('input'));
    maps[0].userMoves(33.04, 130.975);
    expect(n.value).toBe('AP 本コース');
    $<HTMLButtonElement>('[data-area-ok]').click();
    const r = await p;
    expect(r?.name).toBe('AP 本コース');
    expect(r!.rect.x1 - r!.rect.x0).toBeGreaterThan(0);
  });

  it('四隅のつまみで大きさを変え、離すと区切りに吸い付く。動かしている途中は追加できない', () => {
    const maps: FakeMap[] = [];
    void openAreaEditor({ mapFactory: () => { const m = new FakeMap(); maps.push(m); return m; }, circuits: [], defaultName: '範囲 1' });
    const m = maps[0];
    expect(m.handles.map((h) => h.id)).toEqual(['nw', 'ne', 'sw', 'se', 'c']);
    const se = m.handles.find((h) => h.id === 'se')!, nw = m.handles.find((h) => h.id === 'nw')!;
    // 途中: 四角は指の位置どおり(そろえる前)。追加は押せない
    m.moveHandle('se', se.lat - 0.0013, se.lon + 0.0017, false);
    expect(m.guide!.box!.south).toBeCloseTo(se.lat - 0.0013, 9);
    expect($<HTMLButtonElement>('[data-area-ok]').disabled).toBe(true);
    // 離すと、区切りに吸い付き、つまみが四角の角に置き直される
    m.moveHandle('se', se.lat - 0.0013, se.lon + 0.0017, true);
    const b = m.guide!.box!;
    expect(b.south).not.toBeCloseTo(se.lat - 0.0013, 9);
    expect(m.handles.find((h) => h.id === 'se')).toMatchObject({ lat: b.south, lon: b.east });
    expect(m.handles.find((h) => h.id === 'nw')).toMatchObject({ lat: nw.lat, lon: nw.lon });          // 対角は動かない
    expect($<HTMLButtonElement>('[data-area-ok]').disabled).toBe(false);
  });

  it('範囲が広すぎる(一辺 5 km を超える)ときは、追加できない。縮小しているときは区切り線を出さない', () => {
    const maps: FakeMap[] = [];
    void openAreaEditor({ mapFactory: () => { const m = new FakeMap(); maps.push(m); return m; }, circuits: [], defaultName: '範囲 1' });
    const m = maps[0], se = m.handles.find((h) => h.id === 'se')!;
    m.moveHandle('se', se.lat - 0.05, se.lon + 0.05);
    expect($('[data-area-warn]').hidden).toBe(false);
    expect($<HTMLButtonElement>('[data-area-ok]').disabled).toBe(true);
    m.moveHandle('se', se.lat, se.lon);
    expect($('[data-area-warn]').hidden).toBe(true);
    m.userMoves(33.0385, 130.9735, 13);
    expect(m.guide!.grid).toEqual([]);
    m.userMoves(33.0385, 130.9735, 16);
    expect(m.guide!.grid.length).toBeGreaterThan(0);
  });

  it('Esc・キャンセルでは何もしない', async () => {
    const p = openAreaEditor({ mapFactory: () => new FakeMap(), circuits: [], defaultName: '範囲 1' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
    expect(document.querySelector('.area-ed')).toBeNull();
  });
});
