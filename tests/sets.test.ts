// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { Session, SET_COUNT } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const vbo = readFileSync(fx('20260913140139_UTC.vbo'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 20));
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;

let store: MemoryStore, root: HTMLElement, fake: FakeMap, session: Session;
let disk: Map<string, string>, reads: string[];
function bridge(): NativeBridge {
  return {
    storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
    getPathForFile: (f) => `/data/${f.name}`,
    readTextFile: async (p) => { reads.push(p); return disk.get(p) ?? null; },
  };
}
function boot(native = false) {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  (window as { rllNative?: NativeBridge }).rllNative = native ? bridge() : undefined;
  session = new Session(store);
  fake = new FakeMap();
  mountApp(root, session, new ThemeController(store), () => fake);
  return session;
}
beforeEach(() => { store = new MemoryStore(); disk = new Map([['/data/a.vbo', vbo], ['/data/b.vbo', vbo + '\n']]); reads = []; boot(); });
afterEach(() => { delete (window as { rllNative?: NativeBridge }).rllNative; });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const log = () => parseVbo(vbo, 'u.vbo');

describe('比較セット 1〜5', () => {
  it('5 つの枠がある。割り当てが無いうちは「表示中」の印は無く、「表示中にする」も押せない(案件 28)', () => {
    expect(SET_COUNT).toBe(5);
    expect(Array.from(root.querySelectorAll('.set-sec h2')).map((h) => h.textContent)).toEqual(['比較セット1', '比較セット2', '比較セット3', '比較セット4', '比較セット5']);
    expect(Array.from(root.querySelectorAll<HTMLElement>('.set-sec .set-shown')).map((e) => e.textContent)).toEqual(Array(5).fill('表示中にする'));
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>('[data-act="set-active"]')).every((b) => b.disabled)).toBe(true);
    expect(session.shownIndex).toBeNull();
    expect($('#slots .slots-title').textContent).toBe('表示中の比較セットはありません(ラップを A〜D に割り当てると表示されます)');
    expect($('#guide').textContent).toContain('表示予定のセット(比較セット1)');
  });

  it('割り当てた比較セットが表示中になり、印・題・はじめかたに出る。割り当てのある別の比較セットは「表示中にする」で切り替わる', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(log(), 'u', 0);
    session.addLog(log(), 'u', 2);
    expect(session.activeIndex).toBe(2);                                                   // 表示中が無いあいだは、最後に走行ログを入れた比較セットが「表示予定」
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    expect(session.shownIndex).toBe(0);
    expect($('#sec-set-0 .set-shown .shown-mark')).not.toBeNull();
    expect($('#slots .slots-title').textContent).toBe('表示中比較セット1');
    expect($('#slots .slots-title .shown-mark')).not.toBeNull();
    expect($('#guide').textContent).toContain('表示中のセット(比較セット1)');
    expect($<HTMLButtonElement>('#sec-set-2 [data-act="set-active"]').disabled).toBe(true);   // 割り当てが無いので押せない
    session.toggleAssignment('B', { logId: 'u', lap: 1 }, 2);                                 // 割り当てると、その比較セットが表示中
    expect(session.shownIndex).toBe(2);
    $<HTMLButtonElement>('#sec-set-0 [data-act="set-active"]').click();
    expect(session.shownIndex).toBe(0);
    expect($('#slots .slots-title').textContent).toBe('表示中比較セット1');
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);                                 // 割り当てを外すと、表示中が無い状態に戻る
    expect(session.shownIndex).toBeNull();
    expect($('#slots .slots-title').textContent).toContain('表示中の比較セットはありません');
  });
});

describe('タブの「表示中」の印(案件 27・28)', () => {
  it('表示中の比較セットのタブにだけ印。中の見出しの印は CSS で隠す(data-k="on")', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(log(), 'u', 0);
    session.addLog(log(), 'u', 1);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 1);
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('.set-tab'));
    expect(tabs.map((t) => !!t.querySelector('.shown-mark'))).toEqual([false, true, false, false, false]);
    expect(tabs[1].title).toBe('比較セット2(表示セット)');
    expect($<HTMLElement>('#sec-set-1 .set-shown').dataset.k).toBe('on');
  });
});

