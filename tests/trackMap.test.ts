// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeafletMap, panNeeded, tileUrlTemplate } from '../src/ui/trackMap';

/** Leaflet 実体の煙試験(jsdom には画面の大きさが無いので、例外なく動くことだけを見る) */
describe('Leaflet の地図アダプタ', () => {
  // jsdom には canvas が無いので、何もしない描画コンテキストで代用する
  beforeAll(() => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : () => undefined), set: () => true });
    HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  });

  it('ライン・車両・ラベルを出し入れしても例外にならず、地理院タイルが指定されている', async () => {
    const el = document.createElement('div');
    el.style.width = '800px'; el.style.height = '600px';
    document.body.appendChild(el);
    const m = createLeafletMap(el);
    m.setTracks([{ slot: 'A', color: '#f00', points: [[33.03, 130.97], [33.04, 130.98], [33.035, 130.975]] }]);
    m.setLines([
      { label: '計測ライン', kind: 'control', line: { a: { lat: 33.0390, lon: 130.9734 }, b: { lat: 33.0384, lon: 130.9730 } } },
      { label: 'S1', kind: 'sector', line: { a: { lat: 33.0392, lon: 130.9732 }, b: { lat: 33.0386, lon: 130.9728 } } },
    ]);
    // ヒートマップ(色分け区間)・追従・ドラッグ通知も例外なく動く
    m.setTracks([{ slot: 'A', color: '#f00', points: [[33.03, 130.97], [33.04, 130.98], [33.035, 130.975]],
      heat: [{ from: 0, to: 1, color: 'rgb(255,59,48)' }, { from: 1, to: 2, color: 'rgb(46,204,113)' }] }]);
    let dragged = 0;
    m.onUserDrag(() => { dragged++; });
    expect(() => m.setCenter(33.035, 130.975)).not.toThrow();
    expect(dragged).toBe(0);
    m.setCars([{ slot: 'A', lat: 33.035, lon: 130.975, heading: 90 }, { slot: 'B', lat: 33.036, lon: 130.976, heading: 0 }]);
    m.setCars([{ slot: 'A', lat: 33.0351, lon: 130.9751, heading: 135.4 }]);      // B は消える
    expect(el.querySelectorAll('.car')).toHaveLength(1);
    expect(el.querySelector('.car')!.textContent).toBe('');                 // 文字は無い(色で区別する)
    const tri = el.querySelector<SVGElement>('.car .car-tri')!;
    expect(tri.querySelector('polygon')!.getAttribute('points')).toBe('8,1 15,15 1,15');   // 三角形
    expect(tri.getAttribute('width')).toBe('16');                               // 小さい
    expect(tri.style.transform).toBe('rotate(135deg)');                         // 進行方向へ向く
    expect(el.querySelectorAll('.map-label')).toHaveLength(2);
    expect(el.querySelector('.leaflet-control-attribution')!.textContent).toContain('地理院タイル');
    expect(() => { m.fit(); m.invalidate(); }).not.toThrow();
    m.setTracks([]);
    await new Promise((r) => setTimeout(r, 50));     // Leaflet の再描画(次フレーム)が済んでから片付ける
    m.destroy();
  });

  it('再生中に向きとラベルが同じなら、三角形・引き出し線・文字を書き直さない(案件 36)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const m = createLeafletMap(el);
    const car = { slot: 'A' as const, lat: 33.035, lon: 130.975, heading: 90.2, label: '120kph' };
    m.setCars([car]);
    const watched = [el.querySelector('.car-tri')!, el.querySelector('.lbl-line line')!, el.querySelector('.lbl-txt')!];
    expect(watched.every(Boolean)).toBe(true);
    const mo = new MutationObserver(() => {});
    for (const w of watched) mo.observe(w, { attributes: true, characterData: true, childList: true, subtree: true });
    m.setCars([{ ...car, lat: 33.0351, heading: 89.8 }]);       // 位置は動いたが、向き(整数)とラベルは同じ
    expect(mo.takeRecords()).toHaveLength(0);
    m.setCars([{ ...car, heading: 180, label: '121kph' }]);      // 向きとラベルが変われば書く
    expect(mo.takeRecords().length).toBeGreaterThan(0);
    mo.disconnect();
    m.destroy();
  });
});

describe('追従で地図を動かすかどうか(案件 36)', () => {
  it('Leaflet と同じく、ずれを整数に切り捨てて 0 なら動かさない', () => {
    expect(panNeeded(0, 0)).toBe(false);
    expect(panNeeded(0.9, -0.9)).toBe(false);
    expect(panNeeded(1, 0)).toBe(true);
    expect(panNeeded(0, -1.2)).toBe(true);
  });
});

describe('地図のキーボード', () => {
  it('Leaflet の矢印キー・+/- 操作は無効(キーは再生の操作に使う)', () => {
    const el = document.createElement('div');
    el.style.width = '400px'; el.style.height = '300px';
    document.body.appendChild(el);
    const m = createLeafletMap(el);
    expect(el.getAttribute('tabindex')).toBeNull();          // 有効だと Leaflet が tabindex=0 を付ける
    m.destroy();
  });

  it('地図の画像の取得先: デスクトップ版で窓口に tileUrl があればメイン側(案件 2)、無ければ地理院', () => {
    const gsi = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
    expect(tileUrlTemplate(undefined)).toBe(gsi);
    expect(tileUrlTemplate({})).toBe(gsi);
    expect(tileUrlTemplate({ tileUrl: 'rll-tile://tile/{z}/{x}/{y}.jpg' })).toBe('rll-tile://tile/{z}/{x}/{y}.jpg');
  });
});
