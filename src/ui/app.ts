import type { Session } from '../store/session';
import { mountCompareView, type CompareView } from './compareView';
import { type ImportApi, mountImportView } from './importView';
import type { MapFactory } from './mapTypes';
import type { Theme, ThemeController } from './theme';
import { SLOTS, escapeHtml as esc } from '../core';
import { Prefs } from '../store/prefs';
import { mountSettingsView } from './settingsView';
import { logoSvg } from './logo';
import { showAbout } from './aboutView';
import { mountHelpView } from './helpView';
import { applyAnalytics } from '../io/analytics';
import { openResumeStore, type ResumeStore } from '../io/resume';
import { openNativeTileStore, openTileStore, type TileStore } from '../io/tileStore';
import { applyAreas } from '../io/mapSave';
import { isSharedLaunch, takeSharedFiles } from '../io/share';
import { MapAreas } from '../store/mapAreas';
import { installAppleFilePicker } from './fileKind';

export type ViewName = 'help' | 'import' | 'compare' | 'settings';

/** About ボタンの ⓘ アイコン(線画。文字色に合わせる) */
const INFO_ICON = '<svg class="ico" width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r=".95" fill="currentColor"/></svg>';

/** スマホを横向きにしたとき、比較以外の画面に重ねる案内のアイコン(縦向きのスマホ。表示は CSS の @media で決める。案件 46) */
const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>';

/** 一時保存(案件 30)に失敗したときの案内 */
export const RESUME_SAVE_FAILED = '走行ログが大きいため、一時保存できませんでした(読み込み直されると元に戻りません)。';

/**
 * アプリ全体の枠: 上部バー(画面の切り替え・サーキット名・テーマ)と、使い方 / データ管理 / 比較 / 設定の 4 画面。
 * opts.resume: Web 版の一時保存の保存先(案件 30)。省略すると IndexedDB(使えなければ無し)。null で使わない。
 * デスクトップ版(window.rllNative がある)では使わない
 */