describe('ログが 0 件のセット / 比較画面のセット選択 / 地図で新規登録', () => {
  it('「表示中にする」は、割り当てがある比較セットでだけ押せる。session は 0 件の比較セットへの切り替えを受け付けない', () => {
    const btns = () => [1, 2, 3, 4].map((i) => root.querySelector<HTMLButtonElement>(`#sec-set-${i} [data-act="set-active"]`)!.disabled);
    expect(btns()).toEqual([true, true, true, true]);
    session.setActive(3);
    expect(session.activeIndex).toBe(0);
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(log(), 'u', 0);
    session.addLog(log(), 'u', 3);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    expect(btns()).toEqual([true, true, true, true]);                                       // 比較セット4は走行ログだけで、割り当てが無い
    expect($('#sec-set-3 [data-act="set-active"]').getAttribute('title')).toBe('ラップを A〜D に割り当てると選べます');
    session.toggleAssignment('B', { logId: 'u', lap: 1 }, 3);
    session.setActive(0);
    expect(btns()).toEqual([true, true, false, true]);
  });

  it('比較画面の上部に、表示中のプルダウンがある。割り当てが無い比較セットは選べず、選ぶと切り替わる(案件 28)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(log(), 'u', 0);
    session.addLog(log(), 'u', 1);
    session.addLog(log(), 'u', 2);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 2);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    const sel = $<HTMLSelectElement>('#cmp-set');
    expect(Array.from(sel.options).map((o) => [o.textContent, o.disabled])).toEqual([
      ['比較セット1(1本)', false], ['比較セット2(1本)', true], ['比較セット3(1本)', false], ['比較セット4(0本)', true], ['比較セット5(0本)', true]]);
    sel.value = '2';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(session.activeIndex).toBe(2);
    expect(sel.value).toBe('2');
  });

  it('「使用するサーキット」の「走行ログ位置のサーキットを新規に登録する」で、ログの位置を中心に地図の登録画面が開く', () => {
    session.addLog(log(), 'u', 1);
    const empty = $<HTMLSelectElement>('#sec-set-0 .circuit-select');
    expect(Array.from(empty.options).at(-1)!.disabled).toBe(true);
    const sel = $<HTMLSelectElement>('#sec-set-1 .circuit-select');
    const last = Array.from(sel.options).at(-1)!;
    expect(last.textContent).toContain('走行ログ位置のサーキットを新規に登録する');
    sel.value = last.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect($<HTMLElement>('.work-circuit').hidden).toBe(false);
    const v = fake.getView();
    const c = session.logCenter(1)!;
    expect([v.lat, v.lon]).toEqual([c.lat, c.lon]);
    expect(v.zoom).toBe(16);
    expect(session.sets[1].selectedCircuitId).toBeNull();
    expect(sel.value).toBe('');
  });

  it('「地図による登録」の説明に、走行ログ位置から登録する案内がある', () => {
    expect($('#panel-map').textContent).toContain('「走行ログ位置のサーキットを新規に登録する」を選択すると、付近のサーキットが自動で表示され登録が簡単です');
  });
});

