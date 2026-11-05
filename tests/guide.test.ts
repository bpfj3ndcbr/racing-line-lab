// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { Prefs } from '../src/store/prefs';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap, headOf } from './helpers';

const cln = readFileSync('fixtures/cl_autopolis.cln', 'utf8');
const sci = readFileSync('fixtures/autopolis.sci', 'utf8');
const vbo = readFileSync('fixtures/20260913140139_UTC.vbo', 'utf8');
const vbo2 = vbo + '\n';
const vbo3 = vbo + '\n\n';
const flush = () => new Promise((r) => setTimeout(r, 20));
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;

let store: MemoryStore, root: HTMLElement, fake: FakeMap, session: Session;
function boot() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  fake = new FakeMap();
  mountApp(root, session, new ThemeController(store), () => fake);
}
beforeEach(() => { store = new MemoryStore(); boot(); });
afterEach(() => { delete (window as { rllNative?: NativeBridge }).rllNative; });
const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

/** ドロップを再現する(target に落とす) */
function drop(target: Element, files: File[]) {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(e);
  return e;
}
const curStep = () => Array.from(root.querySelectorAll('#guide .gstep')).findIndex((s) => s.classList.contains('cur'));
const nav = (v: string) => $<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`).click();

describe('.vbo のドロップ', () => {
  it('各セットにドロップ枠がある。ログがあるセットの枠は小さい', () => {
    expect(root.querySelectorAll('.set-drop .dropbox')).toHaveLength(5);
    expect($('#sec-set-0 .dropbox').textContent).toContain('ここに .vbo ファイルをドラッグ&ドロップ');
    session.addLog(parseOne(), 'u', 0);
    expect($('#sec-set-0 .dropbox').classList.contains('compact')).toBe(true);
  });

  it('枠に落とした .vbo は、その枠のセットに入る', async () => {
    drop($('#sec-set-2 .dropbox'), [file('a.vbo', vbo)]);
    await flush();
    expect(session.sets.map((w) => w.logs.length)).toEqual([0, 0, 1, 0, 0]);
  });

  it('枠の外(セットの中・ほかの場所)に落としても追加されない。ブラウザがファイルを開かないよう、既定の動作は止める', async () => {
    const e1 = drop($('#sec-set-0 .files'), [file('a.vbo', vbo)]);
    const e2 = drop($('#sec-set-0 .set-bar'), [file('a.vbo', vbo)]);
    const e3 = drop(document.body, [file('a.vbo', vbo)]);
    await flush();
    expect(session.sets.every((w) => w.logs.length === 0)).toBe(true);
    expect(e1.defaultPrevented && e2.defaultPrevented && e3.defaultPrevented).toBe(true);
  });

  it('.vbo 以外は追加せず、案内を出す', async () => {
    drop($('#sec-set-0 .dropbox'), [file('a.vbo', vbo), file('memo.txt', 'x')]);
    await flush();
    expect(session.sets[0].logs).toHaveLength(1);
    expect($('#msg').textContent).toContain('1 件は .vbo ではないため追加しませんでした');
  });

  it('枠の上にファイルを持ってくると強調され、離れると戻る', () => {
    const box = $('#sec-set-0 .dropbox');
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } });
    box.dispatchEvent(over);
    expect(box.classList.contains('over')).toBe(true);
    expect(over.defaultPrevented).toBe(true);
    box.dispatchEvent(new Event('dragleave', { bubbles: true }));
    expect(box.classList.contains('over')).toBe(false);
  });

  it('枠のクリックで、そのセットに追加するファイル選択が開く', () => {
    let opened = 0;
    $<HTMLInputElement>('#vbo-input').click = () => { opened++; };
    $('#sec-set-3 .dropbox').click();
    expect(opened).toBe(1);
  });
});

import { parseVbo } from '../src/core';
function parseOne() { return parseVbo(vbo, 'u.vbo'); }

describe('割り当て: 速いものから自動 / 手動', () => {
  beforeEach(() => { session.registerCircuit('オートポリス', cln, sci); });
  const slots = () => (['A', 'B', 'C', 'D'] as const).map((s) => session.sets[0].assignment[s]?.logId ?? null);
  const four = () => [{ file: file('a.vbo', vbo) }, { file: file('b.vbo', vbo2) }, { file: file('c.vbo', vbo3) }, { file: file('d.vbo', vbo + '\n\n\n') }];

  it('複数のファイルを追加しても、自動では割り当てない(手順 3 で選べる)', async () => {
    await session.addVboFiles(four().slice(0, 3), 0);
    expect(slots()).toEqual([null, null, null, null]);
    expect(session.sets[0].logs).toHaveLength(3);
  });

  it('速いものから自動: 各ログのベストラップを、速い順に A, B, C … へ', async () => {
    await session.addVboFiles(four().slice(0, 3), 0);
    expect(session.autoAssignFastest(0)).toBe(3);
    const ids = slots().filter((x) => x);
    expect(ids).toHaveLength(3);
    const dur = (['A', 'B', 'C'] as const).map((s) => {
      const r = session.sets[0].assignment[s]!;
      return session.sets[0].logs.find((l) => l.id === r.logId)!.laps.find((l) => l.number === r.lap)!.duration;
    });
    expect([...dur].sort((x, y) => x - y)).toEqual(dur);
  });

  it('空き枠があれば若い方から。空きが足りなければ入るところまで。空きが無ければ何もしない', async () => {
    await session.addVboFiles(four(), 0);
    session.autoAssignFastest(0);
    expect(slots().every((x) => x)).toBe(true);
    const a0 = session.sets[0].assignment.A;
    session.toggleAssignment('B', session.sets[0].assignment.B!, 0);      // B を空ける
    await session.addVboFiles([{ file: file('e.vbo', vbo + '\n\n\n\n') }], 0);
    expect(session.autoAssignFastest(0)).toBe(1);                          // 空きは B の 1 枠だけ
    expect(session.sets[0].assignment.B).not.toBeNull();
    expect(session.sets[0].assignment.A).toEqual(a0);                      // 既に入っている枠は動かさない
    await session.addVboFiles([{ file: file('f.vbo', vbo + '\n\n\n\n\n') }], 0);
    expect(session.autoAssignFastest(0)).toBe(0);                          // 空きが無ければ何もしない
  });

  it('割り当てたセットが「表示セット」になる。ログの無いセット・サーキットの無いログは何もしない', async () => {
    await session.addVboFiles(four().slice(0, 2), 3);
    session.autoAssignFastest(3);
    expect(session.activeIndex).toBe(3);
    expect(session.autoAssignFastest(4)).toBe(0);
    const s = new Session(new MemoryStore());
    await s.addVboFiles([{ file: file('a.vbo', vbo) }], 1);
    expect(s.autoAssignFastest(1)).toBe(0);
  });

  it('手順 3 に「速いものから A に自動で割り当て」と「手動で割り当て」が並ぶ。複数ファイルを追加しても手順 3 のまま選べる', async () => {
    drop($('#sec-set-0 .dropbox'), [file('a.vbo', vbo), file('b.vbo', vbo2)]);
    await flush();
    expect(curStep()).toBe(2);
    expect(Array.from(root.querySelectorAll('#guide .gstep.cur button')).map((b) => b.textContent))
      .toEqual(['速いものから A に自動で割り当て', '手動で割り当て']);
  });

  it('どちらを選んでも、その比較セットがスクロール領域の一番上に来る', async () => {
    drop($('#sec-set-2 .dropbox'), [file('a.vbo', vbo), file('b.vbo', vbo2)]);
    await flush();
    session.setActive(2);
    const calls: HTMLElement[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: HTMLElement) { calls.push(this); };
    try {
      $<HTMLButtonElement>('[data-act="guide-manual"]').click();
      expect(calls.at(-1)).toBe($('#sec-set-2'));
      expect(slots().every((x) => !x)).toBe(true);                          // 手動: 割り当ては変えない
      $<HTMLButtonElement>('[data-act="guide-auto"]').click();
      expect(calls.at(-1)).toBe($('#sec-set-2'));
      expect(session.sets[2].assignment.A).not.toBeNull();
    } finally { Element.prototype.scrollIntoView = orig; }
  });
});

describe('はじめかた', () => {
  it('ログが無いときは手順 1 が「いまここ」。ログを追加してサーキットが無ければ手順 2(候補・地図・ファイル・登録済みの入口)', () => {
    expect(curStep()).toBe(0);
    expect($('#guide').textContent).toContain('走行ログ(.vbo)を追加…');
    session.addLog(parseOne(), 'u', 0);
    expect(curStep()).toBe(1);
    // テスト用のログは 1 周分(輪)なので、計測ラインの候補がある(候補のボタンが青)
    const labels = Array.from(root.querySelectorAll('#guide .gstep.cur button')).map((b) => b.textContent);
    expect(labels).toEqual(['ログの計測ラインで登録…', '地図で登録…', '.cln / .sci ファイルで登録…']);
    expect($('[data-act="guide-cand"]').classList.contains('pri')).toBe(true);
    expect($('[data-act="guide-map"]').classList.contains('pri')).toBe(false);
    session.registerCircuit('別', '1\r\n34.0\r\n131.0\r\n34.001\r\n131.001\r\n', '');
    expect(Array.from(root.querySelectorAll('#guide .gstep.cur button')).map((b) => b.textContent)).toContain('登録済みから選ぶ');
  });

  it('サーキットが決まれば手順 3(ベストラップの自動割り当て)。押すと A に入り、手順 4 になる', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseOne(), 'u', 0);
    expect(curStep()).toBe(2);
    $<HTMLButtonElement>('[data-act="guide-auto"]').click();
    expect(session.assignment.A).not.toBeNull();
    expect(curStep()).toBe(3);
    expect($('#guide .gstep.cur').textContent).toContain('比較画面へ');
  });

  it('手順 2 のボタン: 地図で登録 → 登録画面(走行ログの位置)、ファイルで登録 → 「サーキット」を開いてファイルのタブ', () => {
    session.addLog(parseOne(), 'u', 0);
    $<HTMLButtonElement>('[data-act="guide-file"]').click();
    expect($<HTMLDetailsElement>('#sec-circuit').open).toBe(true);
    expect($('#tab-reg').getAttribute('aria-selected')).toBe('true');
    $<HTMLButtonElement>('[data-act="guide-map"]').click();
    expect($<HTMLElement>('.work-circuit').hidden).toBe(false);
    const c = session.logCenter(0)!;
    expect([fake.getView().lat, fake.getView().lon]).toEqual([c.lat, c.lon]);
  });

  it('セットの中の「サーキットが見つかりません」にも、同じ入口のボタンがある', () => {
    session.addLog(parseOne(), 'u', 1);
    const labels = Array.from(root.querySelectorAll('#sec-set-1 .empty button')).map((b) => b.textContent);
    expect(labels).toEqual(['ログの計測ラインで登録…', '地図で登録…', '.cln / .sci ファイルで登録…']);
    expect(root.querySelector('#sec-set-1 .empty [data-act="circ-cand"]')!.classList.contains('pri')).toBe(true);
    // 候補が無いログ(輪でない)では、地図で登録が青
    session.addLog(headOf(parseOne(), 0.8), 'h', 2);
    const set2 = Array.from(root.querySelectorAll('#sec-set-2 .empty button')).map((b) => b.textContent);
    expect(set2).toEqual(['地図で登録…', '.cln / .sci ファイルで登録…']);
    expect(root.querySelector('#sec-set-2 .empty [data-act="circ-map"]')!.classList.contains('pri')).toBe(true);
  });

  it('ラップが出たのに割り当てが無いセットには、自動割り当ての案内が出る(表示していないセットでも)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseOne(), 'u', 2);
    const hint = $('#sec-set-2 .set-hint');
    expect(hint.hidden).toBe(false);
    const auto = $<HTMLButtonElement>('#sec-set-2 [data-act="auto-assign"]');
    expect(auto.classList.contains('pri')).toBe(true);                       // 青(次にやること)
    expect(auto.parentElement!.classList.contains('set-bar')).toBe(true);    // 「セクタータイムを表示」の横
    auto.click();
    expect(session.sets[2].assignment.A).not.toBeNull();
    expect(session.activeIndex).toBe(2);
    expect($('#sec-set-2 .set-hint').hidden).toBe(true);
  });

  it('「閉じる」で 1 行に畳み、「はじめかた ▸」で開き直せる。覚えておく', () => {
    $<HTMLButtonElement>('[data-act="guide-close"]').click();
    expect($('#guide').querySelector('.gstep')).toBeNull();
    expect($('#guide').textContent).toContain('はじめかた ▸');
    boot();
    expect($('#guide').querySelector('.gstep')).toBeNull();
    $<HTMLButtonElement>('[data-act="guide-open"]').click();
    expect($('#guide').querySelector('.gstep')).not.toBeNull();
    boot();
    expect($('#guide').querySelector('.gstep')).not.toBeNull();
  });

  it('一度比較まで進むと、次の起動からは畳んで始まる(開き直した後はそのまま)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseOne(), 'u', 0);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    nav('compare');
    boot();
    expect($('#guide').querySelector('.gstep')).toBeNull();
    $<HTMLButtonElement>('[data-act="guide-open"]').click();
    boot();
    expect($('#guide').querySelector('.gstep')).not.toBeNull();
  });
});

describe('比較画面から、サーキット(セクター)を編集して比較に戻る', () => {
  beforeEach(() => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseOne(), 'u', 0);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    nav('compare');
  });
  it('「セクターを追加・編集…」で登録済みのサーキットの編集画面が開き、終わると比較に戻る', async () => {
    const btn = $<HTMLButtonElement>('#cmp-edit-circuit');
    expect(btn.hidden).toBe(false);
    btn.click();
    expect($<HTMLElement>('#view-import').hidden).toBe(false);
    expect($<HTMLElement>('.work-circuit').hidden).toBe(false);
    expect($('#ce-title').textContent).toBe('サーキットの編集');
    expect($<HTMLInputElement>('#ce-name').value).toBe('オートポリス');
    expect($('#ce-draw-sector').classList.contains('pri')).toBe(true);        // 比較画面から来たときは「セクターを追加」が青
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect($<HTMLElement>('#view-compare').hidden).toBe(false);
    expect($<HTMLElement>('#view-import').hidden).toBe(true);
  });
  it('セクターを足して保存すると、比較画面のセクター表示も更新される(割り当ては残る)', async () => {
    const id = session.circuits[0].id;
    const c = session.circuits[0];
    session.setCircuitLines(id, c.control, []);
    await flush();
    expect($('#cmp-sectors').textContent).toContain('セクター設定無し');
    session.setCircuitLines(id, c.control, c.sectors.slice(0, 2));
    expect(session.assignment.A).not.toBeNull();
    expect(root.querySelectorAll('#cmp-sectors [data-act="sector"]')).toHaveLength(2);
  });
  it('データ管理から開いたサーキット編集は、終わっても比較には移らない', async () => {
    nav('import');
    $<HTMLButtonElement>('[data-act="tab"], #tab-list').click();
    $<HTMLButtonElement>('[data-act="edit-circuit"]').click();
    expect($('#ce-draw-sector').classList.contains('pri')).toBe(false);       // データ管理から開いたときは青にしない
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect($<HTMLElement>('#view-import').hidden).toBe(false);
    expect($<HTMLElement>('#view-compare').hidden).toBe(true);
  });
});

describe('地図の倍率は、比較とサーキット登録で別々', () => {
  it('サーキット登録の地図は、設定の倍率(数値)で開く。比較画面の「前回の倍率」は変わらない', () => {
    const p = new Prefs(session);
    p.setRemember('zoom', true);
    p.setValue('zoom', 18);
    session.registerCircuit('オートポリス', cln, sci, { lat: 33.04, lon: 130.97, zoom: 16 });
    session.addLog(parseOne(), 'u', 0);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    const id = session.circuits[0].id;
    $<HTMLButtonElement>('#tab-list').click();
    $<HTMLButtonElement>(`[data-act="edit-circuit"][data-id="${id}"]`).click();
    expect(fake.viewSet.at(-1)).toEqual([33.04, 130.97, 18]);
    expect(new Prefs(session).initial('zoom')).toBe(18);   // 登録画面を開いても、比較の「前回の倍率」は変わらない
  });

  it('倍率が「サーキット全体」(0)のときは、登録した表示位置のまま開く', () => {
    session.registerCircuit('オートポリス', cln, sci, { lat: 33.04, lon: 130.97, zoom: 16 });
    session.addLog(parseOne(), 'u', 0);
    const id = session.circuits[0].id;
    $<HTMLButtonElement>('#tab-list').click();
    $<HTMLButtonElement>(`[data-act="edit-circuit"][data-id="${id}"]`).click();
    expect(fake.viewSet.at(-1)).toEqual([33.04, 130.97, 16]);
  });
});

describe('初期のテーマ', () => {
  it('保存が無ければ、OS がダークでもライトで始まる。保存があればそれ', () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
    try {
      const t = new ThemeController(new MemoryStore());
      expect(t.get()).toBe('light');
      const s = new MemoryStore(); s.set('theme', 'dark');
      expect(new ThemeController(s).get()).toBe('dark');
    } finally { window.matchMedia = orig; }
  });
});

describe('文字の大きさ(CSS)', () => {
  const css = readFileSync('src/style.css', 'utf8');
  it('全体の文字は 13px', () => {
    expect(css).toMatch(/^body\{[^}]*font:13px\/1\.5/m);
  });
  it('データ管理は、ヘッダー・A〜D のカード・はじめかたを固定して、その下だけスクロールする', () => {
    expect(css).toContain('#view-import{display:flex;flex-direction:column;height:calc(100vh - var(--top-h))');
    expect(css).toMatch(/#view-import>\.body\{[^}]*overflow:auto/);
  });
  it('比較画面のカードの文字の大きさ', () => {
    expect(css).toContain('.card .c1{font-weight:700;font-size:10px}');
    expect(css).toContain('.card .c3{font-size:12px;line-height:1.35}');
    expect(css).toContain('.card .chip{width:24px;height:24px;font-size:12px}');
  });
});

describe('サーキット編集中は画面を移れない', () => {
  it('編集中は上部のタブと「比較画面へ」が押せず、キャンセルで戻ると押せる', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseOne(), 'u', 0);
    session.autoAssignFastest(0);
    $<HTMLButtonElement>('[data-act="open-circuit-editor"]').click();
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.navtab'));
    expect(tabs.filter((t) => t.disabled)).toHaveLength(3);     // 使い方・比較・設定
    expect($<HTMLButtonElement>('[data-act="goto-compare"]').disabled).toBe(true);
    nav('compare');
    expect($<HTMLElement>('#view-compare').hidden).toBe(true);
    $<HTMLButtonElement>('#ce-cancel').click();
    expect(tabs.every((t) => !t.disabled)).toBe(true);
    expect($<HTMLButtonElement>('[data-act="goto-compare"]').disabled).toBe(false);
  });
});
