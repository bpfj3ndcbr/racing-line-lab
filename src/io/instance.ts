/**
 * 同時に開ける窓を 1 つだけにする(案件 60。Web 版・PWA 版)。
 * 保存はアプリ全体で 1 つ(resume.ts)なので、2 つの窓が書き合わないよう、後から開いた窓は起動しない。
 * - 窓の権利は Web Locks(navigator.locks)の名前つきのロック。ページを閉じる・ブラウザが落ちると、ブラウザが外す
 *   (印が残ってしまうことはない)。ロックの範囲は、保存(IndexedDB・localStorage)を共有する範囲と同じ
 * - 先に開いている窓の種類(ブラウザ / PWA)は、BroadcastChannel で聞く
 * - Android の共有の画面から開いた窓だけは、先の窓から奪う(steal)。奪われた窓には onLost で知らせる
 */
export type AppKind = 'browser' | 'pwa';

export interface InstanceLock {
  /** 窓の権利を取る。取れたら true。steal なら先の窓から奪う。onLost は、取ったあとで奪われたときに呼ぶ */
  acquire(o: { steal: boolean; onLost: () => void }): Promise<boolean>;
  /** 先に開いている窓の種類。答えが無ければ null */
  askHolder(): Promise<AppKind | null>;
}

const LOCK_NAME = 'rll-app';
const CHANNEL = 'rll-instance';
/** 先の窓の答えを待つ時間(ms) */
const ASK_WAIT_MS = 500;

/** この窓の種類: インストールしたアプリ(PWA)として開いているか */
export function currentKind(w: Window = window): AppKind {
  try {
    if (w.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
    if ((w.navigator as { standalone?: boolean }).standalone === true) return 'pwa';     // iPhone・iPad のホーム画面
  } catch { /* ブラウザとみなす */ }
  return 'browser';
}

/** Web Locks で窓の権利を扱う。Web Locks が無い環境では null(確かめずに起動する) */
export function openInstanceLock(kind: AppKind = currentKind()): InstanceLock | null {
  const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as LockManager | undefined;
  if (!locks?.request) return null;
  const channel = (): BroadcastChannel | null => { try { return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL); } catch { return null; } };
  let answering: BroadcastChannel | null = null;
  const startAnswering = () => {
    answering = channel();
    if (answering) answering.onmessage = (e) => { if ((e.data as { type?: string })?.type === 'who') answering?.postMessage({ type: 'here', kind }); };
  };
  const stopAnswering = () => { answering?.close(); answering = null; };

  return {
    acquire: ({ steal, onLost }) => new Promise<boolean>((resolve) => {
      let held = false;
      locks.request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return; }
        held = true;
        startAnswering();
        resolve(true);
        return new Promise<void>(() => { /* ページが閉じるまで持ち続ける */ });
      }).catch(() => {
        // 奪われた(AbortError)
        if (held) { stopAnswering(); onLost(); } else resolve(false);
      });
    }),
    askHolder: () => new Promise<AppKind | null>((resolve) => {
      const ch = channel();
      if (!ch) { resolve(null); return; }
      const done = (k: AppKind | null) => { clearTimeout(timer); ch.close(); resolve(k); };
      const timer = setTimeout(() => done(null), ASK_WAIT_MS);
      ch.onmessage = (e) => {
        const d = e.data as { type?: string; kind?: unknown };
        if (d?.type === 'here' && (d.kind === 'browser' || d.kind === 'pwa')) done(d.kind);
      };
      ch.postMessage({ type: 'who' });
    }),
  };
}

/** テスト用: メモリの上で窓の権利を扱う。同じ MemoryInstanceHub を渡したものどうしで、1 つだけが取れる */
export class MemoryInstanceHub {
  holder: { kind: AppKind; onLost: () => void } | null = null;
  lock(kind: AppKind): InstanceLock & { release(): void } {
    const hub = this;
    let mine: { kind: AppKind; onLost: () => void } | null = null;
    return {
      async acquire({ steal, onLost }) {
        if (hub.holder && !steal) return false;
        const prev = hub.holder;
        mine = { kind, onLost };
        hub.holder = mine;
        prev?.onLost();
        return true;
      },
      async askHolder() { return hub.holder?.kind ?? null; },
      /** 窓を閉じた */
      release() { if (hub.holder === mine) hub.holder = null; mine = null; },
    };
  }
}
