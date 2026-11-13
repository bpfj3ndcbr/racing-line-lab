// @vitest-environment jsdom
// セクター通過時の自動合わせ(案件 58): 「自動」をオンにすると、再生で基準の車がセクターを通ったとき、
// そのセクターのボタンを押したのと同じ合わせ方(先頭車両 / 全車一致)をする
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
const bigPath = fx('session_20260506_094550_autopolis.vbo');
const big = existsSync(bigPath);

let root: HTMLElement, session: Session;
let queue: FrameRequestCallback[] = [];
let clock = 0;

beforeEach(() => {
  queue = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const store = new MemoryStore();
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
  session.registerCircuit('オートポリス', cln, sci);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const click = (sel: string) => $<HTMLButtonElement>(sel).click();
const auto = () => $<HTMLButtonElement>('#cmp-sync [data-act="autosync"]');
const topAuto = () => $<HTMLButtonElement>('#top-set [data-act="autosync"]');
const status = () => ($<HTMLElement>('#cmp-sync-status').hidden ? '' : $('#cmp-sync-text').textContent!);
const tau = () => Number($<HTMLInputElement>('#cmp-seek').value);
const lapOf = (slot: 'A' | 'B') => session.resolveRef(session.assignment[slot])!.lap;
const pressed = () => root.querySelector<HTMLElement>('#cmp-sectors [aria-pressed="true"]')?.dataset.k;
const seekTo = (sec: number) => { const e = $<HTMLInputElement>('#cmp-seek'); e.value = String(sec); e.dispatchEvent(new Event('input')); };

/** 0.1 秒ずつコマを進める。until が真になったら止める(なれば true) */
function play(maxFrames: number, until?: () => boolean): boolean {
  for (let i = 0; i < maxFrames; i++) {
    clock += 100;
    const cbs = queue.splice(0);
    for (const cb of cbs) cb(clock);
    if (until?.()) return true;
  }
  return false;
}
function setupTwo() {
  session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'big', lap: 2 });     // 2:26.5
  session.toggleAssignment('B', { logId: 'u', lap: 1 });       // 2:22.9(速い)
  click('[data-act="nav"][data-view="compare"]');
  click('[data-act="xkind"][data-kind="time"]');
}
/** A・B の両方が通るセクターのうち、先頭(B)が先に通るもの。最初のセクターは除く */
function laterSectors(): number[] {
  const a = lapOf('A').sectorTimes, b = lapOf('B').sectorTimes;
  return a.flatMap((t, k) => (k > 0 && t != null && b[k] != null && (b[k] as number) < t ? [k] : []));
}

describe('「自動」ボタン(案件 58)', () => {
  it('初めはオフ。押すとオンになり、基準の車を添えて「自動 先頭」「自動 A」と出す。上部バーにも同じボタンと「セクター動作」の見出し', () => {
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    click('[data-act="nav"][data-view="compare"]');
    expect(auto().textContent).toBe('自動');
    expect(auto().getAttribute('aria-pressed')).toBe('false');
    expect($('#top-set .sync-cap').textContent).toBe('セクター動作');
    topAuto().click();                                              // 上部バーのボタンでも同じ
    expect(auto().getAttribute('aria-pressed')).toBe('true');
    expect(auto().textContent).toBe('自動 先頭');                    // 表示位置の初期値は先頭追従
    expect(topAuto().textContent).toBe('自動 先頭');
    expect(auto().title).toBe('先頭の車 がセクターを通過したとき、自動で全車一致に合わせます');
    expect(status()).toContain('自動');
    click('[data-act="follow"][data-follow="A"]');
    expect(auto().textContent).toBe('自動 A');
    click('[data-act="syncmode"][data-mode="leader"]');
    expect(auto().title).toBe('A がセクターを通過したとき、自動で先頭車両に合わせます');
    auto().click();
    expect(auto().textContent).toBe('自動');
    expect(status()).toBe('');
  });

  it('「解除」を押すと、自動もオフになる', () => {
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    click('[data-act="nav"][data-view="compare"]');
    auto().click();
    click('[data-act="sector"][data-k="2"]');
    click('#cmp-sync-release');
    expect(auto().getAttribute('aria-pressed')).toBe('false');
    expect(auto().textContent).toBe('自動');
  });

  it.skipIf(!big)('全車一致・先頭追従: 先頭の車がセクターを通ると、そのセクターで全車一致にそろえる', () => {
    setupTwo();
    const ks = laterSectors();
    expect(ks.length).toBeGreaterThan(1);
    seekTo((lapOf('B').sectorTimes[ks[0]] as number) - 1);          // 最初に調べるセクターの 1 秒手前から
    auto().click();
    click('[data-act="toggle"]');
    expect(play(30, () => pressed() !== undefined)).toBe(true);
    expect(pressed()).toBe(String(ks[0]));
    expect(status()).toBe(`S${ks[0] + 1} で全車一致中(自動)`);
    expect(tau()).toBeCloseTo(lapOf('A').sectorTimes[ks[0]] as number, 1);   // 遅い車(A)がセクターを通る時刻にそろう
    // 次のセクターでも、また合わせる
    expect(play(2000, () => pressed() !== String(ks[0]))).toBe(true);
    expect(Number(pressed())).toBeGreaterThan(ks[0]);
    expect(status()).toMatch(/^S\d+ で全車一致中\(自動\)$/);
  });

  it.skipIf(!big)('先頭車両・表示位置 A: A がセクターを通ると、先頭(B)の通過時刻へ戻る。戻ったあと A が同じセクターを通っても、もう戻らない', () => {
    setupTwo();
    click('[data-act="syncmode"][data-mode="leader"]');
    click('[data-act="follow"][data-follow="A"]');
    const k = laterSectors()[0];
    const tA = lapOf('A').sectorTimes[k] as number, tB = lapOf('B').sectorTimes[k] as number;
    seekTo(tA - 1);
    auto().click();
    click('[data-act="toggle"]');
    expect(play(30, () => pressed() !== undefined)).toBe(true);
    expect(pressed()).toBe(String(k));
    expect(tau()).toBeCloseTo(tB, 1);                               // B が先頭で通った時点へ戻る
    expect(status()).toBe(`S${k + 1}: B が先頭で通過した時点へ移動しました(自動)`);
    // A がもう一度セクター k を通る(tA を過ぎる)まで進めても、戻らない
    const before = clock;
    play(Math.ceil((tA - tB) * 10) + 10);
    expect(tau()).toBeGreaterThan(tA);
    expect(clock - before).toBeGreaterThan(0);
  });

  it.skipIf(!big)('シークで通り過ぎたときは合わせない(再生で通ったときだけ)', () => {
    setupTwo();
    auto().click();
    const k = laterSectors()[0];
    seekTo((lapOf('A').sectorTimes[k] as number) + 2);
    expect(pressed()).toBeUndefined();
    expect(status()).toContain('自動:');                            // オンにしたときの案内のまま
  });
});
