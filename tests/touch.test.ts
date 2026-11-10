// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { hasExt, installAppleFilePicker, isAppleTouch, wrongExtMessage } from '../src/ui/fileKind';
import { attachSinglePointer } from '../src/ui/mapPointer';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

/** jsdom には PointerEvent が無いので、MouseEvent に pointerId・pointerType を足して代用する */
function ptr(el: Element, type: string, id: number, o: { kind?: string; button?: number; x?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: o.button ?? 0, clientX: o.x ?? 0 });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: o.kind ?? 'touch' });
  el.dispatchEvent(e);
}

describe('地図の上を 1 本の指でなぞる操作(案件 29)', () => {
  let el: HTMLElement, log: string[], on: boolean;
  beforeEach(() => {
    document.body.innerHTML = '<div id="m"><div class="pane"></div><div class="leaflet-marker-icon"><span></span></div><div class="leaflet-control"><button></button></div></div>';
    el = document.getElementById('m')!;
    log = []; on = true;
    attachSinglePointer(el, {
      enabled: () => on,
      start: (e) => log.push(`start ${e.clientX}`),
      move: (e) => log.push(`move ${e.clientX}`),
      end: (e) => log.push(`end ${e.clientX}`),
      cancel: () => log.push('cancel'),
    });
  });
  const pane = () => el.querySelector('.pane')!;

  it('指でなぞると、始め・途中・終わりが届く(マウスと同じ)', () => {
    ptr(pane(), 'pointerdown', 1, { x: 10 });
    ptr(pane(), 'pointermove', 1, { x: 20 });
    ptr(pane(), 'pointerup', 1, { x: 30 });
    expect(log).toEqual(['start 10', 'move 20', 'end 30']);
  });

  it('マウスは左ボタンだけ。受け付けていないときは何も届かない', () => {
    ptr(pane(), 'pointerdown', 1, { kind: 'mouse', button: 2 });
    ptr(pane(), 'pointerup', 1, { kind: 'mouse', button: 2 });
    on = false;
    ptr(pane(), 'pointerdown', 2);
    ptr(pane(), 'pointermove', 2);
    ptr(pane(), 'pointerup', 2);
    expect(log).toEqual([]);
    on = true;
    ptr(pane(), 'pointerdown', 1, { kind: 'mouse', x: 5 });
    ptr(pane(), 'pointerup', 1, { kind: 'mouse', x: 6 });
    expect(log).toEqual(['start 5', 'end 6']);
  });

  it('途中で 2 本目の指が触れたら取り消し。すべての指が離れるまで、次のなぞりは始まらない', () => {
    ptr(pane(), 'pointerdown', 1, { x: 10 });
    ptr(pane(), 'pointerdown', 2, { x: 50 });                 // 2 本の指(拡大・縮小は地図に任せる)
    ptr(pane(), 'pointermove', 1, { x: 20 });
    ptr(pane(), 'pointerup', 2);
    ptr(pane(), 'pointermove', 1, { x: 30 });
    ptr(pane(), 'pointerup', 1);
    expect(log).toEqual(['start 10', 'cancel']);
    ptr(pane(), 'pointerdown', 3, { x: 40 });                 // 離したあとは、また引ける
    ptr(pane(), 'pointerup', 3, { x: 41 });
    expect(log).toEqual(['start 10', 'cancel', 'start 40', 'end 41']);
  });

  it('ブラウザが操作を取り消したら(pointercancel)取り消し', () => {
    ptr(pane(), 'pointerdown', 1);
    ptr(pane(), 'pointercancel', 1);
    expect(log).toEqual(['start 0', 'cancel']);
  });

  it('つまみ・地図の上のボタンで押したときは、なぞる操作にしない', () => {
    ptr(el.querySelector('.leaflet-marker-icon span')!, 'pointerdown', 1);
    ptr(el.querySelector('.leaflet-marker-icon span')!, 'pointerup', 1);
    ptr(el.querySelector('.leaflet-control button')!, 'pointerdown', 2);
    ptr(el.querySelector('.leaflet-control button')!, 'pointerup', 2);
    expect(log).toEqual([]);
  });
});

describe('ファイルの種類(案件 29)', () => {
  const nav = (platform: string, maxTouchPoints = 0, userAgent = '') => ({ platform, maxTouchPoints, userAgent });

  it('拡張子は大文字・小文字を区別しない', () => {
    expect(hasExt('cl_autopolis.CLN', '.cln')).toBe(true);
    expect(hasExt('autopolis.sci.txt', '.sci')).toBe(false);
    expect(wrongExtMessage('a.txt', '.cln')).toBe('「a.txt」は .cln ではないため読み込みませんでした。');
  });

  it('iPhone・iPad(Mac と名乗るタッチの iPad も)を見分ける。Android・Mac は違う', () => {
    expect(isAppleTouch(nav('iPhone'))).toBe(true);
    expect(isAppleTouch(nav('MacIntel', 5))).toBe(true);
    expect(isAppleTouch(nav('MacIntel', 0))).toBe(false);
    expect(isAppleTouch(nav('Linux armv81', 5, 'Mozilla/5.0 (Linux; Android 14)'))).toBe(false);
  });

  it('iPhone・iPad では、ファイルを選ぶ欄を押したときに accept を外す。ほかの端末では外さない', () => {
    document.body.innerHTML = '<input type="file" accept=".vbo" id="f">';
    const f = document.getElementById('f') as HTMLInputElement;
    const offOther = installAppleFilePicker(document, nav('Linux armv81', 5));
    f.click();
    expect(f.getAttribute('accept')).toBe('.vbo');
    offOther();
    const off = installAppleFilePicker(document, nav('iPhone', 5));
    f.click();
    expect(f.hasAttribute('accept')).toBe(false);
    off();
  });
});

describe('種類の違うファイルを選んだとき(案件 29)', () => {
  let root: HTMLElement, session: Session;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    const store = new MemoryStore();
    session = new Session(store);
    mountApp(root, session, new ThemeController(store), () => new FakeMap());
  });
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const pick = async (sel: string, name: string) => {
    const input = $<HTMLInputElement>(sel);
    let read = false;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, text: async () => { read = true; return ''; } }] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    return read;
  };

  it('データ管理のコントロールライン・セクターの欄: 案内を出し、選んだファイルを外す', async () => {
    expect(await pick('#c-cln', 'log.vbo')).toBe(false);
    expect($('#c-msg').textContent).toBe('「log.vbo」は .cln ではないため読み込みませんでした。');
    expect(await pick('#c-sci', 'memo.txt')).toBe(false);
    expect($('#c-msg').textContent).toBe('「memo.txt」は .sci ではないため読み込みませんでした。');
    await pick('#c-cln', 'x.cln');
    expect($('#c-msg').textContent).toBe('');                // 正しい種類を選び直すと、案内は消える
  });

  it('地図で登録する画面の .cln / .sci: 読まずに案内を出す', async () => {
    $<HTMLButtonElement>('[data-act="open-circuit-editor"]').click();
    expect(await pick('#ce-cln', 'log.vbo')).toBe(false);
    expect($('#ce-msg').textContent).toBe('「log.vbo」は .cln ではないため読み込みませんでした。');
    expect(await pick('#ce-sci', 'cl_x.cln')).toBe(false);
    expect($('#ce-msg').textContent).toBe('「cl_x.cln」は .sci ではないため読み込みませんでした。');
  });

  it('位置補正データ(.json): 読まずに案内を出す', async () => {
    expect(await pick('#offsets-input', 'log.vbo')).toBe(false);
    expect(session.message).toBe('「log.vbo」は .json ではないため読み込みませんでした。');
  });
});
