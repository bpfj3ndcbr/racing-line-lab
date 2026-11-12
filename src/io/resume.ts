import type { TrackLog } from '../core';

/**
 * Web 版の一時保存(案件 30)。スマホのスリープやアプリの切り替えで、ブラウザがページを読み込み直したとき
 * (同じタブの中の読み直し)に、読み込んだ走行ログと画面の状態を元に戻すためのもの。
 * - 走行ログ本体は、読み込んだときにそのつど保存する(画面が隠れる瞬間には大きなものを書かない)
 * - 割り当て・設定・開いている画面などの小さな状態は、画面が隠れるときに保存する
 * - タブごとに 1 つだけ持つ。タブの見分けは sessionStorage(同じタブの読み直しでは残り、新しいタブ・閉じたタブでは無い)
 */
export interface ResumeStore {
  /** このタブで前に保存していたか(同じタブの中の読み直しか) */
  readonly resumed: boolean;
  putLog(id: string, log: TrackLog): Promise<void>;
  deleteLog(id: string): Promise<void>;
  putState(state: unknown): Promise<void>;
  /** このタブの保存を読む。無ければ null */
  load(): Promise<{ state: unknown; logs: Map<string, TrackLog> } | null>;
  /** このタブの保存を消し、次の読み直しで元に戻さないようにする(「アプリを初期状態に戻す」など) */
  forget(): Promise<void>;
  /**
   * ほかのタブ(窓)のうち、いちばん新しく保存した状態を、このタブのものとして引き継ぐ(元の分は移すので残らない)。無ければ null。
   * Android の共有の画面から開くと、アプリが新しい窓で開き直されるので、直前の状態を続けて使うため(案件 45)
   */
  adoptLatest(): Promise<{ state: unknown; logs: Map<string, TrackLog> } | null>;
}

const TAB_KEY = 'rll.resumeTab';
/** 小さな状態の写し。ページを閉じる・読み直す瞬間(pagehide)に始めた IndexedDB の書き込みは中止されるので、同期的に書ける sessionStorage にも置く */
const STATE_KEY = 'rll.resumeState';
const DB_NAME = 'rll-resume';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;          // 閉じたタブの分は、1 日たったら消す

