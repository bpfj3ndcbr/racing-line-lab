import {
  type Assignment, type Circuit, type GeoLine, type Lap, type LapRef, type LineCandidate, type MapView, type Offset, type Slot, type TrackLog, type TrimCut,
  SLOTS, applyCuts, clearLog, closeLoop, detectLapRun, emptyAssignment, findCrossings, lineCandidate, matchCircuit, matchLap, nameExists, parseCln, parseSci, parseVbo,
  roundLine, toggleAssign,
} from '../core';
import type { KeyValueStore } from '../io/storage';

export interface LoadedLog {
  id: string;
  /** 「走行データN」の N。削除しても詰めない(割り当てが番号に依存するため) */
  no: number;
  log: TrackLog;
  /** 位置補正量(ファイル単位) */
  offset: Offset;
  circuit: Circuit | null;
  /** true ならコントロールライン通過による自動判定 */
  auto: boolean;
  laps: Lap[];
  /** 最初の通過より前に走行がある(一覧に「始点が無いので非表示」と出す) */
  hasHead: boolean;
  /**
   * 比較セットのサーキットが決まっていて、このログがその計測ラインを通らないとき、そのサーキット(ラップ無しのログ)。
   * このとき circuit は null。比較セットのサーキットは 1 つ(案件 3)
   */
  outside: Circuit | null;
  /** ログの内容から作った計測ラインの候補(RaceChrono の [laptiming] / 1 周分のログ)。作れなければ null */
  candidate: LineCandidate | null;
}

/** 候補と、その候補を作ったログ(ほかのログの候補を使うときは、そのログ) */
export interface CandidateRef { candidate: LineCandidate; from: LoadedLog }
/** 位置補正で、同じラップが見つからずに解除した割り当て(set = 比較セットの番号) */
export interface LostAssignment { set: number; slot: Slot; lap: number }

export interface CircuitResult {
  ok: boolean;
  message: string;
  /** duplicate = 同じ名前が既にある / invalid = 入力やファイルが不正 */
  reason?: 'duplicate' | 'invalid';
}

export interface SortState { key: 'lap' | 'time'; dir: 1 | -1 }

/** そのログのベストラップ: 完了ラップがあればその最速、無ければ全ラップの最速。ラップが無ければ null */
export function bestLap(l: LoadedLog): Lap | null {
  const done = l.laps.filter((x) => x.complete);
  const pool = done.length ? done : l.laps;
  return pool.length ? pool.reduce((a, b) => (b.duration < a.duration ? b : a)) : null;
}
/** ベスト基準のタイム(bestLap の長さ。ラップが無ければ NaN) */
export function bestDuration(l: LoadedLog): number { return bestLap(l)?.duration ?? NaN; }

function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    const s = store.get(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch { return fallback; }
}

/** セット数。セットは互いに独立した作業の組(ログ・割り当て・サーキットの指定・並べ替え) */
export const SET_COUNT = 5;

export class WorkSet {
  logs: LoadedLog[] = [];
  /** null = 自動判定 */
  selectedCircuitId: string | null = null;
  assignment: Assignment = emptyAssignment();
  sort: SortState = { key: 'lap', dir: 1 };
  showSectors = false;
  /** 'split' = 区間タイム、'cumulative' = ラップ開始からの通過時刻 */
  sectorMode: 'split' | 'cumulative' = 'split';
  nextNo = 1;
}

/**
 * 比較セットの設定(割り当て・サーキットの指定・並べ替え・セクターの表示・区間 / 通過)の保存の形。
 * 前回の状態(lastSession)と一時保存(ResumeState)の両方で、この形をそのまま使う。
 * 項目を足すときは、setPrefsOf・applySetPrefs(と、割り当てなら applyAssignment)を直せば、両方に効く
 */
export interface SetPrefs {
  assignment?: Partial<Record<Slot, LapRef | null>>; circuitId?: string | null;
  sort?: SortState; showSectors?: boolean; sectorMode?: 'split' | 'cumulative';
}

/** Web 版の一時保存(案件 30)の、小さな状態 */
export interface ResumeState {
  v: 1;
  active: number;
  sets: ({ logs: { id: string; no: number }[]; nextNo?: number } & SetPrefs)[];
}

/** セットの別名の長さの上限(文字数) */
export const ALIAS_MAX = 15;

/** カード名(A〜D の別名)の長さの上限(文字数。地図の引き出し線に出すので短い) */
export const SLOT_ALIAS_MAX = 6;

export class Session {
  circuits: Circuit[];
  /** 比較セット 1〜5 */
  sets: WorkSet[] = Array.from({ length: SET_COUNT }, () => new WorkSet());
  /** 比較画面に出す(表示する)セットの番号(0 始まり) */
  activeIndex = 0;
  /** 画面の下の通知(案件 53)に出す案内文。warn = 読み込めなかったなど、閉じるまで残すもの。seq は案内を出すたびに増える(同じ文でも出し直せる) */
  message = '';
  messageWarn = false;
  messageSeq = 0;
  /** 前回の走行データを読み込んでいる間の案内(読み込み中でなければ空) */
  loading = '';

