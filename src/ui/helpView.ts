import readme from '../../README.md?raw';
import { extractSection, markdownToHtml } from '../core/markdown';

// README の「使い方」の画像(docs/images/usage-*.png)をアプリに同梱する。キーは '../../docs/images/xxx.png'
const IMAGES = import.meta.glob('../../docs/images/usage-*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** README の画像の書き方(docs/images/xxx.png)を、同梱した画像の URL にする */
function resolveImage(src: string): string | undefined {
  return IMAGES[`../../${src}`];
}

/** 「使い方」タブ: README の「使い方」と「そのほかの操作」を、そのまま表示する */
export function mountHelpView(root: HTMLElement): void {
  const md = extractSection(readme, '## 使い方', '## 開発者の方へ');
  root.innerHTML = `<article class="help" aria-label="使い方">${markdownToHtml(md, { resolveImage })}</article>`;
}
