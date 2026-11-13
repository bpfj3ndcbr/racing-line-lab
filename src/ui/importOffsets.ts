import type { Session } from '../store/session';
import { downloadText } from './download';
import { hasExt, wrongExtMessage } from './fileKind';
import { type ImportPart, SEC_HINT } from './importParts';

/** 「走行ライン補正データ管理」の節: 位置補正データ(ファイル単位で、全部の比較セットに効く)の書き出し・読み込み */
export const OFFSETS_HTML = `
      <details class="sec" id="sec-offsets">
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2>走行ライン補正データ管理</h2><span id="offsets-badge" class="badge"></span><span class="grow"></span>${SEC_HINT}</summary>
        <div class="sec-body">
          <div class="sub offsets-note">
            <p>各走行ログのファイル別に走行ラインを補正したデータを保持しています。</p>
            <p>その補正データの書き出し、読み込みを行います。</p>
            <p>補正済みのファイルは次回から自動で補正が適用されます(どの比較セットでも同じファイルは同じ補正値です)。</p>
          </div>
          <div id="log-bar" class="toolbar"></div>
        </div>
      </details>`;

export interface OffsetsPart extends ImportPart {
  /** change を受ける(読み込むファイルの欄 #offsets-input) */
  onChange(t: HTMLElement): Promise<void>;
}

/** root は「データ管理」の画面全体(この節と、読み込むファイルの欄 #offsets-input を含む) */
export function createOffsets(root: HTMLElement, session: Session): OffsetsPart {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const bar = $('log-bar');
  const input = $<HTMLInputElement>('offsets-input');

  return {
    render() {
      bar.innerHTML = `
      <button class="btn" data-act="export-offsets" data-fk="export-offsets" title="位置補正の値をファイル(JSON)に保存します">補正データを書き出す</button>
      <button class="btn" data-act="import-offsets" data-fk="import-offsets" title="書き出した位置補正のファイル(JSON)を読み込みます">補正データを読み込む</button>`;
      const n = session.offsetCount();
      $('offsets-badge').textContent = n ? `補正済み ${n} ファイル` : '補正なし';
    },
    handle(act) {
      switch (act) {
        // .cln / .sci と同じく、デスクトップ版は保存ダイアログ
        case 'export-offsets': downloadText('position-offsets.json', session.exportOffsets(), 'application/json'); return true;
        case 'import-offsets': input.click(); return true;
        default: return false;
      }
    },
    async onChange(t) {
      if (t.id !== 'offsets-input') return;
      const f = input.files?.[0];
      input.value = '';
      if (f && !hasExt(f.name, '.json')) session.say(wrongExtMessage(f.name, '.json'), true);
      else if (f) session.importOffsets(await f.text());
    },
  };
}
