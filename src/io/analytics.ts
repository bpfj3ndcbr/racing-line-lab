/**
 * 利用状況の送信(Google アナリティクス)。Web 版の公開用ビルドだけで使う。
 * デスクトップ版(Electron)では送らない: file:// では正しく測れないうえ、外から読み込むスクリプトに
 * window.rllNative(ファイルの読み書きの窓口)を触らせないため。開発中(npm run dev)とテストでも送らない。
 */
export const GA_ID = 'G-Z53TFPFVNB';

type GaWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } & Record<string, unknown>;

/** この環境で送れるか(Web 版の公開用ビルドだけ) */
export function analyticsAvailable(): boolean {
  return !window.rllNative && import.meta.env.PROD;
}

let loaded = false;

/**
 * 設定に合わせて、送信を始める / 止める。オフにしたときは、Google の決まりの方法(ga-disable-<ID>)で送信を止める。
 * available を省くと、analyticsAvailable() で決める(テストから渡せるようにしている)。
 */
export function applyAnalytics(enabled: boolean, available = analyticsAvailable()): void {
  if (!available) return;
  const w = window as unknown as GaWindow;
  w[`ga-disable-${GA_ID}`] = !enabled;
  if (!enabled || loaded) return;
  loaded = true;
  w.dataLayer = w.dataLayer || [];
  // gtag.js の決まりの書き方(配列ではなく arguments をそのまま積む)
  w.gtag = function gtag() { w.dataLayer!.push(arguments); };
  w.gtag('js', new Date());
  w.gtag('config', GA_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}
