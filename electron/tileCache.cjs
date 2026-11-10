'use strict';
// デスクトップ版の地図の保存(案件 2)。Web 版(案件 31)の service worker と同じ決まりで、
// 保存範囲の中で表示した地理院タイル(Z15〜Z18)を、ユーザーデータ内の tiles/{z}/{x}/{y}.jpg に保存する。
// Electron に依存させない(node のテストで動かすため)。取得の関数は外から渡す。
const fs = require('node:fs');
const path = require('node:path');

const UPSTREAM = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto';
/** 範囲の基準の倍率と、保存する倍率(src/core/tiles.ts の SNAP_ZOOM・SAVE_ZOOMS と同じ) */
const SNAP_ZOOM = 18;
const SAVE_ZOOMS = [15, 16, 17, 18];
/** 地図の画面が使う URL(画面側は、デスクトップ版のときだけ、地理院の URL の代わりにこれを使う) */
const TILE_URL = 'rll-tile://tile/{z}/{x}/{y}.jpg';

const isInt = (n) => Number.isInteger(n) && n >= 0;
const isTile = (t) => !!t && typeof t === 'object' && isInt(t.z) && isInt(t.x) && isInt(t.y) && t.z <= SNAP_ZOOM && t.x < 2 ** t.z && t.y < 2 ** t.z;

/** 画面から受け取った保存範囲を確かめる(src/core/tiles.ts の cleanAreas と同じ。数字の四角だけを残す) */
function cleanAreas(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((a) => a && typeof a === 'object' && isInt(a.x0) && isInt(a.y0) && isInt(a.x1) && isInt(a.y1) && a.x1 > a.x0 && a.y1 > a.y0)
    .map((a) => ({ x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 }));
}

/** タイルが保存範囲に入るか(src/core/tiles.ts の tileInRect と同じ。保存する倍率でなければ false) */
function tileInAreas(t, areas) {
  if (!SAVE_ZOOMS.includes(t.z)) return false;
  const s = 2 ** (SNAP_ZOOM - t.z);
  return areas.some((r) => t.x >= Math.floor(r.x0 / s) && t.x < Math.ceil(r.x1 / s) && t.y >= Math.floor(r.y0 / s) && t.y < Math.ceil(r.y1 / s));
}

/** rll-tile://tile/{z}/{x}/{y}.jpg → タイルの番号。違えば null(数字だけを取り出し、パスは自前で組み立てる) */
function parseRequest(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'rll-tile:' || u.hostname !== 'tile') return null;
  const m = /^\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.jpg$/.exec(u.pathname);
  if (!m) return null;
  const t = { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
  return isTile(t) ? t : null;
}

class TileCache {
  constructor(dir) { this.dir = dir; this.areas = []; }
  file(t) { return path.join(this.dir, String(t.z), String(t.x), `${t.y}.jpg`); }
  setAreas(v) { this.areas = cleanAreas(v); }
  inAreas(t) { return tileInAreas(t, this.areas); }
  get(t) {
    try { return fs.readFileSync(this.file(t)); } catch { return null; }
  }
  has(t) { try { return fs.statSync(this.file(t)).isFile(); } catch { return false; } }
  /** 一時ファイルに書いてから置き換える(途中で落ちても、壊れたタイルを残さない) */
  put(t, buf) {
    const f = this.file(t);
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.tmp', buf);
      fs.renameSync(f + '.tmp', f);
    } catch (e) { console.error('地図を保存できませんでした', e); }
  }
  /** 保存したタイルの一覧(大きさ付き) */
  list() {
    const out = [];
    const num = (s) => (/^\d{1,8}$/.test(s) ? Number(s) : null);
    const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
    for (const zd of dirs(this.dir)) {
      const z = num(zd.name);
      if (!zd.isDirectory() || z === null) continue;
      for (const xd of dirs(path.join(this.dir, zd.name))) {
        const x = num(xd.name);
        if (!xd.isDirectory() || x === null) continue;
        for (const yf of dirs(path.join(this.dir, zd.name, xd.name))) {
          const m = /^(\d{1,8})\.jpg$/.exec(yf.name);
          if (!yf.isFile() || !m) continue;
          let bytes = 0;
          try { bytes = fs.statSync(path.join(this.dir, zd.name, xd.name, yf.name)).size; } catch { /* 無視 */ }
          out.push({ z, x, y: Number(m[1]), bytes });
        }
      }
    }
    return out;
  }
  /** 指定したタイルを消す。消した枚数を返す */
  remove(list) {
    let n = 0;
    for (const t of Array.isArray(list) ? list : []) {
      if (!isTile(t)) continue;
      try { fs.unlinkSync(this.file(t)); n++; } catch { continue; /* 無いものは数えない */ }
      // 空になったフォルダも消す(中身が残っていれば消えない)
      for (const d of [path.join(this.dir, String(t.z), String(t.x)), path.join(this.dir, String(t.z))]) {
        try { fs.rmdirSync(d); } catch { break; }
      }
    }
    return n;
  }
  clear() { try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { console.error('保存した地図を消せませんでした', e); } }
}

/** 地理院から 1 枚取る。取れなければ例外か、{ ok:false } */
async function fetchTile(fetchImpl, t) {
  const r = await fetchImpl(`${UPSTREAM}/${t.z}/${t.x}/${t.y}.jpg`);
  if (!r.ok) return { ok: false, status: r.status };
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length ? { ok: true, buf } : { ok: false, status: 502 };
}

/**
 * 地図の画面からの要求に答える。保存範囲の中は、保存済みを優先(ネットがあっても取り直さない。航空写真は更新が少ないため)。
 * 無ければ取って保存する。範囲の外は、今までどおり取るだけ(保存しない)。
 * 戻り値: { status, body }(取れないときは body が null。画面ではそのタイルが空白になり、走行ラインは見える)
 */
async function serveTile(cache, fetchImpl, url) {
  const t = parseRequest(url);
  if (!t) return { status: 404, body: null };
  const keep = cache.inAreas(t);
  if (keep) { const hit = cache.get(t); if (hit) return { status: 200, body: hit }; }
  try {
    const r = await fetchTile(fetchImpl, t);
    if (!r.ok) return { status: r.status === 404 ? 404 : 502, body: null };
    if (keep) cache.put(t, r.buf);
    return { status: 200, body: r.buf };
  } catch { return { status: 504, body: null }; }
}

/** まだ保存していないタイルを、取って保存する(概略の地図の先読み・範囲を決める画面で見えていた地図) */
async function prefetchTiles(cache, fetchImpl, list) {
  let saved = 0, failed = 0;
  for (const t of Array.isArray(list) ? list : []) {
    if (!isTile(t) || cache.has(t)) continue;
    try {
      const r = await fetchTile(fetchImpl, t);
      if (!r.ok) { failed++; continue; }
      cache.put(t, r.buf);
      saved++;
    } catch { failed++; }
  }
  return { saved, failed };
}

module.exports = { TileCache, serveTile, prefetchTiles, parseRequest, cleanAreas, tileInAreas, TILE_URL, UPSTREAM };
