import type { TileId, TileRect } from '../core';

/**
 * 保存先の抽象化。ブラウザ版は localStorage、Electron 化したらファイル保存の実装に差し替える。
 * 値は文字列(JSON)で受け渡す。
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** このアプリが保存したものを、すべて消す(「アプリを初期状態に戻す」) */
  clear(): void;
}

export class LocalStorageStore implements KeyValueStore {
  constructor(private prefix = 'rll.') {}
  get(key: string): string | null {
    try { return localStorage.getItem(this.prefix + key); } catch { return null; }
  }
  set(key: string, value: string): void {
    try { localStorage.setItem(this.prefix + key, value); } catch { /* 容量超過などは無視 */ }
  }
  clear(): void {
    try {
      const mine: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(this.prefix)) mine.push(k); }
      mine.forEach((k) => localStorage.removeItem(k));
    } catch { /* 使えないときは何もしない */ }
  }
}

/** Electron が preload で渡す窓口(ブラウザでは無い) */
export interface NativeBridge {
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  /** 保存したものを、すべて消す */
  storageClear(): void;
  /** 選んだファイルの場所(Electron のみ。次回の自動読み込みに使う) */
  getPathForFile(file: File): string;
  /** 場所を指定して、走行ログ(.vbo)の中身を読む。読めなければ null */
  readTextFile(path: string): Promise<string | null>;
  saveText(fileName: string, text: string): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  /** 地図の保存(案件 2。古い版の窓口やテスト用の窓口には無いので、どれも任意) */
  tileUrl?: string;
  tilesSetAreas?(areas: TileRect[]): Promise<boolean>;
  tilesList?(): Promise<(TileId & { bytes: number })[]>;
  tilesRemove?(list: TileId[]): Promise<number>;
  tilesClear?(): Promise<boolean>;
  tilesPrefetch?(list: TileId[]): Promise<{ saved: number; failed: number }>;
  /** 新しい版の確認(案件 52): GitHub のタグの名前の一覧を取る。取れなければ ok: false。古い窓口には無い */
  checkUpdate?(): Promise<{ ok: boolean; tags?: string[] }>;
}
declare global { interface Window { rllNative?: NativeBridge } }

/**
 * Electron 版: メイン側のファイル(ユーザーデータ内の settings.json)に保存する。
 * 読み出しはメインとの同期の通信で、描画のたびに何度も呼ばれる(カード名など)ので、一度読んだ値は覚えておく(案件 36)。
 * 書き換えはこの窓からしか来ない(窓は 1 つ)ので、覚えた値が古くなることはない。
 */
export class NativeStore implements KeyValueStore {
  private memo = new Map<string, string | null>();
  constructor(private bridge: NativeBridge, private prefix = 'rll.') {}
  get(key: string): string | null {
    if (this.memo.has(key)) return this.memo.get(key)!;
    try {
      const v = this.bridge.storageGet(this.prefix + key);
      this.memo.set(key, v);
      return v;
    } catch { return null; }
  }
  set(key: string, value: string): void {
    this.memo.set(key, value);
    try { this.bridge.storageSet(this.prefix + key, value); } catch { /* 保存できなくても動作は続ける */ }
  }
  clear(): void {
    this.memo.clear();
    try { this.bridge.storageClear(); } catch { /* 消せなくても動作は続ける */ }
  }
}

/** 実行環境に合った保存先を返す(Electron ならファイル、ブラウザなら localStorage) */
export function createStore(w: { rllNative?: NativeBridge } = window): KeyValueStore {
  return w.rllNative ? new NativeStore(w.rllNative) : new LocalStorageStore();
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  get(key: string) { return this.m.get(key) ?? null; }
  set(key: string, value: string) { this.m.set(key, value); }
  clear() { this.m.clear(); }
}