export function mountApp(root: HTMLElement, session: Session, theme: ThemeController, mapFactory: MapFactory, opts: { reload?: () => void; resume?: ResumeStore | null; tiles?: TileStore | null; takeShared?: () => Promise<File[] | null>; sharedLaunch?: boolean; startupAbout?: boolean } = {}): { dispose(): void } {
  root.innerHTML = `
    <header class="top">
      <div class="brand">${logoSvg(36)}<div class="brand-txt"><div class="ttl">Racing Line Lab</div><div class="subttl">シンプル走行ライン比較ツール</div></div></div>
      <nav class="navtabs" aria-label="画面">
        <button class="navtab" data-act="nav" data-view="help">使い方</button>
        <button class="navtab" data-act="nav" data-view="import">データ管理</button>
        <button class="navtab" data-act="nav" data-view="compare">比較</button>
        <button class="navtab" data-act="nav" data-view="settings">設定</button>
      </nav>
      <div class="top-set" id="top-set"></div>
      <div class="grow"></div>
      <div id="top-right" class="top-right"></div>
    </header>
    <div id="view-help" hidden></div>
    <div id="view-import"></div>
    <div id="view-compare" hidden></div>
    <div id="view-settings" hidden></div>
    <div class="rotate-note" id="rotate-note" role="status"><div class="rn-box"><div class="rn-head">${logoSvg(28)}<span class="rn-name">Racing Line Lab</span></div><div class="rn-body">${PHONE_ICON}<p>この画面は縦向きでお使いください</p><p class="sub">横向きで使えるのは「比較」の画面です</p></div></div></div>`;

  const helpEl = root.querySelector<HTMLElement>('#view-help')!;
  const importEl = root.querySelector<HTMLElement>('#view-import')!;
  const compareEl = root.querySelector<HTMLElement>('#view-compare')!;
  const settingsEl = root.querySelector<HTMLElement>('#view-settings')!;
  const topRight = root.querySelector<HTMLElement>('#top-right')!;
  let current: ViewName = 'import';
  const unApple = installAppleFilePicker(document, navigator);     // iPhone・iPad でファイルが選べるように(案件 29)
  let compare: CompareView | null = null;
  let importApi: ImportApi | null = null;
  let settingsApi: { refresh(): void } | null = null;

  function navigate(v: ViewName) {
    if (v !== current && importApi?.isEditing()) return;     // サーキットの登録・編集中は、保存かキャンセルするまで移れない
    if (v === 'import' && current !== 'import') importApi?.closeSets();     // ほかのタブから戻ったら、比較セットはすべて閉じる(案件 26)
    const from = current;
    current = v;
    if (v === 'help' && !helpEl.firstChild) mountHelpView(helpEl);     // 開いたときに 1 回だけ作る
    if (v === 'settings' && from !== 'settings') settingsApi?.refresh();        // 地図の保存の容量を数え直す
    helpEl.hidden = v !== 'help';
    importEl.hidden = v !== 'import';
    compareEl.hidden = v !== 'compare';
    settingsEl.hidden = v !== 'settings';
    if (v !== 'import') importApi?.closeWork();      // 位置補正・サーキット登録の大きな画面は、データ管理を離れたら閉じる
    if (v === 'compare') {
      compare ??= mountCompareView(compareEl, session, {
        mapFactory, theme, onBack: () => navigate('import'), topSlot: root.querySelector<HTMLElement>('#top-set')!,
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

  function renderTop() {
    const t = theme.get();
    const seg = (v: Theme, label: string) =>
      `<button data-act="theme" data-theme="${v}" data-fk="theme-${v}" aria-pressed="${t === v}" class="${t === v ? 'on' : ''}">${label}</button>`;
    const key = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    topRight.innerHTML = `<span class="cur">サーキット: <b>${esc(session.setCircuitOf()?.name ?? '未選択')}</b></span>` +
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

  // 地図の保存。保存範囲の中で表示した地図を、Web 版は service worker が(案件 31)、デスクトップ版はメイン側が(案件 2)保存する
  const native = window.rllNative;
  const tiles: TileStore | null = opts.tiles !== undefined ? opts.tiles : native ? openNativeTileStore(native) : openTileStore();
  const mapAreas = new MapAreas(session);

  // 設定タブ: 「記憶しない」項目は、起動時と変更時に初期値を反映する
  const prefs = new Prefs(session);
  if (!prefs.get('theme').remember) theme.set(prefs.get('theme').value);
  applyAnalytics(prefs.analytics);          // 利用状況の送信(Web 版の公開用ビルドで、オンのときだけ)
  settingsApi = mountSettingsView(settingsEl, prefs, (key) => {
    if (key === 'theme') { if (!prefs.get('theme').remember) theme.set(prefs.get('theme').value); }
    else if (key === 'analytics') applyAnalytics(prefs.analytics);
    else if (key !== 'autoLoad' && key !== 'startAbout') compare?.applyPref(key);
  }, () => {            // 「アプリを初期状態に戻す」: 保存したものをすべて消して、画面を読み直す(一時保存も消し、元に戻さない)
    session.factoryReset();
    const reload = opts.reload ?? (() => window.location.reload());
    if (!resume && !tiles) { reload(); return; }
    forgotten = true;
    // 一時保存(案件 30)と、保存した地図・保存範囲(案件 31)も消してから読み直す
    void Promise.all([
      resume?.forget(),
      tiles ? tiles.clear().then(() => tiles.setAreas([])) : undefined,
    ].map((p) => Promise.resolve(p).catch(() => { /* 消せなくても読み直す */ }))).finally(reload);
  }, { store: tiles, areas: mapAreas, mapFactory, circuits: () => session.circuits });
  // 起動時: 保存範囲を service worker に渡し直し、概略の地図のうち足りない分を保存する(ネットがあるとき)
  if (tiles) {
    void applyAreas(tiles, mapAreas.list(), { prefetch: prefs.mapPrefetch && navigator.onLine !== false, persist: prefs.mapPersist }).catch(() => { /* 次の機会に */ });
  }

  // 前回の走行データの自動読み込み(Electron のみ。ファイルの場所を覚えているので読み直せる)
  // Web 版の一時保存(案件 30)。同じタブの中の読み直し(スリープ・アプリの切り替え・手での再読み込み)で元に戻す
  const resume: ResumeStore | null = native ? null : opts.resume !== undefined ? opts.resume : openResumeStore();
  let forgotten = false;
  /** 一時保存から元に戻し終わるまで(共有の画面から受け取ったファイルは、そのあとで追加する) */
  let restored: Promise<void> = Promise.resolve();
  let unhook = () => {};
  if (native && prefs.autoLoad) {
    // 読み込めたら、表示セットに割り当てがあるとき、そのまま「比較」を開く
    // 割り当てが無ければ「データ管理」のまま、比較セットは閉じた状態で始める(一覧ではすべて閉じ、タブは表示中の比較セット。案件 26)
    void session.restoreLast((p) => native.readTextFile(p)).then(() => {
      if (current !== 'import') return;
      if (SLOTS.some((s) => session.assignment[s])) navigate('compare'); else importApi?.closeSets();
    });
  }

  if (resume) {
    // 走行ログ本体は、読み込んだときにそのつど保存する
    session.logHooks = {
      added: (id, log) => { void resume.putLog(id, log).catch(() => session.say(RESUME_SAVE_FAILED)); },
      removed: (id) => { void resume.deleteLog(id).catch(() => { /* 残っても、元に戻すときに使われない */ }); },
    };
    // 割り当てなどの小さな状態と開いている画面は、画面が隠れるときに保存する
    const saveState = () => { if (!forgotten) void resume.putState({ ...session.resumeState(), view: current }).catch(() => { /* 次の機会に */ }); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') saveState(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', saveState);
    unhook = () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', saveState); session.logHooks = null; };
    // 共有の画面から開いた新しい窓(案件 45): Android は窓を開き直すので、直前に使っていた窓の状態を引き継ぐ
    const sharedLaunch = opts.sharedLaunch ?? isSharedLaunch();
    const loadSaved = resume.resumed ? () => resume.load() : sharedLaunch ? () => resume.adoptLatest() : null;
    if (loadSaved) {
      session.setLoading('前の画面の状態を元に戻しています…');
      restored = loadSaved().then((saved) => {
        if (!saved) return;
        session.restoreResume(saved.state, saved.logs);
        const v = (saved.state as { view?: unknown } | null)?.view;
        if (current === 'import' && (v === 'compare' || v === 'help' || v === 'settings')) navigate(v);
      }).catch(() => { /* 戻せなければ初期状態のまま */ }).finally(() => { if (session.loading) session.setLoading(''); });
    }
  }

  importApi = mountImportView(importEl, session, { onCompare: () => void leaveTo('compare'), onWorkChange: renderNav, mapFactory, theme, zoom: () => prefs.get('zoom').value as number });
  session.subscribe(renderTop);
  theme.subscribe(renderTop);
  renderTop();
  navigate('import');
  // 起動時の About(案件 49。main.ts だけが有効にする)。同じタブの読み直し(Web 版の一時保存から戻すとき)と、共有の画面から開いたときは出さない
  if (opts.startupAbout && prefs.startAbout && !resume?.resumed && !(opts.sharedLaunch ?? isSharedLaunch())) {
    void showAbout(document.body, (hide) => { prefs.setStartAbout(!hide); settingsApi?.refresh(); });
  }
  // Android の共有の画面から受け取ったファイル(案件 45。Web 版のみ)。元に戻し終わってから、データ管理で追加する
  const takeShared = opts.takeShared ?? (native ? null : takeSharedFiles);
  if (takeShared) {
    void restored.then(() => takeShared()).then(async (files) => {
      if (!files) return;
      if (!files.length) { session.say('共有されたファイルを受け取れませんでした。'); return; }
      navigate('import');
      await importApi?.addShared(files);
    }).catch(() => session.say('共有されたファイルを受け取れませんでした。'));
  }
  // ファイルを枠の外に落としても、ブラウザがそのファイルを開いてしまわないようにする(追加は、ドロップ枠に落としたときだけ)
  const stopDrop = (e: DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault(); };
  window.addEventListener('dragover', stopDrop);
  window.addEventListener('drop', stopDrop);
  /** 画面を作り直す前に呼ぶ。キー操作の受付(document への登録)を外す。 */
  return { dispose: () => { unhook(); unApple(); compare?.hide(); importApi?.closeWork(); window.removeEventListener('dragover', stopDrop); window.removeEventListener('drop', stopDrop); } };
}
