/** 読み込んだ走行ログ(.vbo)。時刻は先頭サンプルを 0 とした秒。 */
export interface TrackLog {
  fileName: string;
  /** ヘッダから得た作成日時(UTC) */
  createdUtc: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null;
  /** 先頭サンプルの UNIX 時刻(ms, UTC)。日付が分からなければ null */
  startEpochMs: number | null;
  columns: string[];
  comments: string[];
  /** 秒(先頭=0、単調増加。日跨ぎは補正済み) */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** km/h */
  speed: Float64Array;
  heading?: Float64Array;
  height?: Float64Array;
  longAcc?: Float64Array;
  latAcc?: Float64Array;
}

export interface Lap {
  /** RaceChrono と同じ番号(最初のコントロールライン通過から 1) */
  number: number;
  startTime: number;
  endTime: number;
  duration: number;
  /** 終端でコントロールラインを通過していれば true。false は参考値 */
  complete: boolean;
  /** startTime / endTime 以前の最後のサンプル番号 */
  startIndex: number;
  endIndex: number;
  /** 各セクターラインの通過時刻(ラップ開始からの秒)。通過が無ければ null */
  sectorTimes: (number | null)[];
}
