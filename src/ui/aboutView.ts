import { contentDialog } from './dialog';
import { logoSvg } from './logo';

const GH = 'https://github.com/bpfj3ndcbr/racing-line-lab';

/** 「About」ダイアログの中身。文面は ABOUT.md と同じ(ABOUT.md を直したら、ここも合わせる)。ただし「主な機能」は要約のまま(ABOUT.md とは揃えない)。版の表示だけはアプリのみ */
const ABOUT_HTML = `
<div class="about-head">${logoSvg(72)}<div><div class="about-ttl">Racing Line Lab</div><div class="about-sub">シンプル走行ライン比較ツール</div><div class="about-ver">バージョン ${__APP_VERSION__}</div></div></div>
<p>RaceChronoなどのサーキットの走行ログ(.vbo)を読み込み、ラップごとの走行ラインと速度を、航空写真の地図の上で見比べる個人開発のアプリです。</p>
<p>目標の走行ログを事前に入れておきサーキットの現場で、</p>
<ul>
<li><b>1本目を走った後にRaceChrono からログを飛ばして「イメージしていた走りが出来ていたのか」を確認して2本目に繋げる</b></li>
</ul>
<p>のような使い方や、</p>
<ul>
<li><b>自宅のパソコンでじっくり色々な走行データと比較して次に走る時に目指すブレーキングポイントや走行ラインのイメージを脳内に描く</b></li>
</ul>
<p>このような手助けとなるアプリを目指していますが、素人開発なので不具合があるかも知れません。悪しからずご了承ください。</p>
<h4>主な機能</h4>
<ul>
<li><b>走行ログの読み込み</b>: RaceChrono の <code>.vbo</code> をドラッグ&amp;ドロップで複数読み込み。5 つの比較セットに分けて保存できます。</li>
<li><b>サーキットの登録</b>: <code>.cln</code> / <code>.sci</code> ファイル、または地図の上で線を引いて登録(書き出しにも対応)。</li>
<li><b>ラップの検出</b>: 計測ラインの通過からラップを検出し、ラップタイムとセクタータイムを表示。</li>
<li><b>A〜D への割り当て</b>: 比べたいラップを最大 4 つ選びます。</li>
<li><b>比較画面</b>: 国土地理院の空中写真の上に走行ライン・速度/加減速ヒートマップ・車の位置を表示。再生、セクターボタン、速度グラフなど。</li>
<li><b>位置補正</b>: GPS のずれを、ログごとに東西・南北へメートル単位で補正。</li>
<li><b>設定タブ</b>: 初期値と「最後の状態を記憶する」を項目ごとに選べます。</li>
<li><b>前回の走行データの自動読み込み</b>(デスクトップ版のみ)</li>
</ul>
<h4>利用状況の送信(Web 版のみ)</h4>
<p>Web 版では、アプリの改善のため、Google アナリティクスで利用状況(ページの表示、使っている環境など)を送ります。走行ログの中身や位置、ファイル名は送りません。「設定」タブの「利用状況の送信」でオフにできます。デスクトップ版(Electron)では送りません。</p>
<h4>開発者</h4>
<ul>
<li>開発・公開: <a href="https://github.com/bpfj3ndcbr" target="_blank" rel="noopener noreferrer">bpfj3ndcbr</a>(個人開発)</li>
<li>リポジトリ: <a href="${GH}" target="_blank" rel="noopener noreferrer">${GH}</a></li>
<li>© 2026 bpfj3ndcbr</li>
</ul>
<h4>ライセンスと権利表記</h4>
<ul>
<li>本アプリのソースコードは <a href="${GH}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a> で公開されています。</li>
<li>背景地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a> 「地理院タイル(シームレス空中写真)」</li>
<li>Leaflet: © Volodymyr Agafonkin, BSD-2-Clause License / Electron: © Electron contributors, MIT License / Vite: © Evan You &amp; Vite Contributors, MIT License(ビルドに使用)</li>
<li>各ライブラリの詳細は <a href="${GH}/blob/main/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener noreferrer">THIRD-PARTY-NOTICES.txt</a> をご参照ください。</li>
</ul>`;

/** hideNext を渡すと(起動時の表示)、「次回から表示しない」のチェックが付く。チェックの状態が変わるたびに呼ぶ */
export function showAbout(host: HTMLElement = document.body, hideNext?: (hide: boolean) => void): Promise<void> {
  return contentDialog({ title: 'About', html: ABOUT_HTML, wide: true, check: hideNext && { label: '次回から表示しない', onChange: hideNext } }, host);
}
