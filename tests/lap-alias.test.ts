// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type TrackLog, metersPerDegree } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { LAP_ALIAS_MAX, Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 半径 300 m の円を 3 周する人工のログ(走行ログのファイルが無くても動く画面のテスト)
const C = { lat: 33, lon: 131 };
const R = 300;
const m = metersPerDegree(C.lat);
const at = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return { lat: C.lat + (r * Math.sin(a)) / m.lat, lon: C.lon + (r * Math.cos(a)) / m.lon };
};
const PERIOD = (2 * Math.PI * R) / (100 / 3.6);
const line = (deg: number) => { const a = at(deg, R - 10), b = at(deg, R + 10); return `1\r\n${a.lat}\r\n${a.lon}\r\n${b.lat}\r\n${b.lon}\r\n`; };
const sector = (deg: number) => { const a = at(deg, R - 10), b = at(deg, R + 10); return `${a.lat},${a.lon},${b.lat},${b.lon},1\r\n`; };

function sessionLog(): TrackLog {
  const end = 3.5 * PERIOD;
  const n = Math.round(end * 10) + 1;
  const log: TrackLog = {
    fileName: 'synthetic.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
    t: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float64Array(n),
  };
  let deg = 180;
  for (let i = 0; i < n; i++) {
    const p = at(deg);
    log.t[i] = i / 10; log.lat[i] = p.lat; log.lon[i] = p.lon; log.speed[i] = 100;
    deg += ((100 / 3.6) * 0.1 / R) * (180 / Math.PI);
  }
  return log;
}

let root: HTMLElement, store: MemoryStore, session: Session;
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
}
beforeEach(() => {
  store = new MemoryStore();
  mount();
  session.registerCircuit('円', line(0), sector(90));
  session.addLog(sessionLog(), 'syn');
});

const id = () => session.sets[0].logs[0].id;
const input = (lap: number) => root.querySelector<HTMLInputElement>(`.lap-alias[data-lap="${lap}"]`)!;
const editBtn = () => root.querySelector<HTMLButtonElement>('.file [data-act="lap-alias-edit"]');
const okBtn = () => root.querySelector<HTMLButtonElement>('.file [data-act="lap-alias-ok"]');
/** 「別名の変更」→ 入力 → 「確定」 */
const type = (lap: number, text: string) => {
  if (!input(lap)) editBtn()!.click();
  const el = input(lap);
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  okBtn()!.click();
};
const label = (lap: number) => Array.from(root.querySelectorAll('.file .row:not(.hd) .lap-cell'))
  .map((c) => c.textContent!.trim()).find((t) => t.startsWith(`${lap}`))!;

describe('ラップ一覧の「LAP」の欄(案件 68)', () => {
  it('見出しは「LAP」「タイム」で、並び順の ▲▼ は出さない。Delta の列は無く、タイムの欄の下に出す', () => {
    const hd = root.querySelector('.file .row.hd')!;
    expect(hd.textContent).toContain('LAP');
    expect(hd.textContent).not.toMatch(/[▲▼]/);
    expect(hd.textContent).not.toContain('Delta');
    const rows = Array.from(root.querySelectorAll('.file .row:not(.hd)')).filter((r) => r.querySelector('.tm'));   // 始点が無い行などは除く
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.querySelector('.tm .delta')!.textContent).toMatch(/^(ベスト|\+)/);
    }
    expect(rows.filter((r) => r.querySelector('.tm .delta')!.textContent === 'ベスト').length).toBeGreaterThan(0);
  });

  it('ふだんは入力欄が無く、見出しの「LAP」の横の「別名の変更」を押すと、各ラップに入力欄(上限は 6 文字)が出る', () => {
    expect(LAP_ALIAS_MAX).toBe(6);
    expect(input(1)).toBeNull();
    const btn = root.querySelector('.file .row.hd [data-act="lap-alias-edit"]')!;
    expect(btn.textContent).toBe('別名の変更');
    (btn as HTMLButtonElement).click();
    expect(input(1)).not.toBeNull();
    expect(input(1).maxLength).toBe(6);
    expect(input(2)).not.toBeNull();
    expect(okBtn()!.textContent).toBe('確定');                      // ボタンは「確定」になる
    expect(editBtn()).toBeNull();
  });

  it('確定すると入力欄は消え、「1. 別名」の表示になる(別名の無いラップは番号だけ)。ボタンは「別名の変更」に戻る', () => {
    type(1, '雨');
    expect(input(1)).toBeNull();
    expect(label(1)).toBe('1. 雨');
    expect(label(2)).toBe('2');
    expect(editBtn()!.textContent).toBe('別名の変更');
  });

  it('編集中は、入力した文字を確定するまで保存しない。Esc でやめると元に戻る', () => {
    editBtn()!.click();
    input(1).value = '途中';
    input(1).dispatchEvent(new Event('input', { bubbles: true }));
    expect(session.lapAliasOf(id(), 1)).toBe('');
    input(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input(1)).toBeNull();
    expect(label(1)).toBe('1');
    expect(session.lapAliasOf(id(), 1)).toBe('');
  });

  it('Enter でも確定する', () => {
    editBtn()!.click();
    input(2).value = 'ABC';
    input(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(session.lapAliasOf(id(), 2)).toBe('ABC');
    expect(label(2)).toBe('2. ABC');
  });

  it('入力して確定すると、そのラップの別名として保存され、再読み込みしても残る', () => {
    type(1, ' 雨のベスト ');
    expect(session.lapAliasOf(id(), 1)).toBe('雨のベスト');
    expect(label(1)).toBe('1. 雨のベスト');
    const again = new Session(store);
    expect(again.lapAliasOf(id(), 1)).toBe('雨のベスト');
    type(1, '');
    expect(session.lapAliasOf(id(), 1)).toBe('');
  });

  it('上限を超える分は切る', () => {
    type(1, '1234567890');
    expect(session.lapAliasOf(id(), 1)).toBe('123456');
  });

  it('LAP の別名は、そのラップを割り当てているカードの名前にもなる(別のラップのカードは変わらない)', () => {
    session.toggleAssignment('A', { logId: id(), lap: 1 }, 0);
    session.toggleAssignment('B', { logId: id(), lap: 2 }, 0);
    type(1, 'スタート');
    expect(session.slotAliasOf(0, 'A')).toBe('スタート');
    expect(session.slotAliasOf(0, 'B')).toBe('');
    type(1, '');
    expect(session.slotAliasOf(0, 'A')).toBe('');
  });

  it('カードの名前を付けると、割り当てているラップの別名にもなる', () => {
    session.toggleAssignment('A', { logId: id(), lap: 2 }, 0);
    session.setSlotAlias(0, 'A', '本番');
    expect(session.lapAliasOf(id(), 2)).toBe('本番');
    expect(label(2)).toBe('2. 本番');
    session.setSlotAlias(0, 'A', '');
    expect(session.lapAliasOf(id(), 2)).toBe('');
  });

  it('割り当てていないカードの名前は、ラップの別名にしない', () => {
    session.setSlotAlias(0, 'C', '名前だけ');
    expect(session.lapAliasOf(id(), 1)).toBe('');
    expect(session.lapAliasOf(id(), 2)).toBe('');
  });

  it('計測ライン(サーキット)が変わってラップ番号の意味が変わったら、そのファイルの別名を消す', () => {
    type(1, 'スタート');
    expect(session.lapAliasOf(id(), 1)).toBe('スタート');
    const circuit = session.circuits[0];
    session.setCircuitLines(circuit.id, { a: at(45, R - 10), b: at(45, R + 10) }, []);
    expect(session.lapAliasOf(id(), 1)).toBe('');
  });
});

