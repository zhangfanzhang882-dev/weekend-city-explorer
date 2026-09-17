/**
 * 住宿推荐。
 *
 * 数据来自高德 POI 周边搜索（分类 100000 住宿服务）——大众点评、携程、去哪儿等
 * 平台的开放接口均只面向企业/代理商（需营业执照、等保证明或代理资质），
 * 个人开发者无法接入，因此用高德已覆盖的酒店数据实现同等能力。
 *
 * 核心思路：按当天最后一站的坐标搜周边，保证"住的地方离行程近"。
 */
import { amapGet, safeText } from './api';

export interface Lodging {
  id: string;
  name: string;
  type: string;
  area: string;
  address: string;
  location: string;
  /** 与搜索中心（当天最后一站）的直线距离，单位米 */
  distanceM: number | null;
  rating: number | null;
  /** 高德返回的人均或房价参考；多数酒店无此数据 */
  cost: number;
  hasCostData: boolean;
  tel: string;
  photos: string[];
  source: string[];
}

/** 过滤明显不是住宿的结果 */
const LOW_QUALITY = /(停车场|出入口|售票处|公交站|地铁站|钟点房中介|日租房中介)/;

/**
 * 搜索指定坐标附近的住宿。
 * @param location 搜索中心 "lng,lat"，通常是当天最后一站
 * @param radiusM 搜索半径（米）；默认 2500，步行或一段短车程可达
 */
export async function findLodging(location: string, key: string, radiusM = 2500): Promise<Lodging[]> {
  const data = await amapGet('/v3/place/around', {
    location,
    types: '100000',
    radius: String(radiusM),
    offset: '20',
    page: '1',
    extensions: 'all',
    sortrule: 'weight',
  }, key);

  const toHttps = (url?: string) => (url || '').replace(/^http:\/\//, 'https://');
  const flatten = (value?: string | string[]) => (Array.isArray(value) ? value.join('') : value || '');

  const pois = (data.pois as Array<Record<string, unknown>> | undefined) ?? [];
  const seen = new Set<string>();
  const results: Lodging[] = [];

  for (const poi of pois) {
    const name = String(poi.name ?? '');
    if (!name || seen.has(name) || LOW_QUALITY.test(`${name} ${String(poi.type ?? '')}`)) continue;
    seen.add(name);

    const bizExt = (poi.biz_ext ?? {}) as { rating?: string; cost?: string };
    const cost = Math.max(0, Math.round(Number(bizExt.cost || 0) || 0));
    const distance = Number(poi.distance);

    results.push({
      id: `lodging-${String(poi.id ?? results.length)}`,
      name,
      type: String(poi.type ?? '').split(';').at(-1) || '住宿',
      area: String(poi.adname ?? ''),
      address: flatten(poi.address as string | string[] | undefined),
      location: String(poi.location ?? ''),
      distanceM: Number.isFinite(distance) ? Math.round(distance) : null,
      rating: Number(bizExt.rating || 0) || null,
      cost,
      hasCostData: cost > 0,
      tel: flatten(poi.tel as string | string[] | undefined).split(';')[0] || '',
      photos: ((poi.photos as Array<{ url?: string }> | undefined) ?? [])
        .map((photo) => toHttps(photo.url))
        .filter((url) => url.startsWith('https://'))
        .slice(0, 3),
      source: ['高德地图'],
    });
  }

  // 优先展示有评分的，其次按距离近的排
  return results
    .sort((a, b) => {
      if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
      return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity);
    })
    .slice(0, 12);
}

/** 按关键词在指定城市搜住宿，用于用户主动更换 */
export async function searchLodging(keyword: string, city: string, key: string): Promise<Lodging[]> {
  const data = await amapGet('/v3/place/text', {
    keywords: safeText(keyword, 20),
    types: '100000',
    city,
    citylimit: 'true',
    offset: '15',
    page: '1',
    extensions: 'all',
  }, key);

  const toHttps = (url?: string) => (url || '').replace(/^http:\/\//, 'https://');
  const flatten = (value?: string | string[]) => (Array.isArray(value) ? value.join('') : value || '');

  const pois = (data.pois as Array<Record<string, unknown>> | undefined) ?? [];
  const seen = new Set<string>();
  const results: Lodging[] = [];

  for (const poi of pois) {
    const name = String(poi.name ?? '');
    if (!name || seen.has(name) || LOW_QUALITY.test(`${name} ${String(poi.type ?? '')}`)) continue;
    seen.add(name);
    const bizExt = (poi.biz_ext ?? {}) as { rating?: string; cost?: string };
    const cost = Math.max(0, Math.round(Number(bizExt.cost || 0) || 0));
    results.push({
      id: `lodging-${String(poi.id ?? results.length)}`,
      name,
      type: String(poi.type ?? '').split(';').at(-1) || '住宿',
      area: String(poi.adname ?? ''),
      address: flatten(poi.address as string | string[] | undefined),
      location: String(poi.location ?? ''),
      distanceM: null,
      rating: Number(bizExt.rating || 0) || null,
      cost,
      hasCostData: cost > 0,
      tel: flatten(poi.tel as string | string[] | undefined).split(';')[0] || '',
      photos: ((poi.photos as Array<{ url?: string }> | undefined) ?? [])
        .map((photo) => toHttps(photo.url))
        .filter((url) => url.startsWith('https://'))
        .slice(0, 3),
      source: ['高德地图'],
    });
  }
  return results.slice(0, 12);
}
