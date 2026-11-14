import type { AppKind, InstanceLock } from '../io/instance';
import { logoSvg } from './logo';

/**
 * 同時に 1 つの窓だけで起動する(案件 60。Web 版・PWA 版)。
 * 窓の権利が取れたら start でアプリを起動する。取れなければアプリは起動せず、「すでに開かれています」の画面を出す
 * (「もう一度確かめる」で取れたら、そのまま起動する)。起動したあとで奪われた(共有の画面から別の窓が開いた)ら、
 * アプリを止めて(保存もしない)、「別の窓で開き直されました」の画面にする。
 * lock が null(デスクトップ版・Web Locks の無い環境)なら、確かめずに起動する。
 */

const KIND_NAME: Record<AppKind, string> = { browser: 'ブラウザ', pwa: 'インストールしたアプリ(PWA)' };

/** 読み直したとき、前のページのロックが外れるのを待つ回数と間隔(ms) */
const RETRY = 3;
const RETRY_MS = 300;

export interface GateOptions {
  /** 先の窓から奪って起動する(共有の画面から開いたとき) */
  steal: boolean;
  /** テスト用: 待ち */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function noteHtml(body: string): string {
  return `<div class="single-note" role="alert"><div class="rn-box"><div class="rn-head">${logoSvg(28)}<span class="rn-name">Racing Line Lab</span></div>`
    + `<div class="rn-body">${body}</div></div></div>`;
}

export async function startSingle(root: HTMLElement, lock: InstanceLock | null, start: () => { dispose(): void }, o: GateOptions): Promise<void> {
  if (!lock) { start(); return; }
  const wait = o.wait ?? sleep;
  let app: { dispose(): void } | null = null;
  const onLost = () => {
    app?.dispose();
    app = null;
    root.innerHTML = noteHtml('<p>別の窓で開き直されました</p><p class="sub">この窓は閉じてください。</p>');
  };
  const run = () => { root.innerHTML = ''; app = start(); };

  if (o.steal) { if (await lock.acquire({ steal: true, onLost })) { run(); return; } }
  for (let i = 0; i < RETRY; i++) {
    if (await lock.acquire({ steal: false, onLost })) { run(); return; }
    if (i < RETRY - 1) await wait(RETRY_MS);
  }

  // 先の窓がある: 起動しない
  const kind = await lock.askHolder();
  root.innerHTML = noteHtml(
    `<p>Racing Line Lab は、すでに${kind ? KIND_NAME[kind] : '別の窓'}で開かれています</p>`
    + '<p class="sub">先にそちらを閉じてから、もう一度確かめてください。</p>'
    + '<button type="button" class="btn pri" data-single="retry">もう一度確かめる</button><p class="sub" data-single="hint" role="status"></p>');
  const btn = root.querySelector<HTMLButtonElement>('[data-single="retry"]')!;
  const hint = root.querySelector<HTMLElement>('[data-single="hint"]')!;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    hint.textContent = '';
    if (await lock.acquire({ steal: false, onLost })) { run(); return; }
    btn.disabled = false;
    hint.textContent = 'まだ開かれています。';
  });
}
