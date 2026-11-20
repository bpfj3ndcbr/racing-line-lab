import { escapeHtml as esc } from '../core';
import type { ImportPart } from './importParts';

/**
 * 「データ管理」の上のタブ(案件 74)。幅が 768px 以上の画面(PC・タブレット)では、「サーキット」「走行ライン補正データ」
 * 「基準設定」「比較セット」を 1 本のタブで切り替えて、選んだ 1 つの節だけを出す。スマホの縦画面(768px 未満)は、今までの開閉の見出しのまま。
 * タブの見た目は案件 67 のデザイン(CSS の .top-tab)。
 */

export type TopTab = 'circuit' | 'offsets' | 'refs' | 'sets';

/** タブにする幅(これより狭いときは、開閉の見出しのまま) */
export const TOP_TAB_MEDIA = '(min-width: 768px)';

const TABS: { key: TopTab; label: string; sec: string; badge?: string; gap?: boolean }[] = [
  { key: 'circuit', label: 'サーキット', sec: 'sec-circuit', badge: 'circuit-badge' },
  { key: 'sets', label: '比較セット', sec: 'sets-group' },
  // おまけの機能は、必須の 2 つから少し離して右に並べる(スマホの縦画面の見出しは、今の並びのまま)
  { key: 'offsets', label: '走行ライン補正データ', sec: 'sec-offsets', badge: 'offsets-badge', gap: true },
  { key: 'refs', label: '基準設定', sec: 'sec-refs', badge: 'refs-badge' },
];

/** タブの並び(幅が足りないときは隠す)。節の前に置く */
export const TOP_TABS_HTML = `
      <div class="sets-tabs top-tabs" id="top-tabs" role="tablist" aria-label="データ管理の項目" hidden></div>`;

export interface TopTabsPart extends ImportPart {
  /** タブ tab の節を出す(幅が足りないときは、何もしない) */
  show(tab: TopTab): void;
  /** タブの上のキー操作(←→ / Home / End) */
  onKey(e: KeyboardEvent): void;
  /** タブの並びの中の要素か */
  contains(t: EventTarget | null): boolean;
}

/** root は「データ管理」の画面全体(TOP_TABS_HTML と、3 つの節を含む) */
export function createTopTabs(root: HTMLElement): TopTabsPart {
  const bar = root.querySelector<HTMLElement>('#top-tabs')!;
  const body = root.querySelector<HTMLElement>('#import-body')!;
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(TOP_TAB_MEDIA) : null;
  let tab: TopTab = 'sets';          // 初めは「比較セット」(走行ログを追加する場所)
  const wide = () => !!mq?.matches;
  const secOf = (k: TopTab) => root.querySelector<HTMLElement>('#' + TABS.find((t) => t.key === k)!.sec)!;

  function render() {
    const on = wide();
    body.classList.toggle('tabbed', on);
    bar.hidden = !on;
    for (const t of TABS) {
      const el = secOf(t.key);
      el.classList.toggle('top-off', on && t.key !== tab);
      if (on && t.key === tab && el instanceof HTMLDetailsElement) el.open = true;     // 見出しは隠すので、開いておく
    }
    if (!on) return;
    bar.innerHTML = TABS.map((t) => {
      const sel = t.key === tab;
      const badge = t.badge ? root.querySelector(`#${t.badge}`)?.textContent ?? '' : '';      // 見出しの印(「未登録」「補正なし」など)をタブに移す
      return `<button type="button" role="tab" class="top-tab${sel ? ' on' : ''}${t.gap ? ' gap' : ''}" id="top-tab-${t.key}" aria-selected="${sel}" aria-controls="${t.sec}"` +
        ` tabindex="${sel ? 0 : -1}" data-act="top-tab" data-tab="${t.key}" data-fk="top-tab-${t.key}">${t.label}${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</button>`;
    }).join('');
  }
  mq?.addEventListener?.('change', render);

  return {
    render,
    show(t) { tab = t; render(); },
    contains: (t) => !!t && bar.contains(t as Node),
    onKey(e) {
      let i = TABS.findIndex((t) => t.key === tab);
      if (e.key === 'ArrowRight') i = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') i = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = TABS.length - 1;
      else return;
      e.preventDefault();
      tab = TABS[i].key;
      render();
      root.querySelector<HTMLElement>('#top-tab-' + tab)?.focus();
    },
    handle(act, d) {
      if (act !== 'top-tab') return false;
      tab = (TABS.find((t) => t.key === d.tab) ?? TABS[1]).key;
      render();
      return true;
    },
  };
}
