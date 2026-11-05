// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCln, metersPerDegree } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 読み込みの確認ダイアログと、候補を置いた登録画面(案件 3)。走行ログのファイルが無くても動く、人工の .vbo で確かめる

const R = 300, V = 100 / 3.6;
const A = { lat: 33, lon: 131 }, B = { lat: 34.8, lon: 136.5 };
const pad = (v: number, w: number) => (v < 0 ? '-' : '+') + Math.abs(v).toFixed(6).padStart(w, '0');
/** 中心 c の半径 300 m の円を 800° 走る .vbo(timing = true なら、北の点に [laptiming] の Start を入れる) */
function vboText(c: { lat: number; lon: number }, timing: boolean, name = 'テストサーキット'): string {
  const m = metersPerDegree(c.lat);
  const step = ((V * 0.1) / R) * (180 / Math.PI);
  const rows: string[] = [];
  for (let i = 0; i * step <= 800; i++) {
    const a = (i * step * Math.PI) / 180;
    const lat = c.lat + (R * Math.sin(a)) / m.lat, lon = c.lon + (R * Math.cos(a)) / m.lon;
    const t = 36000 + i * 0.1;
    const hms = `${String(Math.floor(t / 3600)).padStart(2, '0')}${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}${(t % 60).toFixed(2).padStart(5, '0')}`;
    rows.push(`010 ${hms} ${pad(lat * 60, 13)} ${pad(-lon * 60, 13)} 100.000 0.00 +00800.00`);
  }
  const p1 = { lat: c.lat + R / m.lat, lon: c.lon }, p2 = { lat: p1.lat, lon: c.lon + 50 / m.lon };
  const lt = timing
    ? `[session data]\r\nname ${name}\r\n\r\n[laptiming]\r\nStart ${pad(-p1.lon * 60, 12)} ${pad(p1.lat * 60, 12)} ${pad(-p2.lon * 60, 12)} ${pad(p2.lat * 60, 12)} ¬ Control line\r\n\r\n`
    : '';
  return `File created on 06/05/2026 at 10:00:00\r\n\r\n[header]\r\nsatellites\r\n\r\n[comments]\r\ntest\r\n\r\n${lt}`
    + `[column names]\r\nsats time lat long velocity heading height\r\n\r\n[data]\r\n${rows.join('\r\n')}\r\n`;
}
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;
const flush = () => new Promise((r) => setTimeout(r, 20));
/** 北の点(円の 90°)で、コースを横切る線 */
function northLine(c: { lat: number; lon: number }) {
  const m = metersPerDegree(c.lat);
  return { a: { lat: c.lat + (R - 10) / m.lat, lon: c.lon }, b: { lat: c.lat + (R + 10) / m.lat, lon: c.lon } };
}

let root: HTMLElement, session: Session, maps: FakeMap[];
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(new MemoryStore());
  maps = [];
  mountApp(root, session, new ThemeController(new MemoryStore()), () => { const m = new FakeMap(); maps.push(m); return m; });
});
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
function drop(set: number, files: File[]) {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files, types: ['Files'] } });
  root.querySelector(`#sec-set-${set} .dropbox`)!.dispatchEvent(e);
}
const dialog = () => document.querySelector<HTMLElement>('.modal.ld');
const rowOf = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.ld-row')).find((r) => r.textContent!.includes(name))!;

const pick = (key: string) => {
  const r = document.querySelector<HTMLInputElement>(`.modal.ld input[name="ld-opt"][value="${key}"]`)!;
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
};
const statusOf = (name: string) => rowOf(name).querySelector('.st')!.textContent;
const ok = () => $<HTMLButtonElement>('.modal.ld [data-dialog="ok"]');