describe('LAP の別名をカードに出す(案件 68)', () => {
  it('LAP に別名を付けたあとで割り当てたカードにも、その別名が出る。カード名を付ければ、そちらを優先する', () => {
    type(1, '雨');
    session.toggleAssignment('A', { logId: id(), lap: 1 }, 0);
    expect(session.slotAliasOf(0, 'A')).toBe('雨');
    expect(session.cardName('A', 0)).toBe('雨');
    expect(session.slotAliasOf(0, 'B')).toBe('');
    session.setSlotAlias(0, 'A', '本番');
    expect(session.slotAliasOf(0, 'A')).toBe('本番');
    expect(session.lapAliasOf(id(), 1)).toBe('本番');
  });
});

describe('走行ログ(Run)の別名(案件 68)', () => {
  const runEdit = () => root.querySelector<HTMLButtonElement>('.file .fh [data-act="run-alias-edit"]');
  const runOk = () => root.querySelector<HTMLButtonElement>('.file .fh [data-act="run-alias-ok"]');
  const runInput = () => root.querySelector<HTMLInputElement>('.file .fh .run-alias');
  const typeRun = (text: string) => {
    if (!runInput()) runEdit()!.click();
    runInput()!.value = text;
    runInput()!.dispatchEvent(new Event('input', { bubbles: true }));
    runOk()!.click();
  };

  it('見出しの「Run N」の横の「別名の変更」で入力欄が出て、「確定」で保存する。表示は「Run 1. 別名」', () => {
    expect(runInput()).toBeNull();
    expect(root.querySelector('.file .fh .fno')!.textContent).toBe('Run 1');
    runEdit()!.click();
    expect(runInput()!.maxLength).toBe(6);
    expect(runOk()!.textContent).toBe('確定');
    typeRun(' 午前の枠 ');
    expect(session.runAliasOf(id())).toBe('午前の枠');
    expect(runInput()).toBeNull();
    expect(root.querySelector('.file .fh .fno')!.textContent).toBe('Run 1. 午前の枠');
    expect(runEdit()!.textContent).toBe('別名の変更');
    expect(new Session(store).runAliasOf(id())).toBe('午前の枠');
  });

  it('Esc でやめると保存しない。空にすると別名なしに戻る。計測ラインが変わっても残す', () => {
    runEdit()!.click();
    runInput()!.value = '途中';
    runInput()!.dispatchEvent(new Event('input', { bubbles: true }));
    runInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(session.runAliasOf(id())).toBe('');
    typeRun('朝');
    session.setCircuitLines(session.circuits[0].id, { a: at(45, R - 10), b: at(45, R + 10) }, []);
    expect(session.runAliasOf(id())).toBe('朝');
    typeRun('');
    expect(session.runAliasOf(id())).toBe('');
    expect(session.runLabel({ id: id(), no: 1 })).toBe('Run 1');
  });

  it('カードには、別名があれば別名を、無ければ「Run N」を出す', () => {
    session.toggleAssignment('A', { logId: id(), lap: 1 }, 0);
    const card = () => root.querySelector('.slots .slot-a .st')!.textContent!.trim();
    expect(card()).toBe('Run 1');
    typeRun('朝');
    expect(card()).toBe('朝');
    session.setSlotAlias(0, 'A', '雨');
    expect(card()).toBe('雨 朝');                                  // 両方あれば、両方出す(スマホは 2 段。別名が無い Run n は、スマホでは CSS で隠す)
    expect(root.querySelector('.slots .slot-a .st .sub')!.classList.contains('ra')).toBe(true);
    typeRun('');
    expect(root.querySelector('.slots .slot-a .st .sub')!.classList.contains('rn')).toBe(true);
  });
});
