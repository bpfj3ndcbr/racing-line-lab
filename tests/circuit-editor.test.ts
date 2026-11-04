// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { distanceM, formatCln, formatSci, metersPerDegree, parseCln, parseSci, parseVbo, roundLine } from '../src/core';
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

describe('.cln / .sci の書き出し(読み込みと同じ形式)', () => {
  it('サンプルを読み込んで書き出すと、元のファイルと同じ内容になる(CRLF・小数 6 桁)', () => {
    expect(formatCln(parseCln(cln))).toBe(cln.replace(/\r?\n$/, '') + '\r\n');
    expect(formatSci(parseSci(sci).map((x) => x.line))).toBe(sci.replace(/\r?\n$/, '') + '\r\n');
    expect(formatCln(parseCln(cln))).toBe('1\r\n33.039045\r\n130.973474\r\n33.038487\r\n130.973020\r\n');
    expect(formatSci(parseSci(sci).map((x) => x.line)).split('\r\n')[0]).toBe('33.038866,130.973387,33.038506,130.973098,1');
  });

  it('書き出したものを読み込み直すと、同じラインになる。本数 0 の .sci は空', () => {
    const lines = parseSci(sci).map((x) => roundLine(x.line));
    expect(parseSci(formatSci(lines)).map((x) => x.line)).toEqual(lines);
    expect(parseCln(formatCln(lines.slice(0, 1)))).toEqual(lines.slice(0, 1));
    expect(formatSci([])).toBe('');
  });
});

