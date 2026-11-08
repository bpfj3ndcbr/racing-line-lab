import { type Lap, type PreviewPick, type PreviewRange, type Slot, SLOTS, detectLaps, findCrossings, formatLapTime, matchLap, metersPerDegree, pickPreviewRanges } from '../core';
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
/** 地図に出す点の数の上限(描く区間が長いときだけ間引く) */
const MAX_POINTS = 20000;
const PREVIEW_DELAY_MS = 250;
/** 最初にチェックを付けるラップの数(カードに割り当て中のラップが無いとき、ベストから) */
const DEFAULT_PICK = 3;
const round2 = (v: number) => Math.round(v * 100) / 100;
const fmtM = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);

/**
 * 位置補正の画面(Run ごと)。
 * 地図の上でドラッグするとラインが動く(「ラインを動かす」のとき)/ 矢印キーで微調整 / 数値でも入力できる。
 * 地図に出すラップは、右の欄の一覧のチェックで選ぶ(案件 19。最初は、カードに割り当て中のラップ、無ければベスト 3、完了ラップも無ければ参考値のラップ)。
 * 「適用して保存」で補正量を保存し、ラップ・セクターを検出し直す。割り当ては、同じラップが見つかれば残る。
 */
/** 地図に何を描いているかの説明 */
function shownText(p: PreviewPick): string {
  if (p.kind === 'laps') return `表示中: ベスト ${p.laps.length} ラップ(LAP ${p.laps.join('・')})`;
  if (p.kind === 'moving') {
    const min = Math.max(1, Math.round(p.seconds / 60));
    // 10 分(既定の上限)に届けば先頭の 10 分、届かなければ走行中の全部
    return `表示中: 走行中(30 km/h 以上)の${p.seconds >= 590 ? '最初の' : ''}約 ${min} 分(ラップが無いため)`;
  }
  return '表示中: 走行ログ全体';
}