  // 表示セットの内容(比較画面などから使う)
  get active(): WorkSet { return this.sets[this.activeIndex]; }
  get logs(): LoadedLog[] { return this.active.logs; }
  get selectedCircuitId(): string | null { return this.active.selectedCircuitId; }
  get assignment(): Assignment { return this.active.assignment; }
  get sort(): SortState { return this.active.sort; }
  get showSectors(): boolean { return this.active.showSectors; }
  get sectorMode(): 'split' | 'cumulative' { return this.active.sectorMode; }

  /** 読み込んだファイルの場所(Electron のみ分かる)。次回の自動読み込みに使う */
  private paths = new Map<string, string>();
  private restoring = false;
  /** Web 版の一時保存(案件 30): 走行ログを新しく入れた・どの比較セットからも外したときに知らせる */
  logHooks: { added(id: string, log: TrackLog): void; removed(id: string): void } | null = null;
  private offsets: Record<string, Offset>;
  /** 「終端の調整」の値(ファイル → ラップ番号 → ラップ開始からの秒) */
  private lapEnds: Record<string, Record<string, number>>;
  /** 取り込まない区間(案件 59。ファイル → 元のログの時刻の区間) */
  private trims: Record<string, TrimCut[]>;
  private listeners = new Set<() => void>();

  constructor(private store: KeyValueStore) {
    this.circuits = readJson<Circuit[]>(store, 'circuits', []);
    this.offsets = readJson<Record<string, Offset>>(store, 'offsets', {});
    this.lapEnds = readJson<Record<string, Record<string, number>>>(store, 'lapEnds', {});
    this.trims = readJson<Record<string, TrimCut[]>>(store, 'trims', {});
  }

  /** アプリを初期状態に戻す: 保存したものをすべて消す(画面は呼び出し側で読み直す) */
  factoryReset(): void { this.store.clear(); }
  /** 「比較セットN」(元の名前。別名があっても残る) */
  setLabel(i: number): string { return `比較セット${i + 1}`; }
  /** セット i の別名(無ければ空文字) */
  aliasOf(i: number): string { return this.getSetting<string[]>('setAliases', [])[i] ?? ''; }
  /** セット i の別名を設定する。前後の空白は除き、上限を超える分は切る。空なら別名なしに戻す */
  setAlias(i: number, text: string): void {
    if (i < 0 || i >= SET_COUNT) return;
    const all = Array.from({ length: SET_COUNT }, (_, k) => this.aliasOf(k));
    all[i] = Array.from(text.trim()).slice(0, ALIAS_MAX).join('');
    this.setSetting('setAliases', all);
    this.emit();
  }
  /** セット i の、カード(A〜D)の別名。セットごと・A〜D ごとに持つ(割り当てるラップを替えても残る)。無ければ空文字 */
  slotAliasOf(i: number, slot: Slot): string { return this.getSetting<Record<string, string>>('slotAliases', {})[`${i}${slot}`] ?? ''; }
  setSlotAlias(i: number, slot: Slot, text: string): void {
    if (i < 0 || i >= SET_COUNT || !SLOTS.includes(slot)) return;
    const all = { ...this.getSetting<Record<string, string>>('slotAliases', {}) };
    const v = Array.from(text.trim()).slice(0, SLOT_ALIAS_MAX).join('');
    if (v) all[`${i}${slot}`] = v; else delete all[`${i}${slot}`];
    this.setSetting('slotAliases', all);
    this.emit();
  }
  /** カード名(別名が無ければ「A」「B」「C」「D」) */
  cardName(slot: Slot, i: number = this.activeIndex): string { return this.slotAliasOf(i, slot) || slot; }
  /** 表示用の名前(別名があれば別名、無ければ「比較セットN」) */
  setName(i: number): string { return this.aliasOf(i) || this.setLabel(i); }

  /** 画面の大きさなど、ログに依存しない設定の読み書き */
  getSetting<T>(key: string, fallback: T): T { return readJson<T>(this.store, 'ui.' + key, fallback); }
  setSetting(key: string, value: unknown): void { this.store.set('ui.' + key, JSON.stringify(value)); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    if (!this.restoring) this.saveLastSession();
    this.notify();
  }
  private notify() { this.listeners.forEach((f) => f()); }

  private ws(i?: number): WorkSet { return this.sets[i ?? this.activeIndex] ?? this.active; }

  /** 比較セット i に A〜D の割り当てがあるか(比較画面に出せるのは、割り当てがある比較セットだけ。案件 28) */
  canShow(i: number): boolean { const w = this.sets[i]; return !!w && SLOTS.some((s) => w.assignment[s]); }
  /**
   * 表示中の比較セット。activeIndex の比較セットに割り当てがあるときだけ。無ければ null。
   * 表示中が無いあいだ、activeIndex は「表示予定のセット」(最後に走行ログを入れた比較セット)を指す
   */
  get shownIndex(): number | null { return this.canShow(this.activeIndex) ? this.activeIndex : null; }

