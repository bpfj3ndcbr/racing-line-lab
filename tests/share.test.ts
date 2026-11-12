// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatCln, metersPerDegree, parseVbo } from '../src/core';
import { SHARE_ACTION, SHARE_FIELD, shareIndex, shareKey } from '../src/core/share';
import { MemoryStore } from '../src/io/storage';
import { MemoryResumeStore } from '../src/io/resume';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// Android の共有の画面から受け取る(案件 45)。走行ログのファイルが無くても動く、人工の .vbo で確かめる

const R = 300, V = 100 / 3.6, C = { lat: 33, lon: 131 };
const pad = (v: number, w: number) => (v < 0 ? '-' : '+') + Math.abs(v).toFixed(6).padStart(w, '0');
/** 中心 C の半径 300 m の円を 2 周あまり走る .vbo */
function vboText(): string {
  const m = metersPerDegree(C.lat);
  const step = ((V * 0.1) / R) * (180 / Math.PI);
  const rows: string[] = [];
  for (let i = 0; i * step <= 800; i++) {
    const a = (i * step * Math.PI) / 180;
    const lat = C.lat + (R * Math.sin(a)) / m.lat, lon = C.lon + (R * Math.cos(a)) / m.lon;
    const t = 36000 + i * 0.1;
    const hms = `${String(Math.floor(t / 3600)).padStart(2, '0')}${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}${(t % 60).toFixed(2).padStart(5, '0')}`;
    rows.push(`010 ${hms} ${pad(lat * 60, 13)} ${pad(-lon * 60, 13)} 100.000 0.00 +00800.00`);
  }
  return `File created on 06/05/2026 at 10:00:00\r\n\r\n[header]\r\nsatellites\r\n\r\n[column names]\r\nsats time lat long velocity heading height\r\n\r\n[data]\r\n${rows.join('\r\n')}\r\n`;
}
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;
const flush = () => new Promise((r) => setTimeout(r, 30));

function boot(shared: File[] | null, o: { resume?: MemoryResumeStore; sharedLaunch?: boolean; prep?: (s: Session) => void } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const session = new Session(new MemoryStore());
  o.prep?.(session);
  // 北の点で円を横切る計測ラインを登録しておく(読み込みの確認画面が出ないように)
  const m = metersPerDegree(C.lat);
  session.registerCircuit('テスト', formatCln([{ a: { lat: C.lat + (R - 10) / m.lat, lon: C.lon }, b: { lat: C.lat + (R + 10) / m.lat, lon: C.lon } }]), '');
  mountApp(root, session, new ThemeController(new MemoryStore()), () => new FakeMap(), { resume: o.resume ?? null, sharedLaunch: o.sharedLaunch, takeShared: async () => shared });
  return { root, session };
}
const setButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.modal [data-share-set]'));

