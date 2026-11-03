import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 走行ログ(fixtures/)は公開しないので、置いていないときは、それを使うテストを飛ばす
const haveFixtures = existsSync('fixtures/20260913140139_UTC.vbo') && existsSync('fixtures/cl_autopolis.cln');
const needFixtures = haveFixtures ? [] : readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts') && /fixtures|fx\(/.test(readFileSync(`tests/${f}`, 'utf8')))
  .map((f) => `tests/${f}`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  // Electron 化(file:// 読み込み)でも動くよう相対パスにする
  base: './',
  // About に出す版(package.json の version)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { include: ['tests/**/*.test.ts'], exclude: ['node_modules/**', ...needFixtures] },
});
