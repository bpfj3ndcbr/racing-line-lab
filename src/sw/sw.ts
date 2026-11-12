/// <reference lib="webworker" />
/**
 * Web 版の service worker(案件 31)。ネットが無くてもアプリを起動できるようにする。
 * - アプリのファイル(ビルドしたときの一覧 __PRECACHE__)を、入れたときにまとめて保存し、保存したものを返す
 * - 新しい版は、ネットがあるときに裏で取得し、アプリを閉じて次に起動したときから使われる(PWA の通常の動き)。
 *   画面の「更新する」(案件 50)が合図を送ったときだけ、待機中の版にすぐ代わる
 * - 地図(地理院タイル)は、「設定」の保存範囲の中で表示したもの(Z15〜Z18)を保存し、次からは保存したものを返す
 *   (ネットが無くても表示できる)。範囲の外は、今までどおりネットから取る
 * - Android の共有の画面から送られたファイル(案件 45)を受け取って保存し、アプリの画面に移す
 * ビルドは vite.config.ts の swPlugin が、このファイルだけを 1 つの sw.js にまとめて行う(アプリ本体とは別)。
 */
import {
  type SaveArea, TILE_AREAS_FILE, TILE_BYTES_HEADER, TILE_CACHE, TILE_META_CACHE, cleanAreas, parseTileUrl, tileInAreas,
} from '../core/tiles';
import { SHARE_ACTION, SHARE_CACHE, SHARE_FIELD, SHARE_NAME_HEADER, SHARE_PARAM, shareKey } from '../core/share';
const sw = self as unknown as ServiceWorkerGlobalScope;
/** ビルドしたときのアプリのファイルの一覧(sw.js からの相対パス。'./' は index.html) */
declare const __PRECACHE__: string[];
/** アプリのファイルの組み合わせごとの印。変わると、新しい版として入れ直す */
declare const __CACHE_VERSION__: string;

const APP_CACHE = `rll-app-${__CACHE_VERSION__}`;
const APP_PREFIX = 'rll-app-';

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(__PRECACHE__.map((p) => new Request(p, { cache: 'reload' })))));
});

sw.addEventListener('activate', (e) => {
  // 古い版のアプリのファイルを消す
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(APP_PREFIX) && k !== APP_CACHE).map((k) => caches.delete(k)))));
});

// ---- 地図の保存 ----
/** 保存範囲(画面が TILE_META_CACHE に置く)。画面から 'rll-areas' が届いたら読み直す */
let areas: Promise<SaveArea[]> | null = null;
const loadAreas = () => areas ??= caches.open(TILE_META_CACHE)
  .then((c) => c.match(new URL(TILE_AREAS_FILE, sw.registration.scope).href))
  .then(async (r) => cleanAreas(r ? await r.json() : []))
  .catch(() => []);
sw.addEventListener('message', (e) => {
  const type = (e.data as { type?: string } | null)?.type;
  if (type === 'rll-areas') areas = null;
  else if (type === 'rll-skip-waiting') void sw.skipWaiting();      // 設定の「更新する」(案件 50): 待機中の新しい版に今すぐ代わる
});

async function tile(req: Request, t: { z: number; x: number; y: number }): Promise<Response> {
  if (!tileInAreas(t, await loadAreas())) return fetch(req);           // 範囲の外は、今までどおり
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;                                                 // 保存済みを優先(航空写真は更新が少ないため)
  const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) return res;
  const blob = await res.blob();
  const stored = new Response(blob, { headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg', [TILE_BYTES_HEADER]: String(blob.size) } });
  await cache.put(req.url, stored.clone()).catch(() => { /* 保存できなくても表示はする */ });
  return stored;
}

// ---- 共有の画面から受け取る(案件 45) ----
/** 送られたファイルを保存して(前に受け取った分は消す)、アプリの画面(?share=1)に移す。画面がそこから取り出して読み込む */
async function receiveShare(req: Request): Promise<Response> {
  const scope = sw.registration.scope;
  try {
    const form = await req.formData();
    const files = form.getAll(SHARE_FIELD).filter((f): f is File => typeof f !== 'string');
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all(files.map((f, i) => cache.put(shareKey(scope, i), new Response(f, {
      headers: { 'content-type': f.type || 'application/octet-stream', [SHARE_NAME_HEADER]: encodeURIComponent(f.name) },
    }))));
  } catch { /* 受け取れなくても、アプリは開く(画面が「受け取れませんでした」と知らせる) */ }
  return Response.redirect(new URL(`./?${SHARE_PARAM}=1`, scope).href, 303);
}

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).href === new URL(SHARE_ACTION, sw.registration.scope).href) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  const t = parseTileUrl(req.url);
  if (t) { if (t.z >= 15 && t.z <= 18) e.respondWith(tile(req, t).catch(() => Response.error())); return; }
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;              // 利用状況の送信などは、今までどおり
  e.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    // 画面(index.html)は、どの URL で開いても保存したものを返す(?以降が付いていても)。
    // Vary: Origin が付いた応答も、crossorigin 付きの読み込み(type="module" の script など)に返せるよう ignoreVary
    const hit = req.mode === 'navigate' ? await cache.match('./') : await cache.match(req, { ignoreSearch: true, ignoreVary: true });
    return hit ?? fetch(req);
  })());
});
