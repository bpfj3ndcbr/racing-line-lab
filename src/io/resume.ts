import { storableLog, type TrackLog } from '../core';
import { LocalStorageStore, type KeyValueStore } from './storage';

/**
 * Web 版・PWA 版の状態の保存(案件 30 → 案件 60 でアプリ全体で 1 つに作り替えた)。
 * 更新したときも、閉じて開き直したときも、読み込んだ走行ログと画面の状態を元に戻すためのもの。
 * - 走行ログ本体は、読み込んだときにそのつど保存する(画面が隠れる瞬間には大きなものを書かない)
 * - 割り当て・設定・開いている画面などの小さな状態は、画面が隠れるときに保存する
 * - アプリ全体で 1 つだけ持つ。同時に開ける窓は 1 つだけ(instance.ts)なので、ほかの窓と書き合うことはない
 * - 保存の形には版の印(RESUME_SCHEMA)を付け、一致しないものは捨てる
 */
export interface ResumeStore {
  putLog(id: string, log: TrackLog): Promise<void>;
  deleteLog(id: string): Promise<void>;
  putState(state: unknown): Promise<void>;
  /** 保存を読む。無い・版の印が合わないときは null(合わないものは消す) */
  load(): Promise<{ state: unknown; logs: Map<string, TrackLog> } | null>;
  /** keep に無い走行ログを消す(元に戻したあと、使われなかった走行ログの掃除) */
  prune(keep: Iterable<string>): Promise<void>;
  /** 保存をすべて消す(「アプリを初期状態に戻す」など) */
  forget(): Promise<void>;
}

/**
 * 保存の形の版。走行ログ(storableLog)や小さな状態(Session.resumeState)の形を、前の版のアプリが読めない形に変えたら上げる。
 * 上げると、前の版で保存したものは捨てる(元に戻さない)。形を変えたときは tests/resume-schema.test.ts が落ちるので、
 * 上げるか(または読み替えを足すか)を決めてから、テストの記録を直す。
 * 1 = タブごとの一時保存(案件 30〜59)、2 = アプリ全体で 1 つ(案件 60)
 */
export const RESUME_SCHEMA = 2;

/** 小さな状態の写しの保存キー(KeyValueStore。ページを閉じる・読み直す瞬間に始めた IndexedDB の書き込みは中止されるので、同期的に書ける方にも置く) */
const COPY_KEY = 'resumeState';
const DB_NAME = 'rll-resume';
const DB_VERSION = 2;
const STATE_ID = 'app';

interface SavedState { schema: number; at: number; app?: string; state: unknown }

const isSaved = (v: unknown): v is SavedState =>
  !!v && typeof v === 'object' && typeof (v as SavedState).schema === 'number' && typeof (v as SavedState).at === 'number';

/** 2 つの写し(IndexedDB と KeyValueStore)のうち、新しい方を選ぶ */
export function newerState(a: unknown, b: unknown): SavedState | null {
  const x = isSaved(a) ? a : null, y = isSaved(b) ? b : null;
  if (!x || !y) return x ?? y;
  return y.at > x.at ? y : x;
}

/** IndexedDB の保存先。使えない環境(IndexedDB が無い)では null */
export function openResumeStore(copy: KeyValueStore = new LocalStorageStore(), now = () => Date.now()): ResumeStore | null {
  try { if (typeof indexedDB === 'undefined') return null; } catch { return null; }
  // 1 の版(タブごと)の写しは、sessionStorage にあった。使わないので消しておく
  try { sessionStorage.removeItem('rll.resumeTab'); sessionStorage.removeItem('rll.resumeState'); } catch { /* 無視 */ }

  let dbp: Promise<IDBDatabase> | null = null;
  let opened: IDBDatabase | null = null;           // 開いたあとは、待たずに使う(ページが隠れる・閉じる直前の書き込みを、その場で始めるため)
  const db = () => dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      // 前の形(タブごと)のものは引き継がない。入れ物ごと作り直す
      const d = r.result;
      for (const name of Array.from(d.objectStoreNames)) d.deleteObjectStore(name);
      d.createObjectStore('state', { keyPath: 'id' });
      d.createObjectStore('logs', { keyPath: 'id' });
    };
    r.onsuccess = () => { opened = r.result; res(r.result); };
    r.onerror = () => rej(r.error);
  });
  void db().catch(() => { /* 使えなければ、書き込みのときに失敗する */ });
  const tx = async (stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => void) => {
    const t = (opened ?? await db()).transaction(stores, mode);
    fn(t);
    await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  };
  const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const readCopy = (): unknown => { try { const c = copy.get(COPY_KEY); return c ? JSON.parse(c) : null; } catch { return null; } };
  const clearAll = async () => {
    copy.set(COPY_KEY, '');
    await tx(['state', 'logs'], 'readwrite', (t) => { t.objectStore('state').clear(); t.objectStore('logs').clear(); });
  };

  return {
    putLog: (id, log) => tx(['logs'], 'readwrite', (t) => { t.objectStore('logs').put({ id, at: now(), log: storableLog(log) }); }),
    deleteLog: (id) => tx(['logs'], 'readwrite', (t) => { t.objectStore('logs').delete(id); }),
    putState(state) {
      const rec: SavedState = { schema: RESUME_SCHEMA, at: now(), app: __APP_VERSION__, state };
      let copied = false;
      try { copy.set(COPY_KEY, JSON.stringify(rec)); copied = true; } catch { /* IndexedDB のほうだけ */ }
      const p = tx(['state'], 'readwrite', (t) => { t.objectStore('state').put({ id: STATE_ID, ...rec }); });
      return copied ? p.catch(() => { /* 写しは書けた */ }) : p;
    },
    async load() {
      const d = await db();
      const fromDb = await req(d.transaction('state').objectStore('state').get(STATE_ID)) as unknown;
      const saved = newerState(fromDb, readCopy());
      if (!saved) return null;
      if (saved.schema !== RESUME_SCHEMA) { await clearAll().catch(() => { /* 消せなくても、使わない */ }); return null; }
      const rows = await req(d.transaction('logs').objectStore('logs').getAll()) as { id: string; log: TrackLog }[];
      return { state: saved.state, logs: new Map(rows.map((r) => [r.id, r.log])) };
    },
    async prune(keep) {
      const k = new Set(keep);
      const d = await db();
      const ids = await req(d.transaction('logs').objectStore('logs').getAllKeys()) as string[];
      const drop = ids.filter((id) => !k.has(id));
      if (drop.length) await tx(['logs'], 'readwrite', (t) => drop.forEach((id) => t.objectStore('logs').delete(id)));
    },
    forget: () => clearAll(),
  };
}

/** テスト用: メモリに持つ保存先(走行ログは、IndexedDB の保存先と同じく storableLog の形で持つ) */
export class MemoryResumeStore implements ResumeStore {
  logs = new Map<string, TrackLog>();
  state: unknown = null;
  async putLog(id: string, log: TrackLog) { this.logs.set(id, storableLog(log)); }
  async deleteLog(id: string) { this.logs.delete(id); }
  async putState(state: unknown) { this.state = state; }
  async load() { return this.state === null ? null : { state: this.state, logs: new Map(this.logs) }; }
  async prune(keep: Iterable<string>) { const k = new Set(keep); for (const id of [...this.logs.keys()]) if (!k.has(id)) this.logs.delete(id); }
  async forget() { this.logs.clear(); this.state = null; }
}
