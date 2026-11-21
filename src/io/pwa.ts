/**
 * Web 版の PWA(案件 31): service worker を登録して、ネットが無くても起動できるようにする。
 * 公開用のビルド(npm run build)の Web 版だけで使う。デスクトップ版(Electron。file:// では動かない)・
 * 開発中(npm run dev)・テストでは登録しない。
 */
export function pwaAvailable(env: { prod: boolean; protocol: string; native: boolean; supported: boolean }): boolean {
  return env.prod && !env.native && env.supported && (env.protocol === 'https:' || env.protocol === 'http:');
}

function available(): boolean {
  return pwaAvailable({
    prod: import.meta.env.PROD, protocol: location.protocol, native: !!window.rllNative, supported: 'serviceWorker' in navigator,
  });
}

/** 画面から切り替えてもらうときの合図(sw.ts が受け取って skipWaiting する) */
export const SKIP_WAITING = 'rll-skip-waiting';
/** 待機中の版に、その版の番号を聞く(案件 88)。返事は、一緒に渡した port に { version } で届く */
export const GET_VERSION = 'rll-get-version';

export type UpdateCheck = 'latest' | 'waiting' | 'failed';

/**
 * アプリの更新(案件 50)。新しい版は裏で取得されて「待機中」になる(次の起動から使われる)ので、
 * 待機中になったことを知らせ、「更新する」で今すぐ切り替えて読み直す。
 * 更新の確認と切り替えは、service worker を登録した Web 版だけ(createUpdateWatcher が null なら使わない)。
 */
export class UpdateWatcher {
  private reg: ServiceWorkerRegistration | null = null;
  private isWaiting = false;
  private applying = false;
  private ver: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private sw: ServiceWorkerContainer, private reload: () => void = () => window.location.reload()) {
    // 「更新する」で新しい版に代わったら、読み直す(自分で頼んだときだけ。ほかの理由では読み直さない)
    sw.addEventListener('controllerchange', () => { if (this.applying) this.reload(); });
  }

  /** 新しい版が待機中か(今の版の次の版が取得済み) */
  get waiting(): boolean { return this.isWaiting; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** 待機中の新しい版の番号(まだ聞けていない・聞けないときは null。案件 88) */
  get waitingVersion(): string | null { return this.isWaiting ? this.ver : null; }
  private set(v: boolean) {
    if (this.isWaiting === v) return;
    this.isWaiting = v; this.listeners.forEach((f) => f());
    if (v) this.askVersion(this.reg?.waiting);
  }
  /** 待機中の版に番号を聞く。返事が来たら画面に知らせる(古い版には聞けないので、番号なしのまま) */
  private askVersion(w: ServiceWorker | null | undefined): void {
    if (!w || typeof MessageChannel === 'undefined') return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e: MessageEvent) => {
      const v = (e.data as { version?: unknown } | null)?.version;
      if (typeof v === 'string' && v !== this.ver) { this.ver = v; this.listeners.forEach((f) => f()); }
    };
    try { w.postMessage({ type: GET_VERSION }, [ch.port2]); } catch { /* 聞けなくても「新しい版があります」は出す */ }
  }

  /** 登録できたら呼ぶ。すでに待機中の版があるか、これから取得される版を見張る */
  attach(reg: ServiceWorkerRegistration): void {
    this.reg = reg;
    reg.addEventListener('updatefound', () => this.track(reg.installing));
    this.track(reg.installing);
    // 動いている版が無い(初めてのインストール)ときの待機中は、更新ではない
    if (reg.waiting && this.sw.controller) this.set(true);
  }
  private track(w: ServiceWorker | null): void {
    if (!w) return;
    w.addEventListener('statechange', () => { if (w.state === 'installed' && this.sw.controller) this.set(true); });
  }

  /** 新しい版があるかを確かめる(ネットが必要)。取得が終わるまで待つ */
  async check(): Promise<UpdateCheck> {
    const reg = this.reg;
    if (!reg) return 'failed';
    try { await reg.update(); } catch { return 'failed'; }
    const w = reg.installing;
    if (w && w.state !== 'installed' && w.state !== 'activated') {
      await new Promise<void>((done) => w.addEventListener('statechange', () => { if (w.state !== 'installing') done(); }));
    }
    if (reg.waiting && this.sw.controller) this.set(true);
    return this.isWaiting ? 'waiting' : 'latest';
  }

  /** 待機中の版に切り替える。切り替わったら読み直す */
  apply(): void {
    const w = this.reg?.waiting;
    if (!w) { this.reload(); return; }
    this.applying = true;
    w.postMessage({ type: SKIP_WAITING });
  }
}

/** 更新の確認が使える環境(公開用ビルドの Web 版)のときだけ作る。それ以外は null */
export function createUpdateWatcher(): UpdateWatcher | null {
  return available() ? new UpdateWatcher(navigator.serviceWorker) : null;
}

export function registerServiceWorker(updates: UpdateWatcher | null = null): void {
  if (!available()) return;
  // 画面の表示を先にし、そのあとで登録する(登録に失敗しても、今までどおりネットから使える)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => updates?.attach(reg)).catch(() => { /* 使えなくても動く */ });
  });
}