describe('セットは独立している(位置補正だけが共通)', () => {
  beforeEach(() => {
    session.registerCircuit('オートポリス', cln, sci);
    session.registerCircuit('別のサーキット', '1\r\n34.0\r\n131.0\r\n34.001\r\n131.001\r\n', '');
    const shared = log();
    session.addLog(shared, 'u', 0);
    session.addLog(shared, 'u', 1);             // 同じファイルを別のセットにも
  });

  it('同じファイルを別のセットに入れても、読み直さず中身を共有する。Run 番号はセットごと', () => {
    expect(session.sets[0].logs[0].log).toBe(session.sets[1].logs[0].log);
    expect(session.sets[0].logs[0].no).toBe(1);
    expect(session.sets[1].logs[0].no).toBe(1);
  });

  it('同じラップを、別のセットでも割り当てられる。割り当ては互いに影響しない', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    session.toggleAssignment('B', { logId: 'u', lap: 1 }, 1);
    expect(session.sets[0].assignment.A).toEqual({ logId: 'u', lap: 1 });
    expect(session.sets[0].assignment.B).toBeNull();
    expect(session.sets[1].assignment.A).toBeNull();
    expect(session.sets[1].assignment.B).toEqual({ logId: 'u', lap: 1 });
  });

  it('表示していないセットで割り当てを押すと、そのセットが表示中になる', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    expect(session.shownIndex).toBe(0);
    $<HTMLButtonElement>('#sec-set-1 [data-act="assign"][data-slot="C"]').click();
    expect(session.activeIndex).toBe(1);
    expect(session.assignment.C).toEqual({ logId: 'u', lap: 1 });
    expect($('#slots .slots-title').textContent).toContain('比較セット2');
    expect(session.sets[0].assignment.C).toBeNull();
  });

  it('使用するサーキットはセットごと。片方を変えても、もう片方の判定・ラップは変わらない(通らないサーキットを選ぶと、ラップ無し)', () => {
    const other = session.circuits.find((c) => c.name === '別のサーキット')!;
    const sel = $<HTMLSelectElement>('#sec-set-1 .circuit-select');
    sel.value = other.id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(session.sets[1].selectedCircuitId).toBe(other.id);
    expect(session.sets[0].selectedCircuitId).toBeNull();
    expect(session.sets[1].logs[0].circuit).toBeNull();
    expect(session.sets[1].logs[0].outside?.name).toBe('別のサーキット');
    expect(session.sets[1].logs[0].laps).toEqual([]);
    expect(session.sets[0].logs[0].circuit?.name).toBe('オートポリス');
    expect(session.sets[0].logs[0].laps.length).toBeGreaterThan(0);
  });

  it('並べ替え・セクタータイムの表示・区間/通過時刻は、そのセットだけ', () => {
    $<HTMLButtonElement>('#sec-set-1 [data-act="sort"][data-key="time"]').click();
    expect(session.sets[1].sort.key).toBe('time');
    expect(session.sets[0].sort.key).toBe('lap');
    $<HTMLButtonElement>('#sec-set-1 [data-act="sectors"]').click();
    expect(session.sets[1].showSectors).toBe(true);
    expect(session.sets[0].showSectors).toBe(false);
    expect(root.querySelector('#sec-set-1 .tbl .row.hd')!.textContent).toContain('S1');
    expect(root.querySelector('#sec-set-0 .tbl .row.hd')!.textContent).not.toContain('S1');
    $<HTMLButtonElement>('#sec-set-1 [data-act="sector-mode"][data-mode="cumulative"]').click();
    expect(session.sets[1].sectorMode).toBe('cumulative');
    expect(session.sets[0].sectorMode).toBe('split');
  });

  it('ログを外す・サーキットを削除する操作も、そのセットだけに効く', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 1);
    session.removeLog('u', 1);
    expect(session.sets[1].logs).toHaveLength(0);
    expect(session.sets[0].logs).toHaveLength(1);
    expect(session.sets[0].assignment.A).not.toBeNull();
    const other = session.circuits.find((c) => c.name === '別のサーキット')!;
    session.setCircuit(other.id, 2);
    session.deleteCircuit(other.id);
    expect(session.sets[2].selectedCircuitId).toBeNull();
  });

  it('位置補正は、同じファイルが入っているすべてのセットに効く。同じラップが見つかれば、どのセットでも割り当ては残る(案件 19)', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    session.toggleAssignment('B', { logId: 'u', lap: 1 }, 1);
    session.setOffset('u', { east: 1.5, north: -0.5 });
    expect(session.sets[0].logs[0].offset).toEqual({ east: 1.5, north: -0.5 });
    expect(session.sets[1].logs[0].offset).toEqual({ east: 1.5, north: -0.5 });
    expect(session.sets[0].assignment.A).toEqual({ logId: 'u', lap: 1 });
    expect(session.sets[1].assignment.B).toEqual({ logId: 'u', lap: 1 });
  });

  it('位置補正の画面は、表示していないセットのログでも開ける', () => {
    session.addLog(parseVbo(vbo, 'z.vbo'), 'z', 2);
    $<HTMLButtonElement>('#sec-set-2 [data-act="correct"]').click();
    expect(root.querySelector('#cor-title')!.textContent).toContain('Run 1');
    expect(root.querySelector('#cor-file')!.textContent).toBe('z.vbo');
  });

  it('比較画面は、表示セットの割り当てを使う', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 1);
    session.toggleAssignment('B', { logId: 'u', lap: 1 }, 0);       // 比較セット1 に切り替わる
    expect(session.activeIndex).toBe(0);
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect(fake.cars.map((c) => c.slot)).toEqual(['B']);
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.setActive(1);
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect(fake.cars.map((c) => c.slot)).toEqual(['A']);
  });
});

