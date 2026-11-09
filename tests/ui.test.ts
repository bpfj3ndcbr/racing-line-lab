// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { FakeMap, headOf } from './helpers';
import { ThemeController } from '../src/ui/theme';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), '20260913140139_UTC.vbo');
const bigPath = fx('session_20260506_094550_autopolis.vbo');

let root: HTMLElement, session: Session, theme: ThemeController, fakeMap: FakeMap;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const store = new MemoryStore();
  session = new Session(store);
  theme = new ThemeController(store);
  fakeMap = new FakeMap();
  mountApp(root, session, theme, () => fakeMap);
});

const rows = () => Array.from(root.querySelectorAll('.file .row:not(.hd):not(.head)'));      // ラップの行(「始点が無いので非表示」の行は除く)
const slotsText = () => root.querySelector('#slots')!.textContent!.replace(/\s+/g, ' ');
const btn = (lap: number, slot: string) =>
  root.querySelector<HTMLButtonElement>(`[data-act="assign"][data-lap="${lap}"][data-slot="${slot}"]`)!;

describe('読み込み画面', () => {
  it('サーキット未登録でも .vbo は読み込めて「未判定」と出る', () => {
    session.addLog(utc(), 'u');
    expect(root.textContent).toContain('サーキット未判定');
    expect(rows()).toHaveLength(0);
  });

  it('サーキットを後から登録すると、自動判定でラップが出る', () => {
    session.addLog(utc(), 'u');
    expect(session.registerCircuit('オートポリス', cln, sci).ok).toBe(true);
    expect(root.textContent).toContain('オートポリス(自動判定)');
    expect(root.textContent).toContain('Run 1');
    expect(root.textContent).toContain('2:22.9');                                // 1 周分のログ(輪)なので、1 周分の完了ラップ
    expect(root.textContent).not.toContain('終端未通過のため参考値');
    expect(rows()).toHaveLength(1);
    const note = rows()[0].querySelector<HTMLElement>('.sub')!;                    // 計測線付近を調整したことが分かる
    expect(note.textContent).toBe('計測線付近の修正あり');
    expect(note.title).toContain('ファイルの計測線とアプリの計測線が異なるため');
  });

  it('完了ラップが取れないログは、終端未通過の参考値として出る', () => {
    session.addLog(headOf(utc(), 0.8), 'h');                                     // 1 周の途中までのログ(輪ではない)
    session.registerCircuit('オートポリス', cln, sci);
    expect(root.textContent).toContain('終端未通過のため参考値');
    expect(root.textContent).not.toContain('計測線付近の修正あり');
  });

  it('A〜D ボタン: 割り当て → 上部に表示 → 再度押すと解除', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    btn(1, 'A').click();
    expect(slotsText()).toContain('Run 1');
    expect(slotsText()).toContain('2:22.9');
    expect(slotsText()).toContain('2026/09/13');
    btn(1, 'A').click();
    expect(slotsText()).not.toContain('Run 1');
    expect(slotsText()).toContain('未割り当て');
  });

  it('サーキットを手動で切り替えると、割り当ては解除される', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    btn(1, 'A').click();
    session.setCircuit(null);          // 自動判定のまま → 変わらない
    expect(session.assignment.A).not.toBeNull();
    session.registerCircuit('別名', cln, sci);
    session.setCircuit(session.circuits[1].id);
    expect(session.assignment.A).toBeNull();
  });

  it('セクタータイム列の表示切り替え', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    expect(root.querySelector('.row.hd')!.textContent).not.toContain('S7');
    root.querySelector<HTMLButtonElement>('[data-act="sectors"]')!.click();
    expect(root.querySelector('.row.hd')!.textContent).toContain('S7');
  });

  it('ファイルの削除で割り当ても消える', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    btn(1, 'B').click();
    root.querySelector<HTMLButtonElement>('[data-act="remove"]')!.click();
    expect(session.assignment.B).toBeNull();
    expect(root.textContent).toContain('ここに .vbo ファイルをドラッグ&ドロップ');
  });

  it.skipIf(!existsSync(bigPath))('ソート: ラップ順 / タイム順(昇順・降順)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
    const lapNums = () => rows().map((r) => r.firstElementChild!.textContent!.trim());
    expect(lapNums()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    expect(root.querySelector('.file .row.head')!.textContent).toContain('始点が無いので非表示');   // アウトラップ(最初の通過より前)
    root.querySelector<HTMLButtonElement>('[data-act="sort"][data-key="time"]')!.click();
    expect(lapNums().slice(0, 2)).toEqual(['2', '7']);             // 2:26.5, 2:27.2
    root.querySelector<HTMLButtonElement>('[data-act="sort"][data-key="time"]')!.click();
    expect(lapNums().slice(0, 2)).toEqual(['5', '6']);             // 長い順
    root.querySelector<HTMLButtonElement>('[data-act="sort"][data-key="lap"]')!.click();
    expect(lapNums()[0]).toBe('1');
  });

  it.skipIf(!existsSync(bigPath))('2ファイルで A/B を別ファイルに割り当てられる', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
    session.addLog(utc(), 'u');
    // 操作のたびに画面が再描画されるので、要素はその都度取り直す
    (root.querySelectorAll('.file')[0].querySelector('[data-slot="A"][data-lap="2"]') as HTMLButtonElement).click();
    (root.querySelectorAll('.file')[1].querySelector('[data-slot="B"][data-lap="1"]') as HTMLButtonElement).click();
    expect(slotsText()).toContain('Run 1');
    expect(slotsText()).toContain('Run 2');
  });
});

