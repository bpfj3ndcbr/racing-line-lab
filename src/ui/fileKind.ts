/**
 * ファイルを選ぶときの種類(拡張子)の扱い(案件 29)。
 *
 * - Android などでは、<input type="file" accept=".vbo"> でも、ほかの種類のファイルが選べてしまう。
 *   そのため、選んだあとに拡張子を確かめる(hasExt)。
 * - iPhone・iPad の Safari は、知らない拡張子(.vbo・.cln・.sci)を accept に書くと、そのファイルを
 *   灰色にして選べなくすることがある。そのため、iPhone・iPad では accept を外してから選ばせる
 *   (installAppleFilePicker)。
 */

/** ファイル名の拡張子が ext(例: '.cln')か(大文字・小文字は区別しない) */
export function hasExt(name: string, ext: string): boolean {
  return name.toLowerCase().endsWith(ext.toLowerCase());
}

/** 種類が違うときの案内(.vbo の「○ 件は .vbo ではないため追加しませんでした。」と言い回しをそろえる) */
export function wrongExtMessage(name: string, ext: string): string {
  return `「${name}」は ${ext} ではないため読み込みませんでした。`;
}

type NavLike = Pick<Navigator, 'platform' | 'maxTouchPoints' | 'userAgent'>;

/** iPhone・iPad か(iPad は、パソコン用のサイトを表示する設定だと Mac と名乗るので、タッチの有無で見分ける) */
export function isAppleTouch(nav: NavLike): boolean {
  if (/iPhone|iPad|iPod/.test(nav.platform) || /iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

/**
 * iPhone・iPad では、ファイルを選ぶ欄を押したとき(選ぶ画面が開く前)に accept を外す。
 * 欄は画面ごとに作り直されるので、文書全体で 1 回だけ受け取る。戻り値は受け取りをやめる関数。
 */
export function installAppleFilePicker(doc: Document, nav: NavLike): () => void {
  if (!isAppleTouch(nav)) return () => {};
  const onClick = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (t?.tagName === 'INPUT' && t.type === 'file') t.removeAttribute('accept');
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