  /** セット i の走行ログの位置(logId を渡せばそのログ、無ければ最初のログ)の中央付近。ログが無ければ null */
  logCenter(i: number, logId?: string): { lat: number; lon: number } | null {
    const w = this.sets[i];
    const l = (logId ? w?.logs.find((x) => x.id === logId) : w?.logs[0])?.log;
    if (!l || l.lat.length === 0) return null;
    const k = Math.floor(l.lat.length / 2);
    return { lat: l.lat[k], lon: l.lon[k] };
  }

  /** 表示セットを切り替える */
  setActive(i: number): void {
    if (i < 0 || i >= SET_COUNT || i === this.activeIndex || this.sets[i].logs.length === 0) return;
    this.activeIndex = i;
    this.emit();
  }

  /** 前回の状態(各セットの読み込んだファイル・割り当て・サーキットの指定・並べ替えと、表示セット)を保存する */
  private saveLastSession() {
    const sets = this.sets.map((w) => ({
      files: w.logs.filter((l) => this.paths.has(l.id)).map((l) => ({ id: l.id, path: this.paths.get(l.id)! })),
      ...this.setPrefsOf(w),
    }));
    this.store.set('lastSession', JSON.stringify({ v: 2, active: this.activeIndex, sets }));
  }

  /**
   * 前回の走行データを読み直す: 各セットのファイルを前回の順に読み込み、A〜D の割り当て・サーキットの指定・
   * 表示セットも戻す。同じファイルは 1 回だけ読む。読めなかったファイルは飛ばし、message に出す。
   * read は場所から中身を返す(読めなければ null)。
   */
  async restoreLast(read: (path: string) => Promise<string | null>): Promise<void> {
    type SavedSet = { files?: { id: string; path: string }[] } & SetPrefs;
    type Saved = { v?: number; active?: number; sets?: SavedSet[] };
    const saved = readJson<Saved>(this.store, 'lastSession', {});
    const list: SavedSet[] = saved.sets ?? [];
    const total = list.slice(0, SET_COUNT).reduce((n, w) => n + (w.files?.length ?? 0), 0);
    if (!total || this.sets.some((w) => w.logs.length)) return;
    this.restoring = true;
    const failed: string[] = [];
    const cache = new Map<string, TrackLog | null>();
    let done = 0;
    try {
      for (let si = 0; si < Math.min(list.length, SET_COUNT); si++) {
        const w = this.sets[si], sv = list[si];
        this.applySetPrefs(w, sv);
        for (const f of sv.files ?? []) {
          const name = f.id.slice(0, f.id.lastIndexOf(':')) || f.id;
          this.loading = `前回のファイルを読み込み中… (${++done}/${total}) ${name}`;
          this.notify();
          try {
            if (!cache.has(f.id)) {
              const text = await read(f.path);
              cache.set(f.id, text === null ? null : this.trimmed(parseVbo(text, name), f.id));
            }
            const log = cache.get(f.id);
            if (!log) { failed.push(name); continue; }
            this.paths.set(f.id, f.path);
            this.addEntry(w, log, f.id);
          } catch { cache.set(f.id, null); failed.push(name); }
        }
        this.applyAssignment(w, si, sv.assignment);
      }
      const a = saved.active;
      if (typeof a === 'number' && a >= 0 && a < SET_COUNT) this.activeIndex = a;
      if (failed.length) this.tell(`前回のファイルを読み込めませんでした: ${Array.from(new Set(failed)).join('、')}`, true);
      else this.message = '';
    } finally { this.restoring = false; this.loading = ''; }
    this.emit();
  }

  /** 比較セットの設定の保存の形(SetPrefs)。前回の状態と一時保存で共通 */
  private setPrefsOf(w: WorkSet): SetPrefs {
    return { assignment: w.assignment, circuitId: w.selectedCircuitId, sort: w.sort, showSectors: w.showSectors, sectorMode: w.sectorMode };
  }
  /** 保存した比較セットの設定を戻す(割り当て以外)。登録に無いサーキット・形の合わない値は戻さない。走行ログを入れる前に呼ぶ */
  private applySetPrefs(w: WorkSet, sv: SetPrefs) {
    if (sv.circuitId && this.circuits.some((c) => c.id === sv.circuitId)) w.selectedCircuitId = sv.circuitId;
    if (sv.sort && (sv.sort.key === 'lap' || sv.sort.key === 'time') && (sv.sort.dir === 1 || sv.sort.dir === -1)) w.sort = sv.sort;
    w.showSectors = sv.showSectors === true;
    w.sectorMode = sv.sectorMode === 'cumulative' ? 'cumulative' : 'split';
  }
  /** 保存した割り当てを戻す(そのラップが今もあるものだけ)。走行ログを入れたあとに呼ぶ */
  private applyAssignment(w: WorkSet, si: number, saved: SetPrefs['assignment']) {
    for (const s of SLOTS) {
      const ref = saved?.[s] ?? null;
      if (ref && this.resolveRef(ref, si)) w.assignment = { ...w.assignment, [s]: { logId: ref.logId, lap: ref.lap } };
    }
  }

