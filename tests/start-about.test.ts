// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { MemoryResumeStore } from '../src/io/resume';
import { Prefs } from '../src/store/prefs';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 起動時に About を表示する(案件 49)

let store: MemoryStore;
let app: { dispose(): void } | null = null;

function boot(o: { startupAbout?: boolean; resume?: MemoryResumeStore; sharedLaunch?: boolean } = {}) {
  app?.dispose();
  document.body.innerHTML = '<div id="app"></div>';
  const session = new Session(store);
  app = mountApp(document.getElementById('app')!, session, new ThemeController(store), () => new FakeMap(),
    { resume: o.resume ?? null, startupAbout: true, takeShared: async () => null, ...o });
  return session;
}
const dialog = () => document.querySelector<HTMLElement>('.modal');
const check = () => document.querySelector<HTMLInputElement>('[data-dialog="check"]');
const closeBtn = () => document.querySelector<HTMLButtonElement>('[data-dialog="ok"]')!;

beforeEach(() => { store = new MemoryStore(); });
afterEach(() => { app?.dispose(); app = null; });

describe('起動時の About', () => {
  it('起動すると About が出て、「次回から表示しない」のチェックが付く(初めはオフ)', () => {
    boot();
    expect(dialog()?.querySelector('h3')?.textContent).toBe('About');
    expect(check()).not.toBeNull();
    expect(check()!.checked).toBe(false);
  });

  it('「次回から表示しない」にチェックして閉じると、次の起動から出ない', () => {
    boot();
    check()!.click();
    closeBtn().click();
    expect(dialog()).toBeNull();
    expect(new Prefs(new Session(store)).startAbout).toBe(false);
    boot();
    expect(dialog()).toBeNull();
  });

  it('チェックを付けずに閉じたときは、次の起動でも出る', () => {
    boot();
    closeBtn().click();
    boot();
    expect(dialog()).not.toBeNull();
  });

  it('チェックを付けたあと外せば、また表示する設定に戻る', () => {
    boot();
    check()!.click();
    check()!.click();
    expect(new Prefs(new Session(store)).startAbout).toBe(true);
  });

  it('startupAbout を渡さなければ(ふだんのテスト・組み込み)出ない', () => {
    boot({ startupAbout: false });
    expect(dialog()).toBeNull();
  });

  it('Web 版の同じタブの読み直し(一時保存から戻すとき)では出ない', () => {
    boot({ resume: new MemoryResumeStore(true) });
    expect(dialog()).toBeNull();
  });

  it('共有の画面から開いたときは出ない', () => {
    boot({ resume: new MemoryResumeStore(false), sharedLaunch: true });
    expect(dialog()).toBeNull();
  });

  it('ヘッダーの About ボタンで開いたときは、チェックを出さない', () => {
    boot({ startupAbout: false });
    document.querySelector<HTMLButtonElement>('[data-act="about"]')!.click();
    expect(dialog()).not.toBeNull();
    expect(check()).toBeNull();
  });

  it('設定タブのスイッチで切り替えられ、チェックと同じ値を見る', () => {
    boot({ startupAbout: false });
    const sw = () => document.querySelector<HTMLButtonElement>('[data-startabout]')!;
    expect(sw().getAttribute('aria-checked')).toBe('true');
    sw().click();
    expect(new Prefs(new Session(store)).startAbout).toBe(false);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    sw().click();
    expect(new Prefs(new Session(store)).startAbout).toBe(true);
  });

  it('「すべて初期値に戻す」で、表示する設定に戻る', () => {
    boot({ startupAbout: false });
    new Prefs(new Session(store)).setStartAbout(false);
    document.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    document.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    expect(new Prefs(new Session(store)).startAbout).toBe(true);
  });
});
