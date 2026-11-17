# AGENTS.md

AI コーディングエージェント(Claude Code など)と、このリポジトリに初めて入る人のための手引きです。

## プロジェクトの概要

**Racing Line Lab** — サーキットの走行ログ(`.vbo`)を読み込み、ラップごとの走行ラインと速度を、航空写真の地図の上で見比べるアプリです。
ブラウザ版と、デスクトップ版(Electron)があります。画面の文字は **日本語** です。

- 言語・ツール: TypeScript(strict)/ Vite / Leaflet / Vitest(jsdom)/ Electron
- 画面: 「データ管理」「比較」「設定」の 3 つのタブ

## よく使うコマンド

```
npm install          # 初回
npm run dev          # ブラウザ版(http://localhost:5173)
npm test             # テスト(vitest)
npm run typecheck    # 型チェックだけ
npm run build        # 型チェック + ビルド(dist/)
npm run electron     # ビルドしてデスクトップ版を起動
npm run dist         # 配布用 .dmg(release/)
```

変更したら、**`npm run typecheck` と `npm test` が通ること**を確認してから終えてください。

## ディレクトリの構成

```
src/core      ラップ検出・セクター・速度/加減速の計算など。画面に依存しない純粋なロジック
src/store     読み込んだログ・A〜D の割り当て・設定(Session / Prefs)。Session は 5 つの WorkSet(比較セット1〜5)を持ち、activeIndex が比較に出るセット
src/io        保存先の抽象化(KeyValueStore: localStorage / Electron のファイル)
src/ui        画面(app / helpView / importView / compareView / settingsView ...)と地図(trackMap)
electron/     デスクトップ版(main / preload / 設定ファイルと地図の保存)。CommonJS(.cjs)
tests/        テスト。tests/helpers.ts に、地図の代わりの FakeMap がある
fixtures/     走行ログ置き場。公開しないので空(.gitkeep と README.md だけ)
```

## 設計の決まりごと

- **地図は `TrackMap`(`src/ui/mapTypes.ts`)越しに使う。** Leaflet に依存してよいのは `src/ui/trackMap.ts` だけです。画面のロジックは `FakeMap` でテストできる状態を保ってください。
- **保存は `KeyValueStore`(`src/io/storage.ts`)越しに行う。** `localStorage` を直接呼ばないでください。デスクトップ版では、同じ窓口がファイル保存に差し替わります。
- **設定の保存キーは変えない。** `compare.mapMode` など、既存のキーを変えると、利用者の保存済みの設定が消えます。新しい項目を足すのは構いません(保存の形式を変えるときは、古い形式を読み替える処理を足すか、版を上げて初期値に戻します)。
- **Electron の画面側(renderer)に、Node の機能を渡さない。** 必要な操作だけを `electron/preload.cjs` の `window.rllNative` で公開します(`contextIsolation: true`)。
- **`src/core` は DOM や Leaflet を import しない。** 純粋な関数にして、単体でテストできるようにします。
- **「使い方」タブは README.md をそのまま表示する。** `src/ui/helpView.ts` が README の「## 使い方」から「## 開発者の方へ」の手前までを取り出し、`src/core/markdown.ts` で HTML にします。画像は `docs/images/usage-*.png` を同梱します。README のこの範囲を直すと、アプリの表示も変わります(見出しの名前を変えるときは helpView も直す)。

## コードの書き方

- TypeScript は strict です。`any` は避けます。
- コメントと画面の文言は日本語です。既存の言い回し(「割り当て」「基準車」「全車一致」など)に合わせてください。
- 新しい画面要素は、CSS の変数(`src/style.css` の `:root` のトークン)で色を決めます。ライト / ダークの両方で読めることを確認してください。
- `hidden` 属性は、CSS の `[hidden]{display:none!important}` が効きます。`display` を指定する要素でも、`hidden` で隠せます。
- 既存の動作を変えるときは、その動作のテストも直します。テストを消して通すことはしません。

