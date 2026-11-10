// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LINE_DIGITS, distanceM, formatCln, formatSci, metersPerDegree, parseCln, parseSci, parseVbo, roundLine } from '../src/core';
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
  it('ファイルへの書き出しは 6 桁。アプリ内の登録(LINE_DIGITS)は 7 桁のまま残る', () => {
    const l = roundLine({ a: { lat: 33.03904567891, lon: 130.97347412345 }, b: { lat: 33.0384871, lon: 130.9730201 } });
    expect(formatCln([l]).split('\r\n')[1]).toBe('33.039046');
    expect(formatSci([l]).split('\r\n')[0]).toBe('33.039046,130.973474,33.038487,130.973020,1');
    expect(parseCln(formatCln([l], LINE_DIGITS))).toEqual([l]);
    expect(parseSci(formatSci([l], 1, LINE_DIGITS)).map((x) => x.line)).toEqual([l]);
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
    expect($('#ce-hint').textContent).toContain('直したら「確定」を押してください');   // 確定ボタンの位置は画面の幅で変わるので、場所は言わない
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

  it('引いたラインは、アプリ内の桁(7 桁)に丸められる', () => {
    openNew();
    click('#ce-draw-control');
    mapOf().drawLine({ lat: 33.03904567891, lon: 130.97347412345 }, B);
    expect(mapOf().lines[0].line.a).toEqual({ lat: 33.0390457, lon: 130.9734741 });
  });
});

