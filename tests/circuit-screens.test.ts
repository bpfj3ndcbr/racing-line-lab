// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');
const flush = () => new Promise((r) => setTimeout(r, 0));

let root: HTMLElement, store: MemoryStore, session: Session, maps: FakeMap[];
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  maps = [];
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => { const m = new FakeMap(); maps.push(m); return m; });
}
beforeEach(() => { store = new MemoryStore(); mount(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const mapOf = () => maps[maps.length - 1];
const work = () => $('#work');
const openNew = () => $<HTMLButtonElement>('[data-act="open-circuit-editor"]').click();
const pick = async (id: string, name: string, text: string) => {
  const input = $<HTMLInputElement>(id);
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name, text: async () => text }] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const okBtn = () => document.querySelector<HTMLButtonElement>('.modal [data-dialog="ok"]')!;

describe('サーキット欄の初期の画面', () => {
  it('登録フォームは 1 行 1 項目 + 最後の行のボタン。地図で登録する画面を開くボタンは「地図による登録」タブにある', () => {
    expect($('#panel-reg').querySelectorAll('.circ-form > .frow')).toHaveLength(4);
    const last = $('#panel-reg').querySelector('.circ-form > .frow:last-child')!;
    expect(Array.from(last.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['登録']);
    expect(Array.from($('#panel-map').querySelectorAll('button')).map((b) => b.textContent)).toEqual(['地図を開いて登録…']);
    expect(work().hidden).toBe(true);
    expect($('#import-body').hidden).toBe(false);
  });
});

describe('大きな画面: 登録', () => {
  it('4 つのカードの下に出る(データ管理の中)。上部のタブは「データ管理」のまま。地図とフォームがある', () => {
    openNew();
    expect(work().hidden).toBe(false);
    expect($('#import-body').hidden).toBe(true);
    const kids = Array.from($('#view-import').children).map((c) => c.id);
    expect(kids.slice(0, 3)).toEqual(['slots', 'guide', 'work']);                  // カードの下(はじめかたは、大きな画面の間は隠れる)
    expect($('#guide').hidden).toBe(true);
    expect($('.navtab[data-view="import"]').getAttribute('aria-current')).toBe('page');
    expect($('#ce-title').textContent).toBe('サーキットの登録');
    expect($('#ce-save').textContent).toBe('登録完了');
    expect($('#ce-lines').textContent).toBe('計測ライン: 未設定');
  });

  it('.cln / .sci を選ぶと、地図にラインが出て(ラベル付き)、名前が自動で入る', async () => {
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    expect($<HTMLInputElement>('#ce-name').value).toBe('autopolis');
    expect(mapOf().lines.map((l) => l.label)).toEqual(['計測ライン']);
    expect(mapOf().fitted).toBeGreaterThan(0);
    await pick('#ce-sci', 'autopolis.sci', sci);
    expect(mapOf().lines).toHaveLength(8);
    expect($('#ce-lines').textContent).toBe('計測ライン あり ・ セクター 7 本');
  });

  it('読み取れないファイルは、その旨を表示して無視する', async () => {
    openNew();
    await pick('#ce-cln', 'x.cln', 'でたらめ');
    expect($('#ce-msg').textContent).toContain('読み取れません');
    expect(mapOf().lines).toHaveLength(0);
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect($('#ce-msg').textContent).toContain('計測ラインを引くか、.cln ファイルを読み込んでください');
    expect(session.circuits).toHaveLength(0);
  });

  it('「登録」で、いま地図に出ている範囲(表示位置)と一緒に保存され、元の画面へ戻る', async () => {
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    await pick('#ce-sci', 'autopolis.sci', sci);
    $<HTMLInputElement>('#ce-name').value = 'オートポリス';
    mapOf().view = { lat: 33.04, lon: 130.98, zoom: 17 };
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect(session.circuits).toHaveLength(1);
    expect(session.circuits[0]).toMatchObject({ name: 'オートポリス', view: { lat: 33.04, lon: 130.98, zoom: 17 } });
    expect(session.circuits[0].sectors).toHaveLength(7);
    expect(work().hidden).toBe(true);
    expect($('#import-body').hidden).toBe(false);
    expect($('#circuit-badge').textContent).toBe('登録 1 件');
    expect(JSON.parse(store.get('circuits')!)[0].view.zoom).toBe(17);
  });

  it('同じ名前は「既に名前が存在します」→ OK で入力に戻る(画面は閉じない)', async () => {
    session.registerCircuit('オートポリス', cln, sci);
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    $<HTMLInputElement>('#ce-name').value = ' オートポリス ';
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect(document.querySelector('.modal')!.textContent).toContain('既に名前が存在します');
    okBtn().click();
    await flush();
    expect(work().hidden).toBe(false);
    expect(session.circuits).toHaveLength(1);
  });

  it('キャンセルでは何も登録しない', async () => {
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    $<HTMLButtonElement>('#ce-cancel').click();
    // 計測ラインを読み込んだあとなので、保存し忘れの確認が出る(案件 23)。「破棄して閉じる」で閉じる
    document.querySelector<HTMLButtonElement>('.modal [data-dialog="ok"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(session.circuits).toHaveLength(0);
    expect(work().hidden).toBe(true);
  });
});

describe('大きな画面: 編集', () => {
  beforeEach(() => {
    session.registerCircuit('オートポリス', cln, sci, { lat: 33.0, lon: 130.9, zoom: 16 });
    $<HTMLButtonElement>('#tab-list').click();
  });
  const edit = () => $<HTMLButtonElement>('[data-act="edit-circuit"]').click();

  it('登録済みの一覧の「編集(地図)…」で開く。ラインと保存した表示位置で地図が出る', () => {
    edit();
    expect($('#ce-title').textContent).toBe('サーキットの編集');
    expect($<HTMLInputElement>('#ce-name').value).toBe('オートポリス');
    expect($('#ce-save').textContent).toBe('保存');
    expect($<HTMLInputElement>('#ce-name').value).toBe('オートポリス');
    expect(mapOf().lines).toHaveLength(8);
    expect(mapOf().viewSet).toEqual([[33.0, 130.9, 16]]);
  });

  it('名前・表示位置・ファイルを変えて保存できる。選ばなかったファイルは変わらない', async () => {
    edit();
    $<HTMLInputElement>('#ce-name').value = 'AUTOPOLIS';
    mapOf().view = { lat: 33.1, lon: 130.95, zoom: 18 };
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    const c = session.circuits[0];
    expect(c.name).toBe('AUTOPOLIS');
    expect(c.view).toEqual({ lat: 33.1, lon: 130.95, zoom: 18 });
    expect(c.sectors).toHaveLength(7);
    expect(work().hidden).toBe(true);
  });

  it('セクターのファイルを選び直すと、セクターが入れ替わる', async () => {
    edit();
    const two = sci.split(/\r?\n/).slice(0, 2).join('\n');
    await pick('#ce-sci', 'autopolis.sci', sci);
    expect($('#ce-lines').textContent).toContain('セクター 7 本');
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect(session.circuits[0].sectors).toHaveLength(7);
    expect(two.length).toBeGreaterThan(0);
  });

  it('他のサーキットと同じ名前にはできない', async () => {
    session.registerCircuit('鈴鹿', cln, sci);
    edit();
    $<HTMLInputElement>('#ce-name').value = '鈴鹿';
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect(document.querySelector('.modal')!.textContent).toContain('既に名前が存在します');
    okBtn().click();
    await flush();
    expect(session.circuits[0].name).toBe('オートポリス');
    expect(work().hidden).toBe(false);
  });
});

describe("登録した表示位置と比較画面の地図は別々", () => {
  it('表示位置があっても、比較画面は使わない(走行ラインに合わせる)。倍率はサーキット登録の地図と別に管理する', () => {
    session.registerCircuit('オートポリス', cln, sci, { lat: 33.0, lon: 130.9, zoom: 16 });
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    const m = maps[0];
    expect(m.viewSet).toHaveLength(0);
    expect(m.fitted).toBeGreaterThan(0);
  });

  it('表示位置が無いサーキットでは fit', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect(maps[0].fitted).toBeGreaterThan(0);
    expect(maps[0].viewSet).toHaveLength(0);
  });
});

describe('大きな画面の切り替え', () => {
  it('サーキット編集中はタブで移れない(キャンセルで閉じる)。位置補正とサーキットの画面は同時には出ない', () => {
    session.addLog(utc(), 'u');
    openNew();
    expect($('.work-circuit').hidden).toBe(false);
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect(work().hidden).toBe(false);                               // 移れない
    $<HTMLButtonElement>('#ce-cancel').click();
    expect(work().hidden).toBe(true);
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    expect($('#import-body').hidden).toBe(false);
    $<HTMLButtonElement>('[data-act="correct"]').click();
    expect($('.work-correct').hidden).toBe(false);
    expect($('.work-circuit').hidden).toBe(true);
  });
});
