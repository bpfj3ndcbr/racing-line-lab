/**
 * 線を少しずつ動かす操作の、共通の小さな道具(案件 39)。
 * サーキットの編集(circuitEditor)・位置補正(correctView)・読み込みの確認の計測ラインの修正(loadDialog)で使う。
 * 動かす対象は画面ごとに違う(線の端点 / 補正量 / 線全体)ので、動かす処理そのものは各画面に置く。
 */

/** 1 回の移動量の候補(m) */
export const NUDGE_STEPS = [0.1, 0.5, 1];

/** 矢印キーの名前・矢印ボタンの向き(N / S / E / W) → 向き */
const DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0],
  N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0],
};

/**
 * 矢印キー(または矢印ボタンの向き)から、動かす量 [東, 北](m)を返す。北・東が正。
 * shift なら 10 倍。矢印でなければ null
 */
export function arrowDelta(keyOrDir: string, step: number, shift = false): [number, number] | null {
  const d = DIRS[keyOrDir];
  if (!d) return null;
  const k = step * (shift ? 10 : 1);
  return [d[0] * k, d[1] * k];
}

/**
 * 文字や数値を入力している要素か(そこでの矢印キー・Space は、その要素に任せる)。
 * allowRange なら、スライダー(input type=range)は入力中とみなさない
 */
export function isTypingTarget(t: EventTarget | null, allowRange = false): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !(allowRange && (el as HTMLInputElement).type === 'range');
}

/** アプリのダイアログが開いているか(開いている間は、後ろの画面のキー操作を止める) */
export const modalOpen = (): boolean => !!document.querySelector('.modal');

/** 「1回の移動量」の切り替えボタン(act = ボタンの data-act、current = 最初に選んでおく移動量) */
export function stepSegHtml(act: string, current: number): string {
  return `<span class="seg sm" role="group" aria-label="1回の移動量">${NUDGE_STEPS.map((s) =>
    `<button data-act="${act}" data-step="${s}" aria-pressed="${s === current}" class="${s === current ? 'on' : ''}">${s} m</button>`).join('')}</span>`;
}

/** 「1回の移動量」の切り替えボタンの、選んでいる表示を step に合わせる */
export function markStep(root: ParentNode, act: string, step: number): void {
  root.querySelectorAll<HTMLElement>(`[data-act="${act}"]`).forEach((b) => {
    const on = Number(b.dataset.step) === step;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
}
