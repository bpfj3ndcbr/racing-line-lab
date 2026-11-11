/**
 * 地図の上の「1 本の指(またはマウスの左ボタン)でなぞる」操作を受け取る(案件 29)。
 * ラインを引く・位置補正でラインを動かす操作に使う。Leaflet には依存しない(テストのため)。
 *
 * - マウス・指・ペンを、pointer イベントでまとめて扱う(指ではマウスのイベントが出ないため)。
 * - なぞっている途中に 2 本目の指が触れたら、なぞるのをやめる(cancel)。そのあとは、すべての指が
 *   離れるまで、なぞる操作を始めない(2 本の指での拡大・縮小は、地図の側に任せる)。
 * - つまみ(マーカー)と、拡大・縮小のボタンなどの上で押したときは、なぞる操作にしない。
 */
export interface SinglePointerHandlers {
  /** いま、なぞる操作を受け付けるか */
  enabled(): boolean;
  start(e: PointerEvent): void;
  move(e: PointerEvent): void;
  /** 指・ボタンを離した(なぞる操作の完了) */
  end(e: PointerEvent): void;
  /** 2 本目の指が触れた・ブラウザが操作を取り消した(なぞる操作の取り消し) */
  cancel(): void;
}

/** なぞる操作にしない場所(つまみ・地図の上のボタンなど) */
const IGNORE = '.leaflet-marker-icon, .leaflet-control';

/** el の上の、1 本の指(マウスは左ボタン)でなぞる操作を受け取る。戻り値は受け取りをやめる関数 */
export function attachSinglePointer(el: HTMLElement, h: SinglePointerHandlers): () => void {
  const down = new Set<number>();     // いま触れている指(マウス・ペンも含む)
  let active: number | null = null;   // なぞっている指
  let blocked = false;                // 2 本の指の操作のあと、すべての指が離れるまで始めない

  const stop = (cancel: boolean, e?: PointerEvent) => {
    active = null;
    if (cancel || !e) h.cancel(); else h.end(e);
  };
  const onDown = (e: PointerEvent) => {
    down.add(e.pointerId);
    if (down.size > 1) {
      blocked = true;
      if (active !== null) stop(true);
      return;
    }
    if (blocked || !h.enabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element | null)?.closest?.(IGNORE)) return;
    active = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    h.start(e);
  };
  const onMove = (e: PointerEvent) => { if (e.pointerId === active) h.move(e); };
  const onUp = (e: PointerEvent, cancel: boolean) => {
    down.delete(e.pointerId);
    if (e.pointerId === active) stop(cancel || !h.enabled(), e);
    if (!down.size) blocked = false;
  };
  const up = (e: PointerEvent) => onUp(e, false);
  const cancel = (e: PointerEvent) => onUp(e, true);

  // 捕捉の段階で受け取る(Leaflet が伝わりを止めても、指の数を数え違えないように)
  el.addEventListener('pointerdown', onDown, true);
  el.addEventListener('pointermove', onMove, true);
  el.addEventListener('pointerup', up, true);
  el.addEventListener('pointercancel', cancel, true);
  return () => {
    el.removeEventListener('pointerdown', onDown, true);
    el.removeEventListener('pointermove', onMove, true);
    el.removeEventListener('pointerup', up, true);
    el.removeEventListener('pointercancel', cancel, true);
  };
}

/** 画面の上の矩形(getBoundingClientRect の値のうち、判定に使うものだけ) */
export interface ScreenRect { left: number; top: number; right: number; bottom: number }

/**
 * 点 (x, y) が、どれかの矩形から margin px 以内にあるか(案件 43)。
 * 大きさが 0 の矩形(隠れている要素)は数えない
 */
export function nearAnyRect(x: number, y: number, rects: readonly ScreenRect[], margin: number): boolean {
  return rects.some((r) => {
    if (r.right <= r.left || r.bottom <= r.top) return false;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy) <= margin;
  });
}
