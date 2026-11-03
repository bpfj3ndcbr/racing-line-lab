import type { KeyValueStore } from '../io/storage';

export type Theme = 'light' | 'dark';

/**
 * ライト / ダークの切り替え。見た目は src/style.css の変数(トークン)だけで決まるので、
 * 配色を変えたいときは CSS の :root[data-theme="…"] の値を書き換えるだけで済む。
 * 保存値が無ければライト。
 */
export class ThemeController {
  private theme: Theme;
  private listeners = new Set<() => void>();

  constructor(private store: KeyValueStore, private doc: Document = document) {
    const saved = store.get('theme');
    this.theme = saved === 'light' || saved === 'dark' ? saved : 'light';      // 設定が無いときは、OS の設定にかかわらずライト
    this.apply();
  }

  get(): Theme { return this.theme; }

  set(t: Theme): void {
    if (t === this.theme) return;
    this.theme = t;
    this.store.set('theme', t);
    this.apply();
    this.listeners.forEach((f) => f());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private apply() { this.doc.documentElement.dataset.theme = this.theme; }
}
