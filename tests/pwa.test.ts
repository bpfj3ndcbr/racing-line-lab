import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pwaAvailable } from '../src/io/pwa';

// Web 版の PWA(案件 31)
describe('PWA', () => {
  const web = { prod: true, protocol: 'https:', native: false, supported: true };

  it('service worker を登録するのは、公開用ビルドの Web 版だけ', () => {
    expect(pwaAvailable(web)).toBe(true);
    expect(pwaAvailable({ ...web, protocol: 'http:' })).toBe(true);           // localhost での確認用
    expect(pwaAvailable({ ...web, prod: false })).toBe(false);                // 開発中(npm run dev)・テスト
    expect(pwaAvailable({ ...web, native: true })).toBe(false);               // デスクトップ版
    expect(pwaAvailable({ ...web, protocol: 'file:' })).toBe(false);
    expect(pwaAvailable({ ...web, supported: false })).toBe(false);
  });

  it('manifest: ホーム画面での表示名は R-LineLab。アイコンは 192px と 512px(切り抜かれる端末向けの maskable も)', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { name: string; short_name: string; start_url: string; display: string; icons: { sizes: string; purpose: string }[] };
    expect(m.name).toBe('Racing Line Lab');
    expect(m.short_name).toBe('R-LineLab');
    expect(m.start_url).toBe('./');
    expect(m.display).toBe('standalone');
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']);
  });

  it('index.html から manifest を読み込み、iOS 用の表示名も R-LineLab', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="R-LineLab">');
  });
});
