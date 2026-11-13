// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

describe('About', () => {
  it('ヘッダーの右に「About」ボタンがあり、押すとダイアログが開く。Esc で閉じる', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const store = new MemoryStore();
    mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
    const segs = root.querySelectorAll('.top-right .seg');
    expect(segs[segs.length - 1].textContent!.trim()).toBe('About');
    expect(root.querySelector('.top [data-act="theme"]')).toBeNull();      // テーマの切り替えは設定タブだけ(案件 58)

    root.querySelector<HTMLElement>('[data-act="about"]')!.click();
    const dlg = document.querySelector('.modal')!;
    expect(dlg.querySelector('h3')!.textContent).toBe('About');
    expect(dlg.textContent).toContain('個人開発');
    expect(dlg.textContent).toContain('悪しからず');
    expect(dlg.textContent).toContain('2本目に繋げる');
    expect(dlg.querySelector('b')!.textContent).toContain('1本目を走った後');
    expect(dlg.textContent).toContain('© 2026 bpfj3ndcbr');
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(dlg.querySelector('.about-ver')!.textContent).toBe(`バージョン ${version}`);         // package.json の版
    const hrefs = Array.from(dlg.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/bpfj3ndcbr/racing-line-lab');
    expect(hrefs).toContain('https://github.com/bpfj3ndcbr/racing-line-lab/blob/main/THIRD-PARTY-NOTICES.txt');
    expect(dlg.querySelector('svg.logo')).not.toBeNull();
    expect(Array.from(dlg.querySelectorAll('a')).every((a) => a.getAttribute('rel') === 'noopener noreferrer' && a.target === '_blank')).toBe(true);

    document.querySelector('.modal-back')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.modal')).toBeNull();
  });
});
