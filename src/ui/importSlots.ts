import { SLOTS, type Slot, formatLapTime, escapeHtml as esc } from '../core';
import { SLOT_ALIAS_MAX, type Session } from '../store/session';
import { type ImportActions, type ImportPart, dateOf } from './importParts';
import { SHOWN_MARK } from './marks';

/** 「データ管理」の上部: 表示中の比較セットの A〜D のカードと、カード名(A〜D の別名)の編集、「比較画面へ」 */
export interface SlotsPart extends ImportPart {
  /** カード名の入力欄でのキー操作(Enter で確定、Esc でやめる) */
  onAliasKey(e: KeyboardEvent): void;
}

export function createSlots(el: HTMLElement, session: Session, deps: { actions: ImportActions; editingCircuit: () => boolean }): SlotsPart {
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
           <div class="sub num">LAP ${r.lap.number}: ${formatLapTime(r.lap.duration)} ・ ${dateOf(r.log).split(' ')[0]}</div>`;
      } else body = '<div class="mut">未割り当て</div>';
      const pen = r && !edit ? `<button class="btn xs slot-pen" data-act="slot-alias-edit" data-slot="${s}" aria-label="${s} のカード名を編集" title="カード名を編集">✎</button>` : '';
      return `<div class="slot slot-${s.toLowerCase()}"><span class="chip s${s.toLowerCase()}">${s}</span><div class="slot-main">${body}</div>${pen}</div>`;
    }).join('') + `<button class="btn pri" data-act="goto-compare" data-fk="goto-compare"${deps.editingCircuit() ? ' disabled title="サーキットの登録・編集中です。登録かキャンセルをしてください"' : SLOTS.some((s) => session.assignment[s]) ? '' : ' disabled title="A〜D にラップを割り当ててください"'}>比較画面へ ▶</button>`;
    const shownI = session.shownIndex;
    const title = shownI === null
      ? '表示中の比較セットはありません(ラップを A〜D に割り当てると表示されます)'          // 案件 28
      : `${SHOWN_MARK}<b>${esc(session.setName(shownI))}</b>${session.aliasOf(shownI) ? ` <span class="sub">(${session.setLabel(shownI)})</span>` : ''}`;
    el.innerHTML = `<div class="slots-title">${title}</div><div class="slots-row">${cards}</div>`;
    const inp = el.querySelector<HTMLInputElement>('.slot-alias-input');
    if (inp && draftText !== undefined && draft) { inp.value = draftText; inp.focus(); inp.setSelectionRange(draftText.length, draftText.length); }
  }

  return {
    render,
    handle(act, d) {
      switch (act) {
        case 'slot-alias-edit': editing = d.slot as Slot; render(); el.querySelector<HTMLInputElement>('.slot-alias-input')?.select(); return true;
        case 'slot-alias-ok': commit(); return true;
        case 'goto-compare': deps.actions.toCompare(); return true;
        default: return false;
      }
    },
    onAliasKey(e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); }
    },
  };
}
