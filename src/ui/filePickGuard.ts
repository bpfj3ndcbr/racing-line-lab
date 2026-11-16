/**
 * ファイルを選ぶ欄の二重タップを防ぐ(案件 70)。
 *
 * Android では、ファイルを選ぶ画面が開くまでに数秒(遅いときは 5〜6 秒)かかることがある。その間にもう一度タップすると、
 * 選ぶ画面が重なって開くおそれがあるため、1 回目のタップから、選び終わる(change)かやめる(cancel)まで、
 * ほかのファイル欄へのタップを無視する。やめた合図が来ない環境のために、一定時間(PICK_SAFETY_MS)で必ず解除する。
 * 待ちの表示(ダイアログ)は出さない。
 */

/** 合図(change・cancel)が来ないときの解除までの時間(ミリ秒) */
export const PICK_SAFETY_MS = 10_000;

const isFileInput = (t: EventTarget | null): t is HTMLInputElement =>
  !!t && (t as HTMLElement).tagName === 'INPUT' && (t as HTMLInputElement).type === 'file';

/** 二重タップを防ぐ仕組みを入れる。戻り値は取り消す関数 */
export function installFilePickGuard(doc: Document, safetyMs = PICK_SAFETY_MS): () => void {
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    busy = false;
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  const onClick = (e: Event) => {
    if (!isFileInput(e.target)) return;
    if (busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // 選ぶ画面を重ねて開かない
    busy = true;
    timer = setTimeout(release, safetyMs);
  };
  const onDone = (e: Event) => { if (isFileInput(e.target)) release(); };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('change', onDone, true);
  doc.addEventListener('cancel', onDone, true);
  return () => {
    release();
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('change', onDone, true);
    doc.removeEventListener('cancel', onDone, true);
  };
}
