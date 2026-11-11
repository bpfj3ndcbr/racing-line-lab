/**
 * 長押ししてから縦になぞると、画面をスクロールする(案件 44。比較画面で使う)。
 *
 * 比較画面の地図と速度グラフは指の動きを自分で受け取る(touch-action:none)ので、なぞっても画面がスクロールしない。
 * スマホではこれらが画面の大半を占めるため、次のルールでスクロールできるようにする。
 *
 * - 指を HOLD_MS の間、MOVE_PX 以内で止めておく(長押し)と、合図を出す(画面の縁に色の線。震わせられる端末は短く震わせる)。
 * - そのあと MOVE_PX を超えて動いたとき、縦の動きが横より大きければ、それ以降の指の動きを画面の縦のスクロールにする。
 *   横なら何もしない(地図の移動・グラフのインジケータの移動など、今までどおり)。
 * - 長押しせずにすぐなぞったときも、今までどおり。
 * - マウス・ペンは対象外。2 本目の指が触れたら取りやめる(拡大・縮小は地図・グラフの側)。
 * - スクロールを始めたら、触れた要素に LONG_PRESS_SCROLL_EVENT を送る(グラフは、触れた瞬間に動かした再生位置を戻す)。
 */

/** スクロールを始めたときに、触れた要素へ送るイベント(bubbles) */
export const LONG_PRESS_SCROLL_EVENT = 'rll-longpress-scroll';

export const HOLD_MS = 400;
export const MOVE_PX = 10;

/** el から上へたどって、縦にスクロールできる要素を探す。無ければ文書全体 */
function scrollerOf(el: Element): Element {
  const doc = el.ownerDocument;
  for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return doc.scrollingElement ?? doc.documentElement;
}

/** root の中で、長押しのあと縦になぞる操作を、画面のスクロールにする。戻り値は受け付けをやめる関数 */
export function installLongPressScroll(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  type Press = { id: number; x: number; y: number; lastY: number; target: Element; timer: number; held: boolean; scrolling: boolean; scroller?: Element; ring?: HTMLElement };
  let press: Press | null = null;
  const fingers = new Set<number>();

  const removeRing = (p: Press) => { p.ring?.remove(); p.ring = undefined; };
  const finish = () => {
    if (!press) return;
    win.clearTimeout(press.timer);
    removeRing(press);
    press = null;
  };
  const hold = () => {
    const p = press;
    if (!p) return;
    p.held = true;
    p.ring = doc.createElement('div');
    p.ring.className = 'lp-ring';
    p.ring.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(p.ring);
    try { win.navigator.vibrate?.(15); } catch { /* 震わせられない端末 */ }
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    fingers.add(e.pointerId);
    if (fingers.size > 1) { finish(); return; }                  // 2 本の指は地図・グラフの側に任せる
    const t = e.target as Element | null;
    if (!t) return;
    finish();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, target: t, timer: 0, held: false, scrolling: false };
    press.timer = win.setTimeout(hold, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    if (!p.scrolling) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (Math.hypot(dx, dy) <= MOVE_PX) return;
      if (!p.held || Math.abs(dy) <= Math.abs(dx)) { finish(); return; }   // すぐなぞった・横に動いた: 今までどおり
      p.scrolling = true;
      p.scroller = scrollerOf(p.target);
      p.target.dispatchEvent(new Event(LONG_PRESS_SCROLL_EVENT, { bubbles: true }));
    }
    e.stopPropagation();                                           // 地図・グラフには渡さない
    p.scroller?.scrollBy(0, p.lastY - e.clientY);
    p.lastY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    if (press && e.pointerId === press.id) finish();
  };
  // Leaflet は指の操作を touch イベントで受け取るので、スクロールの間は地図へ渡さない
  const onTouchMove = (e: TouchEvent) => {
    if (!press?.scrolling) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };
  // 長押しで出るメニュー(地図の画像の保存など)を出さない
  const onContext = (e: Event) => { if (press) e.preventDefault(); };

  const opt = { capture: true };
  const touchOpt = { capture: true, passive: false };
  root.addEventListener('pointerdown', onDown, opt);
  root.addEventListener('pointermove', onMove, opt);
  root.addEventListener('pointerup', onUp, opt);
  root.addEventListener('pointercancel', onUp, opt);
  root.addEventListener('touchmove', onTouchMove, touchOpt);
  root.addEventListener('contextmenu', onContext, opt);
  return () => {
    finish();
    root.removeEventListener('pointerdown', onDown, opt);
    root.removeEventListener('pointermove', onMove, opt);
    root.removeEventListener('pointerup', onUp, opt);
    root.removeEventListener('pointercancel', onUp, opt);
    root.removeEventListener('touchmove', onTouchMove, touchOpt);
    root.removeEventListener('contextmenu', onContext, opt);
  };
}
