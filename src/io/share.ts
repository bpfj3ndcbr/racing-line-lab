/**
 * Android の共有の画面から受け取ったファイルを取り出す(案件 45。画面の側)。
 * service worker が SHARE_CACHE に保存して './?share=1' を開くので、その印があるときだけ取り出し、取り出したら消す。
 * 印が無ければ null。印があって取り出せなかったときは空の配列。
 */
import { SHARE_CACHE, SHARE_NAME_HEADER, SHARE_PARAM, shareIndex } from '../core/share';

/** 共有の画面から開いたところか(URL に ?share=1 が付いている) */
export function isSharedLaunch(): boolean {
  try { return new URL(location.href).searchParams.get(SHARE_PARAM) === '1'; } catch { return false; }
}

export async function takeSharedFiles(): Promise<File[] | null> {
  const url = new URL(location.href);
  if (url.searchParams.get(SHARE_PARAM) !== '1') return null;
  // 読み直したときに、もう一度取り出そうとしないよう、印を消しておく
  url.searchParams.delete(SHARE_PARAM);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  if (typeof caches === 'undefined') return [];
  try {
    const cache = await caches.open(SHARE_CACHE);
    const keys = [...await cache.keys()].sort((a, b) => shareIndex(a.url) - shareIndex(b.url));
    const files: File[] = [];
    for (const k of keys) {
      const r = await cache.match(k);
      if (!r) continue;
      const blob = await r.blob();
      files.push(new File([blob], decodeURIComponent(r.headers.get(SHARE_NAME_HEADER) ?? '') || '共有されたファイル', { type: blob.type }));
    }
    await caches.delete(SHARE_CACHE);
    return files;
  } catch {
    return [];
  }
}
