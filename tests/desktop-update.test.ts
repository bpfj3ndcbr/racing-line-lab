// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isNewerVersion, latestVersion, parseVersion } from '../src/core';
import { checkDesktopUpdate, UPDATE_GUIDE_URL } from '../src/io/desktopUpdate';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { Session } from '../src/store/session';
import { Prefs } from '../src/store/prefs';
import { mountSettingsView } from '../src/ui/settingsView';

// デスクトップ版の「更新を確認する」(案件 52)

describe('版の番号', () => {
  it('○.○.○ と v○.○.○ だけを読む', () => {
    expect(parseVersion('1.6.0')).toEqual([1, 6, 0]);
    expect(parseVersion('v1.10.2')).toEqual([1, 10, 2]);
    expect(parseVersion('v1.6.0-beta')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });
  it('いちばん新しい版を選ぶ(10 は 9 より新しい。読めないタグは無視)', () => {
    expect(latestVersion(['v1.9.0', 'v1.10.0', 'v1.6.0', 'v2.0.0-rc1', 'misc'])).toBe('1.10.0');
    expect(latestVersion(['misc'])).toBeNull();
    expect(latestVersion([])).toBeNull();
  });
  it('新しいかどうか(同じ・古いは false)', () => {
    expect(isNewerVersion('1.6.1', '1.6.0')).toBe(true);
    expect(isNewerVersion('1.6.0', '1.6.0')).toBe(false);
    expect(isNewerVersion('1.5.9', '1.6.0')).toBe(false);
    expect(isNewerVersion('x', '1.6.0')).toBe(false);
  });
});

describe('checkDesktopUpdate', () => {
  const native = (r: { ok: boolean; tags?: string[] } | Error) =>
    ({ checkUpdate: async () => { if (r instanceof Error) throw r; return r; } });
  it('新しい版があれば newer、同じか古ければ latest', async () => {
    expect(await checkDesktopUpdate(native({ ok: true, tags: ['v1.6.0', 'v1.7.0'] }), '1.6.0')).toEqual({ status: 'newer', latest: '1.7.0' });
    expect(await checkDesktopUpdate(native({ ok: true, tags: ['v1.6.0', 'v1.5.0'] }), '1.6.0')).toEqual({ status: 'latest' });
  });
  it('取れなかった・読めるタグが無い・窓口が無いときは failed', async () => {
    expect(await checkDesktopUpdate(native({ ok: false }), '1.6.0')).toEqual({ status: 'failed' });
    expect(await checkDesktopUpdate(native({ ok: true, tags: ['misc'] }), '1.6.0')).toEqual({ status: 'failed' });
    expect(await checkDesktopUpdate(native(new Error('x')), '1.6.0')).toEqual({ status: 'failed' });
    expect(await checkDesktopUpdate(undefined, '1.6.0')).toEqual({ status: 'failed' });
  });
});

describe('設定の「更新を確認する」(デスクトップ版)', () => {
  afterEach(() => { delete window.rllNative; });
  const mount = (check: NativeBridge['checkUpdate']) => {
    window.rllNative = { checkUpdate: check } as unknown as NativeBridge;
    const root = document.createElement('div');
    mountSettingsView(root, new Prefs(new Session(new MemoryStore())), () => {});
    document.body.append(root);
    return root;
  };
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const click = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-update-native]')!.click();
  const status = (root: HTMLElement) => root.querySelector('[data-update-native]')!.parentElement!.querySelector('.swl')!.textContent;

  it('押すと確認して、新しい版があれば知らせて、更新の手順を開くボタンを出す', async () => {
    const root = mount(async () => ({ ok: true, tags: ['v99.0.0'] }));
    expect(root.querySelector('a[href]:not([href^="#"])[target="_blank"].pri')).toBeNull();
    click(root);
    expect(root.querySelector<HTMLButtonElement>('[data-update-native]')!.textContent).toBe('確認中…');
    await flush();
    expect(status(root)).toContain('新しい版 99.0.0 があります');
    const a = root.querySelector<HTMLAnchorElement>('.sctl a.pri')!;
    expect(a.getAttribute('href')).toBe(UPDATE_GUIDE_URL);
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
  });

  it('同じ版なら「最新です」、取れなければ案内を出す(手順のボタンは出さない)', async () => {
    const latest = mount(async () => ({ ok: true, tags: ['v0.0.1'] }));
    click(latest); await flush();
    expect(status(latest)).toContain('最新です');
    expect(latest.querySelector('.sctl a.pri')).toBeNull();

    const failed = mount(async () => ({ ok: false }));
    click(failed); await flush();
    expect(status(failed)).toContain('確認できませんでした');
    expect(failed.querySelector('.sctl a.pri')).toBeNull();
  });

  it('確認は押したときだけ(画面を開いただけでは問い合わせない)', async () => {
    let calls = 0;
    const root = mount(async () => { calls++; return { ok: true, tags: [] }; });
    await flush();
    expect(calls).toBe(0);
    click(root); await flush();
    expect(calls).toBe(1);
  });
});
