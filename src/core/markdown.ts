/**
 * README.md の「使い方」をアプリの中で表示するための、小さな Markdown → HTML 変換。
 * README で使っている書き方(見出し・段落・箇条書き・番号付きリスト・引用・表・画像・コード・太字・リンク・区切り線)だけに対応する。
 */

import { escapeHtml as esc } from './format';

export interface MarkdownOptions {
  /** 画像の src を、表示に使う URL に置き換える(見つからなければ、元の src のまま) */
  resolveImage?: (src: string) => string | undefined;
}

/** 行の中の書式(コード・画像・リンク・太字)。行末の半角スペース 2 つは改行 */
function inline(text: string, opts: MarkdownOptions): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => {
    const url = opts.resolveImage?.(src) ?? src;
    return `<img src="${url}" alt="${alt}" loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/ {2,}$/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** Markdown を HTML にする */
export function markdownToHtml(md: string, opts: MarkdownOptions = {}): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|\||```|---+\s*$)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // コード
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    // 見出し
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2].trim(), opts)}</h${h[1].length}>`); i++; continue; }
    // 区切り線
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // 引用(中身も Markdown として読む)
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(body.join('\n'), opts)}</blockquote>`);
      continue;
    }
    // 表(2 行目が区切りの行)
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    // 箇条書き / 番号付きリスト
    const ul = /^\s*[-*]\s+/, ol = /^\s*\d+\.\s+/;
    if (ul.test(line) || ol.test(line)) {
      const re = ul.test(line) ? ul : ol;
      const tag = re === ul ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t, opts)}</li>`).join('')}</${tag}>`);
      continue;
    }
    // 段落(空行か、別の書き方の行まで)
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) para.push(lines[i++]);
    out.push(`<p>${para.map((l) => inline(l, opts)).join('\n')}</p>`);
  }
  return out.join('\n');
}

/** 見出し from の行から、見出し until の行の手前までを取り出す(until が無ければ最後まで)。from が無ければ空 */
export function extractSection(md: string, from: string, until?: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === from);
  if (start < 0) return '';
  const end = until ? lines.findIndex((l, k) => k > start && l.trim() === until) : -1;
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}
