import { SLOTS, escapeHtml as esc, formatLapTime } from '../core';
import { REF_NAME_MAX, type LoadedLog, type Session } from '../store/session';
import { type ImportPart, SEC_HINT, dateOf } from './importParts';

/**
 * 「ミニセクターの基準LAP設定」の節(案件 85。名称は案件 86 で「基準設定」から変更): サーキットごとに、比較の基準にする走行(CR・PB など)を、読み込み済みの走行ログのラップから選ぶ。
 * 走行ログごとに閉じた 1 行(そのログの最速ラップ)で出し、開くと全ラップと、基準にするボタンが出る。
 * 順位と差は、そのサーキットの全ログの完了ラップの中での順位と、最速との差。
 */
export const REFS_HTML = `
      <details class="sec" id="sec-refs">
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2>ミニセクターの基準LAP設定</h2><span id="refs-badge" class="badge"></span><span class="grow"></span>${SEC_HINT}</summary>
        <div class="sec-body">
          <div class="sub refs-note">
            <p>サーキットごとに、比較の基準にする走行(コースレコード・自己ベストなど)を設定します。走行ログを開いて、基準にするラップを選びます。</p>
            <p>基準は、比較画面のミニセクター表の「基準」のメニューに出ます。走行ログを外すと、その基準も外れます。</p>
          </div>
          <div id="refs-list" class="refs-list"></div>
        </div>
      </details>`;

export interface RefsPart extends ImportPart {
  /** change を受ける(基準の表示名の入力) */
  onChange(t: HTMLElement): void;
}

interface Entry { log: LoadedLog; lap: { number: number; duration: number } }

