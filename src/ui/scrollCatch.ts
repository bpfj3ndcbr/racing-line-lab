/**
 * スクロールの「引っかかり」(案件 74 のあと)。
 * 比較セットの中の、決めた 1 か所(設定の行と Run の一覧の境目)を、一気に(速く)越えようとしたら、そこで止める。
 * ゆっくり動かしたときは、止めない(そのまま越える)。
 * 止めたあとは、タッチし直す(スクロールの動きがいったん止まって、次の操作を始める)まで、そこから動かさない。
 *
 * ホイール・トラックパッド・指のスクロールのどれでも効くように、動かないようにするのではなく、スクロールしたあとの位置を見て、
 * 境目を越えていたら境目へ戻す(スクロールのイベントは、描画の前に届く)。
 * Chrome は、ホイールの動きが続いている間、2 回目以降のイベントを止められない(cancelable が false)ので、wheel の preventDefault には頼らない。
 *
 * - 速さが CATCH_SPEED(px/ms)以上で境目を越えたら、境目へ戻して止める。速さは、直前のスクロールのイベントからの動きで測る
 *   (動きの最初のイベントは、1 コマ(16ms)の動きとして測る)。
 * - トラックパッドの慣性で動いているとき(ホイールの量が、続けて減っていくとき)は、ゆっくりでも、境目で止める。
 * - 止めている間は、触れたまま・慣性で、どちらへ動かしても、止めた位置へ戻す。位置は、止めた時のものに固定する
 *   (上に固定している行の高さが変わっても、動かない)。
 * - スクロールの動きが止まって CATCH_IDLE_MS たつと、1 回の操作が終わったと見なす。そのあとの操作は、そのまま動く。
 * - 止めている間は、ホイール・タッチの入力が続く限り、止めた状態を保つ(動きが小さくて、スクロールのイベントにならないものも含む)。
 *   ただし、ホイールの量が増えた(慣性は減っていくので、新しく触れて動かし始めた)・逆向きになったときは、新しい操作として、止めた状態をやめる。
 *   止めている間は、画面の操作(マウスを乗せた色の変化・クリック)を受け付けない(onHold で知らせる)。
 * - 人の操作(ホイール・タッチ・キー)のあとのスクロールだけが対象。プログラムが動かすスクロール(スクロールして見せる・タブの切り替え)は止めない。
 */

/** スクロールの動きが止まって、1 回の操作が終わったと見なすまでの時間(ミリ秒) */
export const CATCH_IDLE_MS = 160;
/** 慣性と見なす、ホイールの量が続けて減っている回数 */
export const INERTIA_RUN = 5;
/** この速さ(px/ms)以上で境目を越えようとしたときだけ止める。ゆっくり動かしたときは止めない。16ms の 1 コマで 12px 以上動く速さ */
export const CATCH_SPEED = 0.75;

export interface CatchHost {
  getY(): number;
  setY(y: number): void;
  /** 境目のスクロール量。境目が無いとき(タブにしていない・隠れている)は null */
  pin(): number | null;
  /** 止めた(true)/ 止めるのをやめた(false)ときに知らせる(止めている間、画面の操作を受け付けないようにするために使う) */
  onHold?(held: boolean): void;
}

export interface ScrollCatch {
  /** スクロールのイベントを受ける */
  onScroll(): void;
  /** 人の操作があった(この先 ms ミリ秒のスクロールを、人の操作によるものと見なす) */
  noteInput(ms: number): void;
  /** ホイールの縦の量(下向きが正)を受ける。止めている間に、新しい操作(量が増えた・逆向き)が始まったら、止めた状態をやめる */
  noteWheel(dy: number): void;
  /** プログラムが位置を変えたあとに呼ぶ(いまの位置を基準にして、止めている状態をやめる) */
  sync(): void;
  reset(): void;
}

export function createScrollCatch(host: CatchHost): ScrollCatch {
  let lastY = host.getY();
  let heldAt: number | null = null;                // 止めている位置(止めた時に固定する)
  let userUntil = -Infinity;
  let lastT: number | null = null;                 // 直前のスクロールのイベントの時刻
  let lastWheel = 0;                               // 直前のホイールの量(符号つき)
  let lastWheelT: number | null = null;            // 直前のホイールの時刻
  let runLen = 0, runStart = 0;                    // ホイールの量が続けて減っている回数と、その初めの量
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    if (heldAt !== null) { heldAt = null; host.onHold?.(false); }
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  const arm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(reset, CATCH_IDLE_MS);
  };
  return {
    reset,
    noteInput(ms) {
      userUntil = Date.now() + ms;
      if (heldAt !== null && ms > 0) arm();                  // 入力が続いている間は、止めたまま
    },
    noteWheel(dy) {
      const now = Date.now();
      const prev = lastWheelT !== null && now - lastWheelT <= CATCH_IDLE_MS ? lastWheel : 0;     // 間が空いたら、新しい動き
      lastWheelT = now;
      // 慣性は、量が続けて減っていく(触れたままのゆっくりした動きは、減り続けない)
      if (prev !== 0 && Math.sign(dy) === Math.sign(prev) && Math.abs(dy) <= Math.abs(prev)) runLen++;
      else { runLen = 0; runStart = Math.abs(dy); }
      lastWheel = dy;
      if (heldAt !== null && prev !== 0) {
        const grew = Math.abs(dy) > Math.abs(prev) * 1.3 + 6;      // 慣性は減っていく。増えたら、新しく動かし始めた
        const reversed = Math.sign(dy) !== Math.sign(prev);
        if (grew || reversed) reset();
      }
      this.noteInput(300);
    },
    sync() { lastY = host.getY(); lastT = null; reset(); },
    onScroll() {
      const y = host.getY();
      const pin = host.pin();
      const now = Date.now();
      if (pin === null || now > userUntil) { lastY = y; lastT = null; reset(); return; }   // 境目が無い・人の操作ではない
      // 前のイベントからの速さ。間が空いたあと(動きの最初)は、1 コマの動きとして測る
      const dt = lastT === null || now - lastT > CATCH_IDLE_MS ? 16 : Math.max(now - lastT, 8);
      const speed = Math.abs(y - lastY) / dt;
      lastT = now;
      if (heldAt !== null) {
        if (Math.abs(y - heldAt) > 1) host.setY(heldAt);    // どちらへ動かしても、止めた位置へ戻す
        lastY = heldAt;
        arm();
        return;
      }
      const crossing = (lastY < pin && y > pin) || (lastY > pin && y < pin);
      // 慣性で動いている(ホイールの量が、続けて 15% 以上減ってきた)ときは、ゆっくりでも止める
      const inertia = lastWheelT !== null && now - lastWheelT <= CATCH_IDLE_MS && runLen >= INERTIA_RUN && Math.abs(lastWheel) <= runStart * 0.85;
      if (!crossing || (speed < CATCH_SPEED && !inertia)) { lastY = y; return; }     // 越えない・ゆっくり越える: 止めない
      host.setY(pin);                                        // 境目で止める
      heldAt = pin;
      host.onHold?.(true);
      lastY = pin;
      arm();
    },
  };
}
