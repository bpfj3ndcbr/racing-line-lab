// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 各画面(使い方・データ管理・設定)の最下部のフッター(案件 87)
describe('フッター', () => {
  it('「使い方」「データ管理」「設定」の最下部に「Racing Line Lab バージョン x.x.x (2026)」が出る。設定を描き直しても残る', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const store = new MemoryStore();
    mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
    const text = `Racing Line Lab バージョン ${__APP_VERSION__} (2026)`;
    const foot = (id: string) => root.querySelector<HTMLElement>(`#${id} .app-foot`);
    const nav = (v: string) => root.querySelector<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`)!.click();
    expect(foot('view-import')?.textContent).toBe(text);
    expect(foot('view-import')!.parentElement!.lastElementChild).toBe(foot('view-import'));      // 画面の中身の最後
    nav('help');
    expect(foot('view-help')?.textContent).toBe(text);
    nav('settings');
    expect(foot('view-settings')?.textContent).toBe(text);
    root.querySelector<HTMLElement>('#view-settings [data-set]')!.click();                       // 設定を押して描き直す
    expect(foot('view-settings')?.textContent).toBe(text);
    expect(root.querySelectorAll('#view-help .app-foot')).toHaveLength(1);                       // 画面を行き来しても 1 つだけ
    nav('import'); nav('help');
    expect(root.querySelectorAll('#view-help .app-foot')).toHaveLength(1);
  });
});