export function createRefs(root: HTMLElement, session: Session): RefsPart {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const list = $('refs-list');
  /** 開いている走行ログと、閉じているサーキット(描き直しても変わらないように覚える。サーキットは初めは開く) */
  const open = new Set<string>();
  const closedCircuits = new Set<string>();
  /** スマホの縦画面で、「編集」を押して開いているラップの行(走行ログ id#ラップ番号。描き直しても閉じない) */
  const editing = new Set<string>();
  list.addEventListener('toggle', (e) => {
    const d = e.target as HTMLDetailsElement;
    const id = d.dataset?.fid, cid = d.dataset?.cid;
    if (id) { if (d.open) open.add(id); else open.delete(id); }
    if (cid) { if (d.open) closedCircuits.delete(cid); else closedCircuits.add(cid); }
  }, true);

  const lapName = (l: LoadedLog, n: number) => {
    const a = session.lapAliasOf(l.id, n).trim();
    return `LAP ${n}${a ? `(${esc(a)})` : ''}`;
  };

  function circuitBlock(name: string, circuitId: string, logs: LoadedLog[]): string {
    const all: Entry[] = logs.flatMap((l) => l.laps.filter((x) => x.complete).map((x) => ({ log: l, lap: x })));
    if (!all.length) return '';
    const sorted = [...all].sort((a, b) => a.lap.duration - b.lap.duration);
    const best = sorted[0].lap.duration;
    const rank = new Map(sorted.map((e, i) => [`${e.log.id}#${e.lap.number}`, i + 1]));
    // 基準の番号: このサーキットの基準を、ラップタイムの速い順に 1, 2, …(基準 1 = いちばん速い基準)
    const refNo = new Map(session.refsOfByTime(circuitId).map((r, i) => [r.id, i + 1]));
    // 今の比較セットのミニセクター表が基準にしている走行(案件 86)と、カードを割り当てているラップ(A〜D)
    const usingRef = session.active.miniBase.startsWith('ref:') ? session.active.miniBase.slice(4) : '';
    const slotsOf = (logId: string, n: number) => SLOTS.filter((sl) => { const a = session.assignment[sl]; return a?.logId === logId && a.lap === n; });
    const slotChips = (logId: string, n: number) => slotsOf(logId, n).map((sl) => `<span class="chip s${sl.toLowerCase()} refs-cd" title="カード ${sl} に割り当てています">${sl}</span>`).join('');
    const cells = (e: Entry) => `<span class="rc-time num">${formatLapTime(e.lap.duration)}</span><span class="rc-rank num">${rank.get(`${e.log.id}#${e.lap.number}`)}</span>`
      + `<span class="rc-diff num">${e.lap.duration === best ? '—' : '+' + (e.lap.duration - best).toFixed(3)}</span>`;
    const files = logs
      .map((l) => ({ l, es: all.filter((e) => e.log === l).sort((a, b) => a.lap.duration - b.lap.duration) }))
      .filter((f) => f.es.length)
      .sort((a, b) => a.es[0].lap.duration - b.es[0].lap.duration)
      .map(({ l, es }) => {
        const chips = es.flatMap((e) => { const r = session.refAt(l.id, e.lap.number); return r ? [refNo.get(r.id) ?? 0] : []; }).sort((a, b) => a - b);
        // タイトル部の上の狭いところに、基準表示中の札と、この走行ログの基準の札(基準 1, 2, …)を小さく並べる(案件 86)
        const usingHere = es.some((e) => session.refAt(l.id, e.lap.number)?.id === usingRef);
        const tags = chips.length || usingHere
          ? `<span class="refs-tags">${usingHere ? '<span class="refs-chip refs-using" title="この走行ログの基準を、ミニセクター表の基準に使っています">基準表示中</span>' : ''}${chips.map((n) => `<span class="refs-chip">基準${n}</span>`).join('')}</span>` : '';
        const rows = [...es].sort((a, b) => a.lap.number - b.lap.number).map((e) => {
          const isBest = e === es[0];
          const r = session.refAt(l.id, e.lap.number);
          const act = r
            ? `<input type="text" class="refs-name" maxlength="${REF_NAME_MAX}" value="${esc(r.name)}" placeholder="表示名(CR・PB など)" aria-label="基準の表示名" data-ref="${esc(r.id)}" data-fk="ref-name-${esc(r.id)}">`
              + `<button type="button" class="btn sm refs-ok" data-act="ref-name-ok" data-ref="${esc(r.id)}" data-fk="ref-ok-${esc(r.id)}" title="表示名を確定します(Enter でも確定します)">確定</button>`
            : `<button type="button" class="refs-set" data-act="ref-add" data-log="${esc(l.id)}" data-lap="${e.lap.number}" data-fk="ref-add-${esc(l.id)}-${e.lap.number}">基準にする</button>`;
          const isUsing = !!r && r.id === usingRef;
          const ekey = `${l.id}#${e.lap.number}`;
          const no = r ? refNo.get(r.id) ?? '' : '';
          const del = r ? `<button type="button" class="btn sm refs-del" data-act="ref-del" data-ref="${esc(r.id)}" data-fk="ref-del-${esc(r.id)}" title="この基準を解除します">解除</button>` : '';
          // PC 幅: LAP 名の横に、札と「解除」を並べる(今までどおり)
          const pc = `<span class="refs-pc">${isUsing ? '<span class="refs-chip refs-using" title="ミニセクター表の基準に使っています">基準表示中</span>' : ''}${lapName(l, e.lap.number)}${r ? `<span class="refs-chip">基準${no}</span>` : ''}${slotChips(l.id, e.lap.number)}${del}</span>`;
          // スマホの縦画面: 先頭に「編集」。その右に、札(小さく)を LAP 名の上に。基準にする・解除・表示名は「編集」を押すと、下の段に出る(もう一度押すと閉じる)
          const tagsPh = `${isUsing ? '<span class="refs-chip refs-using">基準表示中</span>' : ''}${r ? `<span class="refs-chip">基準${no}</span>` : ''}${slotChips(l.id, e.lap.number)}`;
          const ph = `<button type="button" class="btn sm refs-edit refs-ph" data-act="ref-edit" data-ekey="${esc(ekey)}" data-fk="ref-edit-${esc(ekey)}" title="基準にする・解除・表示名を変えます">編集</button>`
            + `<span class="refs-mid refs-ph">${tagsPh ? `<span class="refs-ltags">${tagsPh}</span>` : ''}<span class="refs-ln">${lapName(l, e.lap.number)}</span></span>`;
          const actPh = del ? del.replace('refs-del', 'refs-del refs-ph') : '';
          return `<div class="refs-row refs-lap${r ? ' is-ref' : ''}${isUsing ? ' is-using' : ''}${isBest ? ' is-best' : ''}${editing.has(ekey) ? ' editing' : ''}" data-ekey="${esc(ekey)}"${isBest ? ' title="この走行ログのベスト"' : ''}><span class="rc-name">${pc}${ph}</span>${cells(e)}<span class="rc-act">${act}${actPh}</span></div>`;
        }).join('');
        const fid = esc(l.id);
        return `<details class="refs-file" data-fid="${fid}"${open.has(l.id) ? ' open' : ''}>`
          + `<summary class="refs-row"><span class="rc-name"><span class="refs-run">${esc(session.runLabel(l))}</span> <span class="refs-fn">${esc(l.log.fileName)} ${esc(dateOf(l))}</span>${tags}</span>${cells(es[0])}</summary>${rows}</details>`;
      }).join('');
    return `<details class="refs-circuit" data-cid="${esc(circuitId)}"${closedCircuits.has(circuitId) ? '' : ' open'}><summary class="refs-cname"><span class="refs-ctext">${esc(name)}</span><span class="refs-ccount">走行ログ ${logs.length} 件</span></summary>`
      + `<div class="refs-row refs-head"><span class="rc-name">走行ログ / LAP(閉じた行は、そのログの最速ラップ)</span><span class="rc-time">タイム</span><span class="rc-rank">順位</span><span class="rc-diff">差</span></div>${files}</details>`;
  }

  return {
    render() {
      // 同じ走行ログが複数の比較セットに入っていても 1 回だけ。サーキットが決まった走行ログだけ
      const seen = new Set<string>();
      const byCircuit = new Map<string, { name: string; logs: LoadedLog[] }>();
      for (const w of session.sets) for (const l of w.logs) {
        if (seen.has(l.id) || !l.circuit) continue;
        seen.add(l.id);
        const g = byCircuit.get(l.circuit.id) ?? { name: l.circuit.name, logs: [] };
        g.logs.push(l);
        byCircuit.set(l.circuit.id, g);
      }
      const html = Array.from(byCircuit, ([id, g]) => circuitBlock(g.name, id, g.logs)).join('');
      list.innerHTML = html || '<p class="sub">サーキットが決まった走行ログを読み込むと、ここで基準を設定できます。</p>';
      let n = 0;
      byCircuit.forEach((_, id) => { n += session.refsOf(id).length; });
      $('refs-badge').textContent = n ? `基準 ${n} 件` : '基準なし';
    },
    handle(act, d) {
      switch (act) {
        case 'ref-add': session.addRef(d.log ?? '', Number(d.lap)); return true;
        case 'ref-name-ok': {                                    // 入力欄の文字を、表示名として確定する
          const inp = Array.from(list.querySelectorAll<HTMLInputElement>('.refs-name')).find((i) => i.dataset.ref === d.ref);
          if (inp) session.renameRef(d.ref ?? '', inp.value);
          return true;
        }
        case 'ref-edit': {                                       // スマホの縦画面: 行の下の段(基準にする・解除・表示名)を開閉する
          const k = d.ekey ?? '';
          const on = !editing.has(k);
          if (on) editing.add(k); else editing.delete(k);
          Array.from(list.querySelectorAll<HTMLElement>('.refs-lap')).filter((r) => r.dataset.ekey === k).forEach((r) => r.classList.toggle('editing', on));
          return true;
        }
        case 'ref-del': session.removeRef(d.ref ?? ''); return true;
        default: return false;
      }
    },
    onChange(t) {
      if (t.classList.contains('refs-name') && t.dataset.ref) session.renameRef(t.dataset.ref, (t as HTMLInputElement).value);
    },
  };
}