  /**
   * Web 版の一時保存(案件 30)の、小さな状態: 比較セットごとの走行ログ(id と Run 番号)・割り当て・設定と、表示中の比較セット。
   * 走行ログの中身は含めない(logHooks で別に保存する)
   */
  resumeState(): ResumeState {
    return {
      v: 1, active: this.activeIndex,
      sets: this.sets.map((w) => ({
        logs: w.logs.map((l) => ({ id: l.id, no: l.no })), nextNo: w.nextNo,
        ...this.setPrefsOf(w),
      })),
    };
  }

  /**
   * 一時保存から元に戻す(案件 30)。logs は id → 走行ログ(読み込んだときの中身)。中身が無い走行ログは飛ばす。
   * 走行ログがすでに入っているときは何もしない。戻した走行ログの数を返す
   */
  restoreResume(saved: unknown, logs: Map<string, TrackLog>): number {
    const st = saved as Partial<ResumeState> | null;
    if (!st || st.v !== 1 || !Array.isArray(st.sets) || this.sets.some((w) => w.logs.length)) return 0;
    let n = 0;
    this.restoring = true;
    try {
      st.sets.slice(0, SET_COUNT).forEach((sv, si) => {
        const w = this.sets[si];
        this.applySetPrefs(w, sv);
        for (const r of sv.logs ?? []) {
          const log = logs.get(r.id);
          if (!log) continue;
          this.addEntry(w, log, r.id);
          const e = w.logs[w.logs.length - 1];
          if (e?.id === r.id && Number.isInteger(r.no)) e.no = r.no;
          n++;
        }
        if (Number.isInteger(sv.nextNo)) w.nextNo = Math.max(w.nextNo, sv.nextNo!);
        this.applyAssignment(w, si, sv.assignment);
      });
      if (typeof st.active === 'number' && st.active >= 0 && st.active < SET_COUNT) this.activeIndex = st.active;
      if (n) this.tell('前の画面の状態を元に戻しました。');
    } finally { this.restoring = false; this.loading = ''; }
    this.emit();
    return n;
  }

  // ---- 走行ログ ----
  /** どこかのセットに読み込み済みのファイルなら、その中身(同じファイルを別のセットに入れるとき、読み直さない) */
  private knownLog(id: string): TrackLog | null { return this.knownEntry(id)?.log ?? null; }

  async addVboFile(file: File, path?: string, set?: number): Promise<void> {
    try {
      const id = `${file.name}:${file.size}`;
      const log = this.knownLog(id) ?? this.trimmed(parseVbo(await file.text(), file.name), id);
      if (path) this.paths.set(id, path);
      this.addLog(log, id, set);
    } catch (e) {
      this.tell(`${file.name}: 読み込めませんでした(${e instanceof Error ? e.message : e})`, true);
      this.emit();
    }
  }

  /** 複数のファイルをまとめて追加する(割り当ては自動では行わない。「はじめかた」などで、速いものから自動 / 手動を選ぶ) */
  async addVboFiles(files: { file: File; path?: string }[], set?: number): Promise<void> {
    for (const f of files) await this.addVboFile(f.file, f.path, set);
  }

  /**
   * 各ログのベストラップを、速い順に、空いている枠の若い方から割り当てる(空きが無くなったら止める)。
   * 割り当てた数を返す。割り当てたセットが「表示セット」になる
   */
  autoAssignFastest(set?: number): number {
    const i = set ?? this.activeIndex;
    const w = this.sets[i];
    if (!w) return 0;
    const cands = w.logs.flatMap((l) => { const lap = bestLap(l); return lap ? [{ id: l.id, lap }] : []; })
      .sort((a, b) => a.lap.duration - b.lap.duration);
    let n = 0;
    for (const c of cands) {
      if (SLOTS.some((s) => w.assignment[s]?.logId === c.id && w.assignment[s]?.lap === c.lap.number)) continue;
      const free = SLOTS.find((s) => !w.assignment[s]);
      if (!free) break;
      w.assignment = { ...w.assignment, [free]: { logId: c.id, lap: c.lap.number } };
      n++;
    }
    if (n) { this.activeIndex = i; this.emit(); }
    return n;
  }

  /** 画面の下の通知に出す案内文。warn = 読み込めなかったなど、閉じるまで残すもの */
  say(text: string, warn = false): void { this.tell(text, warn); this.emit(); }
  private tell(text: string, warn = false): void { this.message = text; this.messageWarn = warn; this.messageSeq++; }
  /** 読み込み中の案内(空文字で消す)。一時保存から元に戻す間など(案件 30) */
  setLoading(text: string): void { this.loading = text; this.notify(); }

  /** 「はじめかた」を閉じているか。未設定なら、一度でも比較を開いた後は閉じた状態で始まる */
  get guideClosed(): boolean {
    const c = this.getSetting<boolean | null>('guideClosed', null);
    return c ?? this.getSetting<boolean>('guideSeen', false);
  }
  setGuideClosed(closed: boolean): void { this.setSetting('guideClosed', closed); this.emit(); }
  markGuideSeen(): void { if (!this.getSetting<boolean>('guideSeen', false)) this.setSetting('guideSeen', true); }

