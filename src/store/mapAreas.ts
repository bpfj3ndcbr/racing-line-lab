import { type SaveArea, type TileRect, cleanAreas } from '../core';
import type { PrefStore } from './prefs';

/**
 * 地図の保存範囲(Web 版は案件 31、デスクトップ版は案件 2)。「設定」の「地図の保存」で決める。保存先のキーは ui.mapAreas。
 * 範囲は Z18 のタイルの区切りにそろえた四角(core/tiles.ts の TileRect)。
 */
export class MapAreas {
  constructor(private s: PrefStore) {}
  list(): SaveArea[] { return cleanAreas(this.s.getSetting<unknown>('mapAreas', [])); }
  get(id: string): SaveArea | null { return this.list().find((a) => a.id === id) ?? null; }
  /** 範囲を足す。名前の前後の空白は除き、空なら「範囲 N」にする */
  add(name: string, r: TileRect): SaveArea {
    const all = this.list();
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const a: SaveArea = { id, name: name.trim() || this.defaultName(), x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
    this.s.setSetting('mapAreas', [...all, a]);
    return a;
  }
  update(id: string, name: string, r: TileRect): void {
    this.s.setSetting('mapAreas', this.list().map((a) => (a.id === id ? { ...a, name: name.trim() || a.name, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 } : a)));
  }
  remove(id: string): void { this.s.setSetting('mapAreas', this.list().filter((a) => a.id !== id)); }
  /** 名前が無いときの名前(「範囲 1」「範囲 2」…。使われていない一番小さい番号) */
  defaultName(): string {
    const used = new Set(this.list().map((a) => a.name));
    let n = 1;
    while (used.has(`範囲 ${n}`)) n++;
    return `範囲 ${n}`;
  }
}
