// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type GeoLine, distanceM, formatCln, lineBearing, lineMid, metersPerDegree } from '../src/core';
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
/**
 * 中心 c の円(半径 R)を反時計回りに span 度(既定は 2 周あまり)走るログ。timing = 計測ライン(北の点)の情報を入れる。
 * splits = セクターの位置(円の角度、ファイルの順)
 */
function vboText(c: { lat: number; lon: number }, timing: boolean, name = 'テストサーキット', splits: number[] = [], span = 800): string {
  const m = metersPerDegree(c.lat);
  const step = ((V * 0.1) / R) * (180 / Math.PI);
  const rows: string[] = [];
  for (let i = 0; i * step <= span; i++) {
    const a = (i * step * Math.PI) / 180;
    const lat = c.lat + (R * Math.sin(a)) / m.lat, lon = c.lon + (R * Math.cos(a)) / m.lon;
    const t = 36000 + i * 0.1;
    const hms = `${String(Math.floor(t / 3600)).padStart(2, '0')}${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}${(t % 60).toFixed(2).padStart(5, '0')}`;
    rows.push(`010 ${hms} ${pad(lat * 60, 13)} ${pad(-lon * 60, 13)} 100.000 0.00 +00800.00`);
  }
  const p1 = { lat: c.lat + R / m.lat, lon: c.lon }, p2 = { lat: p1.lat, lon: c.lon + 50 / m.lon };
  const lt = timing
    ? `[session data]\r\nname ${name}\r\n\r\n[laptiming]\r\nStart ${pad(-p1.lon * 60, 12)} ${pad(p1.lat * 60, 12)} ${pad(-p2.lon * 60, 12)} ${pad(p2.lat * 60, 12)} ¬ Control line\r\n`
      // [laptiming] の線は、p1 を通り p2 → p1 の向きに直交する。p1 = 円の上の点、p2 = そこから接線の向きに 50 m
      + splits.map((deg, i) => {
        const r = (deg * Math.PI) / 180;
        const q1 = { lat: c.lat + (R * Math.sin(r)) / m.lat, lon: c.lon + (R * Math.cos(r)) / m.lon };
        const q2 = { lat: q1.lat + (50 * Math.cos(r)) / m.lat, lon: q1.lon - (50 * Math.sin(r)) / m.lon };
        return `Split ${pad(-q1.lon * 60, 12)} ${pad(q1.lat * 60, 12)} ${pad(-q2.lon * 60, 12)} ${pad(q2.lat * 60, 12)} ¬ Split ${i + 1}\r\n`;
      }).join('')
      + '\r\n'
    : '';
  return `File created on 06/05/2026 at 10:00:00\r\n\r\n[header]\r\nsatellites\r\n\r\n[comments]\r\ntest\r\n\r\n${lt}`
    + `[column names]\r\nsats time lat long velocity heading height\r\n\r\n[data]\r\n${rows.join('\r\n')}\r\n`;
}
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;
const flush = () => new Promise((r) => setTimeout(r, 20));
/** 円の deg 度(東 = 0°、反時計回り)の点で、コースを横切る線(中心から外へ向かう) */
function radial(c: { lat: number; lon: number }, deg: number): GeoLine {
  const m = metersPerDegree(c.lat), a = (deg * Math.PI) / 180;
  const at = (r: number) => ({ lat: c.lat + (r * Math.sin(a)) / m.lat, lon: c.lon + (r * Math.cos(a)) / m.lon });
  return { a: at(R - 10), b: at(R + 10) };
}
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

/** 修正の画面の「キャンセル」・Esc で出る確認(案件 23)で、「破棄して戻る」を押す */
async function discard() {
  await flush();
  document.querySelector<HTMLButtonElement>('.modal:not(.ld) [data-dialog="ok"]')!.click();
  await flush();
}

