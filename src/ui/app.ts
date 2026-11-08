import type { Session } from '../store/session';
import { mountCompareView, type CompareView } from './compareView';
import { type ImportApi, mountImportView } from './importView';
import type { MapFactory } from './mapTypes';
import type { Theme, ThemeController } from './theme';
import { SLOTS } from '../core';
import { Prefs } from '../store/prefs';
import { mountSettingsView } from './settingsView';
import { logoSvg } from './logo';
import { showAbout } from './aboutView';
import { mountHelpView } from './helpView';
import { applyAnalytics } from '../io/analytics';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type ViewName = 'help' | 'import' | 'compare' | 'settings';

/** About ボタンの ⓘ アイコン(線画。文字色に合わせる) */
const INFO_ICON = '<svg class="ico" width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r=".95" fill="currentColor"/></svg>';

/** アプリ全体の枠: 上部バー(画面の切り替え・サーキット名・テーマ)と、使い方 / データ管理 / 比較 / 設定の 4 画面。 */
export function mountApp(root: HTMLElement, session: Session, theme: ThemeController, mapFactory: MapFactory, opts: { reload?: () => void } = {}): { dispose(): void } {
  root.innerHTML = `
    <header class="top">
      <div class="brand">${logoSvg(36)}<div class="brand-txt"><div class="ttl">Racing Line Lab</div><div class="subttl">シンプル走行ライン比較ツール</div></div></div>
      <nav class="navtabs" aria-label="画面">
        <button class="navtab" data-act="nav" data-view="help">使い方</button>
        <button class="navtab" data-act="nav" data-view="import">データ管理</button>
        <button class="navtab" data-act="nav" data-view="compare">比較</button>
        <button class="navtab" data-act="nav" data-view="settings">設定</button>
      </nav>
      <div class="grow"></div>
      <div id="top-right" class="top-right"></div>
    </header>
    <div id="view-help" hidden></div>
    <div id="view-import"></div>
    <div id="view-compare" hidden></div>
    <div id="view-settings" hidden></div>`;

  const helpEl = root.querySelector<HTMLElement>('#view-help')!;
  const importEl = root.querySelector<HTMLElement>('#view-import')!;
  const compareEl = root.querySelector<HTMLElement>('#view-compare')!;
  const settingsEl = root.querySelector<HTMLElement>('#view-settings')!;
  const topRight = root.querySelector<HTMLElement>('#top-right')!;
  let current: ViewName = 'import';
  let compare: CompareView | null = null;
  let importApi: ImportApi | null = null;

  function navigate(v: ViewName) {
    if (v !== current && importApi?.isEditing()) return;     // サーキットの登録・編集中は、保存かキャンセルするまで移れない
    if (v === 'import' && current !== 'import') importApi?.openActiveSet();     // ほかのタブから戻ったら、表示セットだけを開く
    current = v;
    if (v === 'help' && !helpEl.firstChild) mountHelpView(helpEl);     // 開いたときに 1 回だけ作る
    helpEl.hidden = v !== 'help';
    importEl.hidden = v !== 'import';
    compareEl.hidden = v !== 'compare';
    settingsEl.hidden = v !== 'settings';
    if (v !== 'import') importApi?.closeWork();      // 位置補正・サーキット登録の大きな画面は、データ管理を離れたら閉じる
    if (v === 'compare') {
      compare ??= mountCompareView(compareEl, session, {
        mapFactory, theme, onBack: () => navigate('import'),
        onEditCircuit: (id) => { navigate('import'); importApi?.editCircuit(id); },     // 編集が終わったら比較に戻る
      });
      if (SLOTS.some((s) => session.assignment[s])) session.markGuideSeen();            // 一度比較まで進んだら、「はじめかた」は畳んで始める
      compare.show();
    } else {
      compare?.hide();
    }
    renderNav();
  }

  /** 利用者の操作でほかの画面へ移る。位置補正で補正量を動かしたままなら、確かめてから移る */
  let asking = false;
  async function leaveTo(v: ViewName) {
    if (v !== current && importApi?.needsLeaveConfirm()) {
      if (asking) return;
      asking = true;
      const ok = await importApi.confirmLeave();
      asking = false;
      if (!ok) return;
    }
    navigate(v);
  }

  function renderNav() {
    root.querySelectorAll<HTMLElement>('[data-act="nav"]').forEach((b) => {
      const on = b.dataset.view === current;
      const locked = !on && !!importApi?.isEditing();
      (b as HTMLButtonElement).disabled = locked;
      b.title = locked ? 'サーキットの登録・編集中です。登録かキャンセルをしてください' : '';
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  function currentCircuitName(): string {
    const sel = session.circuits.find((c) => c.id === session.selectedCircuitId);
    if (sel) return sel.name;
    const names = Array.from(new Set(session.logs.map((l) => l.circuit?.name).filter((n): n is string => !!n)));
    return names.length ? names.join('、') : '未選択';
  }

  function renderTop() {
    const t = theme.get();
    const seg = (v: Theme, label: string) =>
      `<button data-act="theme" data-theme="${v}" data-fk="theme-${v}" aria-pressed="${t === v}" class="${t === v ? 'on' : ''}">${label}</button>`;
    const key = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    topRight.innerHTML = `<span class="cur">サーキット: <b>${esc(currentCircuitName())}</b></span>` +
      `<span class="seg tiny" role="group" aria-label="テーマ">${seg('light', 'ライト')}${seg('dark', 'ダーク')}</span>` +
      `<span class="seg tiny" role="group" aria-label="このアプリについて"><button data-act="about" data-fk="about" aria-haspopup="dialog">${INFO_ICON}About</button></span>`;
    if (key) topRight.querySelector<HTMLElement>(`[data-fk="${key}"]`)?.focus({ preventScroll: true });
  }

  root.querySelector('header')!.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'nav') void leaveTo(el.dataset.view as ViewName);
    if (el.dataset.act === 'about') { void showAbout(); return; }
    if (el.dataset.act === 'theme') theme.set(el.dataset.theme as Theme);
  });

  // 設定タブ: 「記憶しない」項目は、起動時と変更時に初期値を反映する
  const prefs = new Prefs(session);
  if (!prefs.get('theme').remember) theme.set(prefs.get('theme').value);
  applyAnalytics(prefs.analytics);          // 利用状況の送信(Web 版の公開用ビルドで、オンのときだけ)
  mountSettingsView(settingsEl, prefs, (key) => {
    if (key === 'theme') { if (!prefs.get('theme').remember) theme.set(prefs.get('theme').value); }
    else if (key === 'analytics') applyAnalytics(prefs.analytics);
    else if (key !== 'autoLoad') compare?.applyPref(key);
  }, () => {            // 「アプリを初期状態に戻す」: 保存したものをすべて消して、画面を読み直す
    session.factoryReset();
    (opts.reload ?? (() => window.location.reload()))();
  });

  // 前回の走行データの自動読み込み(Electron のみ。ファイルの場所を覚えているので読み直せる)
  const native = window.rllNative;
  if (native && prefs.autoLoad) {
    // 読み込めたら、表示セットに割り当てがあるとき、そのまま「比較」を開く
    void session.restoreLast((p) => native.readTextFile(p)).then(() => {
      if (current === 'import' && SLOTS.some((s) => session.assignment[s])) navigate('compare');
    });
  }

  importApi = mountImportView(importEl, session, { onCompare: () => void leaveTo('compare'), onWorkChange: renderNav, mapFactory, theme, zoom: () => prefs.get('zoom').value as number });
  session.subscribe(renderTop);
  theme.subscribe(renderTop);
  renderTop();
  navigate('import');
  // ファイルを枠の外に落としても、ブラウザがそのファイルを開いてしまわないようにする(追加は、ドロップ枠に落としたときだけ)
  const stopDrop = (e: DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault(); };
  window.addEventListener('dragover', stopDrop);
  window.addEventListener('drop', stopDrop);
  /** 画面を作り直す前に呼ぶ。キー操作の受付(document への登録)を外す。 */
  return { dispose: () => { compare?.hide(); importApi?.closeWork(); window.removeEventListener('dragover', stopDrop); window.removeEventListener('drop', stopDrop); } };
}