  addLog(log: TrackLog, id: string, set?: number): void {
    // 表示中が無いあいだは、走行ログを入れた比較セットを「表示予定のセット」にする(案件 28)
    if (set !== undefined && this.sets[set] && this.shownIndex === null) this.activeIndex = set;
    const w = this.ws(set);
    if (w.logs.some((l) => l.id === id)) {
      this.tell(`${log.fileName} は読み込み済みです。`);
      this.emit();
      return;
    }
    const isNew = !this.knownEntry(id);
    this.addEntry(w, log, id);
    if (isNew) this.logHooks?.added(id, log);
    this.message = '';
    this.emit();
  }

  private addEntry(w: WorkSet, log: TrackLog, id: string) {
    // 1 周分だけのログ(輪)は、つないだログにしておく(closeLoop)。別のセットに読み込み済みなら、その中身を共有する
    if (w.logs.some((l) => l.id === id)) return;
    const known = this.knownEntry(id);
    const full = known?.log ?? closeLoop(log);
    const entry: LoadedLog = {
      id, no: w.nextNo++, log: full, offset: this.offsets[id] ?? { east: 0, north: 0 },
      circuit: null, auto: true, laps: [], hasHead: false, outside: null,
      candidate: known ? known.candidate : lineCandidate(full),
    };
    w.logs.push(entry);
    this.resolveSet(w, undefined, id);
  }
  /**
   * ログ l に使える計測ラインの候補。自分の候補があればそれ。無ければ、読み込み済みのほかのログ(どのセットでも)の候補のうち、
   * l の走行がその計測ラインを通るもの(RaceChrono の [laptiming] から作ったものを先に)。無ければ null
   */
  candidateFor(l: LoadedLog): CandidateRef | null {
    if (l.candidate) return { candidate: l.candidate, from: l };
    const seen = new Set<string>();
    const pool: LoadedLog[] = [];
    for (const w of this.sets) for (const x of w.logs) if (x.candidate && !seen.has(x.id)) { seen.add(x.id); pool.push(x); }
    pool.sort((p, q) => Number(q.candidate!.source === 'laptiming') - Number(p.candidate!.source === 'laptiming'));
    const hit = pool.find((x) => findCrossings(l.log, x.candidate!.control, { offset: l.offset }).length > 0);
    return hit ? { candidate: hit.candidate!, from: hit } : null;
  }

  /** どこかのセットに読み込み済みのファイルなら、そのログ */
  private knownEntry(id: string): LoadedLog | null {
    for (const w of this.sets) { const l = w.logs.find((x) => x.id === id); if (l) return l; }
    return null;
  }

  removeLog(id: string, set?: number): void {
    const w = this.ws(set);
    w.logs = w.logs.filter((l) => l.id !== id);
    w.assignment = clearLog(w.assignment, id);
    if (!this.sets.some((x) => x.logs.some((l) => l.id === id))) { this.paths.delete(id); this.logHooks?.removed(id); }
    this.resolveSet(w);                                           // 比較セットのサーキットが変わることがある
    this.emit();
  }

  /**
   * 位置補正量を変え、ラップを計算し直す。(0, 0) に戻したときは保存からも消す。同じファイルが入っている全部のセットに効く。
   * 割り当ては、補正の前と同じラップ(matchLap)が見つかれば残し、
   * 見つからなかったものだけ解除して、message で知らせる(案件 19)。解除したもの(セット・カード・ラップ番号)を返す
   */
  setOffset(id: string, offset: Offset): LostAssignment[] {
    if (!this.sets.some((w) => w.logs.some((x) => x.id === id))) return [];
    const lost = this.applyOffset(id, offset);
    this.saveOffsets();
    if (lost.length) {
      const multi = new Set(lost.map((x) => x.set)).size > 1 || lost.some((x) => x.set !== this.activeIndex);
      this.tell(`位置補正で ${lost.map((x) => `${multi ? this.setName(x.set) + ' の ' : ''}${x.slot}(LAP ${x.lap})`).join('、')} のラップが無くなったため、割り当てを解除しました。`, true);
    }
    this.emit();
    return lost;
  }

