// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { bindToast, mountToast, TOAST_MS } from '../src/ui/toast';

// 画面の下の通知(案件 53)

let host: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<div id="host"></div>'; host = document.getElementById('host')!; });
afterEach(() => { vi.useRealTimers(); });

const el = () => host.querySelector<HTMLElement>('.toast')!;
const text = () => host.querySelector('.toast-text')!.textContent;
const closeBtn = () => host.querySelector<HTMLButtonElement>('.toast-x')!;

describe('mountToast', () => {
  it('最初は隠れている', () => {
    mountToast(host);
    expect(el().hidden).toBe(true);
  });

  it('info は出して、数秒で消える', () => {
    const t = mountToast(host);
    t.show('登録しました', 'info');
    expect(el().hidden).toBe(false);
    expect(text()).toBe('登録しました');
    expect(el().getAttribute('role')).toBe('status');
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(el().hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(el().hidden).toBe(true);
  });

  it('warn は時間が経っても残り、「×」で閉じる(role は alert)', () => {
    const t = mountToast(host);
    t.show('読み込めませんでした', 'warn');
    expect(el().classList.contains('warn')).toBe(true);
    expect(el().getAttribute('role')).toBe('alert');
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(el().hidden).toBe(false);
    closeBtn().click();
    expect(el().hidden).toBe(true);
  });

  it('busy は時間では消えず、「×」も無い。hide で消える', () => {
    const t = mountToast(host);
    t.show('読み込み中…', 'busy');
    expect(closeBtn().hidden).toBe(true);
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(el().hidden).toBe(false);
    t.hide();
    expect(el().hidden).toBe(true);
  });

  it('続けて出すと、前の消える予約は取り消される(新しい通知が早く消えない)', () => {
    const t = mountToast(host);
    t.show('A', 'info');
    vi.advanceTimersByTime(TOAST_MS - 1000);
    t.show('B', 'info');
    vi.advanceTimersByTime(2000);
    expect(el().hidden).toBe(false);
    expect(text()).toBe('B');
    vi.advanceTimersByTime(TOAST_MS);
    expect(el().hidden).toBe(true);
  });

  it('info のあとに warn を出すと、残る', () => {
    const t = mountToast(host);
    t.show('A', 'info');
    t.show('失敗', 'warn');
    vi.advanceTimersByTime(TOAST_MS * 2);
    expect(el().hidden).toBe(false);
  });
});

describe('bindToast(セッションの案内を通知に出す)', () => {
  const setup = () => {
    const session = new Session(new MemoryStore());
    const sync = bindToast(mountToast(host), session);
    session.subscribe(sync);
    return session;
  };

  it('say で出す。既定は消える通知、warn を付けると残る通知', () => {
    const s = setup();
    s.say('取り込みました');
    expect(text()).toBe('取り込みました');
    expect(el().classList.contains('warn')).toBe(false);
    s.say('読み込めませんでした', true);
    expect(text()).toBe('読み込めませんでした');
    expect(el().classList.contains('warn')).toBe(true);
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(el().hidden).toBe(false);
  });

  it('同じ文でも、出し直すと、また出る', () => {
    const s = setup();
    s.say('同じ文');
    vi.advanceTimersByTime(TOAST_MS);
    expect(el().hidden).toBe(true);
    s.say('同じ文');
    expect(el().hidden).toBe(false);
  });

  it('消えたあとは、ほかの変化(別の操作)では出し直さない', () => {
    const s = setup();
    s.say('一度だけ');
    vi.advanceTimersByTime(TOAST_MS);
    s.setLoading('');
    s.toggleAssignment('A', { logId: 'none', lap: 1 });
    expect(el().hidden).toBe(true);
  });

  it('読み込み中の案内は、終わるまで出て、終わると消える', () => {
    const s = setup();
    s.setLoading('前回のファイルを読み込み中… (1/2)');
    expect(text()).toContain('読み込み中');
    expect(el().classList.contains('busy')).toBe(true);
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(el().hidden).toBe(false);
    s.setLoading('');
    expect(el().hidden).toBe(true);
  });

  it('位置補正データではないファイルを読み込むと、残る通知で知らせる', () => {
    const s = setup();
    s.importOffsets('これは JSON ではありません');
    expect(text()).toContain('位置補正データとして読み込めませんでした');
    expect(el().classList.contains('warn')).toBe(true);
  });
});
