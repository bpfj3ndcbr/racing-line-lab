/**
 * 設定タブの項目。各項目は「初期値」と「最後の状態を記憶する」を持つ。
 * 記憶する = 前回の状態(操作した結果)で始まる。記憶しない = 設定した初期値で始まる。
 * 「前回の状態」は、各画面が操作のたびに保存する(保存先のキーは lastKey)。
 */
export interface PrefStore {
  getSetting<T>(key: string, fallback: T): T;
  setSetting(key: string, value: unknown): void;
}

export type ThemeV = 'light' | 'dark';
export type MapModeV = 'line' | 'speed' | 'accel';
export type FollowV = 'fixed' | 'leader' | 'A' | 'B' | 'C' | 'D';
export type XKindV = 'dist' | 'time';
export type SyncV = 'all' | 'leader';
/** 地図の引き出し線: 出さない / 速度・タイム差 / カード名 */
export type LabelV = 'off' | 'speed' | 'name';

/** 倍率の初期値: 0 = サーキット全体(登録した表示位置、無ければ走行ライン全体)、それ以外は地図のズーム */
export const ZOOM_CHOICES = [14, 15, 16, 17, 18, 19, 20];
export const RATE_CHOICES = [0.25, 0.5, 1, 2, 3];
export const YMIN_CHOICES = { min: 0, max: 100, step: 10 };

export interface PrefValues {
  theme: ThemeV;
  mapMode: MapModeV;
  labels: LabelV;
  zoom: number;
  follow: FollowV;
  xKind: XKindV;
  sync: SyncV;
  rate: number;
}
export type PrefKey = keyof PrefValues;
export interface PrefItem<V> { remember: boolean; value: V }

export const DEFAULT_VALUES: PrefValues = {
  theme: 'light', mapMode: 'line', labels: 'off', zoom: 0, follow: 'fixed', xKind: 'dist', sync: 'all', rate: 1,
};
/** 最初から「記憶する」になっている項目(操作の結果を自動で保存する項目) */
export const DEFAULT_REMEMBER: Record<PrefKey, boolean> = {
  theme: true, mapMode: true, labels: true, zoom: false, follow: false, xKind: false, sync: true, rate: false,
};
/** 「前回の状態」の保存先(theme は ThemeController が管理) */
export const LAST_KEY: Record<PrefKey, string | null> = {
  theme: null, mapMode: 'compare.mapMode', labels: 'compare.labels', zoom: 'compare.zoom', follow: 'compare.follow',
  xKind: 'compare.xKind', sync: 'compare.sync', rate: 'compare.rate',
};

const clean: { [K in PrefKey]: (v: unknown) => PrefValues[K] | null } = {
  theme: (v) => (v === 'light' || v === 'dark' ? v : null),
  mapMode: (v) => (v === 'line' || v === 'speed' || v === 'accel' ? v : null),
  labels: (v) => (v === 'off' || v === 'speed' || v === 'name' ? v : null),
  zoom: (v) => (v === 0 || (typeof v === 'number' && ZOOM_CHOICES.includes(v)) ? (v as number) : null),
  follow: (v) => (v === 'fixed' || v === 'leader' || v === 'A' || v === 'B' || v === 'C' || v === 'D' ? v : null),
  xKind: (v) => (v === 'dist' || v === 'time' ? v : null),
  sync: (v) => (v === 'all' || v === 'leader' ? v : null),
  rate: (v) => (typeof v === 'number' && RATE_CHOICES.includes(v) ? v : null),
};

export type StartPos = 'center' | 'control';
interface Saved { items?: Partial<Record<PrefKey, { remember?: unknown; value?: unknown }>>; yMin?: unknown; startPos?: unknown; autoLoad?: unknown; analytics?: unknown }

export class Prefs {
  constructor(private s: PrefStore) {}

  private saved(): Saved { return this.s.getSetting<Saved>('prefs', {}) ?? {}; }
  private write(p: Saved) { this.s.setSetting('prefs', p); }

  get<K extends PrefKey>(k: K): PrefItem<PrefValues[K]> {
    const it = this.saved().items?.[k];
    const value = clean[k](it?.value) ?? DEFAULT_VALUES[k];
    const remember = typeof it?.remember === 'boolean' ? it.remember : DEFAULT_REMEMBER[k];
    return { remember, value: value as PrefValues[K] };
  }
  setRemember(k: PrefKey, remember: boolean) { this.patch(k, { remember }); }
  setValue<K extends PrefKey>(k: K, value: PrefValues[K]) { this.patch(k, { value }); }
  private patch(k: PrefKey, p: { remember?: boolean; value?: unknown }) {
    const cur = this.saved();
    const now = this.get(k);
    this.write({ ...cur, items: { ...cur.items, [k]: { remember: now.remember, value: now.value, ...p } } });
  }

  /** 速度グラフの最低速度(km/h)。これは操作で変わらないので「記憶する」は無い */
  get yMin(): number {
    const v = this.saved().yMin;
    return typeof v === 'number' && v >= YMIN_CHOICES.min && v <= YMIN_CHOICES.max ? Math.round(v / YMIN_CHOICES.step) * YMIN_CHOICES.step : 0;
  }
  setYMin(v: number) { this.write({ ...this.saved(), yMin: v }); }

  /** 地図の初期位置: 'center' = 地図の中心(登録した表示位置・走行ライン全体の中心)、'control' = コントロールラインの中心。操作で変わらないので「記憶する」は無い */
  get startPos(): StartPos { return this.saved().startPos === 'control' ? 'control' : 'center'; }
  setStartPos(v: StartPos) { this.write({ ...this.saved(), startPos: v }); }

  /** 起動時に、前回の走行データ(ファイルと A〜D の割り当て)を自動で読み込む */
  get autoLoad(): boolean { return this.saved().autoLoad !== false; }
  setAutoLoad(v: boolean) { this.write({ ...this.saved(), autoLoad: v }); }

  /** 利用状況の送信(Google アナリティクス。Web 版のみ)。初期値はオン */
  get analytics(): boolean { return this.saved().analytics !== false; }
  setAnalytics(v: boolean) { this.write({ ...this.saved(), analytics: v }); }

  /** 前回の状態(保存が無い・読めないときは null) */
  last<K extends PrefKey>(k: K): PrefValues[K] | null {
    const key = LAST_KEY[k];
    if (!key) return null;
    return clean[k](this.s.getSetting<unknown>(key, null));
  }
  /** 操作した結果を、前回の状態として保存する */
  saveLast<K extends PrefKey>(k: K, v: PrefValues[K]) {
    const key = LAST_KEY[k];
    if (key) this.s.setSetting(key, v);
  }
  /** 起動したときの状態: 記憶する → 前回の状態(無ければ初期値)、しない → 初期値 */
  initial<K extends PrefKey>(k: K): PrefValues[K] {
    const it = this.get(k);
    return it.remember ? this.last(k) ?? it.value : it.value;
  }

  reset() { this.write({}); }
}
