// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { Session } from '../src/store/session';
import { Prefs } from '../src/store/prefs';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const vbo = readFileSync(fx('20260913140139_UTC.vbo'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 20));

let store: MemoryStore, root: HTMLElement, fake: FakeMap;
let disk: Map<string, string>;
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;
function bridge(): NativeBridge {
  return {
    storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
    getPathForFile: (f) => `/data/${f.name}`,
    readTextFile: async (p) => disk.get(p) ?? null,
  };
}
function boot(native: boolean) {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  (window as { rllNative?: NativeBridge }).rllNative = native ? bridge() : undefined;
  const session = new Session(store);
  fake = new FakeMap();
  mountApp(root, session, new ThemeController(store), () => fake);
  return session;
}
beforeEach(() => { store = new MemoryStore(); disk = new Map([['/data/a.vbo', vbo]]); });
afterEach(() => { delete (window as { rllNative?: NativeBridge }).rllNative; });

describe('最後の走行データの自動読み込み', () => {
  it('A〜D の割り当てが無ければ「データ管理」のまま、比較セットはすべて閉じた状態で始める(一覧のとき。案件 26)', async () => {
    const s1 = boot(true);
    s1.registerCircuit('オートポリス', cln, sci);
    await s1.addVboFile(file('a.vbo', vbo), '/data/a.vbo');
    s1.setSetting('setsView', 'list');
    const s2 = boot(true);
    await flush();
    expect(s2.logs).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('#view-import')!.hidden).toBe(false);
    expect(Array.from(root.querySelectorAll<HTMLDetailsElement>('.set-sec')).map((d) => d.open)).toEqual([false, false, false, false, false]);
  });

  async function firstRun() {
    const s = boot(true);
    s.registerCircuit('オートポリス', cln, sci);
    await s.addVboFile(file('a.vbo', vbo), '/data/a.vbo');
    s.toggleAssignment('B', { logId: s.logs[0].id, lap: 1 });
    return s;
  }

  it('無効にしているときは、起動し直しても何も読み込まない', async () => {
    const s1 = await firstRun();
    new Prefs(s1).setAutoLoad(false);
    const s2 = boot(true);
    await flush();
    expect(s2.logs).toHaveLength(0);
  });

  it('初期値は有効: 起動時に前回のファイルを読み込み、A〜D の割り当ても元に戻る', async () => {
    const s1 = await firstRun();
    const id = s1.logs[0].id;
    const s2 = boot(true);
    await flush();
    expect(s2.logs.map((l) => l.id)).toEqual([id]);
    expect(s2.logs[0].circuit?.name).toBe('オートポリス');
    expect(s2.assignment.B).toEqual({ logId: id, lap: 1 });
    expect(s2.assignment.A).toBeNull();
    expect(root.querySelector('#slots')!.textContent).toContain('LAP');
    expect(s2.message).toBe('');
  });

  it('読み込み途中の状態で、保存済みの「前回の状態」を上書きしない(2 回続けて起動しても同じ)', async () => {
    await firstRun();
    boot(true); await flush();
    const s3 = boot(true); await flush();
    expect(s3.logs).toHaveLength(1);
    expect(s3.assignment.B).not.toBeNull();
  });

  it('ファイルを削除・移動していたら飛ばして、読めなかったファイルを知らせる。割り当ても無効なものは戻さない', async () => {
    await firstRun();
    disk.clear();
    const s2 = boot(true); await flush();
    expect(s2.logs).toHaveLength(0);
    expect(s2.assignment.B).toBeNull();
  });

  it('読み込んだあとにログを外すと、次回は読み込まれない', async () => {
    const s1 = await firstRun();
    s1.removeLog(s1.logs[0].id);
    const s2 = boot(true); await flush();
    expect(s2.logs).toHaveLength(0);
  });

  it('ブラウザ版(場所が分からない)では使えない: スイッチは押せず、案内が出る', () => {
    boot(false);
    const sw = root.querySelector<HTMLButtonElement>('[data-autoload]')!;
    expect(sw.disabled).toBe(true);
    expect(sw.closest('.srow')!.textContent).toContain('Electron 版のみ');
  });

  it('Electron 版では設定のスイッチで切り替わり、保存される', () => {
    const s = boot(true);
    const sw = () => root.querySelector<HTMLButtonElement>('[data-autoload]')!;
    expect(sw().disabled).toBe(false);
    expect(sw().getAttribute('aria-checked')).toBe('true');          // 初期値は有効
    sw().click();
    expect(new Prefs(s).autoLoad).toBe(false);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    sw().click();
    expect(new Prefs(s).autoLoad).toBe(true);
  });
});

describe('地図の初期位置', () => {
  async function go(pos: 'center' | 'control', view?: { lat: number; lon: number; zoom: number }, zoom = 0) {
    const s = boot(false);
    s.registerCircuit('オートポリス', cln, sci, view);
    const p = new Prefs(s);
    p.setStartPos(pos);
    if (zoom) { p.setRemember('zoom', false); p.setValue('zoom', zoom as never); }
    const { parseVbo } = await import('../src/core');
    s.addLog(parseVbo(vbo, 'u.vbo'), 'u');
    s.toggleAssignment('A', { logId: 'u', lap: 1 });
    root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
    return s;
  }
  const mid = { lat: (33.039045 + 33.038487) / 2, lon: (130.973474 + 130.97302) / 2 };

  it('初期は「地図の中心」(表示位置が無ければ走行ライン全体)', async () => {
    await go('center');
    expect(fake.fitted).toBeGreaterThan(0);
    expect(fake.viewSet).toHaveLength(0);
  });

  it('「コントロールライン」: 地図の中心がコントロールラインの中心になる(倍率は全体表示のまま)', async () => {
    await go('control');
    const [lat, lon] = fake.viewSet.at(-1)!;
    expect(lat).toBeCloseTo(mid.lat, 6);
    expect(lon).toBeCloseTo(mid.lon, 6);
  });

  it('登録した表示位置があっても、倍率はそれを使わず(全体表示のまま)、中心だけコントロールラインに替わる。数値の倍率ならその倍率', async () => {
    await go('control', { lat: 33.1, lon: 131, zoom: 16 });
    expect(fake.viewSet.at(-1)![2]).toBe(fake.getView().zoom === 16 ? 15 : fake.viewSet.at(-1)![2]);
    expect(fake.viewSet.at(-1)![2]).not.toBe(16);
    expect(fake.viewSet.at(-1)![0]).toBeCloseTo(mid.lat, 6);
    await go('control', { lat: 33.1, lon: 131, zoom: 16 }, 19);
    expect(fake.viewSet.at(-1)![2]).toBe(19);
  });

  it('設定タブの「初期位置」で選べる。「記憶する」のチェックは無い', () => {
    const s = boot(false);
    const btn = root.querySelector<HTMLButtonElement>('[data-startpos="control"]')!;
    btn.click();
    expect(new Prefs(s).startPos).toBe('control');
    expect(root.querySelector('[data-startpos="control"]')!.closest('.srow')!.querySelector('input[type=checkbox]')).toBeNull();
  });
});
