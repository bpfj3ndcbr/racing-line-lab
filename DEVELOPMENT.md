# 開発者向けの情報

Racing Line Lab の、開発・ビルド・仕様についての情報です。使い方は [README.md](https://github.com/bpfj3ndcbr/racing-line-lab/blob/main/README.md) をご覧ください。
AI コーディングエージェントへの手引きは [AGENTS.md](https://github.com/bpfj3ndcbr/racing-line-lab/blob/main/AGENTS.md) にあります。

## 必要なもの

- Node.js 20 以上

## ブラウザで動かす

```
npm install
npm run dev
```

表示されたアドレス(通常は http://localhost:5173)をブラウザで開きます。

## デスクトップ版(Electron)

```
npm install
npm run electron          # ビルドして起動
```

開発中は、1 つ目のターミナルで `npm run dev`、2 つ目で `npm run electron:dev` を実行すると、画面の変更がすぐ反映されます。

配布用アプリを作る(macOS):

```
npm run dist        # release/ に .dmg ができます
npm run dist:dir    # インストーラ無しで、アプリだけを作る(動作確認用)
```

署名・公証はしていません。他の Mac に配るときは、初回に右クリック →「開く」が必要です。

## ビルドした版を手元で動かすとき(利用状況の送信に注意)

```
npm run build
npx vite preview     # http://localhost:4173 で dist/ を動かす
```

公開している Web 版と同じものが動きます(PWA の service worker も登録されます)。スマホの実機で確かめるときなどに使います。

このとき、**利用状況の送信(Google アナリティクス、`src/io/analytics.ts`)も有効になります。** 送るかどうかは「デスクトップ版ではない」かつ「本番用のビルド」で決めていて、アドレスでは区別しないため、`localhost` で開いても送られます(ホスト名は `localhost` として記録されます)。

| 動かし方 | 送信 |
|---|---|
| 公開中の Web 版(github.io。PWA を含む) | する(「設定」でオフにしていなければ) |
| `npm run build` → `npx vite preview` | **する** |
| `npm run dev` | しない(本番用のビルドではない) |
| デスクトップ版(`npm run electron`、配布用の .app) | しない |

送りたくないときは、そのブラウザで開いたアプリの「設定」→「利用状況の送信」をオフにします。設定はアドレスごとに保存されるので、公開中の Web 版の設定には影響しません。

## テストと型チェック

```
npm test             # テスト(vitest)
npm run typecheck    # 型チェックだけ
npm run build        # 型チェック + ビルド(dist/)
```

走行ログを使うテストは `fixtures/` のファイルを読みます。ファイルが無いテストは自動で飛ばされます(公開用の状態では `fixtures/` は空です)。

## ファイル形式

.vbo はRaceChronoで .vbo 形式でエクスポートしたファイルを使用する想定です。

.cln、.sci はデジスパイスの形式の想定です。

補正データは走行ログの走行ラインを東西南北に補正した補正情報で、このアプリ独自のものです。

走行ログがあれば、アプリ内でコントロールラインなどは引けるので .vbo だけあれば使えます。

| 種類               | 形式                                           |
|------------------|----------------------------------------------|
| 走行ログ             | `.vbo`(RaceChrono)                           |
| コントロールライン `.cln` | 1 行目 `1`、続く 4 行が `緯度 経度 緯度 経度`(線の始点と終点)      |
| セクターライン `.sci`   | 1 行 1 本、`緯度,経度,緯度,経度,1`(1 本目は S1 としてセクターにする) |
| 補正データ            | JSON(アプリから書き出し / 読み込み)                       |

## データの保存先

- **ブラウザ版**: ブラウザの localStorage
- **デスクトップ版**: ユーザーデータ内の `settings.json`(macOS: `~/Library/Application Support/racing-line-lab/settings.json`)

サーキット・位置補正・画面の設定・比較セット1〜5の状態が保存されます。走行ログ(.vbo)そのものは保存せず、自動読み込みを有効にしたときだけ、元のファイルの場所を覚えます。

### 保存のキー

保存は `KeyValueStore`(`src/io/storage.ts`)越しに行います。キーの名前は次のとおりです(デスクトップ版では、全体に接頭辞 `rll.` が付きます)。

| キー | 内容 |
|---|---|
| `circuits` | 登録したサーキット |
| `offsets` | 位置補正の値(ファイルごと) |
| `lapEnds` | ラップ一覧の「終端の調整」の値(ファイルごと。ラップ番号 → ラップ開始からの秒) |
| `lastSession` | 比較セット1〜5のファイルの場所・割り当て・サーキット指定(自動読み込み用) |
| `theme` | テーマ(ライト/ダーク) |
| `ui.prefs` | 設定タブの値と「記憶する」の選択 |
| `ui.compare.mapMode` / `labels` / `zoom` / `follow` / `xKind` / `sync` / `rate` | 比較画面の「前回の状態」 |
| `ui.compare.layout` | 比較画面の右パネルの幅・グラフの高さ(`v` が保存形式の版。形式を変えるときは版を上げる) |
| `ui.setAliases` / `ui.slotAliases` | 比較セットの別名 / カード(セットごとの A〜D)の別名 |
| `ui.guideClosed` / `ui.guideSeen` | はじめかたの表示状態 |
| `ui.seenVersion` | 前回開いたアプリの版(更新された直後の知らせに使う) |
| `ui.setsView` | 「データ管理」の比較セットの並べ方(`tabs` / `list`) |
| `ui.mapAreas` | 地図の保存範囲(Z18 のタイルの区切りにそろえた四角 `x0`〜`x1`・`y0`〜`y1` と名前) |

保存の形式を変えるときは、古い形式を読み替える処理を足すか、版を上げて初期値に戻してください。

### Web 版の一時保存(同じタブの中の読み直し用)

スマホのスリープやアプリの切り替えでページが読み直されても続きから使えるよう、Web 版だけ、上の保存とは別に一時保存します(`src/io/resume.ts`。デスクトップ版では使いません)。

| 保存先 | 内容 |
|---|---|
| sessionStorage `rll.resumeTab` | タブの印。同じタブの読み直しでは残り、新しいタブ・閉じたタブには無い。これがあれば元に戻す |
| sessionStorage `rll.resumeState` | 比較セットごとの走行ログ(id と Run 番号)・割り当て・設定、表示中の比較セット、開いていた画面 |
| IndexedDB `rll-resume` の `state` | 上と同じ内容と保存時刻(タブごと) |
| IndexedDB `rll-resume` の `logs` | 走行ログの中身(タブ・id ごと) |

- 走行ログは読み込んだときに保存し、どの比較セットからも外したら消します。小さな状態は、画面が隠れるとき(`visibilitychange` の hidden・`pagehide`)に保存します。
- ページを閉じる・読み直す瞬間に始めた IndexedDB の書き込みは中止されることがあるため、小さな状態は同期的に書ける sessionStorage にも写し、元に戻すときはこちらを優先します。
- ほかのタブの保存は、1 日より古ければ起動時に消します。「アプリを初期状態に戻す」では、このタブの一時保存も消します。

### Web 版の PWA と地図の保存

Web 版は PWA です(`public/manifest.webmanifest`、`src/sw/sw.ts`、`src/io/pwa.ts`)。デスクトップ版・開発中(`npm run dev`)・テストでは service worker を登録しません。

- **アプリのファイル**: `npm run build` のあと、`vite.config.ts` の `swPlugin` が `dist` のファイルの一覧を `__PRECACHE__` として埋め込み、`src/sw/sw.ts` を 1 つの `dist/sw.js` にまとめます(アプリ本体とは部品を共有しない。依存パッケージは使わない)。service worker は、入れたときに一覧のファイルを Cache Storage `rll-app-<印>` に保存し、保存したものを返します。新しい版は、ネットがあるときに取得され、アプリを閉じて次に起動したときから使われます。
- **更新の知らせ(案件 50)**: 新しい版は待機中になり(`skipWaiting` しない)、`UpdateWatcher`(`src/io/pwa.ts`)が `updatefound` → `installed` で見つけて画面に知らせます。「更新する」は、待機中の worker に `rll-skip-waiting` を送って切り替え、`controllerchange` で読み直します(自分で頼んだときだけ)。「更新しました」は `ui.seenVersion` と今の版を比べて出します。
- **型チェック**: service worker は画面側と型の種類(WebWorker)が違うので、`tsconfig.sw.json` で別に確かめます(`npm run typecheck` と `npm run build` は両方を行う)。
- **地図の保存**: service worker は、保存範囲(`ui.mapAreas`。画面が Cache Storage `rll-tiles-meta` の `rll-areas.json` に写して渡す)の中の地理院タイル(Z15〜Z18)を、表示したときに Cache Storage `rll-tiles` に保存し、次からは保存したものを返します。範囲の外は今までどおりネットから取ります。タイルの計算は `src/core/tiles.ts`、画面からの操作(一覧・削除・概略の地図の先読み・消されにくくする依頼)は `src/io/tileStore.ts` と `src/io/mapSave.ts` です。
- 同じ画面の中では、一度表示した地図をブラウザが使い回し、service worker を通らないことがあります。そのため、範囲を決める画面(`src/ui/areaEditor.ts`)で見えていた地図は、範囲を追加したときに画面から保存します。
- 保存したタイルには、容量の表示のため、見出し `x-rll-bytes` を付けています。保存した応答は `Vary: Origin` が付いていても返せるよう、`cache.match` に `ignoreVary` を付けています。

### デスクトップ版の地図の保存

デスクトップ版は service worker を使わず、メイン側で同じ決まり(保存範囲の中の Z15〜Z18 を、表示したときに保存。保存済みを優先)で保存します(`electron/tileCache.cjs`。Electron に依存させず、node のテストで動かします)。

- 画面は、窓口に `window.rllNative.tileUrl`(`rll-tile://tile/{z}/{x}/{y}.jpg`)があれば、地理院の URL の代わりにそれを使います(`src/ui/trackMap.ts` の `tileUrlTemplate`)。メイン側は `protocol.handle('rll-tile', …)` で答え、取得先は地理院に固定です(画面から取得先を指定させない。URL は数字だけを取り出して確かめる)。
- 保存先は、ユーザーデータの `tiles/{z}/{x}/{y}.jpg` です(一時ファイルに書いてから置き換える)。取れなかったタイル(ネットが無いなど)は保存せず、画面では空白になります。
- 画面からの操作(保存範囲を渡す・一覧・削除・概略の地図の先読み・すべて削除)は、`src/io/tileStore.ts` の `openNativeTileStore` が窓口(`tilesSetAreas` など。IPC `tiles:*`)を呼びます。設定画面は Web 版と同じものを使い、「保存したデータを消されにくくする」だけは押せません(`TileStore.durable`)。
- preload は sandbox で動き、自前のファイルを読めないので、`tileUrl` の値は `electron/tileCache.cjs` の `TILE_URL` から書き写しています(同じであることをテストで確かめる)。

## 比較画面の再生

速度グラフの横軸が「時間」のときは、全車が同じ経過時間の位置に出ます。「距離」のときは、基準の車(いちばん若い枠)の時間で進め、ほかの車は基準の車と同じ距離の位置に出ます(`src/ui/compareView.ts` の `updateFrame`)。

「距離」の距離は、速度 × 時間の積み上げ(`LapSeries.dist`)ではなく、物差しにする 1 台の走行ラインに各車の点を投影した距離です(`src/core/align.ts`)。物差しは、割り当てた車のうち記録の間隔がいちばん細かい車(1 周を走り切ったラップを優先、同じなら基準車)。前の点の位置から先の決まった範囲だけを探すので、ヘアピンの行きと帰りなどを取り違えません。ラインから 30 m 以上離れた区間(ピットロードなど)では距離を進めず、ラインに戻ったところから合わせ直します。

## 構成

```
src/core      ラップ検出・セクター・速度/加減速の計算など(画面に依存しない)
src/store     読み込んだログ・割り当て・設定の状態(Session は 5 つの比較セットを持つ)
src/ui        画面(使い方 / データ管理 / 比較 / 設定)と地図
electron/     デスクトップ版(main / preload / 設定ファイルと地図の保存)
tests/        テスト(vitest)
docs/images/  README.md のスクリーンショット
```
