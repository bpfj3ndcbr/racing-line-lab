/**
 * 簡易モーダル。ネイティブの alert/prompt は見た目を揃えられず、Electron でも扱いにくいので自前で持つ。
 * - フォーカスはダイアログ内に閉じ込め、閉じたら元の要素へ戻す
 * - Esc でキャンセル(alert は OK と同じ扱い)
 */
let seq = 0;

interface Base { title: string; detail?: string }

function open<T>(
  build: (box: HTMLElement, close: (v: T) => void) => { focus: HTMLElement; onEnter?: () => void },
  cancelValue: T,
  host: HTMLElement,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    back.appendChild(box);

    const close = (v: T) => {
      back.remove();
      if (prev && document.contains(prev)) prev.focus();
      resolve(v);
    };
    const { focus, onEnter } = build(box, close);
    host.appendChild(back);
    focus.focus();

    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(cancelValue); return; }
      if (e.key === 'Enter' && onEnter && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); onEnter(); return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(box.querySelectorAll<HTMLElement>('button:not([disabled]),input'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });
}

function head(box: HTMLElement, o: Base): string {
  const id = `dlg${++seq}`;
  const h = document.createElement('h3');
  h.id = id + '-t';
  h.textContent = o.title;
  box.appendChild(h);
  box.setAttribute('aria-labelledby', h.id);
  if (o.detail) {
    const p = document.createElement('p');
    p.id = id + '-d';
    p.textContent = o.detail;
    box.appendChild(p);
    box.setAttribute('aria-describedby', p.id);
  }
  return id;
}

function button(label: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ('btn ' + cls).trim();
  b.textContent = label;
  return b;
}

/** メッセージと OK ボタンだけのダイアログ */
export function alertDialog(o: Base & { ok?: string }, host: HTMLElement = document.body): Promise<void> {
  return open<void>((box, close) => {
    head(box, o);
    const ok = button(o.ok ?? 'OK', 'pri');
    ok.dataset.dialog = 'ok';
    ok.addEventListener('click', () => close());
    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.appendChild(ok);
    box.appendChild(row);
    return { focus: ok };
  }, undefined, host);
}

/**
 * はい / いいえ を選んでもらうダイアログ。ok を押せば true、cancel・Esc なら false。
 * 初めは cancel(取り消せない操作をしない側)にフォーカスする。ok は左、cancel は右の青いボタン
 */
export function confirmDialog(o: Base & { ok: string; cancel: string }, host: HTMLElement = document.body): Promise<boolean> {
  return open<boolean>((box, close) => {
    head(box, o);
    const ok = button(o.ok);
    ok.dataset.dialog = 'ok';
    const cancel = button(o.cancel, 'pri');
    cancel.dataset.dialog = 'cancel';
    ok.addEventListener('click', () => close(true));
    cancel.addEventListener('click', () => close(false));
    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.append(ok, cancel);
    box.appendChild(row);
    return { focus: cancel };
  }, false, host);
}

/** 文字を1つ入力してもらうダイアログ。キャンセルなら null。空のままでは OK を押せない。 */
export function promptDialog(
  o: Base & { label: string; value: string; ok?: string; cancel?: string },
  host: HTMLElement = document.body,
): Promise<string | null> {
  return open<string | null>((box, close) => {
    const id = head(box, o);
    const label = document.createElement('label');
    label.className = 'modal-field';
    label.htmlFor = id + '-i';
    label.textContent = o.label;
    const input = document.createElement('input');
    input.id = id + '-i';
    input.type = 'text';
    input.value = o.value;
    label.appendChild(input);
    box.appendChild(label);

    const cancel = button(o.cancel ?? 'キャンセル');
    cancel.dataset.dialog = 'cancel';
    const ok = button(o.ok ?? 'OK', 'pri');
    ok.dataset.dialog = 'ok';
    const sync = () => { ok.disabled = input.value.trim() === ''; };
    const submit = () => { if (!ok.disabled) close(input.value.trim()); };
    input.addEventListener('input', sync);
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => close(null));
    sync();
    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.append(cancel, ok);
    box.appendChild(row);
    queueMicrotask(() => input.select());
    return { focus: input, onEnter: submit };
  }, null, host);
}

/**
 * 中身を自分で組み立てるダイアログ(読み込みの確認など)。build で box に中身を入れ、最初にフォーカスする要素を返す。
 * close(値) で閉じる。Esc は cancelValue で閉じる
 */
export function customDialog<T>(
  build: (box: HTMLElement, close: (v: T) => void) => HTMLElement, cancelValue: T, host: HTMLElement = document.body,
): Promise<T> {
  return open<T>((box, close) => ({ focus: build(box, close) }), cancelValue, host);
}

/** 中身を HTML で渡す、読むだけのダイアログ(About など)。HTML は呼び出し側が用意した固定の文字列だけを渡すこと。 */
export function contentDialog(o: { title: string; html: string; ok?: string; wide?: boolean }, host: HTMLElement = document.body): Promise<void> {
  return open<void>((box, close) => {
    if (o.wide) box.classList.add('wide');
    head(box, { title: o.title });
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = o.html;
    box.appendChild(body);
    const ok = button(o.ok ?? '閉じる', 'pri');
    ok.dataset.dialog = 'ok';
    ok.addEventListener('click', () => close());
    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.appendChild(ok);
    box.appendChild(row);
    return { focus: ok };
  }, undefined, host);
}
