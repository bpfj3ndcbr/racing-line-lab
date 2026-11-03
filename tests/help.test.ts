// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const store = new MemoryStore();
  mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
  return root;
}

describe('使い方タブ', () => {
  it('上部のタブは「使い方」「データ管理」「比較」「設定」の順。起動時は「データ管理」', () => {
    const root = mount();
    expect(Array.from(root.querySelectorAll('.navtab')).map((b) => b.textContent)).toEqual(['使い方', 'データ管理', '比較', '設定']);
    expect(root.querySelector('.navtab.on')!.textContent).toBe('データ管理');
    expect(root.querySelector<HTMLElement>('#view-help')!.hidden).toBe(true);
  });

  it('押すと、README の「使い方」と「そのほかの操作」が画像つきで出る。開発者向けの節は出ない', () => {
    const root = mount();
    root.querySelector<HTMLElement>('[data-view="help"]')!.click();
    const help = root.querySelector<HTMLElement>('#view-help')!;
    expect(help.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('#view-import')!.hidden).toBe(true);
    const h2 = Array.from(help.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(['使い方', 'そのほかの操作']);
    expect(help.textContent).toContain('「使い方」「データ管理」「比較」「設定」 の 4 つのタブがあります');
    const imgs = Array.from(help.querySelectorAll('img'));
    expect(imgs.length).toBeGreaterThan(10);
    expect(imgs.every((img) => !img.getAttribute('src')!.startsWith('docs/images/'))).toBe(true);     // 同梱した画像の URL になっている
  });
});
