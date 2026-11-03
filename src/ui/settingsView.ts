import { Prefs, RATE_CHOICES, YMIN_CHOICES, ZOOM_CHOICES, type PrefKey, type PrefValues } from '../store/prefs';

const ZOOM_STOPS = [0, ...ZOOM_CHOICES];   // スライダーの位置 → 倍率(0 = サーキット全体)
const zoomText = (z: number) => (z === 0 ? 'サーキット全体' : `Z${z}`);

type Opt = { v: string; label: string };
type Plain = { name: string; kind: 'ymin' | 'startpos' | 'autoload'; hint?: string };
type Row =
  | { key: PrefKey; name: string; kind: 'seg'; opts: Opt[]; hint?: string }
  | { key: PrefKey; name: string; kind: 'switch'; on: string; off: string; hint?: string }
  | { key: PrefKey; name: string; kind: 'zoom'; hint?: string };

const GROUPS: { title: string; rows: (Row | Plain)[] }[] = [
  { title: '外観', rows: [
    { key: 'theme', name: 'テーマ', kind: 'seg', opts: [{ v: 'light', label: 'ライト' }, { v: 'dark', label: 'ダーク' }] },
  ] },
  { title: 'マップ', rows: [
    { key: 'mapMode', name: '描画', kind: 'seg', opts: [{ v: 'line', label: '走行ライン' }, { v: 'speed', label: '速度' }, { v: 'accel', label: '加減速' }] },
    { key: 'labels', name: '引き出し線の表示', kind: 'seg', opts: [{ v: 'off', label: '非表示' }, { v: 'speed', label: '速度・差' }, { v: 'name', label: 'カード名' }] },
    { key: 'zoom', name: '倍率', kind: 'zoom', hint: '「サーキット全体」は、比較画面では走行ライン全体が入る倍率、サーキット登録の地図では登録した表示位置です。数値は地図のズームで、比較画面とサーキット登録の地図の両方に使います(それぞれ別に管理します)。' },
    { name: '初期位置', kind: 'startpos', hint: '地図を開いたときの中心です。「地図の中心」は、登録した表示位置(無ければ走行ライン全体)の中心、「コントロールライン」はその線の中心です。' },
    { key: 'follow', name: '追従', kind: 'seg', opts: [{ v: 'fixed', label: '固定' }, { v: 'leader', label: '先頭追従' }, { v: 'A', label: 'A' }, { v: 'B', label: 'B' }, { v: 'C', label: 'C' }, { v: 'D', label: 'D' }],
      hint: '割り当ての無い枠を選んだときは「固定」になります。' },
  ] },
  { title: '速度グラフ', rows: [
    { name: '最低速度', kind: 'ymin', hint: '縦軸の下限です。最高速度は走行データに合わせて自動で決まります。' },
    { key: 'xKind', name: '横軸', kind: 'seg', opts: [{ v: 'dist', label: '距離' }, { v: 'time', label: '時間' }],
      hint: '「距離」のときは、地図の再生も距離ベースになります(全車が、基準の車と同じ走行距離の位置に出て、速度だけを比べます)。「時間」のときは、全車が同じ経過時間の位置に出て、タイム差も出ます。' },
  ] },
  { title: '再生・セクター', rows: [
    { key: 'rate', name: '再生速度', kind: 'seg', opts: RATE_CHOICES.map((r) => ({ v: String(r), label: `${r}x` })) },
    { key: 'sync', name: 'セクターボタンの動作', kind: 'seg', opts: [{ v: 'leader', label: '先頭車両' }, { v: 'all', label: '全車一致' }] },
  ] },
  { title: '起動時', rows: [
    { name: '最後の走行データを自動で読み込む', kind: 'autoload', hint: '前回読み込んだファイルと、A〜D の割り当てを元に戻します。ファイルの場所を覚えるので、Electron 版のみ使えます。移動・削除したファイルは読み込まれません。' },
  ] },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * 設定タブ。各項目は「最初の状態」を選ぶ。「最後の状態を記憶する」にチェックすると、その項目は前回の状態で始まるので、
 * 選ぶ部分は押せなくなる。
 */
export function mountSettingsView(root: HTMLElement, prefs: Prefs, onChange: (key: PrefKey | 'yMin' | 'startPos' | 'autoLoad') => void, onFactoryReset: () => void = () => {}): { refresh(): void } {
  let resetArmed = false;
  let wipeArmed = false;

  function control(r: Row, value: unknown, disabled: boolean): string {
    const dis = disabled ? ' disabled' : '';
    if (r.kind === 'seg') {
      return `<span class="seg slide" role="radiogroup" aria-label="${esc(r.name)}">${r.opts.map((o) =>
        `<button type="button" role="radio" data-set="${r.key}" data-v="${esc(o.v)}" aria-checked="${String(value) === o.v}" class="${String(value) === o.v ? 'on' : ''}"${dis}>${esc(o.label)}</button>`).join('')}</span>`;
    }
    if (r.kind === 'switch') {
      const on = value === true;
      return `<button type="button" role="switch" class="switch${on ? ' on' : ''}" data-switch="${r.key}" aria-checked="${on}" aria-label="${esc(r.name)}"${dis}><i></i></button>`
        + `<span class="swl">${on ? r.on : r.off}</span>`;
    }
    const idx = Math.max(0, ZOOM_STOPS.indexOf(value as number));
    return `<input type="range" class="slider" data-zoom min="0" max="${ZOOM_STOPS.length - 1}" step="1" value="${idx}" aria-label="倍率" aria-valuetext="${zoomText(ZOOM_STOPS[idx])}"${dis}>`
      + `<span class="swl" data-zoom-text>${zoomText(ZOOM_STOPS[idx])}</span>`;
  }

  function render() {
    root.innerHTML = `<div class="settings">
      <p class="sub">各項目で、起動したときの最初の状態を選びます。「最後の状態を記憶する」にチェックした項目は、前回の状態で始まります(チェック中は選べません)。</p>
      ${GROUPS.map((g) => `<section class="ce-group set-group"><h3>${g.title}</h3>${g.rows.map((r) => {
        if (r.kind === 'startpos') {
          const cur = prefs.startPos;
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><span class="seg slide" role="radiogroup" aria-label="初期位置">${
            ([['center', '地図の中心'], ['control', 'コントロールライン']] as const).map(([v, l]) =>
              `<button type="button" role="radio" data-startpos="${v}" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (r.kind === 'autoload') {
          const can = !!window.rllNative, on = prefs.autoLoad && can;
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl"><button type="button" role="switch" class="switch${on ? ' on' : ''}" data-autoload aria-checked="${on}" aria-label="${r.name}"${can ? '' : ' disabled'}><i></i></button>`
            + `<span class="swl">${on ? '有効' : '無効'}${can ? '' : '(Electron 版のみ)'}</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (r.kind === 'ymin') {
          return `<div class="srow"><div class="sname">${r.name}</div><div class="sctl">
            <input type="range" class="slider" data-ymin min="${YMIN_CHOICES.min}" max="${YMIN_CHOICES.max}" step="${YMIN_CHOICES.step}" value="${prefs.yMin}" aria-label="最低速度" aria-valuetext="${prefs.yMin} km/h">
            <span class="swl" data-ymin-text>${prefs.yMin} km/h</span></div><div class="srem"></div>${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
        }
        if (!('key' in r)) return '';
        const it = prefs.get(r.key);
        return `<div class="srow${it.remember ? ' remembered' : ''}" data-key="${r.key}"><div class="sname">${r.name}</div>
          <div class="sctl">${control(r, it.value, it.remember)}</div>
          <label class="srem"><input type="checkbox" data-rem="${r.key}"${it.remember ? ' checked' : ''}> 最後の状態を記憶する</label>
          ${r.hint ? `<div class="shint">${r.hint}</div>` : ''}</div>`;
      }).join('')}</section>`).join('')}
      <div class="btn-row reset-row"><button type="button" class="btn" data-reset>${resetArmed ? 'もう一度押すと、すべて初期値に戻します' : 'すべて初期値に戻す'}</button>
      <button type="button" class="btn danger wipe-btn" data-wipe>${wipeArmed ? 'もう一度押すと、アプリを初期状態に戻します' : 'アプリを初期状態に戻す'}</button></div>
    </div>`;
  }

  const setVal = (key: PrefKey, raw: string) => {
    const v: unknown = key === 'rate' ? Number(raw) : raw;
    prefs.setValue(key, v as PrefValues[PrefKey]);
    onChange(key);
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const seg = t.closest<HTMLButtonElement>('[data-set]');
    if (seg && !seg.disabled) { resetArmed = false; setVal(seg.dataset.set as PrefKey, seg.dataset.v!); render(); return; }
    const sp = t.closest<HTMLButtonElement>('[data-startpos]');
    if (sp) { resetArmed = false; prefs.setStartPos(sp.dataset.startpos as 'center' | 'control'); onChange('startPos'); render(); return; }
    const al = t.closest<HTMLButtonElement>('[data-autoload]');
    if (al && !al.disabled) { resetArmed = false; prefs.setAutoLoad(!prefs.autoLoad); onChange('autoLoad'); render(); return; }
    const sw = t.closest<HTMLButtonElement>('[data-switch]');
    if (sw && !sw.disabled) {
      resetArmed = false;
      const key = sw.dataset.switch as PrefKey;
      prefs.setValue(key, (!(prefs.get(key).value as unknown as boolean)) as never);
      onChange(key); render(); return;
    }
    if (t.closest('[data-wipe]')) {
      if (!wipeArmed) { wipeArmed = true; resetArmed = false; render(); return; }
      wipeArmed = false;
      onFactoryReset();
      return;
    }
    if (t.closest('[data-reset]')) {
      wipeArmed = false;
      if (!resetArmed) { resetArmed = true; render(); return; }
      resetArmed = false;
      prefs.reset();
      render();
      (['theme', 'mapMode', 'labels', 'zoom', 'follow', 'xKind', 'sync', 'rate', 'yMin', 'startPos', 'autoLoad'] as const).forEach((k) => onChange(k));
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-rem]')) {
      resetArmed = false;
      prefs.setRemember(t.dataset.rem as PrefKey, t.checked);
      onChange(t.dataset.rem as PrefKey);
      render();
    }
  });

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-zoom]')) {
      const z = ZOOM_STOPS[Number(t.value)];
      prefs.setValue('zoom', z);
      t.setAttribute('aria-valuetext', zoomText(z));
      root.querySelector('[data-zoom-text]')!.textContent = zoomText(z);
      onChange('zoom');
    } else if (t.matches('[data-ymin]')) {
      const v = Number(t.value);
      prefs.setYMin(v);
      t.setAttribute('aria-valuetext', `${v} km/h`);
      root.querySelector('[data-ymin-text]')!.textContent = `${v} km/h`;
      onChange('yMin');
    }
  });

  render();
  return { refresh: render };
}
