import { amapGet, json, safeText, type AppEnv } from '../_shared/api';
import { findLodging, searchLodging } from '../_shared/lodging';

interface DistrictNode {
  name?: string;
  adcode?: string;
  citycode?: string | string[];
  level?: string;
  districts?: DistrictNode[];
}

/**
 * 城市搜索：按关键词返回可选城市。
 * 高德 district 接口会混合返回区县与城市，这里只保留 city/province 级并去重，
 * 避免把"余杭区""杭锦旗"这类结果当成城市返回给用户。
 */
async function searchCities(keyword: string, key: string) {
  const data = await amapGet('/v3/config/district', {
    keywords: keyword,
    subdistrict: '0',
    extensions: 'base',
  }, key);

  const results: Array<{ name: string; adcode: string }> = [];
  const seen = new Set<string>();
  for (const item of (data.districts as DistrictNode[] | undefined) ?? []) {
    if (item.level !== 'city' && item.level !== 'province') continue;
    const name = (item.name || '').replace(/市$/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    results.push({ name, adcode: item.adcode || '' });
  }
  return results.slice(0, 8);
}

/**
 * 区域推荐：返回某城市下可选的行政区。
 * 直辖市（上海/北京/天津/重庆）在高德数据里多出一层"XX城区"，需要向下再取一级。
 */
async function listAreas(city: string, key: string) {
  const data = await amapGet('/v3/config/district', {
    keywords: city,
    subdistrict: '2',
    extensions: 'base',
  }, key);

  const root = (data.districts as DistrictNode[] | undefined)?.[0];
  if (!root) return [];

  const collect = (nodes: DistrictNode[] | undefined): string[] => {
    if (!nodes?.length) return [];
    const names: string[] = [];
    for (const node of nodes) {
      // 直辖市的"上海城区"是虚拟层级，跳过它取真正的行政区
      if (node.level === 'city' || /城区$/.test(node.name || '')) {
        names.push(...collect(node.districts));
        continue;
      }
      // 只收区县级；街道/乡镇过于细碎，会污染区域选择
      if (node.level === 'district' && node.name) names.push(node.name);
    }
    return names;
  };

  const areas = [...new Set(collect(root.districts))];
  return areas.slice(0, 20);
}

/**
 * 地点搜索：按关键词在指定城市内查找真实 POI。
 * 用于行程编辑时"换地点"和"加入地点"，让用户不受初始候选池限制。
 */
async function searchPois(keyword: string, city: string, key: string) {
  const data = await amapGet('/v3/place/text', {
    keywords: keyword,
    city,
    citylimit: 'true',
    offset: '12',
    page: '1',
    extensions: 'all',
  }, key);

  const toHttps = (url?: string) => (url || '').replace(/^http:\/\//, 'https://');
  const flatten = (value?: string | string[]) => (Array.isArray(value) ? value.join('') : value || '');
  const lowQuality = /(停车场|出入口|售票处|卫生间|公交站|地铁站出口)/;

  const pois = (data.pois as Array<Record<string, unknown>> | undefined) ?? [];
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (const poi of pois) {
    const name = String(poi.name ?? '');
    const typeText = `${name} ${String(poi.type ?? '')}`;
    if (!name || seen.has(name) || lowQuality.test(typeText)) continue;
    seen.add(name);
    const bizExt = (poi.biz_ext ?? {}) as { rating?: string; cost?: string };
    results.push({
      id: `search-${String(poi.id ?? results.length)}`,
      name,
      type: String(poi.type ?? '').split(';').at(-1) || '城市体验',
      area: String(poi.adname ?? ''),
      duration: '约 2 小时',
      cost: Math.max(0, Math.round(Number(bizExt.cost || 0) || 0)),
      hasCostData: Number(bizExt.cost || 0) > 0,
      rating: Number(bizExt.rating || 0) || null,
      address: flatten(poi.address as string | string[] | undefined),
      tel: flatten(poi.tel as string | string[] | undefined).split(';')[0] || '',
      location: String(poi.location ?? ''),
      photos: ((poi.photos as Array<{ url?: string }> | undefined) ?? [])
        .map((photo) => toHttps(photo.url))
        .filter((url) => url.startsWith('https://'))
        .slice(0, 3),
      source: ['高德地图'],
      reason: `${flatten(poi.address as string | string[] | undefined) || String(poi.adname ?? '')}${bizExt.rating ? ` · 高德评分 ${bizExt.rating}` : ''}`,
    });
  }
  return results.slice(0, 12);
}

export async function onRequestGet(context: { request: Request; env: AppEnv }) {
  try {
    if (!context.env.AMAP_WEB_SERVICE_KEY) {
      return json({ error: '服务端尚未配置高德密钥' }, 503);
    }
    const url = new URL(context.request.url);
    const mode = url.searchParams.get('mode') || 'city';
    const keyword = (url.searchParams.get('q') || '').trim().slice(0, 20);

    if (mode === 'area') {
      const city = keyword || '上海';
      const areas = await listAreas(city, context.env.AMAP_WEB_SERVICE_KEY);
      return json({ city, areas }, 200, 86400);
    }

    if (mode === 'lodging') {
      const city = (url.searchParams.get('city') || '上海').trim().slice(0, 20);
      const near = (url.searchParams.get('near') || '').trim();
      // 有坐标走周边搜索（离行程近），否则按关键词搜全城
      const list = near
        ? await findLodging(near, context.env.AMAP_WEB_SERVICE_KEY)
        : await searchLodging(keyword || '酒店', city, context.env.AMAP_WEB_SERVICE_KEY);
      return json({ lodging: list }, 200, 300);
    }

    if (mode === 'poi') {
      const city = (url.searchParams.get('city') || '上海').trim().slice(0, 20);
      if (keyword.length < 1) return json({ pois: [] }, 200, 60);
      const pois = await searchPois(keyword, city, context.env.AMAP_WEB_SERVICE_KEY);
      // POI 数据会变动（新开、歇业），只缓存 5 分钟
      return json({ pois }, 200, 300);
    }

    if (keyword.length < 1) return json({ cities: [] }, 200, 86400);
    const cities = await searchCities(keyword, context.env.AMAP_WEB_SERVICE_KEY);
    return json({ cities }, 200, 86400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '查询失败' }, 502, 0);
  }
}
