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

/** タブの 2 つの組(案件 86): 基本設定 = 必須の 2 つ、拡張機能設定 = おまけの機能。スマホの縦画面は、切り替えスライドで組を選ぶ */
export type TopMode = 'basic' | 'ext';
const MODES: { key: TopMode; label: string }[] = [
  { key: 'basic', label: '基本設定' },
  { key: 'ext', label: '拡張機能設定' },
];

const TABS: { key: TopTab; label: string; sec: string; badge?: string; mode: TopMode }[] = [
  { key: 'circuit', label: 'サーキット', sec: 'sec-circuit', badge: 'circuit-badge', mode: 'basic' },
  { key: 'sets', label: '比較セット', sec: 'sets-group', mode: 'basic' },
  // おまけの機能は、必須の 2 つから少し離して右に並べる
  { key: 'refs', label: 'ミニセクターの基準LAP設定', sec: 'sec-refs', badge: 'refs-badge', mode: 'ext' },
  { key: 'offsets', label: '走行ライン補正データ', sec: 'sec-offsets', badge: 'offsets-badge', mode: 'ext' },
];

/** タブの並び(幅が足りないときは隠す)。節の前に置く */
export const TOP_TABS_HTML = `
      <div class="top-mode" id="top-mode" role="group" aria-label="設定の種類" data-mode="basic" hidden>${MODES.map((m) =>
    `<button type="button" data-act="top-mode" data-mode="${m.key}" data-fk="top-mode-${m.key}" aria-pressed="${m.key === 'basic'}">${m.label}</button>`).join('')}</div>
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
  const modeEl = root.querySelector<HTMLElement>('#top-mode')!;
  const body = root.querySelector<HTMLElement>('#import-body')!;
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(TOP_TAB_MEDIA) : null;
  let tab: TopTab = 'sets';          // 初めは「比較セット」(走行ログを追加する場所)
  let mode: TopMode = 'basic';       // スマホの縦画面で出している組(幅が広いときは、選んだタブの組)
  const modeOf = (k: TopTab) => TABS.find((t) => t.key === k)!.mode;
  const wide = () => !!mq?.matches;
  const secOf = (k: TopTab) => root.querySelector<HTMLElement>('#' + TABS.find((t) => t.key === k)!.sec)!;

  function render() {
    const on = wide();
    body.classList.toggle('tabbed', on);
    bar.hidden = !on;
    modeEl.hidden = on;                                   // 切り替えスライドは、スマホの縦画面だけ
    modeEl.dataset.mode = mode;
    modeEl.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    for (const t of TABS) {
      const el = secOf(t.key);
      el.classList.toggle('top-off', on && t.key !== tab);
      el.classList.toggle('mode-off', !on && t.mode !== mode);
      if (on && t.key === tab && el instanceof HTMLDetailsElement) el.open = true;     // 見出しは隠すので、開いておく
    }
    if (!on) return;
    const tabBtn = (t: (typeof TABS)[number]) => {
      const sel = t.key === tab;
      const badge = t.badge ? root.querySelector(`#${t.badge}`)?.textContent ?? '' : '';      // 見出しの印(「未登録」「補正なし」など)をタブに移す
      return `<button type="button" role="tab" class="top-tab${sel ? ' on' : ''}" id="top-tab-${t.key}" aria-selected="${sel}" aria-controls="${t.sec}"` +
        ` tabindex="${sel ? 0 : -1}" data-act="top-tab" data-tab="${t.key}" data-fk="top-tab-${t.key}">${t.label}${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</button>`;
    };
    // 組(基本設定・拡張機能設定)ごとに、見出しと水平線を付けて並べる
    bar.innerHTML = MODES.map((m) => `<div class="top-grp" role="presentation"><div class="top-grp-h" aria-hidden="true">${m.label}</div>`
      + `<div class="top-grp-tabs" role="presentation">${TABS.filter((t) => t.mode === m.key).map(tabBtn).join('')}</div></div>`).join('');
  }
  mq?.addEventListener?.('change', render);

  return {
    render,
    show(t) { tab = t; mode = modeOf(t); render(); },
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
      mode = modeOf(tab);
      render();
      root.querySelector<HTMLElement>('#top-tab-' + tab)?.focus();
    },
    handle(act, d) {
      if (act === 'top-mode') {                           // スマホの縦画面の切り替えスライド
        mode = d.mode === 'ext' ? 'ext' : 'basic';
        if (modeOf(tab) !== mode) tab = TABS.find((t) => t.mode === mode)!.key;     // 幅が広くなったとき、出ているタブが組の中にあるように
        render();
        return true;
      }
      if (act !== 'top-tab') return false;
      tab = (TABS.find((t) => t.key === d.tab) ?? TABS[1]).key;
      mode = modeOf(tab);
      render();
      return true;
    },
  };
}