/** IndexedDB の保存先。使えない環境(IndexedDB・sessionStorage が無い)では null */
export function openResumeStore(now = () => Date.now()): ResumeStore | null {
  let tab: string | null = null, resumed = false;
  try {
    if (typeof indexedDB === 'undefined' || typeof sessionStorage === 'undefined') return null;
    tab = sessionStorage.getItem(TAB_KEY);
    resumed = !!tab;
    if (!tab) { tab = `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; sessionStorage.setItem(TAB_KEY, tab); }
  } catch { return null; }
  const me = tab;

  let dbp: Promise<IDBDatabase> | null = null;
  let opened: IDBDatabase | null = null;           // 開いたあとは、待たずに使う(ページが隠れる・閉じる直前の書き込みを、その場で始めるため)
  const db = () => dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('state', { keyPath: 'tab' });
      d.createObjectStore('logs', { keyPath: 'key' }).createIndex('tab', 'tab');
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
  const removeTab = (t: IDBTransaction, which: string) => {
    t.objectStore('state').delete(which);
    const idx = t.objectStore('logs').index('tab');
    const c = idx.openKeyCursor(IDBKeyRange.only(which));
    c.onsuccess = () => { const cur = c.result; if (cur) { t.objectStore('logs').delete(cur.primaryKey); cur.continue(); } };
  };

  // 閉じたタブの古い保存を消す(起動のたび、裏で)
  void (async () => {
    try {
      const d = await db();
      const all = await req(d.transaction('state').objectStore('state').getAll()) as { tab: string; at: number }[];
      const old = all.filter((s) => s.tab !== me && now() - s.at > MAX_AGE_MS).map((s) => s.tab);
      if (old.length) await tx(['state', 'logs'], 'readwrite', (t) => old.forEach((o) => removeTab(t, o)));
    } catch { /* 使えなければ何もしない */ }
  })();

  return {
    resumed,
    putLog: (id, log) => tx(['logs'], 'readwrite', (t) => { t.objectStore('logs').put({ key: `${me}\u0000${id}`, tab: me, id, at: now(), log }); }),
    deleteLog: (id) => tx(['logs'], 'readwrite', (t) => { t.objectStore('logs').delete(`${me}\u0000${id}`); }),
    putState(state) {
      let copied = false;
      try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)); copied = true; } catch { /* IndexedDB のほうだけ */ }
      const p = tx(['state'], 'readwrite', (t) => { t.objectStore('state').put({ tab: me, at: now(), state }); });
      return copied ? p.catch(() => { /* 写しは書けた */ }) : p;
    },
    async load() {
      const d = await db();
      const t = d.transaction(['state', 'logs']);
      const s = await req(t.objectStore('state').get(me)) as { state: unknown } | undefined;
      let state: unknown = s?.state ?? null;
      try { const c = sessionStorage.getItem(STATE_KEY); if (c) state = JSON.parse(c); } catch { /* IndexedDB のほうを使う */ }
      if (state === null) return null;
      const rows = await req(t.objectStore('logs').index('tab').getAll(IDBKeyRange.only(me))) as { id: string; log: TrackLog }[];
      return { state, logs: new Map(rows.map((r) => [r.id, r.log])) };
    },
    async forget() {
      try { sessionStorage.removeItem(TAB_KEY); sessionStorage.removeItem(STATE_KEY); } catch { /* 無視 */ }
      await tx(['state', 'logs'], 'readwrite', (t) => removeTab(t, me));
    },
    async adoptLatest() {
      const d = await db();
      const all = await req(d.transaction('state').objectStore('state').getAll()) as { tab: string; at: number; state: unknown }[];
      const prev = all.filter((s) => s.tab !== me && now() - s.at <= MAX_AGE_MS).sort((a, b) => b.at - a.at)[0];
      if (!prev) return null;
      const rows = await req(d.transaction('logs').objectStore('logs').index('tab').getAll(IDBKeyRange.only(prev.tab))) as { id: string; log: TrackLog }[];
      await tx(['state', 'logs'], 'readwrite', (t) => {
        removeTab(t, prev.tab);
        t.objectStore('state').put({ tab: me, at: now(), state: prev.state });
        for (const r of rows) t.objectStore('logs').put({ key: `${me}\u0000${r.id}`, tab: me, id: r.id, at: now(), log: r.log });
      });
      try { sessionStorage.setItem(STATE_KEY, JSON.stringify(prev.state)); } catch { /* IndexedDB のほうだけ */ }
      return { state: prev.state, logs: new Map(rows.map((r) => [r.id, r.log])) };
    },
  };
}

/** テスト用: メモリに持つ保存先 */
export class MemoryResumeStore implements ResumeStore {
  logs = new Map<string, TrackLog>();
  state: unknown = null;
  constructor(public resumed = false) {}
  async putLog(id: string, log: TrackLog) { this.logs.set(id, log); }
  async deleteLog(id: string) { this.logs.delete(id); }
  async putState(state: unknown) { this.state = state; }
  async load() { return this.state === null ? null : { state: this.state, logs: new Map(this.logs) }; }
  async forget() { this.logs.clear(); this.state = null; this.resumed = false; }
  /** ほかのタブの保存(adoptLatest で引き継ぐもの) */
  previous: { state: unknown; logs: Map<string, TrackLog> } | null = null;
  async adoptLatest() {
    const p = this.previous;
    if (!p) return null;
    this.previous = null;
    this.state = p.state;
    this.logs = new Map(p.logs);
    return { state: p.state, logs: new Map(p.logs) };
  }
}