let root: HTMLElement, store: MemoryStore, session: Session, maps: FakeMap[], downloads: { name: string; text: string }[];
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  maps = [];
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => { const m = new FakeMap(); maps.push(m); return m; });
}
beforeEach(() => {
  store = new MemoryStore();
  downloads = [];
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  const orig = Blob;
  vi.stubGlobal('Blob', class extends orig { constructor(parts: BlobPart[], o?: BlobPropertyBag) { super(parts, o); (this as unknown as { _t: string })._t = String(parts[0]); } });
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { downloads.push({ name: this.download, text: '' }); };
  mount();
});
afterEach(() => { vi.unstubAllGlobals(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const mapOf = () => maps[maps.length - 1];
const openNew = () => $<HTMLButtonElement>('[data-act="open-circuit-editor"]').click();
const click = (sel: string) => $<HTMLButtonElement>(sel).click();
const pick = async (id: string, name: string, text: string) => {
  const input = $<HTMLInputElement>(id);
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name, text: async () => text }] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const key = (k: string, shiftKey = false, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
/** 引いて、確定まで行う */
const drawC = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => { mapOf().drawLine(a, b); click('#ce-confirm'); };
/** 引いて確定し、そのラインを一覧から選ぶ(確定しただけでは選択されない) */
const drawS = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => { drawC(a, b); const bs = root.querySelectorAll<HTMLButtonElement>('[data-act="ce-select"]'); bs[bs.length - 1].click(); };
const okBtn = () => document.querySelector<HTMLButtonElement>('.modal [data-dialog="ok"]')!;
// オートポリス付近の座標で、東西 30m ほどのライン
const A = { lat: 33.0390, lon: 130.9730 };
const B = { lat: 33.0390, lon: 130.97333 };
const rows = () => Array.from(root.querySelectorAll('.ce-row')).map((r) => r.querySelector('.ce-name')!.textContent);

describe('ラインを引く → 直す → 確定', () => {
  it('「計測ラインを引く」を押すとヒントが出て、地図のドラッグが「仮のライン」になる(まだ一覧には入らない)', () => {
    openNew();
    expect($('#ce-hint').hidden).toBe(true);
    click('#ce-draw-control');
    expect($('#ce-hint').textContent).toContain('始点から終点までドラッグ');
    expect($('#ce-draw-control').getAttribute('aria-pressed')).toBe('true');
    expect(mapOf().drawCb).not.toBeNull();
    mapOf().drawLine(A, B);
    expect(mapOf().drawCb).toBeNull();                              // 1 本引いたら、引くモードは終わる
    expect(rows()).toEqual([]);                                     // 一覧にはまだ入らない
    expect($('#ce-lines').textContent).toBe('計測ライン: 未設定');
    expect($<HTMLElement>('#ce-draft').hidden).toBe(false);
    expect($('#ce-draft-text').textContent).toContain('未確定');
    expect($('#ce-hint').textContent).toContain('右の欄の「確定」');   // 確定ボタンは右の欄にある
    expect(mapOf().lines).toHaveLength(1);
    expect(mapOf().lines[0]).toMatchObject({ label: '計測ライン(仮)', kind: 'control', selected: true });
    expect(mapOf().handles.map((h) => h.id)).toEqual(['a', 'b', 'm']);
    expect($('#ce-len').textContent).toContain('計測ライン(未確定)');
  });

  it('「確定」で一覧に入り、選択は外れる(そのまま動かせない)。仮のラインの表示は消える', () => {
    openNew();
    click('#ce-draw-control'); mapOf().drawLine(A, B);
    click('#ce-confirm');
    expect($<HTMLElement>('#ce-draft').hidden).toBe(true);
    expect(rows()).toEqual(['計測ライン']);
    expect($('#ce-lines').textContent).toBe('計測ライン あり ・ セクター 0 本');
    expect(mapOf().lines).toHaveLength(1);
    expect(mapOf().lines[0]).toMatchObject({ label: '計測ライン', kind: 'control', selected: false });   // 確定したら選択は外れる
    expect(mapOf().handles).toHaveLength(0);                        // そのまま動かせない
    expect($<HTMLElement>('#ce-fine').hidden).toBe(true);
    expect($<HTMLButtonElement>('#ce-draw-control').disabled).toBe(true);     // 消すまで引き直せない
    expect($('#ce-hint').hidden).toBe(true);
  });

  it('確定の前につまみ・矢印キーで直せる。確定するのは直したあとの位置', () => {
    openNew();
    click('#ce-draw-sector'); mapOf().drawLine(A, B);
    mapOf().moveHandle('b', 33.0391, 130.9734, true);
    key('ArrowUp', true);
    const moved = mapOf().lines[0].line;
    click('#ce-confirm');
    expect(mapOf().lines[0].line).toEqual(moved);
    expect(rows()).toEqual(['S1']);
  });

  it('「破棄」で仮のラインを捨てる。一覧は変わらない', () => {
    openNew();
    click('#ce-draw-control'); drawC(A, B);
    click('#ce-draw-sector'); mapOf().drawLine({ lat: 33.04, lon: 130.97 }, { lat: 33.04, lon: 130.9703 });
    expect(mapOf().lines).toHaveLength(2);
    click('#ce-discard');
    expect($<HTMLElement>('#ce-draft').hidden).toBe(true);
    expect(rows()).toEqual(['計測ライン']);
    expect(mapOf().lines).toHaveLength(1);
    expect(mapOf().handles).toHaveLength(0);
  });

  it('仮のラインがあるあいだは、一覧の選択・並べ替え・削除はできない(確定か破棄が先)。保存もできない', async () => {
    openNew();
    click('#ce-draw-control'); drawC(A, B);
    click('#ce-draw-sector'); drawC({ lat: 33.04, lon: 130.97 }, { lat: 33.04, lon: 130.9703 });
    click('#ce-draw-sector'); mapOf().drawLine({ lat: 33.05, lon: 130.97 }, { lat: 33.05, lon: 130.9703 });
    for (const b of root.querySelectorAll<HTMLButtonElement>('#ce-list button')) expect(b.disabled).toBe(true);
    $<HTMLInputElement>('#ce-name').value = 'x';
    click('#ce-save'); await flush();
    expect($('#ce-msg').textContent).toContain('「確定」するか「破棄」');
    expect(session.circuits).toHaveLength(0);
    click('#ce-confirm');
    for (const b of root.querySelectorAll<HTMLButtonElement>('#ce-list button')) {
      if (b.dataset.act === 'ce-select' || b.dataset.act === 'ce-del') expect(b.disabled).toBe(false);
    }
    click('#ce-save'); await flush();
    expect(session.circuits).toHaveLength(1);
    expect(session.circuits[0].sectors).toHaveLength(2);
  });

  it('Enter でも確定できる(入力欄・ボタンにフォーカスがあるときは除く)', () => {
    openNew();
    click('#ce-draw-control'); mapOf().drawLine(A, B);
    key('Enter', false, $('#ce-name'));
    expect(rows()).toEqual([]);
    key('Enter');
    expect(rows()).toEqual(['計測ライン']);
  });

  it('引き直すと、前の仮のラインは捨てられる。引くのをやめても同じ', () => {
    openNew();
    click('#ce-draw-control'); mapOf().drawLine(A, B);
    click('#ce-draw-sector');
    expect($<HTMLElement>('#ce-draft').hidden).toBe(true);
    expect(mapOf().lines).toHaveLength(0);
    click('#ce-draw-sector');                                       // 押し直して、引くのをやめる
    expect(mapOf().drawCb).toBeNull();
  });

  it('セクターは「追加」して確定するたびに S1, S2, … とたまる', () => {
    openNew();
    click('#ce-draw-sector'); drawC(A, B);
    click('#ce-draw-sector'); drawC({ lat: 33.04, lon: 130.97 }, { lat: 33.04, lon: 130.9703 });
    expect(rows()).toEqual(['S1', 'S2']);
    expect(mapOf().lines.map((l) => [l.label, !!l.selected])).toEqual([['S1', false], ['S2', false]]);
  });

  it('計測ラインは、「×」で消すまで引き直せない(消すと、また引ける)', () => {
    openNew();
    click('#ce-draw-control'); drawC(A, B);
    expect($<HTMLButtonElement>('#ce-draw-control').disabled).toBe(true);
    click('#ce-draw-control');
    expect(mapOf().drawCb).toBeNull();
    click('#ce-list [data-act="ce-del"]');
    expect($<HTMLButtonElement>('#ce-draw-control').disabled).toBe(false);
    click('#ce-draw-control'); drawC({ lat: 33.05, lon: 130.97 }, { lat: 33.05, lon: 130.9703 });
    expect(rows()).toEqual(['計測ライン']);
    expect(mapOf().lines[0].line.a.lat).toBeCloseTo(33.05, 6);
  });

  it('引いたラインは 6 桁に丸められる(ファイルに書いたときと同じ値)', () => {
    openNew();
    click('#ce-draw-control');
    mapOf().drawLine({ lat: 33.03904567891, lon: 130.97347412345 }, B);
    expect(mapOf().lines[0].line.a).toEqual({ lat: 33.039046, lon: 130.973474 });
  });
});

describe('一覧の見出し・ラップ行のホバー', () => {
  it('一覧の上に太字の「登録済みライン」がある(コマンドのボタンとは別)', () => {
    openNew();
    const h = $('#ce-list-h');
    expect(h.textContent).toBe('登録済みライン');
    expect(h.compareDocumentPosition($('#ce-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\.ce-list-h\{font-weight:700/);
  });
  it('走行ログのラップ行にマウスを乗せると強調される', () => {
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\.row:not\(\.hd\):hover\{[^}]*box-shadow:inset 4px 0 0 var\(--accent\)/);
  });
});

describe('ファイルによる登録のフォーム', () => {
  it('項目名の列を固定幅にして入力欄の先頭をそろえる(label の flex に負けない)', () => {
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\.circ-form \.frow\{display:grid;grid-template-columns:220px/);
  });
});

describe('項目名の右揃え', () => {
  it('項目名は右揃え', () => {
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\.circ-form \.frow>span:first-child\{text-align:right\}/);
  });
});

describe('hidden 属性', () => {
  it('CSS で hidden が必ず優先される(未確定の枠が出っぱなしにならない)', () => {
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\[hidden\]\{display:none!important\}/);
  });
});

describe('確定後のフォーカス', () => {
  it('「確定」「破棄」を押したあと、ボタンのフォーカスは外れる', () => {
    openNew();
    click('#ce-draw-control'); mapOf().drawLine(A, B);
    $<HTMLButtonElement>('#ce-confirm').focus();
    click('#ce-confirm');
    expect(document.activeElement === document.body || !root.contains(document.activeElement)).toBe(true);
    click('#ce-draw-sector'); mapOf().drawLine(A, B);
    $<HTMLButtonElement>('#ce-discard').focus();
    click('#ce-discard');
    expect(root.contains(document.activeElement) && document.activeElement !== document.body).toBe(false);
  });
});

describe('画面の構成: 枠で囲んだ 3 つのグループ', () => {
  it('「ラインの追加・削除」「ライン移動」「ファイルの読み込み・書き出し」。見出しがあり、ファイル欄は常に開いている', () => {
    openNew();
    const groups = Array.from(root.querySelectorAll('#work-circuit-dummy, .work-circuit .ce-group'));
    expect(groups.map((g) => g.querySelector('h3')!.textContent)).toEqual(['ラインの追加・削除', 'ライン移動', 'ファイルの読み込み・書き出し']);
    expect($('.work-circuit').querySelector('details')).toBeNull();
    expect($('#ce-g1').closest('.ce-group')!.contains($('#ce-draw-control'))).toBe(true);
    expect($('#ce-g1').closest('.ce-group')!.contains($('#ce-list'))).toBe(true);
    expect($('#ce-g2').closest('.ce-group')!.contains($('[data-act="ce-nudge"]'))).toBe(true);
    expect($('#ce-g3').closest('.ce-group')!.contains($('#ce-cln'))).toBe(true);
    expect($('#ce-g3').closest('.ce-group')!.contains($('#ce-export-sci'))).toBe(true);
  });

  it('「ライン移動」は、動かす対象が無いときも枠ごと表示され、案内が出る', () => {
    openNew();
    expect($<HTMLElement>('#ce-fine-empty').hidden).toBe(false);
    expect($<HTMLElement>('#ce-fine').hidden).toBe(true);
    click('#ce-draw-control'); mapOf().drawLine(A, B);
    expect($<HTMLElement>('#ce-fine-empty').hidden).toBe(true);
    expect($<HTMLElement>('#ce-fine').hidden).toBe(false);
  });

  it('見出しは帯と左の線で装飾される', () => {
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toMatch(/\.ce-group>h3\{[^}]*border-left:4px solid var\(--accent\)/);
    expect(css).toMatch(/\.ce-group\{[^}]*border:1px solid var\(--border-strong\)/);
  });
});

describe('直す', () => {
  beforeEach(() => {
    openNew();
    click('#ce-draw-control'); drawS(A, B);
  });

  it('端点のつまみをドラッグすると、その端点だけが動く。ドラッグ中はつまみを作り直さない(離したときに更新)', () => {
    const before = mapOf().handles;
    mapOf().moveHandle('b', 33.0391, 130.9734, false);
    expect(mapOf().lines[0].line.b).toEqual({ lat: 33.0391, lon: 130.9734 });
    expect(mapOf().lines[0].line.a).toEqual(roundLine({ a: A, b: B }).a);
    expect(mapOf().handles).toBe(before);
    mapOf().moveHandle('b', 33.0391, 130.9734, true);
    expect(mapOf().handles).not.toBe(before);
    expect(mapOf().handles.find((h) => h.id === 'b')).toMatchObject({ lat: 33.0391, lon: 130.9734 });
    expect(mapOf().handles.find((h) => h.id === 'm')!.lat).toBeCloseTo((33.039 + 33.0391) / 2, 8);
  });

  it('線の中心のつまみで、線全体が平行に動く(長さは変わらない)', () => {
    const l0 = mapOf().lines[0].line;
    const len0 = distanceM(l0.a, l0.b);
    mapOf().moveHandle('m', 33.05, 130.98, true);
    const l1 = mapOf().lines[0].line;
    expect((l1.a.lat + l1.b.lat) / 2).toBeCloseTo(33.05, 8);
    expect(distanceM(l1.a, l1.b)).toBeCloseTo(len0, 1);     // 緯度が変わると距離の換算がわずかに変わる
  });

  it('矢印キーで微調整: 初期は線全体を 0.1m ずつ。↑ 北 / → 東。Shift で 10 倍', () => {
    const l0 = mapOf().lines[0].line;
    const m = metersPerDegree(l0.a.lat);
    key('ArrowUp');
    expect(mapOf().lines[0].line.a.lat - l0.a.lat).toBeCloseTo(0.1 / m.lat, 9);
    key('ArrowRight', true);
    expect(mapOf().lines[0].line.b.lon - l0.b.lon).toBeCloseTo(1 / m.lon, 9);
    expect(mapOf().lines[0].line.a.lon - l0.a.lon).toBeCloseTo(1 / m.lon, 9);
  });

  it('「始点」「終点」を選ぶと、その端点だけが動く。1回の移動量は 0.1 / 0.5 / 1 m。ボタンでも動かせる', () => {
    const l0 = mapOf().lines[0].line;
    click('[data-act="ce-part"][data-part="b"]');
    click('[data-act="ce-step"][data-step="1"]');
    const m = metersPerDegree(l0.a.lat);
    click('[data-act="ce-nudge"][data-dir="E"]');
    expect(mapOf().lines[0].line.b.lon - l0.b.lon).toBeCloseTo(1 / m.lon, 9);
    expect(mapOf().lines[0].line.a).toEqual(l0.a);
    expect($('[data-act="ce-part"][data-part="b"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('入力欄にいるときの矢印キーは、ラインを動かさない。何も選んでいないときも動かない', () => {
    const l0 = mapOf().lines[0].line;
    key('ArrowUp', false, $('#ce-name'));
    expect(mapOf().lines[0].line).toEqual(l0);
    click('[data-act="ce-del"][data-key="c"]');
    expect(mapOf().lines).toHaveLength(0);
    key('ArrowUp');
    expect(mapOf().lines).toHaveLength(0);
  });

  it('長さが出る。長すぎるときは注意が出る', () => {
    expect($('#ce-len').textContent).toMatch(/^計測ライン ・ 長さ 3[0-9]\.\d m$/);
    mapOf().moveHandle('b', 33.039, 130.98, true);
    expect($('#ce-len').textContent).toContain('長めです');
  });

  it('一覧のボタンでラインを選び直せる。選んでいるものは地図で目立つ。引くモード中は選択でやめる', () => {
    click('#ce-draw-sector'); drawS(A, B);
    expect(mapOf().lines.map((l) => !!l.selected)).toEqual([false, true]);
    click('[data-act="ce-select"][data-key="c"]');
    expect(mapOf().lines.map((l) => !!l.selected)).toEqual([true, false]);
    click('#ce-draw-sector');
    expect(mapOf().handles).toHaveLength(0);                       // 引いている間は、つまみは出ない
    click('[data-act="ce-select"][data-key="s0"]');
    expect(mapOf().drawCb).toBeNull();
    expect(mapOf().handles).toHaveLength(3);
  });
});

describe('セクターの並べ替えと削除', () => {
  beforeEach(() => {
    openNew();
    for (const lat of [33.01, 33.02, 33.03]) { click('#ce-draw-sector'); drawC({ lat, lon: 130.97 }, { lat, lon: 130.9703 }); }
  });
  const lats = () => mapOf().lines.map((l) => l.line.a.lat);

  it('↑ ↓ で順序を入れ替える(S 番号が付け替わる)。端のボタンは押せない', () => {
    expect($<HTMLButtonElement>('[data-act="ce-move"][data-key="s0"][data-d="-1"]').disabled).toBe(true);
    expect($<HTMLButtonElement>('[data-act="ce-move"][data-key="s2"][data-d="1"]').disabled).toBe(true);
    click('[data-act="ce-move"][data-key="s2"][data-d="-1"]');
    expect(lats()).toEqual([33.01, 33.03, 33.02]);
    expect(mapOf().lines.map((l) => !!l.selected)).toEqual([false, true, false]);     // 動かしたものを選んだまま
    click('[data-act="ce-move"][data-key="s1"][data-d="-1"]');
    expect(lats()).toEqual([33.03, 33.01, 33.02]);
  });

  it('削除すると詰められる', () => {
    click('[data-act="ce-del"][data-key="s1"]');
    expect(rows()).toEqual(['S1', 'S2']);
    expect(lats()).toEqual([33.01, 33.03]);
    expect($('#ce-lines').textContent).toBe('計測ライン: 未設定');
  });
});

describe('登録・保存', () => {
  it('引いたラインで新規登録できる(.cln / .sci ファイルは不要)。表示位置も保存される', async () => {
    openNew();
    click('#ce-draw-control'); drawC(A, B);
    click('#ce-draw-sector'); drawC({ lat: 33.04, lon: 130.97 }, { lat: 33.04, lon: 130.9703 });
    $<HTMLInputElement>('#ce-name').value = '自作コース';
    mapOf().view = { lat: 33.039, lon: 130.973, zoom: 18 };
    click('#ce-save');
    await flush();
    expect(session.circuits).toHaveLength(1);
    expect(session.circuits[0]).toMatchObject({ name: '自作コース', view: { zoom: 18 } });
    expect(session.circuits[0].control).toEqual(roundLine({ a: A, b: B }));
    expect(session.circuits[0].sectors).toHaveLength(1);
    expect($('#work').hidden).toBe(true);
  });

  it('計測ラインが無いと登録できない。名前が同じなら「既に名前が存在します」', async () => {
    openNew();
    $<HTMLInputElement>('#ce-name').value = 'x';
    click('#ce-save'); await flush();
    expect($('#ce-msg').textContent).toContain('計測ラインを引くか');
    session.registerCircuit('同名', cln, sci);
    click('#ce-draw-control'); drawC(A, B);
    $<HTMLInputElement>('#ce-name').value = '同名';
    click('#ce-save'); await flush();
    expect(document.querySelector('.modal')!.textContent).toContain('既に名前が存在します');
    okBtn().click(); await flush();
    expect(session.circuits).toHaveLength(1);
  });

  it('既存サーキットの編集でラインを直すと、そのサーキットの周回が検出し直される(割り当ては解除)', async () => {
    session.registerCircuit('オートポリス', cln, sci, { lat: 33.0, lon: 130.9, zoom: 16 });
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    expect(session.assignment.A).not.toBeNull();
    click('#tab-list');
    click('[data-act="edit-circuit"]');
    expect(rows()).toHaveLength(8);
    click('[data-act="ce-del"][data-key="s6"]');                    // S7 を削除
    click('[data-act="ce-select"][data-key="c"]');
    mapOf().moveHandle('m', 33.0, 130.9, true);                      // 計測ラインを遠くへ → どのログも通らない
    click('#ce-save'); await flush();
    expect(session.circuits[0].sectors).toHaveLength(6);
    expect(session.logs[0].laps.length === 0 || !session.logs[0].laps[0].complete).toBe(true);
    expect(session.assignment.A).toBeNull();
    expect(session.circuits[0].view).toBeDefined();
  });

  it('ラインを変えずに保存したときは、割り当てを解除しない', async () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    click('#tab-list');
    click('[data-act="edit-circuit"]');
    click('#ce-save'); await flush();
    expect(session.assignment.A).not.toBeNull();
  });
});

describe('読み込み・書き出し', () => {
  it('.cln / .sci を読み込むと、ラインとして並ぶ(引いたものを置き換え)。そのあと直せる', async () => {
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    await pick('#ce-sci', 'autopolis.sci', sci);
    expect($<HTMLInputElement>('#ce-name').value).toBe('autopolis');
    expect(rows()).toEqual(['計測ライン', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    expect($('[data-act="ce-select"][data-key="c"]').getAttribute('aria-pressed')).toBe('true');
    expect(mapOf().fitted).toBeGreaterThan(0);
  });

  it('書き出しは、ラインが無いと押せない。押すと cl_名前.cln / 名前.sci のファイルになる', async () => {
    openNew();
    expect($<HTMLButtonElement>('#ce-export-cln').disabled).toBe(true);
    expect($<HTMLButtonElement>('#ce-export-sci').disabled).toBe(true);
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    expect($<HTMLButtonElement>('#ce-export-cln').disabled).toBe(false);
    expect($<HTMLButtonElement>('#ce-export-sci').disabled).toBe(true);
    await pick('#ce-sci', 'autopolis.sci', sci);
    $<HTMLInputElement>('#ce-name').value = 'オートポリス';
    click('#ce-export-cln');
    click('#ce-export-sci');
    expect(downloads.map((d) => d.name)).toEqual(['cl_オートポリス.cln', 'オートポリス.sci']);
  });
});

describe('テーマの切り替えボタン', () => {
  it('小さいボタン(高さ 22px)', () => {
    expect(readFileSync('src/style.css', 'utf8')).toMatch(/\.seg\.tiny button\{min-height:22px;height:22px;/);
    expect(readFileSync('src/ui/app.ts', 'utf8')).toContain('class="seg tiny" role="group" aria-label="テーマ"');
  });

  it('セクターを追加・削除しただけなら、割り当てを解除しない(ラップは同じ)', async () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    click('#tab-list');
    click('[data-act="edit-circuit"]');
    click('[data-act="ce-del"][data-key="s6"]');
    click('#ce-save'); await flush();
    expect(session.circuits[0].sectors).toHaveLength(6);
    expect(session.assignment.A).toEqual({ logId: 'u', lap: 1 });
  });

  it('計測ラインがまだ無いうちは「計測ラインを引く」が青(次にやること)。引いたら青ではなくなる', () => {
    openNew();
    expect($('#ce-draw-control').classList.contains('pri')).toBe(true);
    click('#ce-draw-control'); drawC(A, B);
    expect($('#ce-draw-control').classList.contains('pri')).toBe(false);
  });
});
