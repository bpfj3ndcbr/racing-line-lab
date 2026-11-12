// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKIP_WAITING, UpdateWatcher } from '../src/io/pwa';
import { MemoryResumeStore } from '../src/io/resume';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// アプリの更新(案件 50)。service worker の代わりに、動きだけ似せた偽物で確かめる

class Ev { private l: Record<string, (() => void)[]> = {}; addEventListener(t: string, f: () => void) { (this.l[t] ??= []).push(f); } emit(t: string) { (this.l[t] ?? []).forEach((f) => f()); } }
class FakeWorker extends Ev { sent: unknown[] = []; constructor(public state = 'installing') { super(); } postMessage(m: unknown) { this.sent.push(m); } set(s: string) { this.state = s; this.emit('statechange'); } }
class FakeReg extends Ev {
  waiting: FakeWorker | null = null; installing: FakeWorker | null = null; failUpdate = false; onUpdate: (() => void) | null = null;
  async update() { if (this.failUpdate) throw new TypeError('offline'); this.onUpdate?.(); }
}
class FakeContainer extends Ev { controller: object | null = {}; }

function setup(o: { controller?: boolean } = {}) {
  const sw = new FakeContainer(); if (o.controller === false) sw.controller = null;
  const reg = new FakeReg();
  let reloaded = 0;
  const w = new UpdateWatcher(sw as unknown as ServiceWorkerContainer, () => { reloaded++; });
  return { sw, reg, w, reloaded: () => reloaded, attach: () => w.attach(reg as unknown as ServiceWorkerRegistration) };
}

describe('UpdateWatcher', () => {
  it('登録したときに、待機中の新しい版があれば知らせる', () => {
    const t = setup(); t.reg.waiting = new FakeWorker('installed');
    let n = 0; t.w.subscribe(() => n++);
    t.attach();
    expect(t.w.waiting).toBe(true);
    expect(n).toBe(1);
  });

  it('初めてのインストール(動いている版が無い)は、更新として知らせない', () => {
    const t = setup({ controller: false }); t.attach();
    const w = new FakeWorker(); t.reg.installing = w; t.reg.emit('updatefound'); w.set('installed');
    expect(t.w.waiting).toBe(false);
  });

  it('新しい版の取得が終わったら(updatefound → installed)知らせる', () => {
    const t = setup(); t.attach();
    expect(t.w.waiting).toBe(false);
    const w = new FakeWorker(); t.reg.installing = w; t.reg.emit('updatefound');
    w.set('installed');
    expect(t.w.waiting).toBe(true);
  });

  it('check: ネットが無ければ「確認できません」、何も無ければ「最新」、新しい版が取れれば「待機中」', async () => {
    const t = setup(); t.attach();
    t.reg.failUpdate = true;
    expect(await t.w.check()).toBe('failed');
    t.reg.failUpdate = false;
    expect(await t.w.check()).toBe('latest');
    const w = new FakeWorker();
    t.reg.onUpdate = () => { t.reg.installing = w; t.reg.emit('updatefound'); setTimeout(() => { t.reg.waiting = w; w.set('installed'); }, 0); };
    expect(await t.w.check()).toBe('waiting');
    expect(t.w.waiting).toBe(true);
  });

  it('check: 登録できていなければ「確認できません」', async () => {
    expect(await setup().w.check()).toBe('failed');
  });

  it('apply: 待機中の版に切り替えを頼み、代わったら読み直す。自分で頼んでいない切り替えでは読み直さない', () => {
    const t = setup(); const w = new FakeWorker('installed'); t.reg.waiting = w; t.attach();
    t.sw.emit('controllerchange');
    expect(t.reloaded()).toBe(0);
    t.w.apply();
    expect(w.sent).toEqual([{ type: SKIP_WAITING }]);
    expect(t.reloaded()).toBe(0);
    t.sw.emit('controllerchange');
    expect(t.reloaded()).toBe(1);
  });
});

describe('画面の知らせ', () => {
  let store: MemoryStore, app: { dispose(): void } | null = null;
  const boot = (updates: UpdateWatcher | null = null) => {
    app?.dispose();
    document.body.innerHTML = '<div id="app"></div>';
    app = mountApp(document.getElementById('app')!, new Session(store), new ThemeController(store), () => new FakeMap(), { resume: null, takeShared: async () => null, updates });
  };
  const note = () => document.querySelector('.upd-note')?.textContent ?? null;
  const nav = (v: string) => document.querySelector<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`)!.click();
  beforeEach(() => { store = new MemoryStore(); });
  afterEach(() => { app?.dispose(); app = null; });

  it('初めて使うときは「更新しました」を出さず、版を覚える', () => {
    boot();
    expect(note()).toBeNull();
    expect(new Session(store).getSetting('seenVersion', '')).toBe(__APP_VERSION__);
  });

  it('前回と違う版で起動したら「○.○.○ に更新しました」を出し、画面を切り替えたら消す。次の起動では出ない', () => {
    new Session(store).setSetting('seenVersion', '0.0.1');
    boot();
    expect(note()).toBe(`${__APP_VERSION__} に更新しました`);
    nav('settings');
    expect(note()).toBeNull();
    boot();
    expect(note()).toBeNull();
  });

  it('更新して読み直したとき、前の画面に戻す切り替えでは知らせを消さない(「更新しました」が見える)', async () => {
    new Session(store).setSetting('seenVersion', '0.0.1');
    const resume = new MemoryResumeStore(true);
    await resume.putState({ ...new Session(store).resumeState(), view: 'settings' });
    app?.dispose();
    document.body.innerHTML = '<div id="app"></div>';
    app = mountApp(document.getElementById('app')!, new Session(store), new ThemeController(store), () => new FakeMap(), { resume, takeShared: async () => null });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector<HTMLElement>('#view-settings')!.hidden).toBe(false);    // 前の画面に戻った
    expect(note()).toBe(`${__APP_VERSION__} に更新しました`);
    nav('compare');
    expect(note()).toBeNull();
  });

  it('新しい版が待機中になったら「新しい版があります」を出し、画面を切り替えたら消す', () => {
    const t = setup(); t.attach();
    boot(t.w);
    expect(note()).toBeNull();
    const w = new FakeWorker(); t.reg.installing = w; t.reg.emit('updatefound'); w.set('installed');
    expect(note()).toBe('新しい版があります');
    nav('compare');
    expect(note()).toBeNull();
  });

  it('設定の「更新を確認する」: 最新なら結果を出し、新しい版があれば「更新する」に変わって、押すと切り替える', async () => {
    const t = setup(); t.attach();
    boot(t.w);
    const btn = () => document.querySelector<HTMLButtonElement>('[data-update]')!;
    expect(btn().textContent).toBe('更新を確認する');
    btn().click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('#view-settings')!.textContent).toContain('最新です');
    const w = new FakeWorker(); t.reg.installing = w; t.reg.emit('updatefound'); t.reg.waiting = w; w.set('installed');
    expect(btn().textContent).toBe('更新する');
    btn().click();
    expect(w.sent).toEqual([{ type: SKIP_WAITING }]);
  });

  it('更新の確認が使えない環境(デスクトップ版・開発中)では、ボタンは押せない', () => {
    boot(null);
    expect(document.querySelector<HTMLButtonElement>('[data-update]')!.disabled).toBe(true);
  });
});
