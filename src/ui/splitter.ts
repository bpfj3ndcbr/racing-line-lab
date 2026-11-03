/**
 * 境界線(分割バー)のドラッグ・キー操作による大きさ変更。
 * - ポインタ: ドラッグで変更。ダブルクリックで初期値に戻す
 * - キー: フォーカスして矢印キーで 16px ずつ(Shift で 64px)。Home / End で最小 / 最大
 * 値(px)は「バーが動かす側のパネルの大きさ」。値が増える向きは dir で指定する。
 */
export interface SplitterOptions {
  el: HTMLElement;
  /** x = 左右に動かすバー(縦線)、y = 上下に動かすバー(横線) */
  axis: 'x' | 'y';
  /** バーを右(下)へ動かしたとき、値が増えるなら 1、減るなら -1 */
  dir: 1 | -1;
  get(): number;
  set(px: number): void;
  min(): number;
  max(): number;
  initial: number;
  /** ポインタ位置から、新しい値を求める */
  fromPointer(clientX: number, clientY: number): number;
  /** 操作が終わったとき(保存など) */
  commit?(): void;
  valueText?(px: number): string;
  /** キー操作での次の値(sign: 値が増える向きなら 1、big: Shift 押下)。省略時は 16px(Shift で 64px)刻み */
  nextValue?(current: number, sign: 1 | -1, big: boolean): number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function makeSplitter(o: SplitterOptions): { refresh(): void } {
  const { el } = o;
  let dragging = false;

  const apply = (px: number) => { o.set(clamp(Math.round(px), o.min(), o.max())); refresh(); };

  function refresh() {
    const v = o.get();
    el.setAttribute('aria-valuemin', String(Math.round(o.min())));
    el.setAttribute('aria-valuemax', String(Math.round(Math.max(o.min(), o.max()))));
    el.setAttribute('aria-valuenow', String(Math.round(v)));
    el.setAttribute('aria-valuetext', o.valueText ? o.valueText(v) : `${Math.round(v)}px`);
  }

  el.addEventListener('pointerdown', ((e: MouseEvent) => {
    dragging = true;
    document.body.classList.add('resizing', `resizing-${o.axis}`);
    try { el.setPointerCapture((e as PointerEvent).pointerId); } catch { /* 無視 */ }
    e.preventDefault();
  }) as EventListener);
  el.addEventListener('pointermove', ((e: MouseEvent) => {
    if (dragging) apply(o.fromPointer(e.clientX, e.clientY));
  }) as EventListener);
  const end = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
    o.commit?.();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { apply(o.initial); o.commit?.(); });

  el.addEventListener('keydown', (e) => {
    const [minus, plus] = o.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const step = e.shiftKey ? 64 : 16;
    let next: number;
    const move = (sign: 1 | -1) => (o.nextValue ? o.nextValue(o.get(), sign, e.shiftKey) : o.get() + sign * step);
    if (e.key === plus) next = move(o.dir);                      // バーが右(下)へ
    else if (e.key === minus) next = move((-o.dir) as 1 | -1);   // バーが左(上)へ
    else if (e.key === 'Home') next = o.dir === 1 ? o.min() : o.max();
    else if (e.key === 'End') next = o.dir === 1 ? o.max() : o.min();
    else return;
    e.preventDefault();
    e.stopPropagation();
    apply(next);
    o.commit?.();
  });

  refresh();
  return { refresh };
}