describe('読み込みの確認ダイアログ', () => {
  it('全部判定できたときは出さない', async () => {
    session.registerCircuit('サーキットA', formatCln([northLine(A)]), '');
    drop(0, [file('a.vbo', vboText(A, false))]);
    await flush();
    expect(session.sets[0].logs).toHaveLength(1);
    expect(dialog()).toBeNull();
  });

  it('判定できないログがあれば出す。計測ラインは全体で 1 つを選び、各ファイルには、選んだ線を通るかを出す', async () => {
    drop(0, [file('rc.vbo', vboText(A, true)), file('plain.vbo', vboText(A, false)), file('far.vbo', vboText(B, true, '遠いサーキット'))]);
    await flush();
    expect(dialog()).not.toBeNull();
    // 初期値は、通るログが最も多い候補(rc.vbo の計測ライン)
    expect($('.ld-cur').textContent).toContain('現在選択されているサーキット');
    expect($('.ld-cur').textContent).toContain('ファイル: rc.vbo');
    expect($('.ld-cur').textContent).toContain('ファイル内のサーキット名: テストサーキット');
    expect(rowOf('rc.vbo').textContent).toContain('ファイル内のサーキット名「テストサーキット」で登録');
    expect(statusOf('rc.vbo')).toBe('選択中');
    expect(statusOf('plain.vbo')).toBe('通ります(ラップあり)');
    expect(statusOf('far.vbo')).toBe('選択中の計測ラインを通りません(ラップ無し)');
    expect(rowOf('plain.vbo').textContent).toContain('このファイルには計測ラインの情報がありません');
    expect(ok().textContent).toBe('この計測ラインで登録');
    expect($<HTMLInputElement>('#ld-name').value).toBe('テストサーキット');
    // 別のファイルの候補を選ぶと、ステータスが変わる
    pick('cand:far.vbo:' + vboText(B, true, '遠いサーキット').length);
    expect(statusOf('far.vbo')).toBe('選択中');
    expect(statusOf('rc.vbo')).toBe('選択中の計測ラインを通りません(ラップ無し)');
    // 地図 / あとで も同じ形の行
    pick('map');
    expect($('.ld-cur').textContent).toContain('地図で計測ラインを引いて登録');
    expect(statusOf('rc.vbo')).toBe('選択中(地図の場所)');
    pick('later');
    expect(statusOf('plain.vbo')).toBe('未判定のまま');
    expect(ok().textContent).toBe('閉じる');
  });

  it('「あとで」(Esc)なら、未判定のまま', async () => {
    drop(0, [file('rc.vbo', vboText(A, true))]);
    await flush();
    pick('later');
    ok().click();
    await flush();
    expect(dialog()).toBeNull();
    expect(session.sets[0].logs[0].circuit).toBeNull();
    expect(root.querySelector<HTMLElement>('.work-circuit')?.hidden ?? true).toBe(true);
  });

  it('右上に、選んだ計測ラインのプレビュー(計測ラインと、その付近の走行ライン)を出す。「セクター」で範囲を広げる。地図・あとでを選ぶとプレビューは無し', async () => {
    drop(0, [file('rc.vbo', vboText(A, true)), file('plain.vbo', vboText(A, false))]);
    await flush(); await flush();
    const prev = maps.at(-1)!;
    expect(prev.lines.map((l) => l.label)).toEqual(['計測ライン']);
    expect(prev.tracks.length).toBeGreaterThan(0);
    expect($('.ld-prev-none').hidden).toBe(true);
    // 「セクター」: 1 周分の走行ラインを出して、セクターも入るように合わせる
    const near = prev.tracks.length, fitted = prev.fitted, z0 = prev.view.zoom;
    $<HTMLButtonElement>('.ld-prev-mode [data-zoom="all"]').click();
    expect(prev.fitted).toBe(fitted + 1);
    expect(prev.view.zoom).toBe(z0 + 1);                                         // 全体に合わせたあと、1 段階拡大(FakeMap の fit は拡大率を変えない)
    expect(prev.tracks).toHaveLength(1);
    expect(prev.tracks[0].points.length).toBeGreaterThan(100);
    expect($('.ld-prev-mode [data-zoom="all"]').classList.contains('on')).toBe(true);
    expect($('.ld-prev-mode [data-zoom="all"]').textContent).toBe('セクター');
    $<HTMLButtonElement>('.ld-prev-mode [data-zoom="near"]').click();
    expect(prev.tracks.length).toBe(near);
    pick('map');
    expect($('.ld-prev-none').hidden).toBe(false);
    expect($('.ld-prev-mode').hidden).toBe(true);
    expect(ok().textContent).toBe('次へ(地図で登録)');
  });

  it('候補で登録: 登録画面は開かずにその場で登録し、通るログもまとめて判定される(比較セットのサーキットになる)', async () => {
    drop(0, [file('rc.vbo', vboText(A, true)), file('plain.vbo', vboText(A, false))]);
    await flush();
    const name = $<HTMLInputElement>('#ld-name');
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ok().disabled).toBe(true);
    expect($('#ld-name-msg').textContent).toContain('サーキット名を入力してください');
    name.value = 'オートポリス';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ok().disabled).toBe(false);
    ok().click();
    await flush();
    expect(dialog()).toBeNull();
    expect(root.querySelector<HTMLElement>('.work-circuit')?.hidden ?? true).toBe(true);
    expect(session.circuits.map((c) => c.name)).toEqual(['オートポリス']);
    expect(session.sets[0].selectedCircuitId).toBe(session.circuits[0].id);
    expect(session.sets[0].logs.map((l) => l.circuit?.name)).toEqual(['オートポリス', 'オートポリス']);
    expect(session.sets[0].logs[0].laps.some((l) => l.complete)).toBe(true);
  });

  it('登録済みと同じ名前は使えない', async () => {
    session.registerCircuit('テストサーキット', formatCln([northLine(B)]), '');
    drop(0, [file('rc.vbo', vboText(A, true))]);
    await flush();
    expect(ok().disabled).toBe(true);
    expect($('#ld-name-msg').textContent).toContain('既に名前が存在します');
  });

  it('地図で登録: 登録画面が開き(A〜D のカードは隠れる)、登録するとそのサーキットが比較セットのサーキットになる', async () => {
    drop(0, [file('plain.vbo', vboText(A, false))]);
    await flush();
    expect($('.ld-cur').textContent).toContain('地図で計測ラインを引いて登録');      // 候補が無ければ、地図が初期値
    ok().click();
    await flush();
    expect(root.querySelector<HTMLElement>('.work-circuit')!.hidden).toBe(false);
    expect(root.querySelector('#view-import')!.classList.contains('view-ce')).toBe(true);
    const line = northLine(A);
    $<HTMLButtonElement>('#ce-draw-control').click();
    maps.find((m) => m.drawCb)!.drawLine(line.a, line.b);
    $<HTMLButtonElement>('#ce-confirm').click();
    $<HTMLInputElement>('#ce-name').value = 'サーキットA';
    $<HTMLButtonElement>('#ce-save').click();
    await flush();
    expect(session.sets[0].selectedCircuitId).toBe(session.circuits[0].id);
    expect(session.sets[0].logs[0].circuit?.name).toBe('サーキットA');
    expect(root.querySelector('#view-import')!.classList.contains('view-ce')).toBe(false);
  });

  it('空のセットに 2 つのサーキットのログを読み込むと出す。「登録済みのサーキット」の行で選ぶと、そのサーキットを使う', async () => {
    session.registerCircuit('サーキットA', formatCln([northLine(A)]), '');
    session.registerCircuit('サーキットB', formatCln([northLine(B)]), '');
    drop(0, [file('a.vbo', vboText(A, false)), file('b1.vbo', vboText(B, false)), file('b2.vbo', vboText(B, false))]);
    await flush();
    expect($('.ld-cur').textContent).toContain('登録済みのサーキット: サーキットB');        // 通るログが多い方が初期値
    expect(statusOf('a.vbo')).toBe('選択中の計測ラインを通りません(ラップ無し)');
    expect(statusOf('b1.vbo')).toBe('通ります(ラップあり)');
    pick(`circuit:${session.circuits[0].id}`);
    expect(statusOf('a.vbo')).toBe('通ります(ラップあり)');
    expect(ok().textContent).toBe('このサーキットを使う');
    ok().click();
    await flush();
    const w = session.sets[0];
    expect(w.selectedCircuitId).toBe(session.circuits[0].id);
    expect(w.logs.map((l) => l.circuit?.name ?? `外:${l.outside?.name}`)).toEqual(['サーキットA', '外:サーキットA', '外:サーキットA']);
  });

  it('サーキットが決まったセットに、通らないログを足すと、ダイアログは出さずにラップ無しで入る(枠に説明)', async () => {
    session.registerCircuit('サーキットA', formatCln([northLine(A)]), '');
    drop(0, [file('a.vbo', vboText(A, false))]);
    await flush();
    drop(0, [file('b.vbo', vboText(B, true))]);
    await flush();
    expect(dialog()).toBeNull();
    const b = session.sets[0].logs[1];
    expect(b.outside?.name).toBe('サーキットA');
    expect(root.querySelector('#sec-set-0')!.textContent).toContain('この比較セットのサーキット(サーキットA)の計測ラインを通らない');
  });
});