describe('レイアウトとセクター表示', () => {
  it('「サーキット」「比較セット」のグループ見出しがあり、登録項目は前者に入る', () => {
    const h = Array.from(root.querySelectorAll('h2')).map((e) => e.textContent);
    expect(h).toEqual(['サーキット', '走行ライン補正データ管理', '比較セット', '比較セット1', '比較セット2', '比較セット3', '比較セット4', '比較セット5']);
    const group = root.querySelector('#sets-group')!;                                   // 比較セット1〜5は 1 つの枠にまとめる(案件 27)
    expect(Array.from(group.querySelectorAll('.set-sec')).map((e) => e.id)).toEqual(['sec-set-0', 'sec-set-1', 'sec-set-2', 'sec-set-3', 'sec-set-4']);
    const circuitSec = root.querySelector('#sec-circuit')!;
    expect(circuitSec.textContent).toContain('ファイルによる登録');
    expect(circuitSec.textContent).toContain('地図による登録');
    expect(circuitSec.textContent).toContain('登録済みサーキット');
    const logSec = root.querySelector('#sec-set-0')!;
    expect(logSec.textContent).toContain('走行ログを追加');
    expect(logSec.textContent).toContain('セクタータイムを表示');
  });

  it('比較セットの見出しの要約: サーキット名と A〜D の割り当て(案件 27)', () => {
    const sum = (i: number) => root.querySelector(`#sec-set-${i} .set-sum`)!;
    expect(sum(0).textContent).toBe('—');
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    expect(sum(0).textContent).toBe('オートポリス割り当てなし');
    session.toggleAssignment('B', { logId: 'u', lap: 1 });
    expect(sum(0).textContent).toBe('オートポリスB割り当て 1');
    expect(sum(0).querySelector('.sum-slots i')!.className).toBe('sb');
    expect(sum(1).textContent).toBe('—');
  });

  it('ラップ一覧は横スクロール領域に入っている', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    expect(root.querySelector('.file .scroll[tabindex="0"] .tbl')).not.toBeNull();
  });

  it('ラップ一覧の行は、パソコンの列(--cols)と、狭い幅の列(--cols-m: ラップ・タイム・割り当てを先に)を持つ(案件 1)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    const row = root.querySelector<HTMLElement>('.file .row:not(.hd)')!;
    expect(row.style.getPropertyValue('--cols')).toBe('90px 110px 110px minmax(160px,1fr) 200px');
    expect(row.style.getPropertyValue('--cols-m')).toBe('66px 72px 168px 90px minmax(140px,1fr)');
    expect(row.lastElementChild!.classList.contains('pk')).toBe(true);           // DOM の並びは変えない(並べ替えは CSS の order)
  });

  it.skipIf(!existsSync(bigPath))('各セクターの最速セルだけが紫になる(区間タイム/通過時刻の両方)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
    root.querySelector<HTMLButtonElement>('[data-act="sectors"]')!.click();
    const toSec = (t: string) => { const [m, s] = t.split(':'); return Number(m) * 60 + Number(s); };
    for (const mode of ['split', 'cumulative']) {
      root.querySelector<HTMLButtonElement>(`[data-act="sector-mode"][data-mode="${mode}"]`)!.click();
      const ordinary = rows().filter((r) => !r.classList.contains('ex'));
      for (let k = 0; k < 7; k++) {
        const cell = (r: Element) => r.children[3 + k] as HTMLElement;
        const min = Math.min(...ordinary.map((r) => toSec(cell(r).textContent!)));
        const marked = ordinary.filter((r) => cell(r).classList.contains('bsec'));
        expect(marked.length).toBeGreaterThan(0);
        marked.forEach((r) => expect(toSec(cell(r).textContent!)).toBeCloseTo(min, 1));
        rows().filter((r) => r.classList.contains('ex'))
          .forEach((r) => expect(cell(r).classList.contains('bsec')).toBe(false));
      }
    }
  });
});

