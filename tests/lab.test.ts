// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import type { GeoHit } from '../src/io/geocode';
import { gsiGeocode } from '../src/io/geocode';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { mountImportView } from '../src/ui/importView';
import { mountCircuitEditor } from '../src/ui/circuitEditor';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('走行ライン補正データ管理', () => {
  let root: HTMLElement, session: Session;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    session = new Session(new MemoryStore());
    mountImportView(root, session, { mapFactory: () => new FakeMap() });
  });

  it('「サーキット」「比較セット」と同じ 1 つのセクションで、説明文と書き出し・読み込みボタンがある', () => {
    const sec = root.querySelector('#sec-offsets')!;
    expect(sec.querySelector('h2')!.textContent).toBe('走行ライン補正データ管理');
    const t = sec.textContent!;
    expect(t).toContain('各走行ログのファイル別に走行ラインを補正したデータを保持しています。');
    expect(t).toContain('その補正データの書き出し、読み込みを行います。');
    expect(t).toContain('補正済みのファイルは次回から自動で補正が適用されます(どの比較セットでも同じファイルは同じ補正値です)。');
    expect(Array.from(sec.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['補正データを書き出す', '補正データを読み込む']);
  });

  it('見出しの横に、補正済みのファイル数が出る', () => {
    expect(root.querySelector('#offsets-badge')!.textContent).toBe('補正なし');
    session.importOffsets(JSON.stringify({ kind: 'offsets', version: 1, offsets: { 'a.vbo:10': { east: 1, north: 0 } } }));
    expect(root.querySelector('#offsets-badge')!.textContent).toBe('補正済み 1 ファイル');
  });
});

describe('ロゴ', () => {
  it('ヘッダーにロゴとアプリ名が並ぶ。ダークテーマでは薄い枠線が付く(CSS)', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const store = new MemoryStore();
    mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
    expect(root.querySelector('.brand svg.logo')).not.toBeNull();
    expect(root.querySelector('.brand .ttl')!.textContent).toBe('Racing Line Lab');
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toMatch(/:root\[data-theme="dark"\] \.logo-bd\{stroke:rgba\(255,255,255/);
  });
  it('アイコンとファビコンが用意されている', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('favicon.svg');
    expect(readFileSync('build/icon.png').subarray(1, 4).toString()).toBe('PNG');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).build.mac.icon).toBe('build/icon.png');
  });
});

describe('住所検索', () => {
  let root: HTMLElement, map: FakeMap, calls: string[];
  function open(geocode: (q: string) => Promise<GeoHit[]>) {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    map = new FakeMap(); calls = [];
    const ed = mountCircuitEditor(root, new Session(new MemoryStore()), {
      mapFactory: () => map, onDone: () => {}, geocode: async (q) => { calls.push(q); return geocode(q); },
    });
    ed.show(null);
  }
  const q = () => root.querySelector<HTMLInputElement>('#ce-geo-q')!;
  const search = async (text: string) => { q().value = text; root.querySelector('#ce-geo')!.dispatchEvent(new Event('submit', { cancelable: true })); await flush(); };

  it('地図の上に「住所で検索...」の検索窓がある', () => {
    open(async () => []);
    expect(q().placeholder).toBe('住所で検索...');
    expect(root.querySelector('.corr-map-wrap')!.contains(q())).toBe(true);
  });

  it('候補が 1 件ならその場所へ移動する(拡大率 17)', async () => {
    open(async () => [{ title: '大分県玖珠郡九重町', lat: 33.04, lon: 130.97 }]);
    await search('九重町');
    expect(calls).toEqual(['九重町']);
    expect(map.getView()).toEqual({ lat: 33.04, lon: 130.97, zoom: 17 });
    expect(root.querySelector<HTMLElement>('#ce-geo-res')!.hidden).toBe(true);
  });

  it('候補が複数なら一覧が出て、選ぶと移動する', async () => {
    open(async () => [{ title: 'A', lat: 1, lon: 2 }, { title: 'B', lat: 3, lon: 4 }]);
    await search('x');
    const hits = root.querySelectorAll<HTMLElement>('.geo-hit');
    expect(Array.from(hits).map((h) => h.textContent)).toEqual(['A', 'B']);
    hits[1].click();
    expect(map.getView()).toEqual({ lat: 3, lon: 4, zoom: 17 });
    expect(root.querySelector<HTMLElement>('#ce-geo-res')!.hidden).toBe(true);
  });

  it('見つからないとき・失敗したときは、案内を出す。空の入力では検索しない', async () => {
    open(async () => []);
    await search('zzz');
    expect(root.querySelector('#ce-geo-res')!.textContent).toBe('見つかりませんでした');
    open(async () => { throw new Error('offline'); });
    await search('zzz');
    expect(root.querySelector('#ce-geo-res')!.textContent).toContain('検索できませんでした');
    await search('  ');
    expect(calls).toEqual(['zzz']);
  });

  it('検索窓での矢印キーは、ラインの微調整にならない', async () => {
    open(async () => []);
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    q().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('国土地理院の住所検索の応答を、緯度・経度の候補にする', async () => {
    const orig = globalThis.fetch;
    let url = '';
    globalThis.fetch = (async (u: string) => {
      url = u;
      return { ok: true, json: async () => [
        { geometry: { type: 'Point', coordinates: [130.97, 33.04] }, properties: { title: '大分県九重町' } },
        { geometry: { coordinates: ['x'] }, properties: { title: '壊れた候補' } }] };
    }) as unknown as typeof fetch;
    try {
      const hits = await gsiGeocode('九重 町');
      expect(url).toContain('msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent('九重 町'));
      expect(hits).toEqual([{ title: '大分県九重町', lat: 33.04, lon: 130.97 }]);
    } finally { globalThis.fetch = orig; }
  });
});
