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

describe('「データ管理」タブに移ったときの比較セットの開閉(案件 26)', () => {
  it('起動したときは、今までどおり比較セット1を開いている', () => {
    expect(opened()).toEqual([true, false, false, false, false]);
  });

  it('何も無くても、ほかのタブから移ったら比較セットはすべて閉じる', () => {
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('settings');
    nav('import');
    expect(opened()).toEqual([false, false, false, false, false]);
  });

  it('走行ログがあっても、表示セットを含めてすべて閉じる(比較・使い方から)', () => {
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

  it('「データ管理」にいる間は、開いた比較セットを閉じない', () => {
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
