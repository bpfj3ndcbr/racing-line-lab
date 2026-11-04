// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type TrackLog, metersPerDegree } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { endFromStep, endSteps, stepFromEnd } from '../src/ui/importView';
import { FakeMap } from './helpers';

// 半径 300 m の円を反時計回りに走る人工のログ(走行ログのファイルが無くても動く画面のテスト)
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

/**
 * 180° から出て(最初の通過までに半周 = 始点無しの区間)、LAP 1 は普通に、LAP 2 は途中で 2 分止まり(ベストの 160% 超)、
 * LAP 3 を走って、最後の通過から 40 秒走ったところで止まる(終点無しのラップ)
 */
function sessionLog(): TrackLog {
  const half = PERIOD / 2;
  const stop2 = half + PERIOD + PERIOD / 2;                                 // LAP 2 の半ばで止まる
  const end = half + 3 * PERIOD + 120 + 40;
  const v = (t: number) => (t >= stop2 && t < stop2 + 120 ? 0 : t >= end ? 0 : 100);
  const n = Math.round((end + 60) * 10) + 1;
  const log: TrackLog = {
    fileName: 'synthetic.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
    t: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float64Array(n),
  };
  let deg = 180;
  for (let i = 0; i < n; i++) {
    const t = i / 10, s = v(t), p = at(deg);
    log.t[i] = t; log.lat[i] = p.lat; log.lon[i] = p.lon; log.speed[i] = s;
    deg += ((s / 3.6) * 0.1 / R) * (180 / Math.PI);
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

const rowOf = (lap: number | '—') => Array.from(root.querySelectorAll<HTMLElement>('.file .row:not(.hd)'))
  .find((r) => r.querySelector('.num')?.textContent === String(lap))!;
const lapOf = (pred: (l: { number: number }) => boolean) => session.sets[0].logs[0].laps.find(pred);
const check = (lap: number) => root.querySelector<HTMLInputElement>(`input[data-act="lap-end"][data-lap="${lap}"]`);
const range = (lap: number) => root.querySelector<HTMLInputElement>(`.lap-end-range[data-lap="${lap}"]`);
const slide = (lap: number, sec: number) => {
  const r = range(lap)!;
  r.value = String(stepFromEnd(sec, Number(r.dataset.max)));
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('ラップ一覧の端の区間', () => {
  it('最初の通過より前の走行は「始点が無いので非表示」の行(割り当てはできない)', () => {
    const head = rowOf('—');
    expect(head.textContent).toContain('始点が無いので非表示');
    expect(head.querySelector('[data-act="assign"]')).toBeNull();
    expect(rowOf(1)).toBeDefined();
  });

  it('最後の通過より後の走行は、終点無しのラップ(参考値)として割り当てられる', () => {
    const tail = rowOf(4);
    expect(tail.textContent).toContain('終端未通過のため参考値');
    expect(tail.querySelector('[data-act="assign"][data-slot="A"]')).not.toBeNull();
  });

  it('一覧の下に、ラップ番号の数え方を書く', () => {
    expect(root.textContent).toContain('ラップ番号は計測ラインの最初の通過から数えます');
    expect(root.textContent).not.toContain('ラップ番号は RaceChrono と同じ番号です');
  });
});

describe('終端の調整', () => {
  it('ベストの 160% を超えるラップと、終点無しのラップにだけ出る', () => {
    expect(check(1)).toBeNull();
    expect(check(2)).not.toBeNull();                                       // 途中で 2 分止まったラップ
    expect(check(3)).toBeNull();
    expect(check(4)).not.toBeNull();
    expect(range(2)).toBeNull();                                           // スライドバーは、チェックを入れてから
  });

  it('チェックを入れるとスライドバーが出る(終端はまだ変わらない)。縮めると参考値になり、タイムも変わる', () => {
    const before = rowOf(2).children[1].textContent;
    check(2)!.click();
    expect(range(2)).not.toBeNull();
    expect(rowOf(2).children[1].textContent).toBe(before);
    slide(2, 30);
    expect(rowOf(2).children[1].textContent).toBe('0:30.0');
    expect(rowOf(2).textContent).toContain('終端: 0:30(参考値)');
    expect(lapOf((l) => l.number === 2)!.complete).toBe(false);
  });

  it('動かしている間は値の表示だけが変わり、手を離したとき(change)に反映する', () => {
    check(2)!.click();
    const r = range(2)!;
    r.value = String(stepFromEnd(60, Number(r.dataset.max)));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(r.parentElement!.textContent).toContain('終端: 1:00');
    expect(range(2)).toBe(r);                                              // 一覧は作り直していない
    expect(lapOf((l) => l.number === 2)!.complete).toBe(true);
  });

  it('チェックを外すと元に戻る', () => {
    check(2)!.click();
    slide(2, 30);
    check(2)!.click();
    expect(range(2)).toBeNull();
    expect(lapOf((l) => l.number === 2)!.complete).toBe(true);
  });

  it('終点無しのラップは、記録の終わりまで延ばせる', () => {
    const auto = lapOf((l) => l.number === 4)!.duration;
    check(4)!.click();
    slide(4, Number(range(4)!.dataset.max));
    expect(lapOf((l) => l.number === 4)!.duration).toBeGreaterThan(auto + 30);
  });

  it('調整した値はファイルごとに保存され、次に読み込んだときも使う', () => {
    check(2)!.click();
    slide(2, 30);
    expect(JSON.parse(store.get('lapEnds')!)).toEqual({ syn: { 2: 30 } });
    mount();
    session.addLog(sessionLog(), 'syn');
    expect(rowOf(2).children[1].textContent).toBe('0:30.0');
  });

  it('計測ラインが変わると、調整をやめる(ラップ番号の意味が変わるため)。セクターだけの変更では残す', () => {
    check(2)!.click();
    slide(2, 30);
    const id = session.circuits[0].id;
    session.reloadSectors(id, sector(180));
    expect(session.lapEnd('syn', 2)).toBe(30);
    session.reloadControl(id, line(1));
    expect(session.lapEnd('syn', 2)).toBeNull();
    expect(store.get('lapEnds')).toBe('{}');
  });

  it('セクタータイムを表示しているときは操作できず、調整中のラップは設定だけを文字で出す', () => {
    check(2)!.click();
    slide(2, 30);
    root.querySelector<HTMLButtonElement>('[data-act="sectors"][data-set="0"]')!.click();
    expect(check(2)).toBeNull();
    expect(range(2)).toBeNull();
    expect(rowOf(2).textContent).toContain('終端: 0:30(参考値)');
  });
});

describe('スライドバーの段階と終端の対応', () => {
  it('上限が 10 分以下なら、端から端まで 10 秒刻み。右端は上限', () => {
    expect(endSteps(188)).toBe(19);
    expect(endFromStep(1, 188)).toBe(10);
    expect(endFromStep(3, 188)).toBe(30);
    expect(endFromStep(19, 188)).toBe(188);
    expect(stepFromEnd(30, 188)).toBe(3);
    expect(stepFromEnd(188, 188)).toBe(19);
  });

  it('長いラップ(200 分)は、左半分で最初の 5 分を 10 秒刻み、右半分で残りを選ぶ', () => {
    const max = 200 * 60;
    expect(endSteps(max)).toBe(60);
    expect(endFromStep(24, max)).toBe(240);                                // 4:00
    expect(endFromStep(30, max)).toBe(300);                                // 真ん中 = 5:00
    expect(endFromStep(45, max)).toBe(6150);                               // 5 分 + 残りの半分
    expect(endFromStep(60, max)).toBe(max);
    expect(stepFromEnd(240, max)).toBe(24);
    expect(stepFromEnd(max, max)).toBe(60);
    for (let k = 1; k < 60; k++) expect(endFromStep(k + 1, max)).toBeGreaterThan(endFromStep(k, max));   // 戻らない
  });
});