describe('共有の画面から受け取る(案件 45)', () => {
  it('manifest: 共有の送り先として、RaceChrono のファイルを POST で受け取る', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { share_target: { action: string; method: string; enctype: string; params: { files: { name: string; accept: string[] }[] } } };
    expect(m.share_target.action).toBe(SHARE_ACTION);
    expect(m.share_target.method).toBe('POST');
    expect(m.share_target.enctype).toBe('multipart/form-data');
    expect(m.share_target.params.files[0].name).toBe(SHARE_FIELD);
    // 送り先に出すのは、RaceChrono の共有(RaceChrono が付けるファイルの種類)のときだけ
    expect(m.share_target.params.files[0].accept).toEqual(['application/x-racechrono', '.vbo']);
  });

  it('保存のキー: スコープの下に番号付きで置き、番号で並べ直せる', () => {
    const k = shareKey('https://example.com/racing-line-lab/', 2);
    expect(k).toBe('https://example.com/racing-line-lab/share-target/file/2');
    expect(shareIndex(k)).toBe(2);
    expect(shareIndex('https://example.com/other')).toBe(-1);
  });

  it('受け取ったら「データ管理」で比較セットを選ぶ。初めは表示予定の比較セットが選ばれていて、選んだセットに追加する', async () => {
    const { session } = boot([file('rc.vbo', vboText())]);
    await flush();
    expect(document.querySelector('.modal')?.textContent).toContain('追加する比較セットを選んでください');
    expect(document.querySelector('.modal')?.textContent).toContain('共有された走行ログ(1 件)');
    const btns = setButtons();
    expect(btns).toHaveLength(5);
    expect(document.activeElement).toBe(btns[0]);
    expect(btns[0].classList.contains('pri')).toBe(true);
    btns[2].click();
    await flush();
    expect(session.sets[2].logs).toHaveLength(1);
    expect(session.sets[0].logs).toHaveLength(0);
    expect(document.querySelector<HTMLElement>('#view-import')!.hidden).toBe(false);
  });

  it('キャンセルすると追加しない', async () => {
    const { session } = boot([file('rc.vbo', vboText())]);
    await flush();
    document.querySelector<HTMLButtonElement>('.modal [data-dialog="cancel"]')!.click();
    await flush();
    expect(session.sets.every((w) => w.logs.length === 0)).toBe(true);
    expect(session.message).toContain('追加しませんでした');
  });

  it('.vbo が無いときは、セットを聞かずに「読み込めるのは .vbo ファイルだけです」を出す', async () => {
    const { session } = boot([file('data.csv', 'a,b')]);
    await flush();
    expect(setButtons()).toHaveLength(0);
    expect(document.querySelector('.modal')?.textContent).toContain('読み込めるのは .vbo ファイルだけです');
    expect(session.sets.every((w) => w.logs.length === 0)).toBe(true);
  });

  it('受け取れなかったときは知らせ、共有で開いたのでなければ何もしない', async () => {
    const a = boot([]);
    await flush();
    expect(a.session.message).toContain('受け取れませんでした');
    const b = boot(null);
    await flush();
    expect(document.querySelector('.modal')).toBeNull();
    expect(b.session.message).not.toContain('受け取れませんでした');
  });

  it('比較セットに別名があるときは、別名と元の名前を出す', async () => {
    boot([file('rc.vbo', vboText())], { prep: (s) => s.setAlias(1, '富士 11/7') });
    await flush();
    const btns = setButtons();
    expect(btns[1].textContent).toContain('富士 11/7');
    expect(btns[1].textContent).toContain('(比較セット2)');
    expect(btns[0].textContent).not.toContain('(');
  });

  it('共有で開いた新しい窓では、直前の窓の状態(走行ログと割り当て)を引き継いでから、追加する', async () => {
    // 直前の窓: 比較セット1 に走行ログが 1 本
    const before = new Session(new MemoryStore());
    const log = parseVbo(vboText(), 'local.vbo');
    before.addLog(log, 'local', 0);
    const resume = new MemoryResumeStore(false);
    resume.previous = { state: JSON.parse(JSON.stringify({ ...before.resumeState(), view: 'compare' })), logs: new Map([['local', log]]) };

    const { session } = boot([file('rc.vbo', vboText())], { resume, sharedLaunch: true });
    await flush();
    expect(session.sets[0].logs.map((l) => l.id)).toEqual(['local']);
    expect(setButtons()[0].textContent).toContain('走行ログ 1 件');
    setButtons()[0].click();
    await flush();
    expect(session.sets[0].logs).toHaveLength(2);
    expect(resume.previous).toBeNull();                 // 引き継いだ分は、この窓のものになる
  });

  it('共有で開いたのでなければ、ほかの窓の状態は引き継がない', async () => {
    const before = new Session(new MemoryStore());
    before.addLog(parseVbo(vboText(), 'local.vbo'), 'local', 0);
    const resume = new MemoryResumeStore(false);
    resume.previous = { state: before.resumeState(), logs: new Map() };
    const { session } = boot(null, { resume, sharedLaunch: false });
    await flush();
    expect(session.sets[0].logs).toHaveLength(0);
    expect(resume.previous).not.toBeNull();
  });
});
