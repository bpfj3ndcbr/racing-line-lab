import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractSection, markdownToHtml } from '../src/core/markdown';

describe('Markdown → HTML(使い方タブ用)', () => {
  it('見出し・段落・太字・コード・リンク', () => {
    const html = markdownToHtml('## 見出し\n\n**太字** と `a<b>` と [リンク](https://example.com)\n続きの行');
    expect(html).toContain('<h2>見出し</h2>');
    expect(html).toContain('<b>太字</b>');
    expect(html).toContain('<code>a&lt;b&gt;</code>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">リンク</a>');
    expect(html).toContain('続きの行</p>');
  });

  it('箇条書き・番号付きリスト・引用・表・区切り線・コードの塊', () => {
    const md = ['- いち', '- に', '', '1. 一', '2. 二', '', '> 注意 **大事**', '> 2 行目', '',
      '| | 緯度 |', '|---|---|', '| 始点 | 33.0 |', '', '---', '', '```', 'npm <install>', '```'].join('\n');
    const html = markdownToHtml(md);
    expect(html).toContain('<ul><li>いち</li><li>に</li></ul>');
    expect(html).toContain('<ol><li>一</li><li>二</li></ol>');
    expect(html).toMatch(/<blockquote><p>注意 <b>大事<\/b>\n2 行目<\/p><\/blockquote>/);
    expect(html).toContain('<thead><tr><th></th><th>緯度</th></tr></thead><tbody><tr><td>始点</td><td>33.0</td></tr></tbody>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<pre><code>npm &lt;install&gt;</code></pre>');
  });

  it('画像の src を置き換える。見つからないものは元のまま', () => {
    const html = markdownToHtml('![図](docs/images/a.png)\n\n![外](x.png)', { resolveImage: (s) => (s === 'docs/images/a.png' ? '/assets/a-123.png' : undefined) });
    expect(html).toContain('<img src="/assets/a-123.png" alt="図" loading="lazy">');
    expect(html).toContain('<img src="x.png" alt="外" loading="lazy">');
  });

  it('見出しから、次に指定した見出しの手前までを取り出す', () => {
    const md = '# A\n## 使い方\n本文\n## そのほか\n続き\n## 開発者の方へ\n別';
    expect(extractSection(md, '## 使い方', '## 開発者の方へ')).toBe('## 使い方\n本文\n## そのほか\n続き');
    expect(extractSection(md, '## 無い')).toBe('');
  });

  it('README の「使い方」「そのほかの操作」を取り出せて、画像がすべて docs/images を指している', () => {
    const md = extractSection(readFileSync('README.md', 'utf8'), '## 使い方', '## 開発者の方へ');
    expect(md).toContain('## そのほかの操作');
    const srcs: string[] = [];
    markdownToHtml(md, { resolveImage: (s) => { srcs.push(s); return s; } });
    expect(srcs.length).toBeGreaterThan(10);
    expect(srcs.every((s) => s.startsWith('docs/images/'))).toBe(true);
  });
});