describe('一覧の見出し・ラップ行のホバー', () => {
  it('一覧の上に太字の「登録済みライン」がある(コマンドのボタンとは別)', () => {
    openNew();
    const h = $('#ce-list-h');
    expect(h.querySelector('span')!.textContent).toBe('登録済みライン');
    expect(h.querySelector('#ce-sort')!.textContent).toBe('セクター整列');            // 見出しの右に「セクター整列」(案件 21)
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
  it('項目名は右揃えで太字(狭い画面では左揃え)', () => {
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toMatch(/\.circ-form \.frow>span:first-child\{text-align:right;font-weight:700[;}]/);
    expect(css).toMatch(/@media \(max-width:767px\)[\s\S]*\.circ-form \.frow>span:first-child\{text-align:left\}/);
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
    expect($('#ce-g2').closest('.ce-group')!.contains($('.corr-pad [data-act="ce-nudge"]'))).toBe(true);
    expect($('#ce-pad-map').closest('.corr-map-wrap')).not.toBeNull();             // スマホの幅で地図の右下に出す矢印(案件 1)。ラインを選ぶまでは隠す
    expect($('#ce-pad-map').hidden).toBe(true);
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

describe('セクター整列(案件 21)', () => {
  // オートポリスのセクター 7 本を、順番を崩して読み込む(ファイルの 1 行目 = 本来の S1)
  const sciLines = sci.trim().split(/\r?\n/);
  const shuffled = [sciLines[3], sciLines[0], sciLines[6], sciLines[1], sciLines[5], sciLines[2], sciLines[4]].join('\r\n') + '\r\n';
  const firstLat = (i: number) => Number(sciLines[i].split(',')[0]);
  const sortBtn = () => $<HTMLButtonElement>('#ce-sort');
  const secLats = () => mapOf().lines.filter((l) => l.kind === 'sector').map((l) => Number(l.line.a.lat.toFixed(6)));

  it('読み込み済みの走行ログが通った順に並べ替え、使ったログの名前を出す。選んでいたラインは選んだまま', async () => {
    session.addLog(utc(), 'u');
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    await pick('#ce-sci', 'autopolis.sci', shuffled);
    expect(secLats()).toEqual([3, 0, 6, 1, 5, 2, 4].map(firstLat));
    expect(sortBtn().disabled).toBe(false);
    click('[data-act="ce-select"][data-key="s0"]');                                    // 本来の S4 を選んでおく
    click('#ce-sort');
    expect(secLats()).toEqual([0, 1, 2, 3, 4, 5, 6].map(firstLat));
    expect(rows()).toEqual(['計測ライン', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    expect(mapOf().lines.find((l) => l.selected)!.label).toBe('S4');
    expect($('#ce-msg').textContent).toBe('セクターを通った順に並べ替えました(走行ログ: u.vbo)。');
    click('#ce-sort');
    expect($('#ce-msg').textContent).toBe('すでに通った順です(走行ログ: u.vbo)。');
  });

  it('走行ログが通らないセクターは最後に回し、知らせる', async () => {
    session.addLog(utc(), 'u');
    openNew();
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    await pick('#ce-sci', 'autopolis.sci', [sciLines[2], sciLines[0], sciLines[1]].join('\r\n') + '\r\n');
    click('#ce-draw-sector'); drawC({ lat: 33.01, lon: 130.97 }, { lat: 33.01, lon: 130.9703 });      // コースから離れた線
    click('[data-act="ce-move"][data-key="s3"][data-d="-1"]');
    click('[data-act="ce-move"][data-key="s2"][data-d="-1"]');                         // 通らない線を 2 番目に
    click('#ce-sort');
    expect(secLats()).toEqual([firstLat(0), firstLat(1), firstLat(2), 33.01]);
    expect($('#ce-msg').textContent).toBe('セクターを通った順に並べ替えました(走行ログ: u.vbo)。 S4 は走行ログが通らないため、最後にしました。');
  });

  it('押せないとき: 計測ラインが無い・セクターが 2 本未満・仮のラインがある・通る走行ログが無い。理由はボタンの説明に出す', async () => {
    openNew();
    expect(sortBtn().disabled).toBe(true);
    expect(sortBtn().title).toBe('計測ラインを引いてから使えます');
    await pick('#ce-cln', 'cl_autopolis.cln', cln);
    await pick('#ce-sci', 'autopolis.sci', sciLines[0] + '\r\n');
    expect(sortBtn().title).toBe('セクターが 2 本以上あるときに使えます');
    await pick('#ce-sci', 'autopolis.sci', shuffled);
    expect(sortBtn().disabled).toBe(true);
    expect(sortBtn().title).toContain('計測ラインを通る走行ログ');                       // ログを読み込んでいない
    session.addLog(utc(), 'u');
    click('#ce-draw-sector'); mapOf().drawLine({ lat: 33.01, lon: 130.97 }, { lat: 33.01, lon: 130.9703 });
    expect(sortBtn().disabled).toBe(true);
    expect(sortBtn().title).toBe('引いたラインを「確定」か「破棄」してから使えます');
    click('#ce-discard');
    expect(sortBtn().disabled).toBe(false);
    expect(sortBtn().title).toBe('セクターを、読み込み済みの走行ログが通った順に並べ替えます');
  });
});

describe('保存し忘れの確認(案件 23)', () => {
  const modal = () => document.querySelector<HTMLElement>('.modal');
  const modalBtn = (k: 'ok' | 'cancel') => document.querySelector<HTMLButtonElement>(`.modal [data-dialog="${k}"]`)!;
  const cancel = async () => { click('#ce-cancel'); await flush(); };

  it('何も変えていなければ、確認なしで閉じる。地図を動かしただけでも同じ', async () => {
    openNew();
    mapOf().view = { lat: 33.1, lon: 131.0, zoom: 12 };
    await cancel();
    expect(modal()).toBeNull();
    expect($('#work').hidden).toBe(true);
  });

  it('変えたまま「キャンセル」すると確かめる。「編集を続ける」と Esc は戻り、「破棄して閉じる」で閉じる', async () => {
    openNew();
    click('#ce-draw-control'); drawC(A, B);
    await cancel();
    expect(modal()).not.toBeNull();
    expect(modal()!.textContent).toContain('編集中の内容が保存されていません');
    expect(modalBtn('ok').textContent).toBe('破棄して閉じる');
    expect(modalBtn('cancel').textContent).toBe('編集を続ける');
    expect(document.activeElement).toBe(modalBtn('cancel'));                     // 初めは「編集を続ける」
    modalBtn('cancel').click(); await flush();
    expect(modal()).toBeNull();
    expect($('#work').hidden).toBe(false);
    expect(rows()).toEqual(['計測ライン']);                                       // 編集の内容はそのまま
    await cancel();
    modal()!.parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(modal()).toBeNull();
    expect($('#work').hidden).toBe(false);
    await cancel();
    modalBtn('ok').click(); await flush();
    expect($('#work').hidden).toBe(true);
    expect(session.circuits).toHaveLength(0);
  });

  it('名前だけ変えたとき・確定していない仮のラインがあるときも確かめる', async () => {
    openNew();
    $<HTMLInputElement>('#ce-name').value = '自作コース';
    await cancel();
    expect(modal()).not.toBeNull();
    modalBtn('cancel').click(); await flush();
    $<HTMLInputElement>('#ce-name').value = '';
    click('#ce-draw-control'); mapOf().drawLine(A, B);                          // 確定していない
    await cancel();
    expect(modal()).not.toBeNull();
    modalBtn('ok').click(); await flush();
    expect($('#work').hidden).toBe(true);
  });

  it('既存のサーキット: 開いたときのままなら確認なし。セクターの順番を変えただけでも確かめる', async () => {
    session.registerCircuit('オートポリス', cln, sci);
    click('#tab-list');
    click('[data-act="edit-circuit"]');
    await cancel();
    expect(modal()).toBeNull();
    expect($('#work').hidden).toBe(true);
    click('[data-act="edit-circuit"]');
    click('[data-act="ce-move"][data-key="s1"][data-d="-1"]');
    await cancel();
    expect(modal()).not.toBeNull();
    modalBtn('ok').click(); await flush();
    expect(session.circuits[0].sectors).toEqual(parseSci(sci).map((x) => roundLine(x.line)));      // 保存されていない
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
