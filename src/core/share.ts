/**
 * Android の共有の画面から受け取ったファイル(案件 45。PWA の Web Share Target)。
 * service worker(受け取って保存する)と画面(取り出して読み込む)の両方で使う決まりごと。
 * - 共有の送り先: manifest の share_target.action(スコープからの相対 'share-target')に、POST(multipart/form-data)で届く
 * - service worker は、ファイルを SHARE_CACHE に保存してから、'./?share=1' に移す
 */
export const SHARE_CACHE = 'rll-share';
export const SHARE_ACTION = 'share-target';
/** 受け取ったあとに開く画面の URL に付ける印(?share=1) */
export const SHARE_PARAM = 'share';
/** 保存したファイルの名前(encodeURIComponent したもの)を入れる見出し */
export const SHARE_NAME_HEADER = 'x-rll-name';
/** manifest の share_target.params.files の name */
export const SHARE_FIELD = 'file';

/** i 番目に受け取ったファイルを保存するときのキー(Cache は URL で引く) */
export function shareKey(scope: string, i: number): string {
  return new URL(`${SHARE_ACTION}/file/${i}`, scope).href;
}
/** shareKey の番号(並べ直すため)。キーでなければ -1 */
export function shareIndex(key: string): number {
  const m = /\/file\/(\d+)$/.exec(key);
  return m ? Number(m[1]) : -1;
}
