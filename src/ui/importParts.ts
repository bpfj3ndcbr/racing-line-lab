import { formatJst } from '../core';
import type { LoadedLog } from '../store/session';

/**
 * 「データ管理」の画面(importView)を役割ごとに分けた部品(案件 40)の、共通の決まり。
 * 各部品は、自分の場所の HTML を作り(render)、自分の操作(data-act)を処理する(handle)。
 * importView は、描画のときに各部品の render を順に呼び、クリックを各部品の handle に順に渡す。
 */
export interface ImportPart {
  render(): void;
  /** 自分の操作なら処理して true。d は押した要素の data-* */
  handle(act: string, d: DOMStringMap): boolean;
}

/** 部品をまたぐ操作(importView が用意して渡す) */
export interface ImportActions {
  /** 比較セット set に走行ログ(.vbo)を追加する(ファイルを選ぶ画面を開く) */
  addLogs(set: number): void;
  /** 位置補正・サーキットの登録 / 編集の大きな画面を開く */
  openWork(kind: 'correct' | 'circuit', id: string | null, set?: number): void;
  /** 地図でサーキットを登録する画面を、セット set のログ(logId。無ければ最初のログ)の場所で開く */
  openMapRegister(set: number, logId?: string): void;
  /** ログの計測ラインの候補で、読み込みの確認画面を開く */
  openLoadCheck(set: number, logId: string): void;
  /** 「サーキット」の節を、タブ tab で開いて見せる */
  openCircuitSection(tab: CircuitTab): void;
  /** 比較セット set を開いて、「使用するサーキット」を選べるようにする */
  focusCircuitSelect(set: number): void;
  /** 比較セット set を開いて、見えるようにする */
  scrollToSet(set: number): void;
  /** 速いものから自動で割り当てて、そのセットを見せる */
  autoAssign(set: number): void;
  /** 「比較画面へ」 */
  toCompare(): void;
}

/** 「サーキット」の節のタブ(案件 25 で「登録済みサーキット」を先頭に) */
export type CircuitTab = 'list' | 'reg' | 'map';

/** 折りたたみの見出しの右端の案内 */
export const SEC_HINT = '<span class="sec-hint"><span class="h-open">クリックで閉じる</span><span class="h-closed">クリックで開く</span></span>';

/** 走行ログの日時(JST)。分からなければ「日時不明」 */
export const dateOf = (l: LoadedLog): string => (l.log.startEpochMs ? formatJst(l.log.startEpochMs) : '日時不明');
