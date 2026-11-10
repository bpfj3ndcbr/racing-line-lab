/**
 * Web 版の PWA(案件 31): service worker を登録して、ネットが無くても起動できるようにする。
 * 公開用のビルド(npm run build)の Web 版だけで使う。デスクトップ版(Electron。file:// では動かない)・
 * 開発中(npm run dev)・テストでは登録しない。
 */
export function pwaAvailable(env: { prod: boolean; protocol: string; native: boolean; supported: boolean }): boolean {
  return env.prod && !env.native && env.supported && (env.protocol === 'https:' || env.protocol === 'http:');
}

export function registerServiceWorker(): void {
  const ok = pwaAvailable({
    prod: import.meta.env.PROD, protocol: location.protocol, native: !!window.rllNative, supported: 'serviceWorker' in navigator,
  });
  if (!ok) return;
  // 画面の表示を先にし、そのあとで登録する(登録に失敗しても、今までどおりネットから使える)
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* 使えなくても動く */ }); });
}
