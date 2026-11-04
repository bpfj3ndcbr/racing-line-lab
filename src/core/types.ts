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
  /**
   * 1 周分だけのログ(輪)を、読み込み時に「元のログ + 同じ 1 周をもう一度」へつないだときの情報(closeLoop)。
   * 0〜n-1 番が元のログ、n 番以降がつないだ部分。period は 1 周の時間(秒)
   */
  loop?: { n: number; period: number };
}

export interface Lap {
  /** 最初のコントロールライン通過から 1(計測ラインの位置によっては、RaceChrono の番号と異なる) */
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
  /** 終端を調整する前の長さ(秒) */
  baseDuration: number;
  /** 終端を調整できる上限の長さ(秒)。完了ラップはその長さ、終点無しのラップは記録の終わりまで(最大 30 分) */
  maxDuration: number;
}
