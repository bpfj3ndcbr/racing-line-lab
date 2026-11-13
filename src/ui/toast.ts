import type { Session } from '../store/session';

/**
 * 画面の下の通知(案件 53)。データ管理などで出る案内(読み込めなかった・取り込んだ結果など)を、画面の位置にかかわらず見える場所に出す。
 * - info: 数秒で消える
 * - warn: 読み込めなかったなど、「×」で閉じるまで残す
 * - busy: 読み込み中の案内。終わると消える(「×」なし)
 */
export type ToastKind = 'info' | 'warn' | 'busy';

export interface Toast {
  show(text: string, kind: ToastKind): void;
  hide(): void;
}

/** info が自動で消えるまでの時間(ミリ秒) */
export const TOAST_MS = 6000;

export function mountToast(root: HTMLElement, autoMs = TOAST_MS): Toast {
  const el = document.createElement('div');
  el.className = 'toast';
  el.hidden = true;
  el.innerHTML = '<span class="toast-text"></span><button type="button" class="toast-x" aria-label="閉じる" title="閉じる">×</button>';
  root.append(el);
  const text = el.querySelector<HTMLElement>('.toast-text')!;
  const close = el.querySelector<HTMLButtonElement>('.toast-x')!;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const hide = () => { clear(); el.hidden = true; };
  close.addEventListener('click', hide);
  return {
    show(t, kind) {
      clear();
      text.textContent = t;
      el.className = `toast ${kind}`;
      el.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
      close.hidden = kind === 'busy';
      el.hidden = false;
      if (kind === 'info') timer = setTimeout(hide, autoMs);
    },
    hide,
  };
}

/** セッションの案内(読み込み中の案内・メッセージ)を通知に出す。session の変化のたびに呼ぶ */
export function bindToast(toast: Toast, session: Session): () => void {
  let seen = 0;
  let busyShown = false;
  return () => {
    if (session.loading) { toast.show(session.loading, 'busy'); busyShown = true; return; }
    if (busyShown) { toast.hide(); busyShown = false; }
    if (session.messageSeq !== seen) {
      seen = session.messageSeq;
      if (session.message) toast.show(session.message, session.messageWarn ? 'warn' : 'info');
    }
  };
}
