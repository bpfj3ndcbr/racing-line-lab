// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap, autoTrim } from './helpers';

// ファイルの追加で出る取り込み範囲の画面(案件 59)は、そのまま「次へ」で進める
autoTrim();

const vbo = readFileSync('fixtures/20260913140139_UTC.vbo', 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 20));
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;

let root: HTMLElement;
/** 幅が wide(768px 以上)か狭いか(スマホの縦画面)で起動する。jsdom には matchMedia が無いので差し替える */
function boot(wide: boolean) {
  (window as { matchMedia?: unknown }).matchMedia = (q: string) => ({
    matches: wide, media: q, addEventListener() {}, removeEventListener() {},
  });
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const store = new MemoryStore();
  mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
}
afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const bar = () => $('#top-tabs');
const tab = (k: string) => $<HTMLButtonElement>(`#top-tab-${k}`);
const sec = (id: string) => $(`#${id}`);
const shown = () => ['sec-circuit', 'sec-offsets', 'sets-group'].filter((id) => !sec(id).classList.contains('top-off'));

describe('データ管理の上のタブ(案件 74): 幅が広いとき', () => {
  it('「サーキット」「走行ライン補正データ」「比較セット」のタブが出て、初めは「比較セット」だけを出す', () => {
    boot(true);
    expect(bar().hidden).toBe(false);
    expect($('#import-body').classList.contains('tabbed')).toBe(true);
    expect(Array.from(bar().querySelectorAll('[role="tab"]')).map((b) => b.firstChild?.textContent)).toEqual(['サーキット', '走行ライン補正データ', '比較セット']);
    expect(tab('sets').getAttribute('aria-selected')).toBe('true');
    expect(shown()).toEqual(['sets-group']);
  });

  it('タブを押すと、その節だけを出す(開閉の節は開いて見せる)', () => {
    boot(true);
    tab('circuit').click();
    expect(shown()).toEqual(['sec-circuit']);
    expect($<HTMLDetailsElement>('#sec-circuit').open).toBe(true);
    expect(tab('circuit').getAttribute('aria-selected')).toBe('true');
    expect(tab('sets').getAttribute('aria-selected')).toBe('false');
    tab('offsets').click();
    expect(shown()).toEqual(['sec-offsets']);
    expect($<HTMLDetailsElement>('#sec-offsets').open).toBe(true);
    tab('sets').click();
    expect(shown()).toEqual(['sets-group']);
  });

  it('見出しの印(「未登録」「補正なし」)は、タブに移る', () => {
    boot(true);
    expect(tab('circuit').textContent).toContain('未登録');
    expect(tab('offsets').textContent).toContain('補正なし');
  });

  it('キーボード: ←→・Home・End でタブを移る', () => {
    boot(true);
    const key = (k: string) => tab(document.activeElement?.id.replace('top-tab-', '') ?? 'sets').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    tab('sets').focus();
    key('ArrowRight');                         // 比較セット → サーキット(端から回る)
    expect(shown()).toEqual(['sec-circuit']);
    key('End');
    expect(shown()).toEqual(['sets-group']);
    key('ArrowLeft');
    expect(shown()).toEqual(['sec-offsets']);
    key('Home');
    expect(shown()).toEqual(['sec-circuit']);
    // サーキットの中のタブ(登録済み / ファイル / 地図)は、変わらない
    expect($('#tab-list').getAttribute('aria-selected')).toBe('true');
  });

  it('はじめかたの「.cln / .sci ファイルで登録…」は、「サーキット」のタブに切り替えて見せる', async () => {
    boot(true);
    $<HTMLButtonElement>('#sec-set-0 [data-act="add"]').click();
    const inp = $<HTMLInputElement>('#vbo-input');
    Object.defineProperty(inp, 'files', { value: [file('a.vbo', vbo)], configurable: true });
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    document.querySelector<HTMLButtonElement>('[data-dialog="cancel"], [data-act="load-cancel"]')?.click();
    await flush();
    expect(shown()).toEqual(['sets-group']);
    const btn = root.querySelector<HTMLButtonElement>('[data-act="guide-file"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(shown()).toEqual(['sec-circuit']);
    expect($('#panel-reg').hidden).toBe(false);
  });
});

describe('データ管理の上のタブ(案件 74): 幅が狭いとき(スマホの縦画面)', () => {
  it('タブは出さず、今までの開閉の見出しのまま', () => {
    boot(false);
    expect(bar().hidden).toBe(true);
    expect($('#import-body').classList.contains('tabbed')).toBe(false);
    expect(shown()).toEqual(['sec-circuit', 'sec-offsets', 'sets-group']);
    expect(bar().children).toHaveLength(0);
  });

  it('matchMedia が無い環境でも、開閉の見出しのまま', () => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    const store = new MemoryStore();
    mountApp(root, new Session(store), new ThemeController(store), () => new FakeMap());
    expect(bar().hidden).toBe(true);
    expect(shown()).toEqual(['sec-circuit', 'sec-offsets', 'sets-group']);
  });
});
