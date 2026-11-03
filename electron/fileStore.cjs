'use strict';
// 設定・サーキット・補正データなどの保存先(ユーザーデータ内の JSON ファイル 1 つ)。
// 起動時に全部読み込んで、書き込みは少し待ってまとめて行う(一時ファイルに書いてから置き換えるので、途中で落ちても壊れない)。
const fs = require('node:fs');
const path = require('node:path');

class FileStore {
  constructor(file, delayMs = 200) {
    this.file = file;
    this.delayMs = delayMs;
    this.data = {};
    this.timer = null;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && typeof j === 'object' && !Array.isArray(j)) this.data = j;
    } catch { /* 初回や壊れたファイルは空から始める */ }
  }
  get(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; }
  set(key, value) {
    this.data[key] = String(value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }
  /** すべて消して、ファイルにも反映する */
  clear() { this.data = {}; this.flush(); }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('保存に失敗しました', e); }
  }
}

module.exports = { FileStore };
