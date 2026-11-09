// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { TrackLog } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 中身は問わない小さなログ(走行ログのファイルが無くても動くテスト)
const tiny = (): TrackLog => ({
  fileName: 't.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
  t: Float64Array.from([0, 1, 2]), lat: new Float64Array(3).fill(33), lon: new Float64Array(3).fill(131), speed: new Float64Array(3),
});

let root: HTMLElement, session: Session;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const store = new MemoryStore();
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
});

const opened = () => Array.from(root.querySelectorAll<HTMLDetailsElement>('.set-sec')).map((d) => d.open);
const nav = (v: string) => root.querySelector<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`)!.click();
const view = (v: 'tabs' | 'list') => root.querySelector<HTMLButtonElement>(`[data-act="sets-view"][data-view="${v}"]`)!.click();
const tabOn = () => Array.from(root.querySelectorAll<HTMLElement>('.set-sec')).findIndex((d) => d.classList.contains('tab-on'));

describe('「データ管理」タブに移ったときの比較セットの開閉(案件 26)', () => {
  it('起動したときは、今までどおり比較セット1を開いている', () => {
    expect(opened()).toEqual([true, false, false, false, false]);
  });

  it('何も無くても、ほかのタブから移ったら比較セットはすべて閉じる(一覧)', () => {
    view('list');
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('settings');
    nav('import');
    expect(opened()).toEqual([false, false, false, false, false]);
  });

  it('走行ログがあっても、表示セットを含めてすべて閉じる(比較・使い方から)(一覧)', () => {
    view('list');
    session.addLog(tiny(), 'a', 0);
    session.addLog(tiny(), 'b', 2);
    session.setActive(2);
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('help');
    nav('import');
    expect(opened()).toEqual([false, false, false, false, false]);
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('compare');
    nav('import');
    expect(opened()).toEqual([false, false, false, false, false]);
  });

  it('「データ管理」にいる間は、開いた比較セットを閉じない(一覧)', () => {
    view('list');
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('import');
    expect(opened()).toEqual([true, true, true, true, true]);
  });
});

describe('比較セットの見出しの本数(案件 26)', () => {
  const badges = () => Array.from(root.querySelectorAll<HTMLElement>('.set-sec .set-badge'));
  it('走行ログが入った比較セットだけ緑(has-logs)。外すと元の灰色に戻る', () => {
    expect(badges().map((b) => b.classList.contains('has-logs'))).toEqual([false, false, false, false, false]);
    session.addLog(tiny(), 'a', 0);
    session.addLog(tiny(), 'b', 2);
    session.addLog(tiny(), 'c', 2);
    expect(badges().map((b) => b.textContent)).toEqual(['1 本', '0 本', '2 本', '0 本', '0 本']);
    expect(badges().map((b) => b.classList.contains('has-logs'))).toEqual([true, false, true, false, false]);
    session.removeLog('a', 0);
    expect(badges()[0].textContent).toBe('0 本');
    expect(badges()[0].classList.contains('has-logs')).toBe(false);
  });
});

describe('比較セットの見出しの要約(案件 27)', () => {
  it('走行ログが無ければ「—」、サーキットが判定できなければ「サーキット未判定」', () => {
    const sum = (i: number) => root.querySelector(`#sec-set-${i} .set-sum`)!.textContent;
    expect(sum(0)).toBe('—');
    session.addLog(tiny(), 'a', 0);
    expect(sum(0)).toBe('サーキット未判定割り当てなし');
    expect(sum(1)).toBe('—');
  });
});

describe('比較セットの並べ方: タブ / 一覧(案件 27)', () => {
  let store2: MemoryStore;
  const remount = () => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    session = new Session(store2);
    mountApp(root, session, new ThemeController(store2), () => new FakeMap());
  };
  beforeEach(() => { store2 = new MemoryStore(); remount(); });
  const tabs = () => Array.from(root.querySelectorAll<HTMLElement>('.set-tab'));

  it('初めはタブで、比較セット1を出す。割り当てが無ければ「表示中」の印はどこにも無い。別名があればタブは別名だけ', () => {
    expect(root.querySelector('#sets-group')!.classList.contains('as-tabs')).toBe(true);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(root.querySelector('.set-tab .shown-mark')).toBeNull();
    session.addLog(tiny(), 'a', 2);
    session.setAlias(2, 'AP');
    expect(tabs()[2].textContent).toBe('AP1 本');                                       // 「比較セット3」は出さない
    expect(tabs()[2].title).toBe('比較セット3');
    expect(tabs()[0].textContent).toBe('比較セット10 本');
  });

  it('タブを押すと、その比較セットだけを出す。見出しを押しても閉じない', () => {
    tabs()[3].click();
    expect(tabOn()).toBe(3);
    expect(opened()[3]).toBe(true);
    root.querySelector<HTMLElement>('#sec-set-3 > summary')!.click();
    expect(opened()[3]).toBe(true);
  });

  it('タブ ⇔ 一覧: 一覧の開閉は、タブで見た比較セットに関係なく元に戻る', () => {
    view('list');
    const sets = root.querySelectorAll<HTMLDetailsElement>('.set-sec');
    sets[0].open = false; sets[1].open = true; sets[4].open = true;
    sets.forEach((d) => d.dispatchEvent(new Event('toggle')));
    view('tabs');
    tabs()[2].click(); tabs()[3].click();
    view('list');
    expect(opened()).toEqual([false, true, false, false, true]);
  });

  it('ほかの画面から戻ると、タブは表示セット、一覧はすべて閉じた状態', () => {
    session.addLog(tiny(), 'a', 1);
    session.setActive(1);
    tabs()[4].click();
    view('list');
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; d.dispatchEvent(new Event('toggle')); });
    view('tabs');
    nav('compare');
    nav('import');
    expect(tabOn()).toBe(1);
    view('list');
    expect(opened()).toEqual([false, false, false, false, false]);
  });

  it('選んだ並べ方は保存され、次に開いたときも同じ', () => {
    view('list');
    expect(store2.get('ui.setsView')).toBe('"list"');
    remount();
    expect(root.querySelector('#sets-group')!.classList.contains('as-tabs')).toBe(false);
    expect(root.querySelector('[data-act="sets-view"][data-view="list"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});