## テストの方針

- テストは `tests/*.test.ts` です。画面のテストは jsdom と `FakeMap` を使います。
- 走行ログを使うテストは `fixtures/` のファイルを読みます。ファイルが無いと、`vite.config.ts` がそのテストを自動で飛ばします(公開用の状態)。
- jsdom には `File.text()` が無いので、テストでは `{ name, size, text: async () => text }` のような代用品を渡します。
- 見た目(CSS)の変更は、テストでは確認しきれません。ブラウザで実際に見てください。

### ラップの検出に関わる変更をしたとき

`src/core/laps.ts`(ラップの検出)・`src/core/loop.ts`(1 周分のログを輪にする処理)・`src/core/candidate.ts`(計測ラインの候補)・`src/core/trim.ts`(取り込み範囲)や、読み込みの手順(`src/store/session.ts`)を変えたときは、ふだんのテストに加えて次を行います。実ログが 2〜3 本(オートポリスと鈴鹿など)だけでは、通過の回数やログの始点・終点と計測ラインの位置関係による場合分けの抜けが見つからないためです(案件 64)。

1. **場合分けを列挙する。** 変えた関数の分岐(通過が 0 回・1 回・2 回以上、輪かどうか、取り込まなかった区間の有無など)を書き出し、分岐ごとに、人工のログ(`tests/loop.test.ts` の `ride`)のテストがあるか確かめる。無い分岐は足す。
2. **計測ラインをずらして確かめる。** 輪のログでは、計測ラインを輪の上のどこに置いても(始点・終点のつなぎ目の前後を、数 cm ずつずらして含める)、1 周分の完了ラップが 1 つできる(`tests/loop.test.ts`)。
3. **空どうしの比較にしない。** 「変更前と同じ結果」を確かめるテストは、件数も確かめる(結果が両方とも空でも通ってしまうため)。
4. **手元の走行ログで、変更の前後を比べる。** 手元にあるログ(`fixtures/` と `fixtures/samples/`)を、読み込み → 輪にする処理 → 計測ラインの候補 → ラップの検出まで通し、ラップの件数と時間が、変更の前後で変わらないことを確かめる(変わるなら、意図した変更だけか確かめる)。手元用のスクリプト `fixtures/samples/lap-check.ts`(公開しない)で、`npx vite-node fixtures/samples/lap-check.ts` の出力を、`git stash` で変更を戻した状態と diff する。新しい種類のログで不具合が見つかったら、そのログを `fixtures/samples/` に足し、1〜2 のテストにも写す。

## やってはいけないこと

- **走行ログ(`.vbo`)や個人データをコミットしない。** `fixtures/` は空のまま公開します(`.gitignore` で除外済み)。
- **トークン・パスワードなどの秘密情報をコミットしない。**
- 履歴の書き換え(`git push --force` など)を、依頼されずに行わない。
- 依頼されていない大きなリファクタリングや、依存パッケージの追加をしない。必要なときは、理由を添えて先に相談します。
- `node_modules/`、`dist/`、`release/` をコミットしない。

## ライセンス・権利表記

- このプロジェクトは PolyForm Shield License 1.0.0 です(`LICENSE`)。1.8.0 より前の版は MIT License です。競合する製品やサービスとして提供しない(販売・無料配布を問わず)のが条件です。
- 地図は国土地理院の地理院タイルです。**画面内の出典表記(地図右下)を消さないでください。**
- ライブラリを追加したら、`THIRD-PARTY-NOTICES.txt` と README の「使用サードパーティライブラリ」に追記します。

## コミットとプルリクエスト

- コミットメッセージは、何をしたかが分かる短い文にします(日本語でも英語でも可)。
- 1 つのコミット・PR では、1 つの目的だけを扱います。
- PR の説明には、変更の内容、確認したこと(テスト・画面)、気になる点を書きます。