describe('計測ラインの修正(案件 15)', () => {
  const fixEl = () => $('.modal.ld .ld-fix');
  const val = (cls: string) => $(`.ld-fix .${cls}`).textContent;
  const setNum = (deg: number) => {
    const n = $<HTMLInputElement>('.ld-fix-deg');
    n.value = String(deg);
    n.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const key = (k: string, shiftKey = false) =>
    fixEl().dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
  async function openFix() {
    drop(0, [file('rc.vbo', vboText(A, true)), file('plain.vbo', vboText(A, false))]);
    await flush(); await flush();
    $<HTMLButtonElement>('.ld-prev-fix').click();
    return maps.at(-1)!;
  }

  it('「計測ラインを修正」は候補を選んだときだけ。押すと、ダイアログの中身が修正の画面に切り替わる', async () => {
    drop(0, [file('rc.vbo', vboText(A, true))]);
    await flush(); await flush();
    expect($('.ld-prev-fix').hidden).toBe(false);
    expect($('.ld-cur').textContent).toContain('計測ライン: ファイルのまま(修正なし)');
    expect($('.ld-prev-fix').textContent).toBe('計測ラインを修正');
    // 「セクター」のときも押せて、名前が「セクターを修正」になる(案件 17。どちらから開いても、計測ラインとセクターを直せる)
    $<HTMLButtonElement>('.ld-prev-mode [data-zoom="all"]').click();
    expect($<HTMLButtonElement>('.ld-prev-fix').disabled).toBe(false);
    expect($('.ld-prev-fix').textContent).toBe('セクターを修正');
    $<HTMLButtonElement>('.ld-prev-mode [data-zoom="near"]').click();
    expect($('.ld-prev-fix').textContent).toBe('計測ラインを修正');
    pick('map');
    expect($('.ld-prev-fix').hidden).toBe(true);
    pick('later');
    expect($('.ld-prev-fix').hidden).toBe(true);
    pick(document.querySelector<HTMLInputElement>('.modal.ld input[value^="cand:"]')!.value);
    const n = maps.length;
    $<HTMLButtonElement>('.ld-prev-fix').click();
    expect($('.modal.ld .ld-main').hidden).toBe(true);
    expect(fixEl().hidden).toBe(false);
    expect(fixEl().textContent).toContain('計測ライン・セクターの修正');
    expect(ok().hidden).toBe(true);
    expect($<HTMLButtonElement>('[data-fix="apply"]').hidden).toBe(false);
    expect(document.querySelector('.modal.ld input[name="ld-opt"]')).toBeNull();         // 元の画面の入力欄は残さない
    // 大きな地図: 補正前(灰色の破線)と補正後の線、つまみ 3 つ、拡大率 Z19
    expect(maps).toHaveLength(n + 1);
    const fm = maps.at(-1)!;
    expect(fm.lines.map((l) => [l.label, !!l.before, !!l.selected])).toEqual([['補正前', true, false], ['計測ライン', false, true]]);
    expect(fm.handles.map((h) => h.id)).toEqual(['a', 'b', 'm']);
    expect(fm.view.zoom).toBe(19);
    expect(fm.tracks.length).toBeGreaterThan(0);
    expect(val('ld-fix-b0')).toBe('0.0°');                                                 // 人工のログの線は北向き
    expect(val('ld-fix-d')).toBe('0.0°');
    expect(val('ld-fix-mv')).toBe('0.0 m');
  });

  it('角度は、数値入力・スライダー・[−][+] で変えられ、補正前・補正後・差を出す(北から時計回り)', async () => {
    const fm = await openFix();
    setNum(2.5);
    expect(val('ld-fix-b1')).toBe('2.5°');
    expect(val('ld-fix-d')).toBe('+2.5°');
    expect($<HTMLInputElement>('.ld-fix-range').value).toBe('2.5');
    expect(lineBearing(fm.lines[1].line)).toBeCloseTo(2.5, 6);
    $<HTMLButtonElement>('[data-fix="inc"]').click();
    expect(val('ld-fix-b1')).toBe('2.6°');
    $<HTMLButtonElement>('[data-fix="dec"]').click();
    $<HTMLButtonElement>('[data-fix="dec"]').click();
    expect(val('ld-fix-b1')).toBe('2.4°');
    const r = $<HTMLInputElement>('.ld-fix-range');
    r.value = '-3';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(val('ld-fix-b1')).toBe('357.0°');
    expect(val('ld-fix-d')).toBe('−3.0°');
    expect($<HTMLInputElement>('.ld-fix-deg').value).toBe('357.0');
    // 長さと中心は変わらない
    expect(distanceM(fm.lines[1].line.a, fm.lines[1].line.b)).toBeCloseTo(distanceM(fm.lines[0].line.a, fm.lines[0].line.b), 3);
    expect(val('ld-fix-mv')).toBe('0.0 m');
  });

  it('つまみ: 両端で回し(長さはそのまま)、中央で動かす。矢印キーでも動かせる(Shift で 10 倍)', async () => {
    const fm = await openFix();
    const before = fm.lines[0].line, c = lineMid(before), m = metersPerDegree(c.lat);
    fm.moveHandle('b', c.lat, c.lon + 30 / m.lon);                                       // 中心の東へ
    expect(val('ld-fix-b1')).toBe('90.0°');
    expect(distanceM(fm.lines[1].line.a, fm.lines[1].line.b)).toBeCloseTo(distanceM(before.a, before.b), 3);
    expect(fm.handles.find((h) => h.id === 'b')!.lon).toBeCloseTo(c.lon + distanceM(before.a, before.b) / 2 / m.lon, 7);   // つまみは線の端に置き直す
    fm.moveHandle('m', c.lat + 2 / m.lat, c.lon);
    expect(val('ld-fix-mv')).toBe('2.0 m');
    expect(val('ld-fix-b1')).toBe('90.0°');
    key('ArrowDown');
    expect(val('ld-fix-mv')).toBe('1.9 m');
    key('ArrowDown', true);
    expect(val('ld-fix-mv')).toBe('0.9 m');
  });

  it('「この位置にする」で元の画面に戻り、直した線でプレビュー・登録する', async () => {
    await openFix();
    setNum(4);
    $<HTMLButtonElement>('[data-fix="apply"]').click();
    expect(fixEl().hidden).toBe(true);
    expect($('.modal.ld .ld-main').hidden).toBe(false);
    expect(ok().hidden).toBe(false);
    expect(ok().disabled).toBe(false);
    expect($('.ld-cur').textContent).toContain('計測ライン: 修正あり(角度 +4.0°・移動 0.0 m)');
    expect(statusOf('plain.vbo')).toBe('通ります(ラップあり)');
    await flush();
    const prev = maps[0];
    expect(lineBearing(prev.lines[0].line)).toBeCloseTo(4, 6);
    // もう一度開くと、直した線から続けられる(補正前は候補の線のまま)
    $<HTMLButtonElement>('.ld-prev-fix').click();
    expect(val('ld-fix-b0')).toBe('0.0°');
    expect(val('ld-fix-b1')).toBe('4.0°');
    $<HTMLButtonElement>('[data-fix="apply"]').click();
    ok().click();
    await flush();
    expect(dialog()).toBeNull();
    expect(lineBearing(session.circuits[0].control!)).toBeCloseTo(4, 1);                 // 保存の丸め(7 桁)で、ずれは 0.02° ほど
    expect(session.sets[0].logs.map((l) => l.circuit?.name)).toEqual(['テストサーキット', 'テストサーキット']);
  });

  it('「キャンセル」と Esc は修正をやめて元の画面に戻る(ダイアログは閉じない)。「補正前に戻す」で戻した線は、修正なし', async () => {
    await openFix();
    setNum(10);
    $<HTMLButtonElement>('[data-fix="cancel"]').click();
    await discard();                                                                      // 線を変えたので確認が出る(案件 23)
    expect(fixEl().hidden).toBe(true);
    expect($('.ld-cur').textContent).toContain('ファイルのまま(修正なし)');
    $<HTMLButtonElement>('.ld-prev-fix').click();
    expect(val('ld-fix-b1')).toBe('0.0°');
    setNum(10);
    key('Escape');
    await discard();
    expect(dialog()).not.toBeNull();
    expect(fixEl().hidden).toBe(true);
    expect($('.ld-cur').textContent).toContain('ファイルのまま(修正なし)');
    $<HTMLButtonElement>('.ld-prev-fix').click();
    setNum(10);
    key('ArrowUp');
    $<HTMLButtonElement>('[data-fix="reset"]').click();
    expect(val('ld-fix-d')).toBe('0.0°');
    expect(val('ld-fix-mv')).toBe('0.0 m');
    $<HTMLButtonElement>('[data-fix="apply"]').click();
    expect($('.ld-cur').textContent).toContain('ファイルのまま(修正なし)');
  });
});

describe('セクターの修正・追加(案件 17)', () => {
  // ログは北(90°)の計測ラインから反時計回り: 西(180°)→ 南(270°)→ 東(0°)の順に通る。ファイルのセクターは、南・西の順に書く
  const fixEl = () => $('.modal.ld .ld-fix');
  const names = () => Array.from(document.querySelectorAll('.ld-fix-list .ld-fix-name')).map((b) => b.textContent);
  const selName = () => $('.ld-fix-list [aria-pressed="true"]').textContent;
  const stOf = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.ld-fix-row'))
    .find((r) => r.querySelector('.ld-fix-name')!.textContent === name)!.querySelector('.ld-fix-st')!.textContent;
  const btn = (sel: string) => $<HTMLButtonElement>(sel);
  const rowBtn = (name: string, act: string) => Array.from(document.querySelectorAll<HTMLElement>('.ld-fix-row'))
    .find((r) => r.querySelector('.ld-fix-name')!.textContent === name)!.querySelector<HTMLButtonElement>(`[data-fix="${act}"]`)!;
  /** 線の中心が、円の何度の位置か */
  const degOf = (l: GeoLine) => {
    const c = lineMid(l), m = metersPerDegree(A.lat);
    return Math.round(((Math.atan2((c.lat - A.lat) * m.lat, (c.lon - A.lon) * m.lon) * 180) / Math.PI + 360) % 360);
  };
  async function openSectors(splits = [270, 180]) {
    drop(0, [file('rc.vbo', vboText(A, true, 'テストサーキット', splits))]);
    await flush(); await flush();
    btn('.ld-prev-mode [data-zoom="all"]').click();
    btn('.ld-prev-fix').click();
    return maps.at(-1)!;
  }

  it('「セクターを修正」で開くと、線の一覧(通った順)が出て S1 を選んだ状態。地図は 1 周全体', async () => {
    const fm = await openSectors();
    expect(names()).toEqual(['計測ライン', 'S1', 'S2']);
    expect(selName()).toBe('S1');
    expect(fm.fitted).toBeGreaterThan(0);
    expect(fm.lines.filter((l) => !l.before).map((l) => [l.label, l.kind, degOf(l.line), !!l.selected]))
      .toEqual([['計測ライン', 'control', 90, false], ['S1', 'sector', 180, true], ['S2', 'sector', 270, false]]);
    expect(fm.lines.find((l) => l.before)?.kind).toBe('sector');                           // 選んでいる S1 の補正前
    expect(fm.handles.map((h) => h.id)).toEqual(['a', 'b', 'm']);
    expect($('.ld-fix-of').textContent).toBe('(S1)');
    // 一覧で選ぶと、その線を直す対象になり、地図がその線へ寄る
    rowBtn('S2', 'sel').click();
    expect(selName()).toBe('S2');
    expect($('.ld-fix-of').textContent).toBe('(S2)');
    const c = lineMid(radial(A, 270));
    expect(fm.view.lat).toBeCloseTo(c.lat, 6);
    expect(fm.view.zoom).toBeGreaterThanOrEqual(18);
    // 一覧のボタンにフォーカスがあるまま、矢印キーで続けて動かせる(描き直しでフォーカスが外れない)
    const press = () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement!.textContent).toBe('S2');
    press(); press(); press();
    expect($('.ld-fix-mv').textContent).toBe('0.3 m');
    expect(document.activeElement!.textContent).toBe('S2');
    expect(stOf('S2')).toBe('修正済み');
  });

  it('「計測ラインを修正」から開いたときは、計測ラインを選んだ状態', async () => {
    drop(0, [file('rc.vbo', vboText(A, true, 'テストサーキット', [180]))]);
    await flush(); await flush();
    btn('.ld-prev-fix').click();
    expect(names()).toEqual(['計測ライン', 'S1']);
    expect(selName()).toBe('計測ライン');
    expect(rowBtn('計測ライン', 'del')).toBeNull();                                         // 計測ラインは消せない
  });

  it('「セクターを追加」で地図に引くと、通った順に並べ直して番号を振り直す。通らない線は最後に「通りません」', async () => {
    const fm = await openSectors();
    btn('[data-fix="draw"]').click();
    expect(btn('[data-fix="draw"]').getAttribute('aria-pressed')).toBe('true');
    expect($('.ld-fix-draw-hint').hidden).toBe(false);
    expect(fm.handles).toEqual([]);                                                         // 引いている間は、つまみを出さない
    fm.drawLine(radial(A, 0).a, radial(A, 0).b);                                            // 東: 最後に通る
    expect(btn('[data-fix="draw"]').getAttribute('aria-pressed')).toBe('false');
    expect(names()).toEqual(['計測ライン', 'S1', 'S2', 'S3']);
    expect(selName()).toBe('S3');
    expect(stOf('S3')).toBe('追加');
    btn('[data-fix="draw"]').click();
    fm.drawLine(radial(A, 135).a, radial(A, 135).b);                                        // 北西: 計測ラインの次に通る
    expect(selName()).toBe('S1');
    expect(stOf('S1')).toBe('追加');
    expect(fm.lines.filter((l) => !l.before && l.kind === 'sector').map((l) => [l.label, degOf(l.line)]))
      .toEqual([['S1', 135], ['S2', 180], ['S3', 270], ['S4', 0]]);
    btn('[data-fix="draw"]').click();
    const m = metersPerDegree(A.lat);
    fm.drawLine({ lat: A.lat, lon: A.lon - 20 / m.lon }, { lat: A.lat, lon: A.lon + 20 / m.lon });   // 円の中心: どのラップも通らない
    expect(names()).toEqual(['計測ライン', 'S1', 'S2', 'S3', 'S4', 'S5']);
    expect(selName()).toBe('S5');
    expect(stOf('S5')).toBe('通りません');
  });

  it('引いている途中の Esc は、引くのをやめるだけ(修正の画面は閉じない)', async () => {
    await openSectors();
    btn('[data-fix="draw"]').click();
    fixEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(fixEl().hidden).toBe(false);
    expect(btn('[data-fix="draw"]').getAttribute('aria-pressed')).toBe('false');
    expect($('.ld-fix-draw-hint').hidden).toBe(true);
  });

  it('直す・足す・消すをまとめて「この位置にする」で決め、登録するとそのセクターで登録される', async () => {
    const fm = await openSectors();
    // S1(西)を回す → 修正済み
    const n = $<HTMLInputElement>('.ld-fix-deg');
    n.value = String((lineBearing(radial(A, 180)) + 3) % 360);
    n.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stOf('S1')).toBe('修正済み');
    // S2(南)を消し、東に足す
    rowBtn('S2', 'del').click();
    expect(names()).toEqual(['計測ライン', 'S1']);
    btn('[data-fix="draw"]').click();
    fm.drawLine(radial(A, 0).a, radial(A, 0).b);
    btn('[data-fix="apply"]').click();
    expect(fixEl().hidden).toBe(true);
    expect($('.ld-cur').textContent).toContain('計測ライン: ファイルのまま(修正なし)');
    expect($('.ld-cur').textContent).toContain('セクター: 修正あり(2 本。修正 1・追加 1・削除 1)');
    await flush();
    expect(maps[0].lines.filter((l) => l.kind === 'sector').map((l) => [l.label, degOf(l.line)])).toEqual([['S1', 180], ['S2', 0]]);   // プレビュー
    // もう一度開くと、直した状態から続けられる
    btn('.ld-prev-fix').click();
    expect(names()).toEqual(['計測ライン', 'S1', 'S2']);
    expect(stOf('S2')).toBe('追加');
    btn('[data-fix="apply"]').click();
    ok().click();
    await flush();
    expect(dialog()).toBeNull();
    const c = session.circuits[0];
    expect(c.sectors.map(degOf)).toEqual([180, 0]);
    expect(lineBearing(c.sectors[0])).toBeCloseTo((lineBearing(radial(A, 180)) + 3) % 360, 1);
    expect(degOf(c.control!)).toBe(90);
    expect(session.sets[0].logs[0].laps.find((l) => l.complete)!.sectorTimes.every((t) => t !== null)).toBe(true);
  });

  it('「キャンセル」では、消したセクターも元に戻る', async () => {
    await openSectors();
    rowBtn('S1', 'del').click();
    btn('[data-fix="cancel"]').click();
    await discard();
    expect($('.ld-cur').textContent).toContain('セクター: ファイルのまま(2 本)');
    btn('.ld-prev-fix').click();
    expect(names()).toEqual(['計測ライン', 'S1', 'S2']);
  });

  it('セクターの無い候補(計算した計測ライン)でも、セクターを足して登録できる', async () => {
    drop(0, [file('loop.vbo', vboText(A, false, '', [], 360))]);                     // 1 周分だけのログ(計測ラインを計算する)
    await flush(); await flush();
    expect($('.ld-cur').textContent).toContain('計算した計測ライン');
    expect($('.ld-cur').textContent).toContain('セクター: なし');
    btn('.ld-prev-mode [data-zoom="all"]').click();
    btn('.ld-prev-fix').click();
    const fm = maps.at(-1)!;
    expect(names()).toEqual(['計測ライン']);
    expect(selName()).toBe('計測ライン');
    btn('[data-fix="draw"]').click();
    fm.drawLine(radial(A, 270).a, radial(A, 270).b);
    expect(names()).toEqual(['計測ライン', 'S1']);
    btn('[data-fix="apply"]').click();
    expect($('.ld-cur').textContent).toContain('セクター: 修正あり(1 本。追加 1)');
    ok().click();
    await flush();
    expect(session.circuits[0].sectors).toHaveLength(1);
  });
});

