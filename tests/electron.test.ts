// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeStore, createStore, LocalStorageStore, type NativeBridge } from '../src/io/storage';
import { Session } from '../src/store/session';

const { FileStore } = createRequire(import.meta.url)('../electron/fileStore.cjs');
const dir = () => mkdtempSync(join(tmpdir(), 'rll-'));

describe('ファイル保存(メイン側)', () => {
  it('書いた値は flush でファイルに入り、次の起動で読める', () => {
    const f = join(dir(), 'sub', 'settings.json');
    const a = new FileStore(f, 10);
    expect(a.get('x')).toBeNull();
    a.set('x', '1'); a.set('y', '{"a":2}');
    a.flush();
    expect(existsSync(f)).toBe(true);
    expect(existsSync(f + '.tmp')).toBe(false);
    const b = new FileStore(f);
    expect(b.get('x')).toBe('1');
    expect(b.get('y')).toBe('{"a":2}');
  });
  it('壊れたファイルは空から始める。書き込みはまとめて遅らせる', async () => {
    const f = join(dir(), 's.json');
    writeFileSync(f, '{broken');
    const a = new FileStore(f, 20);
    expect(a.get('k')).toBeNull();
    a.set('k', 'v');
    expect(readFileSync(f, 'utf8')).toBe('{broken');                       // まだ書いていない
    await new Promise((r) => setTimeout(r, 60));
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ k: 'v' });
  });
});

describe('画面側の保存先', () => {
  const bridge = (): NativeBridge & { m: Map<string, string> } => {
    const m = new Map<string, string>();
    return { m, storageGet: (k) => m.get(k) ?? null, storageSet: (k, v) => { m.set(k, v); }, storageClear: () => { m.clear(); }, getPathForFile: () => '', readTextFile: async () => null, saveText: vi.fn(async () => ({ ok: true })) };
  };
  it('窓口があれば NativeStore、無ければ localStorage', () => {
    expect(createStore({ rllNative: bridge() })).toBeInstanceOf(NativeStore);
    expect(createStore({})).toBeInstanceOf(LocalStorageStore);
  });
  it('Session の設定・補正データが窓口を通って保存され、別の Session で読める', () => {
    const b = bridge();
    const s1 = new Session(new NativeStore(b));
    s1.setSetting('compare.labels', 'speed');
    expect([...b.m.keys()].every((k) => k.startsWith('rll.'))).toBe(true);
    const s2 = new Session(new NativeStore(b));
    expect(s2.getSetting('compare.labels', 'off')).toBe('speed');
  });
  it('窓口が例外を投げても動作は続く', () => {
    const st = new NativeStore({ storageGet: () => { throw new Error('x'); }, storageSet: () => { throw new Error('x'); }, storageClear: () => { throw new Error('x'); }, getPathForFile: () => '', readTextFile: async () => null, saveText: async () => ({ ok: false }) });
    expect(st.get('a')).toBeNull();
    expect(() => st.set('a', 'b')).not.toThrow();
  });

  it('FileStore.clear() は、すべて消してファイルにも反映する', () => {
    const f = join(dir(), 'settings.json');
    const a = new FileStore(f, 10);
    a.set('k', 'v'); a.flush();
    a.clear();
    expect(new FileStore(f).get('k')).toBeNull();
  });
});
