// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

describe('アプリ名', () => {
  it('左上に、アプリ名とサブタイトルが 2 段で出る', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const store = new MemoryStore();
    mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
    expect(root.querySelector('.brand .ttl')!.textContent).toBe('Racing Line Lab');
    expect(root.querySelector('.brand .subttl')!.textContent).toBe('シンプル走行ライン比較ツール');
    expect(root.querySelector('header')!.firstElementChild!.classList.contains('brand')).toBe(true);
  });
  it('ページ名・ウィンドウ名・配布名も同じ', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('<title>Racing Line Lab</title>');
    expect(readFileSync('electron/main.cjs', 'utf8')).toContain("title: 'Racing Line Lab'");
    expect(JSON.parse(readFileSync('package.json', 'utf8')).build.productName).toBe('Racing Line Lab');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).name).toBe('racing-line-lab');
    expect(readFileSync('electron/main.cjs', 'utf8')).toContain("APP_NAME = 'racing-line-lab'");
  });
});