describe('読み込みの取り消し(案件 22)', () => {
  const undoBtn = () => document.querySelector<HTMLButtonElement>('.modal.ld [data-dialog="undo"]');
  const esc = () => dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  it('読み込んだ直後の確認画面に「読み込みを取り消す」が出て、押すと、いま読み込んだログを外して閉じる', async () => {
    drop(0, [file('rc.vbo', vboText(A, true)), file('b.vbo', vboText(B, true, 'サーキットB'))]);
    await flush(); await flush();
    expect(dialog()).not.toBeNull();
    expect(undoBtn()!.hidden).toBe(false);
    expect(undoBtn()!.textContent).toBe('読み込みを取り消す');
    undoBtn()!.click();
    await flush();
    expect(dialog()).toBeNull();
    expect(session.sets[0].logs).toHaveLength(0);
    expect(session.circuits).toHaveLength(0);
    expect(session.message).toBe('読み込みを取り消しました(2 件)。');
  });

  it('前から入っていたログは残す。Esc は今までどおり「あとで」(読み込みは残る)', async () => {
    drop(0, [file('rc.vbo', vboText(A, true))]);
    await flush(); await flush();
    esc();
    await flush();
    expect(dialog()).toBeNull();
    expect(session.sets[0].logs.map((l) => l.log.fileName)).toEqual(['rc.vbo']);
    drop(0, [file('b.vbo', vboText(B, true, 'サーキットB'))]);
    await flush(); await flush();
    undoBtn()!.click();
    await flush();
    expect(session.sets[0].logs.map((l) => l.log.fileName)).toEqual(['rc.vbo']);
    expect(session.message).toBe('読み込みを取り消しました(1 件)。');
  });

  it('修正の画面を開いている間は出さない', async () => {
    drop(0, [file('rc.vbo', vboText(A, true))]);
    await flush(); await flush();
    $<HTMLButtonElement>('.ld-prev-fix').click();
    expect(undoBtn()!.hidden).toBe(true);
    $<HTMLButtonElement>('[data-fix="cancel"]').click();
    expect(undoBtn()!.hidden).toBe(false);
  });

  it('ログの枠の「ログの計測ラインで登録…」から開いたとき(前に読み込んだログ)は出さない', async () => {
    drop(0, [file('rc.vbo', vboText(A, true))]);
    await flush(); await flush();
    esc();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-act="circ-cand"]')!.click();
    await flush(); await flush();
    expect(dialog()).not.toBeNull();
    expect(undoBtn()).toBeNull();
  });
});

