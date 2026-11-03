import { SLOTS, detectLaps, findCrossings, formatLapTime, metersPerDegree } from '../core';
import type { LoadedLog, Session } from '../store/session';
import type { MapFactory, TrackMap } from './mapTypes';
import type { ThemeController } from './theme';

export interface CorrectDeps {
  mapFactory: MapFactory;
  theme?: ThemeController;
  /** 適用・キャンセルのあと(データ管理画面へ戻る) */
  onDone: () => void;
}
export interface CorrectView { show(logId: string, set?: number): void; hide(): void }

const STEPS = [0.1, 0.5, 1];
/** 地図に出す点の数の目安(長いログでも軽く動かせるように間引く) */
const MAX_POINTS = 4000;
const PREVIEW_DELAY_MS = 250;
const round2 = (v: number) => Math.round(v * 100) / 100;
const fmtM = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);

/**
 * 位置補正の画面(Run ごと)。
 * 地図の上でドラッグするとラインが動く / 矢印キーで微調整 / 数値でも入力できる。
 * 「適用して保存」で補正量を保存し、ラップ・セクターを検出し直す。
 */
export function mountCorrectView(root: HTMLElement, session: Session, deps: CorrectDeps): CorrectView {
  root.innerHTML = `
    <div class="corr">
      <div class="corr-map-wrap">
        <div class="map" id="cor-map"></div>
        <div class="map-ov tl">
          <span class="seg sm" role="group" aria-label="地図の上のドラッグ">
            <button data-act="cor-mode" data-mode="line" aria-pressed="true" class="on" title="ドラッグでラインを動かします">ラインを動かす</button>
            <button data-act="cor-mode" data-mode="map" aria-pressed="false" title="ドラッグで地図を動かします">地図を動かす</button>
          </span>
        </div>
      </div>
      <aside class="corr-side" aria-label="位置補正">
        <div class="h" id="cor-title">位置補正</div>
        <div class="sub" id="cor-file"></div>
        <div class="sub">地図の上をドラッグするとラインが動きます。矢印キーで微調整(Shift で 10 倍)。</div>
        <div class="corr-fields">
          <label class="frow2"><span>東へ</span><input id="cor-east" type="number" step="0.1" aria-label="東への補正量(メートル)"><span>m</span></label>
          <label class="frow2"><span>北へ</span><input id="cor-north" type="number" step="0.1" aria-label="北への補正量(メートル)"><span>m</span></label>
        </div>
        <div class="corr-pad" role="group" aria-label="矢印で動かす">
          <button class="ib" data-act="nudge" data-dir="N" aria-label="北へ" title="北へ [↑]">↑</button>
          <button class="ib" data-act="nudge" data-dir="W" aria-label="西へ" title="西へ [←]">←</button>
          <button class="ib" data-act="nudge" data-dir="E" aria-label="東へ" title="東へ [→]">→</button>
          <button class="ib" data-act="nudge" data-dir="S" aria-label="南へ" title="南へ [↓]">↓</button>
        </div>
        <div class="corr-step"><span class="sub">1回の移動量</span>
          <span class="seg sm" role="group" aria-label="1回の移動量">${STEPS.map((s) =>
            `<button data-act="cor-step" data-step="${s}" aria-pressed="${s === 0.5}" class="${s === 0.5 ? 'on' : ''}">${s} m</button>`).join('')}</span>
        </div>
        <div class="corr-laps" id="cor-laps" role="status"></div>
        <div class="sub" id="cor-note"></div>
        <div class="corr-actions">
          <button class="btn pri" id="cor-apply" data-act="cor-apply">適用して保存</button>
          <button class="btn" id="cor-revert" data-act="cor-revert" title="開いたときの補正量に戻します">元に戻す</button>
          <button class="btn" id="cor-zero" data-act="cor-zero" title="補正なし(0, 0)にします">補正なしにする</button>
          <button class="btn" id="cor-cancel" data-act="cor-cancel">キャンセル</button>
        </div>
      </aside>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  let map: TrackMap | null = null;
  let visible = false;
  let log: LoadedLog | null = null;
  let saved = { east: 0, north: 0 };
  let draft = { east: 0, north: 0 };
  let step = 0.5;
  let mode: 'line' | 'map' = 'line';
  let base: { lat: Float64Array; lon: Float64Array } | null = null;
  let mPer = metersPerDegree(33);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4aa3ff';

  function pushTrack() {
    if (!map || !base) return;
    const dLat = draft.north / mPer.lat, dLon = draft.east / mPer.lon;
    const pts = Array.from(base.lat, (la, i) => [la + dLat, base!.lon[i] + dLon] as [number, number]);
    map.setTracks([{ slot: 'A', color: accent(), points: pts }]);
  }

  function pushLines() {
    const c = log?.circuit;
    map?.setLines(c ? [
      { label: '計測ライン', line: c.control, kind: 'control' as const },
      ...c.sectors.map((line, i) => ({ label: `S${i + 1}`, line, kind: 'sector' as const })),
    ] : []);
  }

  /** 補正量が変わったときの更新(地図・数値・ラップの見込み) */
  function changed() {
    draft = { east: round2(draft.east), north: round2(draft.north) };
    const e = $<HTMLInputElement>('cor-east'), n = $<HTMLInputElement>('cor-north');
    if (document.activeElement !== e) e.value = String(draft.east);
    if (document.activeElement !== n) n.value = String(draft.north);
    pushTrack();
    $('cor-laps').textContent = log?.circuit ? '周回を確認中…' : 'サーキットが未判定のため、ラップの見込みは出せません。';
    if (timer) clearTimeout(timer);
    if (log?.circuit) timer = setTimeout(previewLaps, PREVIEW_DELAY_MS);
  }

  /** この補正量でコントロールラインを通ったときの、ラップ数とベスト(保存はしない) */
  function previewLaps() {
    timer = null;
    const c = log?.circuit;
    if (!log || !c) return;
    if (!findCrossings(log.log, c.control, { offset: draft }).length) {
      $('cor-laps').textContent = 'この補正量では、コントロールラインを通過しません。';
      return;
    }
    const all = detectLaps(log.log, c.control, c.sectors, { offset: draft });
    const laps = all.filter((l) => l.complete);
    $('cor-laps').textContent = laps.length
      ? `この補正量では ${laps.length} ラップ ・ ベスト ${formatLapTime(Math.min(...laps.map((l) => l.duration)))}`
      : `この補正量では、完了したラップはありません(参考値 ${all.length} 件)。`;
  }

  const nudge = (dEast: number, dNorth: number) => { draft = { east: draft.east + dEast, north: draft.north + dNorth }; changed(); };
  const setMode = (m: 'line' | 'map') => {
    mode = m;
    root.querySelectorAll<HTMLElement>('[data-act="cor-mode"]').forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    map?.setEditDrag(m === 'line' ? (dLat, dLon) => nudge(dLon * mPer.lon, dLat * mPer.lat) : null);
  };
  const setStep = (s: number) => {
    step = s;
    root.querySelectorAll<HTMLElement>('[data-act="cor-step"]').forEach((b) => {
      const on = Number(b.dataset.step) === s;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  };
  const dirDelta = (dir: string, k = 1): [number, number] =>
    dir === 'N' ? [0, step * k] : dir === 'S' ? [0, -step * k] : dir === 'E' ? [step * k, 0] : [-step * k, 0];

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'cor-mode': setMode(d.mode as 'line' | 'map'); break;
      case 'cor-step': setStep(Number(d.step)); break;
      case 'nudge': { const [x, y] = dirDelta(d.dir!); nudge(x, y); break; }
      case 'cor-zero': draft = { east: 0, north: 0 }; changed(); break;
      case 'cor-revert': draft = { ...saved }; changed(); break;
      case 'cor-cancel': deps.onDone(); break;
      case 'cor-apply':
        if (log) session.setOffset(log.id, { ...draft });
        deps.onDone();
        break;
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'cor-east' && t.id !== 'cor-north') return;
    const v = Number(t.value);
    if (t.value === '' || !Number.isFinite(v) || Math.abs(v) > 1000) return;
    if (t.id === 'cor-east') draft = { ...draft, east: v }; else draft = { ...draft, north: v };
    changed();
  });

  /** 矢印キー: 北・東が正。Shift で 10 倍。数値欄・ダイアログの操作は邪魔しない */
  const onKey = (e: KeyboardEvent) => {
    if (!visible || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.modal')) return;
    const dir = ({ ArrowUp: 'N', ArrowDown: 'S', ArrowRight: 'E', ArrowLeft: 'W' } as Record<string, string>)[e.key];
    if (!dir) return;
    e.preventDefault();
    const [x, y] = dirDelta(dir, e.shiftKey ? 10 : 1);
    nudge(x, y);
  };

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (visible) map?.invalidate(); }).observe($('cor-map'));
  }
  deps.theme?.subscribe(() => { if (visible) pushTrack(); });

  return {
    show(logId: string, set?: number) {
      const w = session.sets[set ?? session.activeIndex] ?? session.active;
      const l = w.logs.find((x) => x.id === logId);
      if (!l) { deps.onDone(); return; }
      log = l;
      visible = true;
      document.addEventListener('keydown', onKey);
      saved = { ...l.offset };
      draft = { ...l.offset };
      // 地図に出す点(間引く)。補正量は、あとから足して動かす
      const n = l.log.t.length, every = Math.max(1, Math.ceil(n / MAX_POINTS));
      const idx = Array.from({ length: Math.ceil(n / every) }, (_, i) => i * every);
      base = { lat: Float64Array.from(idx, (i) => l.log.lat[i]), lon: Float64Array.from(idx, (i) => l.log.lon[i]) };
      mPer = metersPerDegree(l.log.lat[Math.floor(n / 2)] ?? 33);
      $('cor-title').textContent = `Run ${l.no} の位置補正`;
      $('cor-file').textContent = l.log.fileName;
      const assigned = SLOTS.some((s) => w.assignment[s]?.logId === l.id);
      $('cor-note').textContent = assigned ? '※ 適用すると、この Run の A〜D への割り当ては解除されます(ラップを検出し直すため)。' : '';
      map ??= deps.mapFactory($('cor-map'));
      setMode('line');
      setStep(0.5);
      pushLines();
      changed();
      map.invalidate();
      map.fit();
    },
    hide() {
      visible = false;
      document.removeEventListener('keydown', onKey);
      if (timer) { clearTimeout(timer); timer = null; }
      map?.setEditDrag(null);
    },
  };
}
