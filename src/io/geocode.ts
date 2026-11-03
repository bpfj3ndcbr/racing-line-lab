/** 住所検索の候補 */
export interface GeoHit { title: string; lat: number; lon: number }
export type Geocoder = (query: string) => Promise<GeoHit[]>;

/** 国土地理院の住所検索 API(地図と同じ提供元)。失敗したときは例外を投げる */
export const gsiGeocode: Geocoder = async (query) => {
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];
  const hits: GeoHit[] = [];
  for (const d of data as { geometry?: { coordinates?: unknown }; properties?: { title?: unknown } }[]) {
    const c = d?.geometry?.coordinates;
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && typeof d.properties?.title === 'string') {
      hits.push({ title: d.properties.title, lat: c[1], lon: c[0] });
    }
  }
  return hits.slice(0, 8);
};