describe('修正の画面の、反映し忘れの確認(案件 23)', () => {
  const fixEl = () => $('.modal.ld .ld-fix');
  const confirmBox = () => document.querySelector<HTMLElement>('.modal:not(.ld)');
  const confirmBtn = (k: 'ok' | 'cancel') => document.querySelector<HTMLButtonElement>(`.modal:not(.ld) [data-dialog="${k}"]`)!;
  const escFix = () => fixEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  async function open() {
    drop(0, [file('rc.vbo', vboText(A, true, 'テストサーキット', [180]))]);
    await flush(); await flush();
    $<HTMLButtonElement>('.ld-prev-fix').click();
  }

  it('何も変えていなければ、「キャンセル」も Esc も確認なしで戻る', async () => {
    await open();
    $<HTMLButtonElement>('[data-fix="cancel"]').click();
    await flush();
    expect(confirmBox()).toBeNull();
    expect(fixEl().hidden).toBe(true);
    $<HTMLButtonElement>('.ld-prev-fix').click();
    escFix();
    await flush();
    expect(confirmBox()).toBeNull();
    expect(fixEl().hidden).toBe(true);
  });

  it('線を変えたまま「キャンセル」・Esc を押すと確かめる。「修正を続ける」と Esc は修正の画面のまま、「破棄して戻る」で戻る', async () => {
    await open();
    $<HTMLButtonElement>('[data-fix="inc"]').click();
    $<HTMLButtonElement>('[data-fix="cancel"]').click();
    await flush();
    expect(confirmBox()!.textContent).toContain('修正した内容が反映されていません');
    expect(confirmBtn('ok').textContent).toBe('破棄して戻る');
    expect(confirmBtn('cancel').textContent).toBe('修正を続ける');
    expect(document.activeElement).toBe(confirmBtn('cancel'));
    confirmBtn('cancel').click(); await flush();
    expect(confirmBox()).toBeNull();
    expect(fixEl().hidden).toBe(false);
    expect($('.ld-fix-d').textContent).toBe('+0.1°');                                     // 直した内容はそのまま
    escFix(); await flush();
    expect(confirmBox()).not.toBeNull();
    confirmBox()!.parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(confirmBox()).toBeNull();
    expect(fixEl().hidden).toBe(false);
    expect(dialog()).not.toBeNull();                                                      // 読み込みの確認画面も閉じない
    escFix(); await flush();
    confirmBtn('ok').click(); await flush();
    expect(fixEl().hidden).toBe(true);
    expect($('.ld-cur').textContent).toContain('計測ライン: ファイルのまま(修正なし)');
  });

  it('セクターを足しただけ・消しただけでも確かめる。いったん決めた内容から変えていなければ確認なし', async () => {
    await open();
    const fm = maps.at(-1)!;
    $<HTMLButtonElement>('[data-fix="draw"]').click();
    fm.drawLine({ lat: A.lat - 0.0027, lon: A.lon }, { lat: A.lat - 0.0029, lon: A.lon });
    $<HTMLButtonElement>('[data-fix="apply"]').click();                                   // 決める
    $<HTMLButtonElement>('.ld-prev-fix').click();
    $<HTMLButtonElement>('[data-fix="cancel"]').click();                                  // 決めた内容のまま → 確認なし
    await flush();
    expect(confirmBox()).toBeNull();
    expect(fixEl().hidden).toBe(true);
    $<HTMLButtonElement>('.ld-prev-fix').click();
    document.querySelector<HTMLButtonElement>('.ld-fix-row [data-fix="del"]')!.click();   // 消す
    $<HTMLButtonElement>('[data-fix="cancel"]').click();
    await flush();
    expect(confirmBox()).not.toBeNull();
    confirmBtn('ok').click(); await flush();
    expect($('.ld-cur').textContent).toContain('セクター: 修正あり(2 本。追加 1)');        // 決めた内容に戻る
  });
});
