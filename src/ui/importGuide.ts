import { SLOTS, escapeHtml as esc } from '../core';
import type { Session, WorkSet } from '../store/session';
import type { ImportActions, ImportPart } from './importParts';

/** はじめかた: 表示セットの状態で、次の操作を案内する */

/** いまの段階(0 = ログを追加 / 1 = サーキットを用意 / 2 = ラップを割り当て / 3 = 比較する) */
function guideStep(w: WorkSet): number {
  if (!w.logs.length) return 0;
  if (SLOTS.some((s) => w.assignment[s])) return 3;
  if (w.logs.some((l) => !l.circuit && !l.outside)) return 1;            // サーキットを通らないログ(ラップ無し)は対象外
  return 2;
}

export function createGuide(el: HTMLElement, session: Session, actions: ImportActions): ImportPart {
  function render() {
    if (session.guideClosed) {
      el.innerHTML = '<button class="linkbtn" data-act="guide-open" data-fk="guide-open">はじめかた ▸</button>';
      return;
    }
    const w = session.active;
    const cur = guideStep(w);
    const firstWithLaps = w.logs.find((l) => l.circuit && l.laps.length);
    const free = SLOTS.find((s) => !w.assignment[s]);
    const candLog = w.logs.find((l) => !l.circuit && !l.outside && session.candidateFor(l));
    const pri = (act: string) => act === 'guide-add' || act === 'guide-cand' || (act === 'guide-map' && !candLog) || act === 'guide-auto' || act === 'guide-compare';
    const btn = (act: string, label: string, extra = '') => `<button class="btn sm${pri(act) ? ' pri' : ''}" data-act="${act}" data-fk="${act}"${extra}>${label}</button>`;
    const steps = [
      { t: 'ログを追加', d: 'RaceChrono などの .vbo ファイルを、比較セットの枠のドロップ欄にドラッグ&ドロップします。',
        b: btn('guide-add', '走行ログ(.vbo)を追加…') },
      { t: 'サーキットを用意', d: '計測ライン(ゴールライン)を決めて、サーキットを登録します(1 回だけ)。走行ログに計測ラインの情報があれば、それを使えます。無ければ地図の上で引くか、.cln / .sci ファイルで登録します。',
        b: (candLog ? btn('guide-cand', 'ログの計測ラインで登録…') : '') + btn('guide-map', '地図で登録…') + btn('guide-file', '.cln / .sci ファイルで登録…')
          + (session.circuits.length ? btn('guide-pick', '登録済みから選ぶ') : '') },
      { t: 'ラップを割り当て', d: '比べたいラップを A〜D に割り当てます(最大 4 つ)。速いものから自動で入れるか、自分で選ぶかを選べます。',
        b: firstWithLaps ? (free ? btn('guide-auto', `速いものから ${free} に自動で割り当て`) : '') + btn('guide-manual', '手動で割り当て') : '' },
      { t: '比較する', d: '「比較画面へ」を押して、走行ラインを見比べます。',
        b: btn('guide-compare', '比較画面へ ▶') },
    ];
    el.innerHTML = `<section class="guide" aria-label="はじめかた">
      <div class="gh"><b>はじめかた</b><span class="sub">${session.shownIndex === null ? '表示予定' : '表示中'}のセット(${esc(session.setName(session.activeIndex))})の状態に合わせて、次の操作を案内します</span>
        <button class="linkbtn" data-act="guide-close" data-fk="guide-close">閉じる ×</button></div>
      <div class="gsteps">${steps.map((s, k) => `
        <div class="gstep${k < cur ? ' done' : k === cur ? ' cur' : ''}">
          <div class="gn" aria-hidden="true">${k < cur ? '✓' : k + 1}</div>
          <div><h4>${s.t}${k === cur ? '<span class="gtag">いまここ</span>' : ''}</h4><p>${s.d}</p>${k === cur ? s.b : ''}</div>
        </div>`).join('')}</div></section>`;
  }

  return {
    render,
    handle(act) {
      const set = session.activeIndex;
      switch (act) {
        case 'guide-close': session.setGuideClosed(true); return true;
        case 'guide-open': session.setGuideClosed(false); return true;
        case 'guide-add': actions.addLogs(set); return true;
        case 'guide-cand': {
          const l = session.active.logs.find((x) => !x.circuit && !x.outside && session.candidateFor(x));
          if (l) actions.openLoadCheck(set, l.id);
          return true;
        }
        case 'guide-map': actions.openMapRegister(set); return true;
        case 'guide-file': actions.openCircuitSection('reg'); return true;
        case 'guide-pick': actions.focusCircuitSelect(set); return true;
        case 'guide-auto': actions.autoAssign(set); return true;
        case 'guide-manual': actions.scrollToSet(set); return true;
        case 'guide-compare': actions.toCompare(); return true;
        default: return false;
      }
    },
  };
}
