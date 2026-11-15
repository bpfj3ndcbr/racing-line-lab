import { SLOTS, type Slot, formatLapTime, escapeHtml as esc } from '../core';
import { SLOT_ALIAS_MAX, type Session } from '../store/session';
import { type ImportPart, dateOf } from './importParts';

/** 「データ管理」の上部: 表示中の比較セットの A〜D のカード(1 行の小さなカード)と、カード名(A〜D の別名)の編集 */
export interface SlotsPart extends ImportPart {
  /** カード名の入力欄でのキー操作(Enter で確定、Esc でやめる) */
  onAliasKey(e: KeyboardEvent): void;
}

export function createSlots(el: HTMLElement, session: Session): SlotsPart {
  let editing: Slot | null = null;

  function commit() {
    const inp = el.querySelector<HTMLInputElement>('.slot-alias-input');
    const s = editing;
    editing = null;
    if (inp && s) session.setSlotAlias(session.activeIndex, s, inp.value);   // 変わらなくても再描画される
    render();
  }

  function render() {
    const draft = el.querySelector<HTMLInputElement>('.slot-alias-input');    // 入力中の文字は、再描画しても消さない
    const draftText = draft?.value;
    const cards = SLOTS.map((s) => {
      const r = session.resolveRef(session.assignment[s]);
      const alias = session.slotAliasOf(session.activeIndex, s);
      const edit = editing === s && !!r;
      let body: string;
      if (edit) {
        body = `<div class="slot-edit"><input type="text" class="alias-input slot-alias-input" maxlength="${SLOT_ALIAS_MAX}" value="${esc(alias)}" placeholder="カード名(${SLOT_ALIAS_MAX}文字まで)" aria-label="${s} のカード名" data-slot="${s}">
          <button class="btn xs pri" data-act="slot-alias-ok" data-slot="${s}">確定</button></div>`;
      } else if (r) {
        body = `<div class="st">${alias ? `${esc(alias)} <span class="sub">Run ${r.log.no}</span>` : `Run ${r.log.no}`}</div>
           <div class="sub num"><span class="lapno">LAP ${r.lap.number}: </span>${formatLapTime(r.lap.duration)}</div>`;
      } else body = '<div class="mut">未割り当て</div>';
      const pen = r && !edit ? `<button class="btn xs slot-pen" data-act="slot-alias-edit" data-slot="${s}" aria-label="${s} のカード名を編集" title="カード名を編集">✎</button>` : '';
      const tip = r ? ` title="${esc(dateOf(r.log))}"` : '';
      const tap = r && !edit ? ` data-act="slot-alias-edit" data-slot="${s}"` : '';          // スマホでは鉛筆を出さず、カードを押して名前を編集する
      return `<div class="slot slot-${s.toLowerCase()}${edit ? ' editing' : ''}"${tip}${tap}><span class="chip s${s.toLowerCase()}">${s}</span><div class="slot-main">${body}</div>${pen}</div>`;
    }).join('');
    el.innerHTML = `<div class="slots-row">${cards}</div>`;
    const inp = el.querySelector<HTMLInputElement>('.slot-alias-input');
    if (inp && draftText !== undefined && draft) { inp.value = draftText; inp.focus(); inp.setSelectionRange(draftText.length, draftText.length); }
  }

  return {
    render,
    handle(act, d) {
      switch (act) {
        case 'slot-alias-edit': editing = d.slot as Slot; render(); el.querySelector<HTMLInputElement>('.slot-alias-input')?.select(); return true;
        case 'slot-alias-ok': commit(); return true;
        default: return false;
      }
    },
    onAliasKey(e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); }
    },
  };
}