  private applyOffset(id: string, offset: Offset): LostAssignment[] {
    if (offset.east === 0 && offset.north === 0) delete this.offsets[id]; else this.offsets[id] = offset;
    const lost: LostAssignment[] = [];
    this.sets.forEach((w, set) => {
      const l = w.logs.find((x) => x.id === id);
      if (!l) return;
      // 補正の前に割り当てていたラップ(補正のあとに、同じラップを探して付け直す)
      const keep = SLOTS.flatMap((slot) => {
        const ref = w.assignment[slot];
        const lap = ref?.logId === id ? l.laps.find((x) => x.number === ref.lap) : undefined;
        return lap ? [{ slot, lap }] : [];
      });
      l.offset = offset;
      w.assignment = clearLog(w.assignment, id);
      this.resolveSet(w);
      for (const k of keep) {
        const hit = matchLap(k.lap, l.laps, l.log.loop?.period);
        if (hit) w.assignment = { ...w.assignment, [k.slot]: { logId: id, lap: hit.number } };
        else lost.push({ set, slot: k.slot, lap: k.lap.number });
      }
    });
    return lost;
  }
  /**
   * 「終端の調整」: ラップ番号 lap の終端を、ラップ開始から sec 秒にする(null で調整をやめる)。
   * 同じファイルを入れたすべてのセットに反映する。割り当ては解除しない
   */
  setLapEnd(id: string, lap: number, sec: number | null): void {
    const cur = { ...(this.lapEnds[id] ?? {}) };
    if (sec === null) delete cur[lap]; else cur[lap] = Math.round(sec);
    if (Object.keys(cur).length) this.lapEnds[id] = cur; else delete this.lapEnds[id];
    this.saveLapEnds();
    for (const w of this.sets) { const l = w.logs.find((x) => x.id === id); if (l) this.computeLaps(l); }
    this.emit();
  }
  /** ファイル id の取り込まない区間(案件 59。無ければ空) */
  trimOf(id: string): TrimCut[] { return (this.trims[id] ?? []).map((c) => ({ ...c })); }
  /**
   * ファイル id の取り込まない区間を保存する(空で消す)。次にそのファイルを読み込むときから当てはめる
   * (デスクトップ版の前回のファイルの読み直しも)。読み込み済みのログは変えない
   */
  setTrim(id: string, cuts: readonly TrimCut[]): void {
    const list = cuts.map((c) => ({ from: Math.round(c.from * 10) / 10, to: Math.round(c.to * 10) / 10 })).filter((c) => c.to > c.from);
    if (list.length) this.trims[id] = list; else delete this.trims[id];
    this.store.set('trims', JSON.stringify(this.trims));
  }
  /** 解析したばかりのログに、保存した取り込み範囲を当てはめる(当てはめられなければ、そのまま) */
  private trimmed(log: TrackLog, id: string): TrackLog {
    const cuts = this.trims[id];
    if (!cuts?.length) return log;
    try { return applyCuts(log, cuts); } catch { return log; }
  }
  /** ラップ番号 lap の「終端の調整」の値(調整していなければ null) */
  lapEnd(id: string, lap: number): number | null { return this.lapEnds[id]?.[lap] ?? null; }
  /** ラップ番号の意味が変わったとき(計測ライン・サーキットの判定が変わったとき)、そのファイルの調整をやめる */
  private clearLapEnds(id: string): boolean {
    if (!this.lapEnds[id]) return false;
    delete this.lapEnds[id];
    this.saveLapEnds();
    return true;
  }
  private saveLapEnds() { this.store.set('lapEnds', JSON.stringify(this.lapEnds)); }

  /** 位置補正の値を持っているファイルの数 */
  offsetCount(): number { return Object.keys(this.offsets).length; }

  private saveOffsets() { this.store.set('offsets', JSON.stringify(this.offsets)); }

  /** 位置補正データを JSON(ファイルに保存する文字列)にする。キーは走行ログのファイル(名前:サイズ) */
  exportOffsets(): string {
    return JSON.stringify({ app: 'racing-line-lab', kind: 'offsets', version: 1, offsets: this.offsets }, null, 2);
  }

