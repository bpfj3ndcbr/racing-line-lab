// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { analyticsAvailable, applyAnalytics, GA_ID } from '../src/io/analytics';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { Session } from '../src/store/session';
import { Prefs } from '../src/store/prefs';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const bridge = (): NativeBridge => ({
  storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
  getPathForFile: () => '', readTextFile: async () => null,
});
const gaScripts = () => document.querySelectorAll(`script[src*="googletagmanager.com/gtag/js?id=${GA_ID}"]`);
const disabled = () => (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];

function boot(native: boolean, store = new MemoryStore()) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  (window as { rllNative?: NativeBridge }).rllNative = native ? bridge() : undefined;
  const session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
  root.querySelector<HTMLElement>('[data-view="settings"]')!.click();
  return { root, session, sw: () => root.querySelector<HTMLButtonElement>('[data-analytics]')! };
}
afterEach(() => { delete (window as { rllNative?: NativeBridge }).rllNative; });

describe('利用状況の送信(Google アナリティクス)', () => {
  it('テスト・開発中、デスクトップ版では送らない(スクリプトを読み込まない)', () => {
    expect(analyticsAvailable()).toBe(false);       // テストは公開用ビルドではない
    boot(false);
    boot(true);
    expect(gaScripts()).toHaveLength(0);
  });

  it('公開用の Web 版でオンなら、gtag.js を 1 回だけ読み込む。オフにすると送信を止め、オンで再開する', () => {
    applyAnalytics(false, true);
    expect(gaScripts()).toHaveLength(0);
    expect(disabled()).toBe(true);
    applyAnalytics(true, true);
    applyAnalytics(true, true);
    expect(gaScripts()).toHaveLength(1);
    expect(disabled()).toBe(false);
    const w = window as unknown as { dataLayer: IArguments[] };
    expect(Array.from(w.dataLayer.at(-1)!)).toEqual(['config', GA_ID]);
    applyAnalytics(false, true);
    expect(disabled()).toBe(true);
    expect(gaScripts()).toHaveLength(1);
  });

  it('設定タブ(Web 版): 初期値はオンで、押すと切り替わって保存される', () => {
    const store = new MemoryStore();
    const { root, session, sw } = boot(false, store);
    expect(root.textContent).toContain('利用状況の送信');
    expect(sw().disabled).toBe(false);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().parentElement!.textContent).toContain('送信する');
    sw().click();
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().parentElement!.textContent).toContain('送信しない');
    expect(new Prefs(session).analytics).toBe(false);
    expect(boot(false, store).sw().getAttribute('aria-checked')).toBe('false');    // 起動し直しても残る
  });

  it('設定タブ(デスクトップ版): 「送信しない」のまま押せない', () => {
    const { sw } = boot(true);
    expect(sw().disabled).toBe(true);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().parentElement!.textContent).toContain('送信しない(デスクトップ版では送りません)');
  });

  it('About にも、計測していることが書いてある', () => {
    const { root } = boot(false);
    root.querySelector<HTMLElement>('[data-act="about"]')!.click();
    expect(document.querySelector('.modal')!.textContent).toContain('Google アナリティクス');
  });
});
