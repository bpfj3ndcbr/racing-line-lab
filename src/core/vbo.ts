import type { TrackLog } from './types';

/**
 * .vbo(VBOX 形式)パーサ。RaceChrono 出力と DigiSpice 変換出力の両方を想定。
 * - 緯度経度は「分」単位(度×60)、経度は符号反転(負が東経)
 * - 時刻は hhmmss.ss (UTC)。日跨ぎは連続した秒に直す
 * - 列は [column names] から引く(無い列は undefined)
 */

const DEFAULT_COLUMNS = ['sats', 'time', 'lat', 'long', 'velocity', 'heading', 'height'];

interface ColumnIndex {
  count: number;
  time: number; lat: number; lon: number; speed: number;
  heading: number; height: number; longAcc: number; latAcc: number;
}

function buildIndex(columns: string[]): ColumnIndex {
  const names = columns.map((c) => c.toLowerCase());
  const find = (...alias: string[]) => names.findIndex((n) => alias.includes(n));
  const idx: ColumnIndex = {
    count: columns.length,
    time: find('time'),
    lat: find('lat', 'latitude'),
    lon: find('long', 'lon', 'longitude'),
    speed: find('velocity', 'speed'),
    heading: find('heading'),
    height: find('height'),
    longAcc: find('longacc'),
    latAcc: find('latacc'),
  };
  for (const k of ['time', 'lat', 'lon', 'speed'] as const) {
    if (idx[k] < 0) throw new Error(`.vbo の [column names] に必須列がありません: ${k}`);
  }
  return idx;
}

/** hhmmss.ss → 0時からの秒 */
export function parseHms(s: string): number {
  if (s.length < 6) return NaN;
  return Number(s.slice(0, 2)) * 3600 + Number(s.slice(2, 4)) * 60 + Number(s.slice(4));
}

export function parseVbo(text: string, fileName = ''): TrackLog {
  const lines = text.split(/\r?\n/);
  let section = '';
  let createdUtc: TrackLog['createdUtc'] = null;
  let columns: string[] = [];
  const comments: string[] = [];
  let idx: ColumnIndex | null = null;

  const T: number[] = [], LAT: number[] = [], LON: number[] = [], SPD: number[] = [];
  const HDG: number[] = [], HGT: number[] = [], LACC: number[] = [], TACC: number[] = [];
  let prev = NaN, wrap = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[')) { section = line.toLowerCase(); continue; }
    if (section === '') {
      const m = line.match(/File created on (\d+)\/(\d+)\/(\d+) at (\d+):(\d+):(\d+)/i);
      if (m) {
        createdUtc = { day: +m[1], month: +m[2], year: +m[3], hour: +m[4], minute: +m[5], second: +m[6] };
      }
      continue;
    }
    if (section === '[comments]') { comments.push(line); continue; }
    if (section === '[column names]') { columns = line.split(/\s+/); continue; }
    if (section !== '[data]') continue;

    if (!idx) idx = buildIndex(columns.length ? columns : DEFAULT_COLUMNS);
    const p = line.split(/\s+/);
    if (p.length < idx.count) continue;
    const sec = parseHms(p[idx.time]);
    const lat = parseFloat(p[idx.lat]) / 60;
    const lon = -parseFloat(p[idx.lon]) / 60;
    const spd = parseFloat(p[idx.speed]);
    if (!Number.isFinite(sec) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let tt = sec + wrap;
    if (!Number.isNaN(prev) && tt < prev - 43200) { wrap += 86400; tt = sec + wrap; }
    prev = tt;
    T.push(tt); LAT.push(lat); LON.push(lon); SPD.push(Number.isFinite(spd) ? spd : 0);
    if (idx.heading >= 0) HDG.push(parseFloat(p[idx.heading]));
    if (idx.height >= 0) HGT.push(parseFloat(p[idx.height]));
    if (idx.longAcc >= 0) LACC.push(parseFloat(p[idx.longAcc]));
    if (idx.latAcc >= 0) TACC.push(parseFloat(p[idx.latAcc]));
  }

  if (T.length < 2) throw new Error('.vbo にデータ行がありません');
  const first = T[0];
  const t = Float64Array.from(T, (v) => v - first);
  const startEpochMs = createdUtc
    ? Date.UTC(createdUtc.year, createdUtc.month - 1, createdUtc.day) + first * 1000
    : null;

  const log: TrackLog = {
    fileName, createdUtc, startEpochMs, columns, comments,
    t, lat: Float64Array.from(LAT), lon: Float64Array.from(LON), speed: Float64Array.from(SPD),
  };
  if (HDG.length) log.heading = Float64Array.from(HDG);
  if (HGT.length) log.height = Float64Array.from(HGT);
  if (LACC.length) log.longAcc = Float64Array.from(LACC);
  if (TACC.length) log.latAcc = Float64Array.from(TACC);
  return log;
}

/** 表示用: UNIX ms → "2026/05/06 09:45" (JST) */
export function formatJst(epochMs: number): string {
  const d = new Date(epochMs + 9 * 3600 * 1000);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${z(d.getUTCMonth() + 1)}/${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`;
}