  /**
   * 書き出した位置補正データを取り込む。いま読み込んでいるログには、すぐ反映する(ラップも再計算)。
   * まだ読み込んでいないログの分も保存しておき、あとで読み込んだときに適用される。
   */
  importOffsets(text: string): { ok: boolean; applied: number; total: number; message: string } {
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = null; }
    const src = (data as { offsets?: unknown } | null)?.offsets;
    if (!src || typeof src !== 'object' || (data as { kind?: unknown }).kind !== 'offsets') {
      this.tell('位置補正データとして読み込めませんでした。', true);
      this.emit();
      return { ok: false, applied: 0, total: 0, message: this.message };
    }
    const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000;
    let total = 0, applied = 0;
    for (const [id, o] of Object.entries(src as Record<string, { east?: unknown; north?: unknown }>)) {
      if (!o || !valid(o.east) || !valid(o.north)) continue;
      total++;
      const off = { east: o.east, north: o.north };
      if (this.sets.some((w) => w.logs.some((x) => x.id === id))) { this.applyOffset(id, off); applied++; }
      else if (off.east === 0 && off.north === 0) delete this.offsets[id];
      else this.offsets[id] = off;
    }
    this.saveOffsets();
    this.tell(`位置補正データを読み込みました(${total} 件、うち読み込み済みのログに適用 ${applied} 件)。`);
    this.emit();
    return { ok: true, applied, total, message: this.message };
  }

  // ---- サーキット ----
  setCircuit(id: string | null, set?: number): void {
    const w = this.ws(set);
    w.selectedCircuitId = id;
    // 変えたセットだけでなく、全部のセットを計算し直す。終端の調整はファイル単位なので、このセットでサーキットが変わって
    // 調整を解除したログが、ほかのセットにも入っていることがある(案件 38 で確かめた)
    this.resolveAll();
    this.emit();
  }

  /** ファイル(.cln / .sci の中身)からサーキットを登録する。線はファイルの値のまま */
  registerCircuit(name: string, clnText: string, sciText: string, view?: MapView): CircuitResult {
    const bad = this.circuitNameError(name);
    if (bad) return bad;
    const control = parseCln(clnText)[0];
    if (!control) return { ok: false, reason: 'invalid', message: '.cln からコントロールラインを読み取れませんでした。' };
    return this.addCircuit(name.trim(), control, parseSci(sciText).map((x) => x.line), view, false);
  }

  /**
   * 画面で決めた線から、サーキットを登録する(サーキットの編集画面・読み込みの確認画面)。線は保存の桁(LINE_DIGITS)に丸める。
   * announce なら、登録できたことを message で知らせる
   */
  registerCircuitLines(name: string, control: GeoLine, sectors: GeoLine[], opts: { view?: MapView; announce?: boolean } = {}): CircuitResult {
    const bad = this.circuitNameError(name);
    if (bad) return bad;
    return this.addCircuit(name.trim(), roundLine(control), sectors.map(roundLine), opts.view, opts.announce === true);
  }

  private circuitNameError(name: string): CircuitResult | null {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, reason: 'invalid', message: 'サーキット名を入力してください。' };
    if (nameExists(this.circuits, trimmed)) return { ok: false, reason: 'duplicate', message: '既に名前が存在します' };
    return null;
  }

  private addCircuit(name: string, control: GeoLine, sectors: GeoLine[], view: MapView | undefined, announce: boolean): CircuitResult {
    this.circuits = [...this.circuits, { id: `c${Date.now().toString(36)}${this.circuits.length}`, name, control, sectors, ...(view ? { view } : {}) }];
    this.saveCircuits();
    this.resolveAll();
    const message = `「${name}」を登録しました(セクター ${sectors.length} 本)。`;
    if (announce) this.tell(message);
    this.emit();
    return { ok: true, message };
  }

  renameCircuit(id: string, name: string): CircuitResult {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, reason: 'invalid', message: 'サーキット名を入力してください。' };
    if (nameExists(this.circuits, trimmed, id)) return { ok: false, reason: 'duplicate', message: '既に名前が存在します' };
    this.circuits = this.circuits.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
    this.saveCircuits();
    this.emit();
    return { ok: true, message: `名前を「${trimmed}」に変更しました。` };
  }

  /**
   * 地図で引いた / 直したラインを保存する。変わったものだけ更新し、変わっていれば
   * そのサーキットのラップ・セクタータイムを計算し直す(コントロールラインが変わったときだけ割り当てを解除する)。
   */
  setCircuitLines(id: string, control: GeoLine, sectors: GeoLine[]): CircuitResult {
    const c = this.circuits.find((x) => x.id === id);
    if (!c) return { ok: false, reason: 'invalid', message: 'サーキットが見つかりません。' };
    const ctl = roundLine(control), secs = sectors.map(roundLine);
    const patch: Partial<Pick<Circuit, 'control' | 'sectors'>> = {};
    if (JSON.stringify(ctl) !== JSON.stringify(c.control)) patch.control = ctl;
    if (JSON.stringify(secs) !== JSON.stringify(c.sectors)) patch.sectors = secs;
    if (Object.keys(patch).length) this.updateCircuit(id, patch);
    return { ok: true, message: `「${c.name}」のラインを保存しました(セクター ${secs.length} 本)。` };
  }

  /** 地図の表示位置を保存する(ラップには影響しない) */
  setCircuitView(id: string, view: MapView): void {
    this.circuits = this.circuits.map((c) => (c.id === id ? { ...c, view } : c));
    this.saveCircuits();
    this.emit();
  }

  /** コントロールラインを .cln から読み直す。ラップは再計算される。 */
  reloadControl(id: string, clnText: string): CircuitResult {
    const c = this.circuits.find((x) => x.id === id);
    if (!c) return { ok: false, reason: 'invalid', message: 'サーキットが見つかりません。' };
    const control = parseCln(clnText)[0];
    if (!control) return { ok: false, reason: 'invalid', message: '.cln からコントロールラインを読み取れませんでした。' };
    this.updateCircuit(id, { control });
    return { ok: true, message: `「${c.name}」のコントロールラインを更新しました。` };
  }

  /** セクターを .sci から読み直す。ラップのセクタータイムは再計算される。 */
  reloadSectors(id: string, sciText: string): CircuitResult {
    const c = this.circuits.find((x) => x.id === id);
    if (!c) return { ok: false, reason: 'invalid', message: 'サーキットが見つかりません。' };
    const sectors = parseSci(sciText).map((x) => x.line);
    if (!sectors.length) return { ok: false, reason: 'invalid', message: '.sci からセクターを読み取れませんでした。' };
    this.updateCircuit(id, { sectors });
    return { ok: true, message: `「${c.name}」のセクターを更新しました(${sectors.length} 本)。` };
  }

  private updateCircuit(id: string, patch: Partial<Pick<Circuit, 'control' | 'sectors'>>) {
    this.circuits = this.circuits.map((c) => (c.id === id ? { ...c, ...patch } : c));
    this.saveCircuits();
    // このサーキットのラップは変わるので、関係するログの割り当てを解除して計算し直す。
    // コントロールラインが変わる(ラップ番号が変わる)か、サーキットの判定が変わったときだけ解除する。
    // セクターだけの変更ではラップは同じなので、A〜D の割り当てはそのまま残す
    for (const w of this.sets) this.resolveSet(w, patch.control ? id : undefined);
    this.emit();
  }

  deleteCircuit(id: string): void {
    this.circuits = this.circuits.filter((c) => c.id !== id);
    for (const w of this.sets) if (w.selectedCircuitId === id) w.selectedCircuitId = null;
    this.saveCircuits();
    this.resolveAll();
    this.emit();
  }

  private saveCircuits() { this.store.set('circuits', JSON.stringify(this.circuits)); }

  /** 全セットの全ログのラップを計算し直す。サーキットが変わったログの割り当ては解除する。 */
  private resolveAll() { for (const w of this.sets) this.resolveSet(w); }

  /**
   * 比較セットのサーキット: 「使用するサーキット」で選んでいればそれ。自動判定なら、セットの中で最初に
   * 判定できたログのサーキット。無ければ null(未判定)
   */
  setCircuitOf(set?: number): Circuit | null {
    const w = this.ws(set);
    return this.chosenOf(w) ?? w.logs.find((l) => l.circuit && l.auto)?.circuit ?? null;
  }
  private chosenOf(w: WorkSet): Circuit | null {
    return (w.selectedCircuitId ? this.circuits.find((c) => c.id === w.selectedCircuitId) : undefined) ?? null;
  }

  /**
   * セットの全ログのサーキットとラップを決め直す(比較セットのサーキットは 1 つ)。
   * サーキットが変わったログ(と、controlChangedId のサーキットのログ)は、割り当てと終端の調整を解除する。
   * added は、いま追加したログ(保存してある終端の調整を使うので、解除しない)
   */
  private resolveSet(w: WorkSet, controlChangedId?: string, added?: string) {
    const before = new Map(w.logs.map((l) => [l.id, l.circuit?.id ?? null]));
    const chosen = this.chosenOf(w);
    let setCircuit = chosen;
    if (!setCircuit) {
      for (const l of w.logs) {
        const m = matchCircuit(l.log, this.circuits, l.offset)?.circuit ?? null;
        if (m) { setCircuit = m; break; }
      }
    }
    for (const l of w.logs) {
      l.auto = !chosen;
      const crosses = setCircuit ? findCrossings(l.log, setCircuit.control, { offset: l.offset }).length > 0 : false;
      l.circuit = crosses ? setCircuit : null;
      l.outside = setCircuit && !crosses ? setCircuit : null;
      const b = before.get(l.id) ?? null, a = l.circuit?.id ?? null;
      if (l.id !== added && (b !== a || (controlChangedId && (b === controlChangedId || a === controlChangedId)))) {
        w.assignment = clearLog(w.assignment, l.id);
        this.clearLapEnds(l.id);
      }
      this.computeLaps(l);
    }
  }

  /** ログ l の、決まったサーキットでのラップ */
  private computeLaps(l: LoadedLog) {
    const ends = this.lapEnds[l.id];
    const run = l.circuit
      ? detectLapRun(l.log, l.circuit.control, l.circuit.sectors, { offset: l.offset, ends: ends && Object.fromEntries(Object.entries(ends).map(([k, v]) => [Number(k), v])) })
      : null;
    l.laps = run?.laps ?? [];
    l.hasHead = run?.hasHead ?? false;
  }

  // ---- 表示・割り当て(set を省くと、表示セット) ----
  toggleSort(key: SortState['key'], set?: number) {
    const w = this.ws(set);
    w.sort = w.sort.key === key ? { key, dir: w.sort.dir === 1 ? -1 : 1 } : { key, dir: 1 };
    this.emit();
  }
  toggleSectors(set?: number) { const w = this.ws(set); w.showSectors = !w.showSectors; this.emit(); }
  setSectorMode(m: 'split' | 'cumulative', set?: number) { this.ws(set).sectorMode = m; this.emit(); }
  /** 表示していないセットで割り当てを操作したときは、そのセットを表示セットにする */
  toggleAssignment(slot: Slot, ref: LapRef, set?: number) {
    if (set !== undefined && set !== this.activeIndex && this.sets[set]) this.activeIndex = set;
    const w = this.active;
    w.assignment = toggleAssign(w.assignment, slot, ref);
    this.emit();
  }
  resolveRef(ref: LapRef | null, set?: number): { log: LoadedLog; lap: Lap } | null {
    if (!ref) return null;
    const log = this.ws(set).logs.find((l) => l.id === ref.logId);
    const lap = log?.laps.find((x) => x.number === ref.lap);
    return log && lap ? { log, lap } : null;
  }
}
