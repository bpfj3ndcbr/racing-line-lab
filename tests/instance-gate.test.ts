// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryInstanceHub, currentKind, openInstanceLock } from '../src/io/instance';
import { startSingle } from '../src/ui/instanceGate';

// 同時に 1 つの窓だけで起動する(案件 60。Web 版・PWA 版)
const flush = () => new Promise((r) => setTimeout(r, 0));
const noWait = async () => {};

let hub: MemoryInstanceHub;
function windowRoot() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}
/** 起動したら「app」と書き、dispose で印を付けるアプリの代わり */
function fakeApp(root: HTMLElement, log: string[], name: string) {
  return () => { root.textContent = `app:${name}`; log.push(`start:${name}`); return { dispose: () => { log.push(`dispose:${name}`); } }; };
}
const text = (root: HTMLElement) => root.textContent ?? '';

beforeEach(() => { hub = new MemoryInstanceHub(); document.body.innerHTML = ''; });

describe('同時に 1 つの窓だけで起動する', () => {
  it('ほかに開いている窓が無ければ、そのまま起動する', async () => {
    const root = windowRoot(), log: string[] = [];
    await startSingle(root, hub.lock('browser'), fakeApp(root, log, 'A'), { steal: false, wait: noWait });
    expect(log).toEqual(['start:A']);
    expect(text(root)).toBe('app:A');
  });

  it('先にブラウザで開いていれば、後から開いた PWA の窓は起動せず、先の窓の種類を出す', async () => {
    const a = windowRoot(), b = windowRoot(), log: string[] = [];
    await startSingle(a, hub.lock('browser'), fakeApp(a, log, 'A'), { steal: false, wait: noWait });
    await startSingle(b, hub.lock('pwa'), fakeApp(b, log, 'B'), { steal: false, wait: noWait });
    expect(log).toEqual(['start:A']);
    expect(text(b)).toContain('Racing Line Lab は、すでにブラウザで開かれています');
    expect(text(b)).toContain('先にそちらを閉じてから、もう一度確かめてください。');
    expect(b.querySelector('[data-single="retry"]')?.textContent).toBe('もう一度確かめる');
  });

  it('先が PWA なら「インストールしたアプリ(PWA)」と出す', async () => {
    const a = windowRoot(), b = windowRoot();
    await startSingle(a, hub.lock('pwa'), fakeApp(a, [], 'A'), { steal: false, wait: noWait });
    await startSingle(b, hub.lock('browser'), fakeApp(b, [], 'B'), { steal: false, wait: noWait });
    expect(text(b)).toContain('すでにインストールしたアプリ(PWA)で開かれています');
  });

  it('「もう一度確かめる」: 先の窓がまだあれば案内を出し、閉じたあとならそのまま起動する', async () => {
    const a = windowRoot(), b = windowRoot(), log: string[] = [];
    const la = hub.lock('browser');
    await startSingle(a, la, fakeApp(a, log, 'A'), { steal: false, wait: noWait });
    await startSingle(b, hub.lock('pwa'), fakeApp(b, log, 'B'), { steal: false, wait: noWait });
    b.querySelector<HTMLButtonElement>('[data-single="retry"]')!.click();
    await flush();
    expect(b.querySelector('[data-single="hint"]')?.textContent).toBe('まだ開かれています。');
    la.release();                                       // 先の窓を閉じた
    b.querySelector<HTMLButtonElement>('[data-single="retry"]')!.click();
    await flush();
    expect(log).toEqual(['start:A', 'start:B']);
    expect(text(b)).toBe('app:B');
  });

  it('読み直したとき、前のページのロックがすぐに外れなくても、少し待って取れれば起動する', async () => {
    const a = windowRoot(), b = windowRoot(), log: string[] = [];
    const la = hub.lock('browser');
    await startSingle(a, la, fakeApp(a, log, 'A'), { steal: false, wait: noWait });
    let waits = 0;
    await startSingle(b, hub.lock('browser'), fakeApp(b, log, 'B'), { steal: false, wait: async () => { if (++waits === 1) la.release(); } });
    expect(log).toEqual(['start:A', 'start:B']);
  });

  it('共有の画面から開いた窓は、先の窓から奪って起動する。奪われた窓はアプリを止めて、閉じるよう案内する', async () => {
    const a = windowRoot(), b = windowRoot(), log: string[] = [];
    await startSingle(a, hub.lock('pwa'), fakeApp(a, log, 'A'), { steal: false, wait: noWait });
    await startSingle(b, hub.lock('pwa'), fakeApp(b, log, 'B'), { steal: true, wait: noWait });
    expect(log).toEqual(['start:A', 'dispose:A', 'start:B']);
    expect(text(b)).toBe('app:B');
    expect(text(a)).toContain('別の窓で開き直されました');
    expect(text(a)).toContain('この窓は閉じてください。');
  });

  it('窓の権利を扱えない(デスクトップ版・Web Locks の無い環境)ときは、確かめずに起動する', async () => {
    const root = windowRoot(), log: string[] = [];
    expect(openInstanceLock()).toBeNull();               // jsdom には navigator.locks が無い
    await startSingle(root, null, fakeApp(root, log, 'A'), { steal: false });
    expect(log).toEqual(['start:A']);
  });

  it('窓の種類: インストールしたアプリとして開いていれば PWA', () => {
    const w = (standalone: boolean) => ({ matchMedia: () => ({ matches: standalone }), navigator: {} }) as unknown as Window;
    expect(currentKind(w(true))).toBe('pwa');
    expect(currentKind(w(false))).toBe('browser');
    expect(currentKind({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } } as unknown as Window)).toBe('pwa');
  });
});