describe('前回の状態の保存と自動読み込み(セット)', () => {
  async function prepare() {
    const s = boot(true);
    s.registerCircuit('オートポリス', cln, sci);
    await s.addVboFile(file('a.vbo', vbo), '/data/a.vbo', 0);
    await s.addVboFile(file('a.vbo', vbo), '/data/a.vbo', 2);       // 同じファイルを別のセットにも
    await s.addVboFile(file('b.vbo', vbo + '\n'), '/data/b.vbo', 2);
    s.toggleAssignment('A', { logId: s.sets[0].logs[0].id, lap: 1 }, 0);
    s.toggleAssignment('B', { logId: s.sets[2].logs[1].id, lap: 1 }, 2);
    s.toggleSort('time', 2);
    s.toggleSectors(2);
    return s;
  }

  it('全セットのファイル・割り当て・並べ替え・表示セットが、起動し直しても元に戻る。同じファイルは 1 回だけ読む', async () => {
    const s1 = await prepare();
    const aId = s1.sets[0].logs[0].id, bId = s1.sets[2].logs[1].id;
    reads = [];
    const s2 = boot(true);
    await flush();
    expect(s2.sets.map((w) => w.logs.map((l) => l.id))).toEqual([[aId], [], [aId, bId], [], []]);
    expect(s2.sets[2].assignment.B).toEqual({ logId: bId, lap: 1 });
    expect(s2.sets[0].assignment.A).toEqual({ logId: aId, lap: 1 });
    expect(s2.sets[2].sort.key).toBe('time');
    expect(s2.sets[2].showSectors).toBe(true);
    expect(s2.activeIndex).toBe(2);                                  // 最後に操作したセット
    expect(reads.sort()).toEqual(['/data/a.vbo', '/data/b.vbo']);
  });

  it('読み込み後、表示セットに割り当てがあれば「比較」を開く', async () => {
    await prepare();
    boot(true);
    expect($<HTMLElement>('#view-import').hidden).toBe(false);       // 読み込み中は、データ管理のまま
    await flush();
    expect($<HTMLElement>('#view-compare').hidden).toBe(false);
    expect($<HTMLElement>('#view-import').hidden).toBe(true);
  });

  it('割り当てが無ければ、「データ管理」のまま', async () => {
    const s = boot(true);
    s.registerCircuit('オートポリス', cln, sci);
    await s.addVboFile(file('a.vbo', vbo), '/data/a.vbo', 1);
    boot(true);
    await flush();
    expect($<HTMLElement>('#view-import').hidden).toBe(false);
    expect(session.activeIndex).toBe(1);                             // 表示中が無いので、走行ログを入れた比較セット2が「表示予定」のまま
    expect(session.shownIndex).toBeNull();
    expect(session.sets[1].logs).toHaveLength(1);
  });

  it('読み込み中は、案内(何件中何件目)が出る', async () => {
    await prepare();
    boot(true);
    expect($('.toast').textContent).toContain('前回のファイルを読み込み中');       // 画面の下の通知(案件 53)
    expect($<HTMLElement>('.toast').hidden).toBe(false);
    await flush();
    expect($<HTMLElement>('.toast').hidden).toBe(true);
  });

  it('セットごとの使用するサーキットも戻る', async () => {
    const s = boot(true);
    s.registerCircuit('オートポリス', cln, sci);
    await s.addVboFile(file('a.vbo', vbo), '/data/a.vbo', 3);
    const id = s.circuits[0].id;
    s.setCircuit(id, 3);
    const s2 = boot(true);
    await flush();
    expect(s2.sets[3].selectedCircuitId).toBe(id);
    expect(s2.sets[3].logs[0].auto).toBe(false);
  });

  it('読めなかったファイルは飛ばして知らせる。そのファイルへの割り当ては戻さない', async () => {
    await prepare();
    disk.delete('/data/b.vbo');
    const s2 = boot(true);
    await flush();
    expect(s2.sets[2].logs).toHaveLength(1);
    expect(s2.sets[2].assignment.B).toBeNull();
    expect(s2.message).toContain('b.vbo');
  });
});