export function mountCorrectView(root: HTMLElement, session: Session, deps: CorrectDeps): CorrectView {
  root.innerHTML = `
    <div class="corr">
      <div class="corr-map-wrap">
        <div class="map" id="cor-map"></div>
        <div class="map-ov tl">
          <span class="seg sm" role="group" aria-label="地図の上のドラッグ">
            <button data-act="cor-mode" data-mode="line" aria-pressed="false" title="ドラッグでラインを動かします">ラインを動かす</button>
            <button data-act="cor-mode" data-mode="map" aria-pressed="true" class="on" title="ドラッグで地図を動かします">地図を動かす</button>
          </span>
        </div>
      </div>
      <aside class="corr-side" aria-label="位置補正">
        <div class="h" id="cor-title">位置補正</div>
        <div class="sub" id="cor-file"></div>
        <div class="sub" id="cor-shown"></div>
        <div class="corr-pick" id="cor-pick" hidden>
          <div class="corr-pick-h"><b id="cor-pick-count"></b>
            <button type="button" class="btn" data-act="cor-pick-all">すべて選ぶ</button><button type="button" class="btn" data-act="cor-pick-none">すべて外す</button></div>
          <div class="corr-pick-list" id="cor-pick-list" role="group" aria-label="地図に出すラップ"></div>
        </div>
        <div class="sub">「ラインを動かす」にすると、地図の上のドラッグでラインが動きます。矢印キーで微調整(Shift で 10 倍)。</div>
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
  /** 地図に描く区間ごとの点(補正なし)。区間ごとに別の線にする */
  let base: { lat: Float64Array; lon: Float64Array }[] = [];
  let mPer = metersPerDegree(33);
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 開いたときのラップ(一覧はこれで固定し、補正量を動かしても変えない) */
  let laps: Lap[] = [];
  /** 地図に出すラップ(番号) */
  let checked = new Set<number>();
  /** 開いた比較セットで、この Run のラップを割り当てているカード(ラップ番号 → カード) */
  let slotOfLap = new Map<number, Slot>();

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4aa3ff';

  function pushTrack() {
    if (!map) return;
    const dLat = draft.north / mPer.lat, dLon = draft.east / mPer.lon, color = accent();
    map.setTracks(base.map((b) => ({
      slot: 'A' as const, color,
      points: Array.from(b.lat, (la, i) => [la + dLat, b.lon[i] + dLon] as [number, number]),
    })));
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
    const crosses = findCrossings(log.log, c.control, { offset: draft }).length > 0;
    const all = crosses ? detectLaps(log.log, c.control, c.sectors, { offset: draft }) : [];
    const done = all.filter((l) => l.complete);
    const head = !crosses ? 'この補正量では、コントロールラインを通過しません。'
      : done.length ? `この補正量では ${done.length} ラップ ・ ベスト ${formatLapTime(Math.min(...done.map((l) => l.duration)))}`
        : `この補正量では、完了したラップはありません(参考値 ${all.length} 件)。`;
    // 割り当て中のラップが、この補正量でも見つかるか(見つからなければ、適用すると解除される)
    const lost = [...slotOfLap].filter(([n]) => { const lap = laps.find((x) => x.number === n); return !lap || !matchLap(lap, all, log?.log.loop?.period); })
      .map(([n, slot]) => `${slot}(LAP ${n})`);
    $('cor-laps').textContent = head;
    if (lost.length) {
      const w = document.createElement('div');
      w.className = 'corr-lost';
      w.textContent = `この補正量では ${lost.join('、')} のラップが見つかりません。適用すると、その割り当てを解除します。`;
      $('cor-laps').appendChild(w);
    }
  }

  /** 地図に描く区間(補正なしの点)を作り直す。点が多いときは、全体で MAX_POINTS 点ほどに間引く */
  function buildBase() {
    if (!log) return;
    const l = log, n = l.log.t.length;
    const ranges: PreviewRange[] = laps.length
      ? laps.filter((x) => checked.has(x.number)).map((x) => ({ from: x.startIndex, to: Math.min(n - 1, x.endIndex + 1) }))   // endIndex は終点の直前のサンプルなので 1 つ先まで
      : pickPreviewRanges(l.log, l.laps).ranges;
    const total = ranges.reduce((s, r) => s + r.to - r.from + 1, 0);
    const every = Math.max(1, Math.ceil(total / MAX_POINTS));
    base = ranges.map((r) => {
      const idx: number[] = [];
      for (let i = r.from; i < r.to; i += every) idx.push(i);
      idx.push(r.to);
      return { lat: Float64Array.from(idx, (i) => l.log.lat[i]), lon: Float64Array.from(idx, (i) => l.log.lon[i]) };
    });
  }
  /** ラップの一覧(チェックボックス・LAP・タイム・割り当て中のカード) */
  function renderPick() {
    const best = Math.min(...laps.filter((x) => x.complete).map((x) => x.duration));
    $('cor-pick-list').innerHTML = laps.map((x) => {
      const slot = slotOfLap.get(x.number);
      const ex = !x.complete || x.duration > best * 1.2;
      return `<label class="corr-pick-row${ex ? ' ex' : ''}"><input type="checkbox" data-pick="${x.number}"${checked.has(x.number) ? ' checked' : ''}>
        <span>LAP ${x.number}</span><span class="num">${formatLapTime(x.duration)}${x.complete ? '' : '(参考値)'}</span>
        <span class="corr-pick-slot">${slot ? `<i class="s${slot.toLowerCase()}" title="カード ${slot} に割り当て中">${slot}</i>` : ''}</span></label>`;
    }).join('');
    updatePickCount();
  }
  function updatePickCount() { $('cor-pick-count').textContent = `地図に出すラップ ${checked.size} / ${laps.length}`; }
  /** チェックを変えたとき: 地図だけ描き直す(表示位置は変えない) */
  function pickChanged() { updatePickCount(); buildBase(); pushTrack(); }

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
      case 'cor-pick-all': case 'cor-pick-none':
        checked = new Set(d.act === 'cor-pick-all' ? laps.map((x) => x.number) : []);
        root.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((c) => { c.checked = checked.has(Number(c.dataset.pick)); });
        pickChanged();
        break;
      case 'cor-apply':
        if (log) session.setOffset(log.id, { ...draft });
        deps.onDone();
        break;
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-pick]')) return;
    const no = Number(t.dataset.pick);
    if (t.checked) checked.add(no); else checked.delete(no);
    pickChanged();
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
      // 地図に出すラップは、一覧のチェックで選ぶ(開いたときのラップで、操作中は替えない)。
      // 最初は、カードに割り当て中のラップ、無ければベスト 3。ラップが無いログは、今までどおり走行中の区間などを出す
      laps = l.laps;
      slotOfLap = new Map(SLOTS.flatMap((s) => { const r = w.assignment[s]; return r?.logId === l.id ? [[r.lap, s] as [number, Slot]] : []; }));
      const best = laps.filter((x) => x.complete).sort((a, b) => a.duration - b.duration).slice(0, DEFAULT_PICK).map((x) => x.number);
      checked = new Set(slotOfLap.size ? [...slotOfLap.keys()].filter((n) => laps.some((x) => x.number === n))
        : best.length ? best : laps.map((x) => x.number));                         // 完了ラップが無ければ、参考値のラップ
      $('cor-pick').hidden = !laps.length;
      $('cor-shown').hidden = !!laps.length;
      if (laps.length) renderPick();
      else $('cor-shown').textContent = shownText(pickPreviewRanges(l.log, l.laps));
      buildBase();
      const n = l.log.t.length;
      mPer = metersPerDegree(l.log.lat[Math.floor(n / 2)] ?? 33);
      $('cor-title').textContent = `Run ${l.no} の位置補正`;
      $('cor-file').textContent = l.log.fileName;
      $('cor-note').textContent = slotOfLap.size ? '適用しても、補正の前と同じラップが見つかれば、A〜D の割り当てはそのまま残ります。' : '';
      map ??= deps.mapFactory($('cor-map'));
      setMode('map');                                        // 最初は地図を動かせる状態(ラインを動かすときは切り替える)
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
