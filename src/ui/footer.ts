/**
 * 各画面(使い方・データ管理・設定)の最下部のフッター(案件 87): 「Racing Line Lab バージョン x.x.x (2026)」。
 * 画面の中身の最後に足す(PC は、画面そのものがスクロールするので、中身の最後に置く)。比較画面には出さない
 */
export const FOOTER_YEAR = 2026;

export const footerHtml = () => `<footer class="app-foot">Racing Line Lab バージョン ${__APP_VERSION__} (${FOOTER_YEAR})</footer>`;

export function createFooter(): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = footerHtml();
  return t.content.firstElementChild as HTMLElement;
}