describe('セットの別名', () => {
  const alias = (i: number) => $<HTMLElement>(`#sec-set-${i} .set-alias`);
  it('「別名を編集」→ 入力 → 「確定」で、「別名: XXXX」と「編集」になる。元の「比較セットN」は残る', () => {
    session.addLog(log(), 'u', 1);
    expect(alias(1).textContent).toContain('別名を編集');
    $<HTMLButtonElement>('#sec-set-1 [data-act="alias-edit"]').click();
    const inp = $<HTMLInputElement>('#sec-set-1 .alias-input');
    expect(inp.maxLength).toBe(15);
    inp.value = '今日の自分';
    $<HTMLButtonElement>('#sec-set-1 [data-act="alias-ok"]').click();
    expect(alias(1).textContent).toContain('別名: 今日の自分');
    expect(alias(1).querySelector('button')!.textContent).toBe('編集');
    expect($('#sec-set-1 h2').textContent).toBe('比較セット2');
    expect(session.aliasOf(1)).toBe('今日の自分');
  });
  it('入力中に他の更新があっても、入力欄は作り直されない。Enter で確定、Esc でやめる', () => {
    session.addLog(log(), 'u', 1);
    $<HTMLButtonElement>('#sec-set-1 [data-act="alias-edit"]').click();
    const inp = $<HTMLInputElement>('#sec-set-1 .alias-input');
    inp.value = '途中';
    session.say('別の更新');
    expect($<HTMLInputElement>('#sec-set-1 .alias-input')).toBe(inp);
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(session.aliasOf(1)).toBe('');
    $<HTMLButtonElement>('#sec-set-1 [data-act="alias-edit"]').click();
    const inp2 = $<HTMLInputElement>('#sec-set-1 .alias-input');
    inp2.value = '  A  ';
    inp2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(session.aliasOf(1)).toBe('A');
  });
  it('空にして確定すると別名なしに戻る。16 文字以上は切られる。保存される', () => {
    session.setAlias(0, '12345678901234567890');
    expect(session.aliasOf(0)).toBe('123456789012345');
    session.setAlias(0, '  ');
    expect(session.aliasOf(0)).toBe('');
    session.setAlias(2, 'あ');
    expect(new Session(store).aliasOf(2)).toBe('あ');
  });
  it('比較画面のプルダウンと上部のカードに別名が出る(元の名前と件数も)', () => {
    session.addLog(log(), 'u', 1);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 1);
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    session.setAlias(1, '先週');
    const opt = Array.from(root.querySelectorAll<HTMLOptionElement>('#cmp-set option'))[1];
    expect(opt.textContent).toBe('先週(1本)');
    session.setActive(1);
    expect($('.slots-title').textContent).toContain('先週');
    expect($('.slots-title').textContent).toContain('比較セット2');
  });
});

describe('カード名(A〜D の別名)', () => {
  it('上部のカードの「✎」で編集できる。6 文字まで。セットごと・枠ごとに持つ。空で確定すると A〜D に戻る', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(log(), 'u', 0);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    expect($('.slot-a').textContent).toContain('Run 1');
    expect($('.slot-a').textContent).toContain('LAP 1:');
    $<HTMLButtonElement>('.slot-a [data-act="slot-alias-edit"]').click();
    const inp = $<HTMLInputElement>('.slot-alias-input');
    expect(inp.maxLength).toBe(6);
    session.say('別の更新');                                          // 入力中に再描画されても、文字は残る
    $<HTMLInputElement>('.slot-alias-input').value = '自分';
    session.say('もう一度');
    expect($<HTMLInputElement>('.slot-alias-input').value).toBe('自分');
    $<HTMLButtonElement>('.slot-a [data-act="slot-alias-ok"]').click();
    expect($('.slot-a').textContent).toContain('自分');
    expect($('.slot-a').textContent).toContain('Run 1');
    expect(session.cardName('A', 0)).toBe('自分');
    expect(session.cardName('B', 0)).toBe('B');
    expect(session.cardName('A', 1)).toBe('A');                       // 別のセットには影響しない
    $<HTMLButtonElement>('.slot-a [data-act="slot-alias-edit"]').click();
    $<HTMLInputElement>('.slot-alias-input').value = '  ';
    $<HTMLInputElement>('.slot-alias-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(session.slotAliasOf(0, 'A')).toBe('');
    expect(new Session(store).cardName('A', 0)).toBe('A');
  });
});
