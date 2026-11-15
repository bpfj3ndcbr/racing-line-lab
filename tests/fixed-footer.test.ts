import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (p: string) => readFileSync(p, 'utf8');
const css = src('src/style.css');

describe('下部に固定するボタン(案件 63)', () => {
  it('位置補正・サーキットの登録/編集: 保存とキャンセルは、右の列の下の .fix-foot に入っている', () => {
    const cor = src('src/ui/correctView.ts');
    expect(cor).toMatch(/<div class="fix-foot">\s*<button[^>]*id="cor-apply"[\s\S]*?id="cor-cancel"[\s\S]*?<\/div>/);
    const ce = src('src/ui/circuitEditor.ts');
    expect(ce).toMatch(/<div class="fix-foot">\s*<button[^>]*id="ce-save"[\s\S]*?id="ce-cancel"[\s\S]*?<\/div>/);
    expect(ce).not.toMatch(/<div class="ce-head">[\s\S]*?id="ce-save"[\s\S]*?<div class="map"/);   // 上の帯には残さない
  });

  it('取り込み範囲: 中身(.tr-body)だけがスクロールし、ボタン(.tr-actions)はその外に固定する', () => {
    const tr = src('src/ui/trimDialog.ts');
    expect(tr).toMatch(/<div class="tr-body">[\s\S]*<\/div>\s*<div class="modal-actions tr-actions">/);
    expect(css).toMatch(/\.modal\.tr\{[^}]*overflow:hidden/);
    expect(css).toMatch(/\.tr-body\{[^}]*overflow-y:auto/);
  });

  it('PC は列の下端に固定(sticky)、スマホ(縦)は画面の下端に固定(fixed)', () => {
    expect(css).toMatch(/\.fix-foot\{position:sticky;bottom:/);
    const narrow = css.slice(css.indexOf('/* 位置補正・サーキットの登録/編集: 地図を上'));
    expect(narrow).toMatch(/\.fix-foot\{position:fixed;left:0;right:0;bottom:0/);
  });
});
