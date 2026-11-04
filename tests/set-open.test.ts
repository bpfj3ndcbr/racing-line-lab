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

describe('「データ管理」タブに移ったときの比較セットの開閉', () => {
  it('何も無ければ、比較セット1だけを開く', () => {
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('settings');
    nav('import');
    expect(opened()).toEqual([true, false, false, false, false]);
  });

  it('表示セットの比較セットだけを開き、ほかは閉じる', () => {
    session.addLog(tiny(), 'a', 0);
    session.addLog(tiny(), 'b', 2);
    session.setActive(2);
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('help');
    nav('import');
    expect(opened()).toEqual([false, false, true, false, false]);
  });

  it('「データ管理」にいる間は、開いた比較セットを閉じない', () => {
    root.querySelectorAll<HTMLDetailsElement>('.set-sec').forEach((d) => { d.open = true; });
    nav('import');
    expect(opened()).toEqual([true, true, true, true, true]);
  });
});
