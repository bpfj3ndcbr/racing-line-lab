import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { build, defineConfig, type Plugin } from 'vite';

// 走行ログ(fixtures/)は公開しないので、置いていないときは、それを使うテストを飛ばす
const haveFixtures = existsSync('fixtures/20260913140139_UTC.vbo') && existsSync('fixtures/cl_autopolis.cln');
const needFixtures = haveFixtures ? [] : readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts') && /fixtures|fx\(/.test(readFileSync(`tests/${f}`, 'utf8')))
  .map((f) => `tests/${f}`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/**
 * Web 版の service worker(案件 31)を作る。アプリ本体のビルドが終わったあとに、dist のファイルの一覧を
 * __PRECACHE__ として埋め込み、src/sw/sw.ts を 1 つの dist/sw.js にまとめる(アプリ本体とは部品を共有しない)。
 */
function swPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rll-sw', apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    async closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && f !== 'index.html' && !f.startsWith('.')).sort();
      const hash = createHash('sha256');
      for (const f of ['index.html', ...list]) hash.update(f).update(readFileSync(join(outDir, f)));
      await build({
        configFile: false, logLevel: 'warn',
        define: { __PRECACHE__: JSON.stringify(['./', ...list]), __CACHE_VERSION__: JSON.stringify(hash.digest('hex').slice(0, 12)) },
        build: {
          outDir, emptyOutDir: false, copyPublicDir: false,
          lib: { entry: 'src/sw/sw.ts', formats: ['iife'], name: 'rllSw', fileName: () => 'sw.js' },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [swPlugin()],
  // Electron 化(file:// 読み込み)でも動くよう相対パスにする
  base: './',
  // About に出す版(package.json の version)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { include: ['tests/**/*.test.ts'], exclude: ['node_modules/**', ...needFixtures] },
});