describe('枠・開閉・タブ・テーマ', () => {
  it('サーキットと比較セット1は枠(details)で、開閉の案内がある。サーキットは閉じて、比較セット1は開いて始まる', () => {
    for (const id of ['#sec-circuit', '#sec-set-0']) {
      const sec = root.querySelector<HTMLDetailsElement>(id)!;
      expect(sec.tagName).toBe('DETAILS');
      expect(sec.open).toBe(id === '#sec-set-0');
      expect(sec.querySelector('summary')!.textContent).toContain('クリックで閉じる');
      expect(sec.querySelector('summary')!.textContent).toContain('クリックで開く');
    }
  });

  it('サーキットは3つのタブ: 先頭は「登録済みサーキット」で、初期はこれが選ばれている(案件 25)', () => {
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('#sec-circuit [role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['登録済みサーキット', 'ファイルによる登録', '地図による登録']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(root.querySelector<HTMLElement>('#panel-list')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('#panel-reg')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('#panel-map')!.hidden).toBe(true);
    expect(root.querySelector('#circuit-list')!.textContent).toContain('登録済みのサーキットはありません');   // 無くても一覧のタブ。登録のタブへの案内が出る
    expect(root.querySelector('#circuit-badge')!.textContent).toBe('未登録');
  });

  it('サーキットのタブのキー操作は、新しい並びの順(→ / ← / Home / End)', () => {
    const key = (k: string) => root.querySelector<HTMLElement>('#sec-circuit [role="tab"][aria-selected="true"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const selected = () => root.querySelector<HTMLElement>('#sec-circuit [role="tab"][aria-selected="true"]')!.textContent;
    key('ArrowRight'); expect(selected()).toBe('ファイルによる登録');
    key('ArrowRight'); expect(selected()).toBe('地図による登録');
    key('ArrowRight'); expect(selected()).toBe('登録済みサーキット');
    key('ArrowLeft'); expect(selected()).toBe('地図による登録');
    key('Home'); expect(selected()).toBe('登録済みサーキット');
    key('End'); expect(selected()).toBe('地図による登録');
  });

  it('件数バッジと、上部のサーキット名', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    expect(root.querySelector('#sec-set-0 .set-badge')!.textContent).toBe('1 本');
    expect(root.querySelector('#sec-set-1 .set-badge')!.textContent).toBe('0 本');
    expect(root.querySelector('#circuit-badge')!.textContent).toBe('登録 1 件');
    expect(root.querySelector('.cur')!.textContent).toContain('オートポリス');
  });

  it('テーマ切り替え: html の data-theme が変わり、保存される', () => {
    const initial = theme.get();
    const other = initial === 'dark' ? 'light' : 'dark';
    root.querySelector<HTMLButtonElement>(`[data-act="theme"][data-theme="${other}"]`)!.click();
    expect(document.documentElement.dataset.theme).toBe(other);
    expect(root.querySelector(`[data-theme="${other}"]`)!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector(`[data-theme="${initial}"]`)!.getAttribute('aria-pressed')).toBe('false');
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const dlg = () => document.querySelector('.modal');
const dlgBtn = (kind: 'ok' | 'cancel') => document.querySelector<HTMLButtonElement>(`.modal [data-dialog="${kind}"]`)!;
const tabBtn = (t: 'reg' | 'map' | 'list') => root.querySelector<HTMLButtonElement>(`#tab-${t}`)!;

describe('登録済みサーキットのタブ', () => {
  beforeEach(() => {
    session.registerCircuit('オートポリス', cln, sci);
    session.registerCircuit('鈴鹿', cln, sci);
    tabBtn('list').click();
  });

  it('タブを切り替えると一覧が見え、各ボタンが並ぶ', () => {
    expect(tabBtn('list').getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('#panel-list')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('#panel-reg')!.hidden).toBe(true);
    const items = root.querySelectorAll('#circuit-list .citem');
    expect(items).toHaveLength(2);
    const labels = Array.from(items[0].querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['編集(地図)…', '名前を変更', 'コントロールラインの再読み込み', 'セクターの再読み込み', '削除']);
    expect(items[0].textContent).toContain('セクター 7 本');
  });

  it('←→ キーでタブを切り替えられる', () => {
    tabBtn('list').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabBtn('map').getAttribute('aria-selected')).toBe('true');
    tabBtn('map').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabBtn('reg').getAttribute('aria-selected')).toBe('true');
  });

  it('削除', () => {
    root.querySelector<HTMLButtonElement>('[data-act="del-circuit"]')!.click();
    expect(session.circuits.map((c) => c.name)).toEqual(['鈴鹿']);
  });

  it('名前の変更: 入力 → 変更 → 一覧に反映', async () => {
    root.querySelector<HTMLButtonElement>('[data-act="rename-circuit"]')!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('.modal input')!;
    expect(input.value).toBe('オートポリス');
    input.value = 'AUTOPOLIS';
    input.dispatchEvent(new Event('input'));
    dlgBtn('ok').click();
    await flush();
    expect(dlg()).toBeNull();
    expect(session.circuits[0].name).toBe('AUTOPOLIS');
    expect(root.querySelector('#circuit-list')!.textContent).toContain('AUTOPOLIS');
  });

  it('名前の変更で既存の名前にすると「既に名前が存在します」→ OK で入力に戻る', async () => {
    root.querySelector<HTMLButtonElement>('[data-act="rename-circuit"]')!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('.modal input')!;
    input.value = '鈴鹿';
    input.dispatchEvent(new Event('input'));
    dlgBtn('ok').click();
    await flush();
    expect(dlg()!.textContent).toContain('既に名前が存在します');
    expect(document.querySelector('.modal input')).toBeNull();      // 今出ているのは警告だけ
    dlgBtn('ok').click();
    await flush();
    expect(document.querySelector<HTMLInputElement>('.modal input')!.value).toBe('鈴鹿'); // 入力ダイアログに戻る
    dlgBtn('cancel').click();
    await flush();
    expect(dlg()).toBeNull();
    expect(session.circuits.map((c) => c.name)).toEqual(['オートポリス', '鈴鹿']);
  });

  it('空の名前は OK を押せない / キャンセルで何も変わらない', async () => {
    root.querySelector<HTMLButtonElement>('[data-act="rename-circuit"]')!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('.modal input')!;
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    expect(dlgBtn('ok').disabled).toBe(true);
    dlgBtn('cancel').click();
    await flush();
    expect(session.circuits[0].name).toBe('オートポリス');
  });
});

describe('サーキットの登録: 同じ名前は二重登録しない', () => {
  it('同名(全角半角・大小文字・前後の空白の違いも同名)は登録されず、理由が duplicate', () => {
    expect(session.registerCircuit('Autopolis', cln, sci).ok).toBe(true);
    for (const n of ['Autopolis', ' autopolis ', 'ＡＵＴＯＰＯＬＩＳ']) {
      const r = session.registerCircuit(n, cln, sci);
      expect(r).toMatchObject({ ok: false, reason: 'duplicate', message: '既に名前が存在します' });
    }
    expect(session.circuits).toHaveLength(1);
  });
});

describe('コントロールライン / セクターの再読み込み', () => {
  it('セクターを読み直すとセクタータイムが変わるが、割り当ては残る(コントロールラインが同じなのでラップは同じ)', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    btn(1, 'A').click();
    const firstLine = sci.split(/\r?\n/).filter(Boolean)[1];            // S2 のみ(1本)
    const r = session.reloadSectors(session.circuits[0].id, firstLine);
    expect(r.ok).toBe(true);
    expect(session.logs[0].laps[0].sectorTimes).toHaveLength(1);
    expect(session.assignment.A).toEqual({ logId: 'u', lap: 1 });
  });

  it('不正なファイルは更新しない', () => {
    session.registerCircuit('オートポリス', cln, sci);
    const id = session.circuits[0].id;
    expect(session.reloadControl(id, 'abc').ok).toBe(false);
    expect(session.reloadSectors(id, 'abc').ok).toBe(false);
    expect(session.circuits[0].sectors).toHaveLength(7);
  });

  it('コントロールラインを別の場所に変えると、そのログはラップが出なくなる', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    const far = '1\r\n35.0\r\n139.0\r\n35.001\r\n139.001\r\n';
    expect(session.reloadControl(session.circuits[0].id, far).ok).toBe(true);
    expect(session.logs[0].laps).toHaveLength(0);
  });
});
