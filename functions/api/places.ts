interface Env {
  AMAP_WEB_SERVICE_KEY: string;
}

interface DistrictNode {
  name?: string;
  adcode?: string;
  citycode?: string | string[];
  level?: string;
  districts?: DistrictNode[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 行政区数据变动极少，缓存可显著降低搜索时的接口压力与延迟
      'cache-control': 'public, max-age=86400',
    },
  });

async function amapGet(path: string, params: Record<string, string>, key: string) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url.toString());
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.status !== '1') {
    throw new Error(`高德服务暂不可用：${String(data.info ?? response.status).slice(0, 80)}`);
  }
  return data;
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

export async function onRequestGet(context: { request: Request; env: Env }) {
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
      return json({ city, areas });
    }

    if (keyword.length < 1) return json({ cities: [] });
    const cities = await searchCities(keyword, context.env.AMAP_WEB_SERVICE_KEY);
    return json({ cities });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '查询失败' }, 502);
  }
}
