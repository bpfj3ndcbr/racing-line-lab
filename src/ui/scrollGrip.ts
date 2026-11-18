/**
 * 画面のスクロールのつまみ(案件 79。スマホの縦画面の「比較」で使う)。
 *
 * 比較の地図と速度グラフは指の動きを自分で受け取るので、縦画面ではなぞっても画面がスクロールしない。
 * 再生の操作の行の右端につまみを置き、押さえたまま上下に動かした分だけ、画面をスクロールする。
 *
 * - 指を下へ動かすと、ページは上へ戻る(画面をなぞるときと同じ向き)。押さえた位置からの指の移動量と同じだけ(倍率は掛けない)。
 * - つまみはページ(背景)に付いたままにする。ページが動けば一緒に動くので、限りまでスクロールしたあとは、指だけが先へ動いて、つまみは離れない。
 */
import { scrollerOf } from './longPressScroll';

/** つまみの印(長押しスクロールの受け付けから外すのにも使う) */
export const SCROLL_GRIP_CLASS = 'scroll-grip';

export function installScrollGrip(grip: HTMLElement): () => void {
  let id: number | null = null;
  let startY = 0, scroller: Element | null = null, startTop = 0;

  const down = (e: PointerEvent) => {
    if (id !== null) return;
    id = e.pointerId;
    startY = e.clientY;
    scroller = scrollerOf(grip);
    startTop = scroller.scrollTop;
    try { grip.setPointerCapture(id); } catch { /* 無い環境(試験など) */ }
    grip.classList.add('on');
    e.preventDefault();
    e.stopPropagation();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id || !scroller) return;
    scroller.scrollTop = startTop + (startY - e.clientY);      // 押さえた位置からの移動量で決める(限りを超えた分は、戻すときに取り戻す)
    e.preventDefault();
    e.stopPropagation();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    scroller = null;
    grip.classList.remove('on');
  };
  grip.addEventListener('pointerdown', down);
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
  return () => {
    grip.removeEventListener('pointerdown', down);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
  };
}
