// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { metersPerDegree, parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap, headOf } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');

let root: HTMLElement, store: MemoryStore, session: Session, maps: FakeMap[], app: { dispose(): void } | null = null;
function mount() {
  app?.dispose();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  maps = [];
  session = new Session(store);
  app = mountApp(root, session, new ThemeController(store), () => { const m = new FakeMap(); maps.push(m); return m; });
}
beforeEach(() => {
  store = new MemoryStore();
  mount();
  session.registerCircuit('オートポリス', cln, sci);
  session.addLog(utc(), 'u');
});
afterEach(() => { vi.useRealTimers(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const openCorrect = () => $<HTMLButtonElement>('[data-act="correct"]').click();
const work = () => $('#work');
const east = () => $<HTMLInputElement>('#cor-east');
const north = () => $<HTMLInputElement>('#cor-north');
const key = (k: string, shiftKey = false, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
const mapOf = () => maps[maps.length - 1];
const dialog = () => document.querySelector<HTMLElement>('.modal');
const dialogBtn = (k: 'ok' | 'cancel') => document.querySelector<HTMLButtonElement>(`.modal [data-dialog="${k}"]`)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('セッション: 位置補正の保存と、書き出し・読み込み', () => {
  it('補正量は保存され、次に同じログを読み込むと自動で適用される', () => {
    session.setOffset('u', { east: 1.5, north: -2 });
    expect(session.logs[0].offset).toEqual({ east: 1.5, north: -2 });
    mount();
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    expect(session.logs[0].offset).toEqual({ east: 1.5, north: -2 });
  });

  it('(0, 0) に戻すと保存からも消える。補正でラップが検出し直され、割り当ては解除される', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    expect(session.assignment.A).not.toBeNull();
    session.setOffset('u', { east: 300, north: 300 });                  // 大きくずらすと、コントロールラインを通らない
    expect(session.logs[0].laps).toHaveLength(0);
    expect(session.assignment.A).toBeNull();                              // 同じラップが無いので解除して、知らせる
    expect(session.message).toBe('位置補正で A(LAP 1) のラップが無くなったため、割り当てを解除しました。');
    session.setOffset('u', { east: 0, north: 0 });
    expect(session.logs[0].laps.length).toBeGreaterThan(0);
    expect(JSON.parse(session.exportOffsets()).offsets).toEqual({});
  });

  it('同じファイルを入れたほかの比較セットの割り当ても、同じラップが見つかれば残る(案件 19)', () => {
    session.addLog(utc(), 'u', 1);
    session.toggleAssignment('A', { logId: 'u', lap: 1 }, 0);
    session.toggleAssignment('B', { logId: 'u', lap: 1 }, 1);
    expect(session.setOffset('u', { east: 1, north: 1 })).toEqual([]);
    expect(session.sets[0].assignment.A).toEqual({ logId: 'u', lap: 1 });
    expect(session.sets[1].assignment.B).toEqual({ logId: 'u', lap: 1 });
    expect(session.setOffset('u', { east: 300, north: 300 })).toEqual([{ set: 0, slot: 'A', lap: 1 }, { set: 1, slot: 'B', lap: 1 }]);
    expect(session.message).toBe('位置補正で 比較セット1 の A(LAP 1)、比較セット2 の B(LAP 1) のラップが無くなったため、割り当てを解除しました。');
  });

  it('書き出した JSON を読み込むと、補正量が戻る。まだ読み込んでいないログの分も保存される', () => {
    session.setOffset('u', { east: 0.8, north: 1.25 });
    const json = session.exportOffsets();
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({ kind: 'offsets', version: 1, offsets: { u: { east: 0.8, north: 1.25 } } });
    mount();
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    session.setOffset('u', { east: 0, north: 0 });
    const withOther = { ...parsed, offsets: { ...parsed.offsets, 'other:1': { east: 2, north: 3 } } };
    const r = session.importOffsets(JSON.stringify(withOther));
    expect(r.ok).toBe(true);
    expect(session.logs[0].offset).toEqual({ east: 0.8, north: 1.25 });
    const stored = JSON.parse(session.exportOffsets()).offsets;
    expect(stored['other:1']).toEqual({ east: 2, north: 3 });
  });

  it('読み込めない内容・範囲外の値は無視する', () => {
    expect(session.importOffsets('これはJSONではありません').ok).toBe(false);
    expect(session.importOffsets('{"kind":"other","offsets":{}}').ok).toBe(false);
    const r = session.importOffsets('{"kind":"offsets","offsets":{"u":{"east":99999,"north":0},"v":{"east":"a","north":1}}}');
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
    expect(session.logs[0].offset).toEqual({ east: 0, north: 0 });
  });
});

describe('補正データの書き出し(案件 37)', () => {
  afterEach(() => { delete window.rllNative; });
  const native = (r: { ok: boolean; canceled?: boolean; error?: string }) => {
    const saveText = vi.fn(async () => r);
    window.rllNative = {
      storageGet: () => null, storageSet: () => {}, storageClear: () => {}, getPathForFile: () => '', readTextFile: async () => null, saveText,
    };
    return saveText;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('デスクトップ版では、.cln / .sci と同じ保存ダイアログ(saveText)で書き出す', async () => {
    session.setOffset('u', { east: 1, north: 2 });
    const saveText = native({ ok: true });
    $<HTMLButtonElement>('[data-act="export-offsets"]').click();
    await flush();
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText).toHaveBeenCalledWith('position-offsets.json', session.exportOffsets());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('保存に失敗したら、アプリのダイアログで知らせる(取り消しなら何も出さない)', async () => {
    native({ ok: false, canceled: true });
    $<HTMLButtonElement>('[data-act="export-offsets"]').click();
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    native({ ok: false, error: '書き込めません' });
    $<HTMLButtonElement>('[data-act="export-offsets"]').click();
    await flush();
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('保存できませんでした');
    expect(dlg.textContent).toContain('書き込めません');
  });
});

describe('データ管理画面から位置補正の画面へ', () => {
  it('各 Run に「位置補正」ボタン(補正済みなら「(済)」と補正量のヒント)。書き出し・読み込みのボタンもある', () => {
    const b = $<HTMLButtonElement>('[data-act="correct"]');
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe('位置補正');
    session.setOffset('u', { east: 1, north: 2 });
    const b2 = $<HTMLButtonElement>('[data-act="correct"]');
    expect(b2.textContent).toBe('位置補正(済)');
    expect(b2.title).toContain('東 1.00 m / 北 2.00 m');
    expect($('[data-act="export-offsets"]')).not.toBeNull();
    expect($('[data-act="import-offsets"]')).not.toBeNull();
  });

  it('押すと、4 つのカードの下に位置補正の画面が出る(データ管理の中)。その Run のライン・サーキットの線が地図に出る', () => {
    openCorrect();
    expect(work().hidden).toBe(false);
    expect($('#import-body').hidden).toBe(true);
    expect($('#view-import').hidden).toBe(false);
    const kids = Array.from($('#view-import').children).map((c) => c.id);
    expect(kids.slice(0, 3)).toEqual(['slots', 'guide', 'work']);                  // カードの下(はじめかたは、大きな画面の間は隠れる)
    expect($('#guide').hidden).toBe(true);
    expect($('#slots').hidden).toBe(false);
    expect($('#cor-title').textContent).toBe('Run 1 の位置補正');
    expect($('#cor-file').textContent).toBe('u.vbo');
    const m = mapOf();
    expect(m.tracks.length).toBeGreaterThan(0);                                     // 1 周分のログ(輪)なので、1 周分の完了ラップを描く
    expect(m.tracks[0].points.length).toBeGreaterThan(100);
    expect($('#cor-pick').hidden).toBe(false);                                      // 地図に出すラップの一覧(最初はベスト)
    expect($('#cor-pick-count').textContent).toBe('地図に出すラップ 1 / 1');
    expect($<HTMLInputElement>('[data-pick="1"]').checked).toBe(true);
    expect(m.lines.map((l) => l.label)).toContain('計測ライン');
    expect(m.fitted).toBeGreaterThan(0);
    expect($('.navtab[data-view="import"]').getAttribute('aria-current')).toBe('page');   // 「データ管理」にいると分かる
    expect(east().value).toBe('0');
    expect(north().value).toBe('0');
  });

  it('完了ラップが無いログは、参考値のラップにチェックを付けて描く', () => {
    session.addLog(headOf(utc(), 0.8), 'h');                                        // 1 周の途中までのログ(輪ではない)
    $<HTMLButtonElement>('[data-act="correct"][data-log="h"]').click();
    expect(mapOf().tracks.length).toBeGreaterThan(0);
    expect($('#cor-pick-list').textContent).toContain('参考値');
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('[data-pick]')).every((c) => c.checked)).toBe(true);
  });
  it('ラップが 1 つも無いログは、今までどおり走行中の区間を描く(一覧は出さない)', () => {
    session.setOffset('u', { east: 300, north: 300 });                              // 計測ラインを通らない
    openCorrect();
    expect($('#cor-pick').hidden).toBe(true);
    expect($('#cor-shown').textContent).toContain('ラップが無いため');
    expect(mapOf().tracks.length).toBeGreaterThan(0);
  });
  it('最初は「地図を動かす」(ドラッグで地図が動く)', () => {
    openCorrect();
    expect($('[data-act="cor-mode"][data-mode="map"]').getAttribute('aria-pressed')).toBe('true');
    expect(mapOf().editCb).toBeNull();
  });

  it('キャンセルで元のデータ管理の表示へ戻り、何も変わらない(補正量を動かしていれば、確かめてから)', async () => {
    openCorrect();
    key('ArrowUp');
    $<HTMLButtonElement>('#cor-cancel').click();
    expect(dialog()!.textContent).toContain('位置補正が保存されていません');
    expect(dialogBtn('ok').textContent).toBe('破棄して閉じる');
    dialogBtn('ok').click();
    await flush();
    expect(work().hidden).toBe(true);
    expect($('#import-body').hidden).toBe(false);
    expect(session.logs[0].offset).toEqual({ east: 0, north: 0 });
  });

  it('比較画面へ移ると大きな画面は閉じ、位置補正のキー操作は止まる', () => {
    openCorrect();
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect(work().hidden).toBe(true);
    key('ArrowUp');
    expect(north().value).toBe('0');
    expect(mapOf().editCb).toBeNull();
  });
});

describe('補正量を動かしたまま、ほかの画面へ移るとき(1.2.1)', () => {
  it('補正量を動かしていなければ、確かめずに閉じる(キャンセル・上部のタブ)', () => {
    openCorrect();
    key('ArrowUp'); key('ArrowDown');                                              // 動かしても、元に戻っていれば変更なし
    $<HTMLButtonElement>('#cor-cancel').click();
    expect(dialog()).toBeNull();
    expect(work().hidden).toBe(true);
    openCorrect();
    $<HTMLButtonElement>('[data-act="nav"][data-view="settings"]').click();
    expect(dialog()).toBeNull();
    expect($('#view-settings').hidden).toBe(false);
  });

  it('上部のタブ: 確かめる。「補正を続ける」なら位置補正の画面に残り、補正量もそのまま', async () => {
    openCorrect();
    key('ArrowUp');
    $<HTMLButtonElement>('[data-act="nav"][data-view="settings"]').click();
    expect(dialog()!.textContent).toContain('位置補正が保存されていません');
    expect(dialog()!.textContent).toContain('破棄して移動すると');
    expect(dialogBtn('ok').textContent).toBe('破棄して移動する');
    expect(dialogBtn('cancel').textContent).toBe('補正を続ける');
    expect(document.activeElement).toBe(dialogBtn('cancel'));
    dialogBtn('cancel').click();
    await flush();
    expect(dialog()).toBeNull();
    expect($('#view-import').hidden).toBe(false);
    expect($('#view-settings').hidden).toBe(true);
    expect(work().hidden).toBe(false);
    expect(north().value).toBe('0.5');
    key('ArrowUp');                                                                 // 矢印キーも効いたまま
    expect(north().value).toBe('1');
  });

  it('上部のタブ: 「破棄して移動する」なら移り、補正量は保存しない', async () => {
    openCorrect();
    key('ArrowUp');
    $<HTMLButtonElement>('[data-act="nav"][data-view="help"]').click();
    dialogBtn('ok').click();
    await flush();
    expect($('#view-help').hidden).toBe(false);
    expect(work().hidden).toBe(true);
    expect(session.logs[0].offset).toEqual({ east: 0, north: 0 });
    expect(store.get('offsets')).toBeFalsy();
  });

  it('カードの横の「比較画面へ」も確かめる', async () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    openCorrect();
    key('ArrowRight');
    $<HTMLButtonElement>('[data-act="goto-compare"]').click();
    expect(dialog()).not.toBeNull();
    dialogBtn('cancel').click();
    await flush();
    expect($('#view-compare').hidden).toBe(true);
    expect(work().hidden).toBe(false);
    $<HTMLButtonElement>('[data-act="goto-compare"]').click();
    dialogBtn('ok').click();
    await flush();
    expect($('#view-compare').hidden).toBe(false);
    expect(work().hidden).toBe(true);
    expect(session.logs[0].offset).toEqual({ east: 0, north: 0 });
  });

  it('キャンセル: 「補正を続ける」なら位置補正の画面に残る', async () => {
    openCorrect();
    key('ArrowLeft');
    $<HTMLButtonElement>('#cor-cancel').click();
    dialogBtn('cancel').click();
    await flush();
    expect(work().hidden).toBe(false);
    expect(east().value).toBe('-0.5');
  });
});

describe('ラインを動かす', () => {
  beforeEach(() => { openCorrect(); $<HTMLButtonElement>('[data-act="cor-mode"][data-mode="line"]').click(); });

  it('地図をドラッグすると、その分(メートル)ラインが動く。東・北が正', () => {
    const before = mapOf().tracks[0].points[10];
    const m = metersPerDegree(33.0);
    mapOf().dragTrack(1e-5, 2e-5);
    const n = Number(north().value), e = Number(east().value);
    expect(n).toBeCloseTo(1e-5 * m.lat, 1);
    expect(e).toBeCloseTo(2e-5 * m.lon, 1);
    const after = mapOf().tracks[0].points[10];
    expect(after[0] - before[0]).toBeCloseTo(n / m.lat, 6);
    expect(after[1] - before[1]).toBeCloseTo(e / m.lon, 6);
  });

  it('「地図を動かす」にすると、ドラッグはラインを動かさない(通常の地図の移動)。戻すとまたラインが動く', () => {
    $<HTMLButtonElement>('[data-act="cor-mode"][data-mode="map"]').click();
    expect(mapOf().editCb).toBeNull();
    $<HTMLButtonElement>('[data-act="cor-mode"][data-mode="line"]').click();
    expect(mapOf().editCb).not.toBeNull();
    expect($('[data-act="cor-mode"][data-mode="line"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('矢印キー: ↑ 北 / → 東 / ↓ 南 / ← 西 へ 0.5m(初期)。Shift で 10 倍', () => {
    key('ArrowUp'); expect(north().value).toBe('0.5');
    key('ArrowRight'); expect(east().value).toBe('0.5');
    key('ArrowDown'); key('ArrowDown'); expect(north().value).toBe('-0.5');
    key('ArrowLeft', true); expect(east().value).toBe('-4.5');
  });

  it('1回の移動量を 0.1 / 0.5 / 1 m から選べる。矢印のボタンでも動かせる', () => {
    $<HTMLButtonElement>('[data-act="cor-step"][data-step="0.1"]').click();
    key('ArrowUp'); key('ArrowUp'); key('ArrowUp');
    expect(north().value).toBe('0.3');
    $<HTMLButtonElement>('[data-act="cor-step"][data-step="1"]').click();
    $<HTMLButtonElement>('[data-act="nudge"][data-dir="E"]').click();
    expect(east().value).toBe('1');
    expect($('[data-act="cor-step"][data-step="1"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('数値を直接入力できる。数値欄の中の矢印キーは、欄自身の操作(ラインは動かない)', () => {
    east().value = '2.5';
    east().dispatchEvent(new Event('input', { bubbles: true }));
    expect(Number(mapOf().tracks[0].points[0][1])).toBeGreaterThan(0);
    key('ArrowUp', false, north());
    expect(north().value).toBe('0');
    east().value = '';
    east().dispatchEvent(new Event('input', { bubbles: true }));                 // 空欄の途中は無視
    expect(session.logs[0].offset.east).toBe(0);
  });

  it('「補正なしにする」「元に戻す」', () => {
    session.setOffset('u', { east: 1, north: 1 });
    openCorrect();
    expect(east().value).toBe('1');
    key('ArrowUp');
    expect(north().value).toBe('1.5');
    $<HTMLButtonElement>('#cor-revert').click();
    expect(north().value).toBe('1');
    $<HTMLButtonElement>('#cor-zero').click();
    expect(east().value).toBe('0');
    expect(north().value).toBe('0');
  });

  it('補正量のラップ数・ベストの見込みを(少し待ってから)表示する。補正で通らなくなれば、そう表示する', () => {
    vi.useFakeTimers();
    key('ArrowUp');
    expect($('#cor-laps').textContent).toBe('周回を確認中…');
    vi.advanceTimersByTime(300);
    expect($('#cor-laps').textContent).toBe('この補正量では 1 ラップ ・ ベスト 2:22.9');          // 1 周分のログ(輪)なので、1 周分の完了ラップ
    east().value = '1000'; east().dispatchEvent(new Event('input', { bubbles: true }));     // 東へ 1 km(欄に直接入力)
    north().value = '1000'; north().dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect($('#cor-laps').textContent).toBe('この補正量では、コントロールラインを通過しません。');
  });
});

describe('完了ラップが無いログの補正量の見込み', () => {
  it('割り当て中のラップが、その補正量で見つからなければ、適用する前に知らせる(案件 19)', () => {
    vi.useFakeTimers();
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    openCorrect();
    vi.advanceTimersByTime(300);
    expect($('#cor-laps').textContent).not.toContain('見つかりません');
    expect($('#cor-pick-list').textContent).toContain('A');                    // 割り当て中の印
    east().value = '300'; east().dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect($('#cor-laps').textContent).toContain('A(LAP 1) のラップが見つかりません。適用すると、その割り当てを解除します。');
  });

  it('参考値の件数を表示する', () => {
    session.addLog(headOf(utc(), 0.8), 'h');                                        // 1 周の途中までのログ(輪ではない)
    vi.useFakeTimers();
    $<HTMLButtonElement>('[data-act="correct"][data-log="h"]').click();
    key('ArrowUp');
    vi.advanceTimersByTime(300);
    expect($('#cor-laps').textContent).toContain('完了したラップはありません(参考値 1 件)');
  });
});

describe('適用して保存', () => {
  it('補正量を保存してデータ管理画面へ戻る。補正済みの表示になる。同じラップが見つかれば、割り当ては残る', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    openCorrect();
    expect($('#cor-note').textContent).toContain('割り当てはそのまま残ります');
    key('ArrowUp'); key('ArrowRight', true);
    $<HTMLButtonElement>('#cor-apply').click();
    expect(session.logs[0].offset).toEqual({ east: 5, north: 0.5 });
    expect(work().hidden).toBe(true);
    expect($<HTMLButtonElement>('[data-act="correct"]').textContent).toBe('位置補正(済)');
    expect(session.assignment.A).toEqual({ logId: 'u', lap: 1 });
    expect(JSON.parse(store.get('offsets')!)).toEqual({ u: { east: 5, north: 0.5 } });
  });

  it('比較画面の地図にも補正が反映される(ラインの位置がずれる)', () => {
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    const p0 = maps[0].tracks[0].points[0];
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    openCorrect();
    for (let i = 0; i < 4; i++) key('ArrowUp', true);                               // 北へ 20 m
    $<HTMLButtonElement>('#cor-apply').click();
    expect(session.assignment.A).toEqual({ logId: 'u', lap: 1 });                   // 割り当ては残る(案件 19)
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    const p1 = maps[0].tracks[0].points[0];
    expect(p1[0] - p0[0]).toBeGreaterThan(0.00001);
  });
});

const bigPath = fx('session_20260506_094550_autopolis.vbo');
describe.skipIf(!existsSync(bigPath))('長いログ(13 ラップ)', () => {
  it('補正量の見込みにラップ数・ベストが出る。最初は地図にベスト 3 ラップを描き、一覧のチェックで選び直せる', () => {
    vi.useFakeTimers();
    session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
    const row = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-act="correct"]'))[1];
    row.click();
    vi.advanceTimersByTime(300);
    expect($('#cor-laps').textContent).toMatch(/^この補正量では 1\d ラップ ・ ベスト \d:\d\d\.\d$/);
    expect(mapOf().tracks).toHaveLength(3);
    const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('[data-pick]'));
    expect(boxes.length).toBeGreaterThan(10);
    expect(boxes.filter((c) => c.checked)).toHaveLength(3);
    $<HTMLButtonElement>('[data-act="cor-pick-all"]').click();
    expect(mapOf().tracks).toHaveLength(boxes.length);
    expect(mapOf().tracks.reduce((s, t) => s + t.points.length, 0)).toBeLessThanOrEqual(20000 + boxes.length);   // 点が多いときは間引く
    $<HTMLButtonElement>('[data-act="cor-pick-none"]').click();
    expect(mapOf().tracks).toHaveLength(0);
    const one = boxes[0];
    one.checked = true; one.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mapOf().tracks).toHaveLength(1);
    expect($('#cor-pick-count').textContent).toBe(`地図に出すラップ 1 / ${boxes.length}`);
  });
});
