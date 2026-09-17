import {
  amapGet, callDeepSeek, extractJsonObject, formatDate, isDateString, json, safeText,
  type AppEnv,
} from '../_shared/api';
import {
  centerOf, haversineKm, MAX_LEG_KM, MAX_SPAN_KM, orderByProximity, parseLocation, routeGeometry,
} from '../_shared/geo';
import { checkOpening } from '../_shared/opening';
import { fetchAirQuality, fetchHoliday } from '../_shared/context';
import { findLodging } from '../_shared/lodging';

interface PlanRequest {
  city: string;
  /** 兼容单区域旧字段 */
  area: string;
  /** 多选区域；为空表示不限区域 */
  areas: string[];
  date: string;
  endDate: string;
  /** 预算档位标识，如「经济实惠」；不含具体金额 */
  budgetTier: string;
  /** 该档位的消费取向说明 */
  budgetHint: string;
  interests: string[];
  partySize: number;
}

interface AmapPoi {
  id: string;
  name: string;
  type: string;
  address: string | string[];
  pname?: string;
  cityname?: string;
  adname?: string;
  location?: string;
  tel?: string | string[];
  photos?: Array<{ title?: string | string[]; url?: string }>;
  biz_ext?: { rating?: string; cost?: string; opentime2?: string | string[] };
}

interface RouteDraft {
  title: string;
  subtitle: string;
  accent: string;
  weatherFit: string;
  stopNames: string[];
}

async function getCityAdcode(city: string, key: string) {
  const data = await amapGet('/v3/config/district', { keywords: city, subdistrict: '0', extensions: 'base' }, key);
  const districts = data.districts as Array<{ adcode?: string }> | undefined;
  const adcode = districts?.[0]?.adcode;
  if (!adcode) throw new Error(`未找到城市“${city}”的行政区编码`);
  return adcode;
}

/**
 * 天气查询支持日期范围：命中范围内任一天即视为精确，
 * 并汇总范围内的天气概览，便于跨天行程判断。
 */
async function getWeather(city: string, date: string, endDate: string, key: string) {
  const adcode = await getCityAdcode(city, key);
  const data = await amapGet('/v3/weather/weatherInfo', { city: adcode, extensions: 'all' }, key);
  const forecasts = data.forecasts as Array<{ casts?: Array<Record<string, string>> }> | undefined;
  const casts = forecasts?.[0]?.casts ?? [];
  const inRange = casts.filter((item) => item.date >= date && item.date <= endDate);
  const selected = inRange[0] ?? casts.find((item) => item.date === date) ?? casts.at(-1);
  if (!selected) throw new Error(`暂未获得“${city}”的天气预报`);
  const forecastStatus = inRange.length > 0 ? 'exact' : 'out_of_range';
  const rangeDays = date === endDate ? 1 : inRange.length;
  const rangeSummary = inRange.length > 1
    ? inRange.map((item) => `${item.date.slice(5)} ${item.dayweather}`).join(' / ')
    : '';
  return {
    date: selected.date,
    condition: selected.dayweather,
    tempHigh: Number(selected.daytemp),
    tempLow: Number(selected.nighttemp),
    dayWind: selected.daywind,
    dayPower: selected.daypower,
    requestedDate: date,
    requestedEndDate: endDate,
    coveredDays: rangeDays,
    rangeSummary,
    forecastStatus,
    note: forecastStatus === 'exact'
      ? (rangeSummary ? `所选日期范围的高德预报：${rangeSummary}` : `${selected.date} 的高德预报`)
      : `${date} 尚未进入预报窗口，当前展示最远可用日期 ${selected.date}，路线按临近天气规划`,
    source: '高德天气',
  };
}

async function getPois(request: PlanRequest, key: string) {
  const requestedKeywords = request.interests.length ? request.interests : ['展览', '市集'];
  // 用户自定义关键词优先，只在数量不足时用通用词补齐，避免自定义兴趣被通用词挤掉
  const complementaryKeywords = ['博物馆', '公园', '咖啡', '演出', '艺术中心'];
  const merged = [...new Set([...requestedKeywords, ...complementaryKeywords])];
  const interestKeywords = merged.slice(0, Math.max(5, Math.min(requestedKeywords.length, 6)));
  // 区域可多选：对每个区域分别检索，让每个选中区域都有候选地点。
  // 区域数多时缩减每区关键词数，避免请求量随乘积膨胀。
  const selectedAreas = request.areas.length > 0 ? request.areas : [''];
  const perAreaKeywords = selectedAreas.length > 1
    ? interestKeywords.slice(0, Math.max(2, Math.ceil(6 / selectedAreas.length)))
    : interestKeywords;

  const queries: string[] = [];
  for (const areaName of selectedAreas) {
    const prefix = areaName.replace('路线', '').replace('漫游', '');
    for (const interest of perAreaKeywords) queries.push(`${prefix}${interest}`);
  }

  const payloads: Array<Record<string, unknown>> = [];
  for (const keywords of queries.slice(0, 10)) {
    payloads.push(await amapGet('/v3/place/text', {
      keywords,
      city: request.city,
      citylimit: 'true',
      offset: '8',
      page: '1',
      extensions: 'all',
    }, key));
    await new Promise((resolve) => setTimeout(resolve, 260));
  }

  const seen = new Set<string>();
  const pois: AmapPoi[] = [];
  const lowQualityPattern = /(生鲜|农贸|菜市场|超市|便利店|蔬菜|水果|批发|停车场|出入口|售票处|卫生间)/;
  const majorVenuePatterns = [
    '上海新国际博览中心',
    '上海展览中心',
    '上海世博展览馆',
    '国家会展中心',
  ];
  const canonicalName = (name: string) => {
    const majorVenue = majorVenuePatterns.find((venue) => name.includes(venue));
    if (majorVenue) return majorVenue;
    const parenthetical = name.match(/[（(]([^）)]{4,})[）)]/);
    const source = parenthetical?.[1] || name;
    return source
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[·\-—]/g, '')
      .replace(/(东一馆|西一馆|友谊会堂|小黄楼|展览馆|东馆|西馆|南馆|北馆|西花园|东花园|[A-Z]\d+号馆)[A-Z0-9]*$/i, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  };
  for (const payload of payloads) {
    for (const poi of (payload.pois as AmapPoi[] | undefined) ?? []) {
      const dedupeKey = canonicalName(poi.name || '');
      const typeText = `${poi.name || ''} ${poi.type || ''}`;
      if (!poi.name || !dedupeKey || lowQualityPattern.test(typeText) || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      pois.push(poi);
    }
  }
  if (pois.length < 6) throw new Error('真实地点候选不足，请更换城市、区域或兴趣后重试');
  // 高德照片部分返回 http，页面为 https 会被浏览器拦截，统一升级协议
  const toHttps = (url?: string) => (url || '').replace(/^http:\/\//, 'https://');
  const flatten = (value?: string | string[]) => (Array.isArray(value) ? value.join('') : value || '');

  const enriched = pois.map((poi, index) => {
    const opening = checkOpening(poi.biz_ext?.opentime2, request.date);
    return {
      id: poi.id || `poi-${index + 1}`,
      name: poi.name,
      type: poi.type?.split(';').at(-1) || '城市体验',
      area: poi.adname || request.area,
      address: flatten(poi.address),
      location: poi.location || '',
      tel: flatten(poi.tel).split(';')[0] || '',
      rating: Number(poi.biz_ext?.rating || 0) || null,
      cost: Math.max(0, Math.round(Number(poi.biz_ext?.cost || 0) || 0)),
      openStatus: opening.status,
      openNote: opening.note,
      photos: (poi.photos ?? [])
        .map((photo) => toHttps(photo.url))
        .filter((url) => url.startsWith('https://'))
        .slice(0, 3),
      source: ['高德地图'],
    };
  });

  // 当天闭馆的地点直接排除；若剩余不足则退回全量，避免无结果
  const openable = enriched.filter((poi) => poi.openStatus !== 'closed');
  const usable = openable.length >= 6 ? openable : enriched;

  // 多选区域时按区域配额取样，避免前几个区把 20 个名额占满、后面的区一个都进不来
  if (request.areas.length > 1) {
    const quota = Math.max(2, Math.floor(20 / request.areas.length));
    const picked: typeof usable = [];
    const counts = new Map<string, number>();
    // 先按配额轮取每个选中区域的地点
    for (const poi of usable) {
      const matched = request.areas.find((name) => poi.area.includes(name) || name.includes(poi.area));
      if (!matched) continue;
      const used = counts.get(matched) ?? 0;
      if (used >= quota) continue;
      counts.set(matched, used + 1);
      picked.push(poi);
    }
    // 名额未满则用其余地点补齐
    for (const poi of usable) {
      if (picked.length >= 20) break;
      if (!picked.includes(poi)) picked.push(poi);
    }
    if (picked.length >= 6) return picked.slice(0, 20);
  }

  return usable.slice(0, 20);
}

async function generateRoutes(request: PlanRequest, weather: unknown, pois: Awaited<ReturnType<typeof getPois>>, env: AppEnv) {

  // 候选点几何中心，用于给模型提供可读的相对方位
  const center = (() => {
    const points = pois.map((poi) => parseLocation(poi.location)).filter(Boolean) as Array<{ lng: number; lat: number }>;
    if (points.length === 0) return null;
    return {
      lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
      lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    };
  })();

  // 照片 URL 与原始坐标对选点决策无用且占 token，换成方位与距中心距离
  const poisForPrompt = pois.map(({ photos, location, ...rest }) => {
    const point = parseLocation(location);
    const geo = point && center
      ? {
        bearing: `${point.lat >= center.lat ? '北' : '南'}${point.lng >= center.lng ? '东' : '西'}`,
        kmFromCenter: Number(haversineKm(center, point).toFixed(1)),
      }
      : {};
    return { ...rest, ...geo };
  });

  const prompt = `你是周末城市路线规划师。请严格从候选地点中选择，不得创造新地点或修改地点名称。\n\n用户条件：${JSON.stringify(request)}\n天气：${JSON.stringify(weather)}\n候选地点：${JSON.stringify(poisForPrompt)}\n\n生成3条差异明显的一日路线，每条选3个不同地点。\n\n【地理顺路是硬性要求】每个候选地点带 bearing（相对方位）与 kmFromCenter（距中心公里数）。同一条路线内的地点必须彼此靠近、方位一致，相邻两点距离不得超过 ${MAX_LEG_KM} 公里，整条路线跨度不得超过 ${MAX_SPAN_KM} 公里。绝对不要把城市东边和西边的地点放进同一条路线。三条路线之间应通过不同区域或不同主题体现差异。\n\n【消费取向】用户选择的档位是「${request.budgetTier}」，含义是：${request.budgetHint}。请据此挑选地点类型，但不要在任何字段里编造门票价格或人均花费——多数候选地点没有价格数据，价格因城市与场馆差异很大。\n\n候选地点还带 openNote 字段（真实营业时间）。请避免把营业时段明显冲突的地点排进同一条路线。\n\n字段要求：\n- accent：该路线的主题标签，4到6个汉字，例如“室内避雨”“城市漫步”，不要填颜色值或色号。\n- weatherFit：用不超过20个汉字说明这条路线为什么适合当天天气，只描述天气与场地的关系，不要复述日期或预报范围。\n\n只返回JSON：{"routes":[{"title":"","subtitle":"","accent":"","weatherFit":"","stopNames":["候选地点原名"]}]}`;
  const content = await callDeepSeek(env, [
    { role: 'system', content: '只根据给定真实数据规划路线。禁止编造地点、价格、开放时间或平台评价。' },
    { role: 'user', content: prompt },
  ]);
  const drafts = extractJsonObject<{ routes?: RouteDraft[] }>(content).routes ?? [];
  const poiMap = new Map(pois.map((poi) => [poi.name, poi]));
  // AI 偶尔会把色号填进 accent、把日期范围复述进 weatherFit，这里做服务端兜底清洗。
  const cleanAccent = (value: unknown) => {
    const text = safeText(value, 12);
    return /^#|rgb|^[0-9a-f]{6}$/i.test(text) ? '' : text;
  };
  const cleanWeatherFit = (value: unknown) => {
    const text = safeText(value, 30);
    return /尚未进入预报窗口|预报范围|\d{4}-\d{2}/.test(text) ? '' : text;
  };
  const valid = drafts.slice(0, 3).map((draft, routeIndex) => {
    const picked = (draft.stopNames || []).map((name) => poiMap.get(name)).filter(Boolean).slice(0, 3) as typeof pois;
    if (picked.length < 3) return null;

    // 地理硬校验：AI 可能无视提示词，这里按最近邻重排并拒绝跨城组合
    const selected = orderByProximity(picked);
    const geometry = routeGeometry(selected);
    if (geometry.measured && (geometry.maxLegKm > MAX_LEG_KM || geometry.spanKm > MAX_SPAN_KM)) return null;

    const knownCosts = selected.filter((poi) => poi.cost > 0);
    return {
      id: `ai-${routeIndex + 1}`,
      title: safeText(draft.title, 24),
      subtitle: safeText(draft.subtitle, 44),
      accent: cleanAccent(draft.accent),
      weatherFit: cleanWeatherFit(draft.weatherFit),
      totalTime: `${selected.length * 2} 小时`,
      budget: selected.reduce((sum, poi) => sum + poi.cost, 0),
      // 高德多数 POI 无价格数据，需区分“真的免费”与“暂无数据”，避免误导为全程 0 元。
      budgetKnownCount: knownCosts.length,
      budgetTotalCount: selected.length,
      totalKm: Number(geometry.totalKm.toFixed(1)),
      maxLegKm: Number(geometry.maxLegKm.toFixed(1)),
      stops: selected.map((poi, stopIndex) => ({
        id: `${routeIndex + 1}-${poi.id || stopIndex}`,
        name: poi.name,
        type: poi.type,
        area: poi.area,
        duration: '约 2 小时',
        cost: poi.cost,
        hasCostData: poi.cost > 0,
        photos: poi.photos,
        rating: poi.rating,
        address: poi.address,
        tel: poi.tel,
        openStatus: poi.openStatus,
        openNote: poi.openNote,
        location: poi.location,
        legKm: stopIndex === 0 ? null : Number((geometry.legs[stopIndex - 1] ?? 0).toFixed(1)),
        source: poi.source,
        reason: `${poi.address || poi.area}${poi.rating ? ` · 高德评分 ${poi.rating}` : ''}`,
      })),
    };
  }).filter(Boolean);

  // AI 三条路线可能全被地理校验拒绝，用确定性聚类兜底，保证始终有顺路方案
  if (valid.length < 2) {
    const fallback = buildGeoRoutes(pois);
    if (fallback.length >= 2) return fallback;
    throw new Error('未能生成地理上顺路的路线，请缩小区域范围后重试');
  }
  return valid;
}

/**
 * 确定性兜底：按地理邻近聚类生成路线，不依赖 AI。
 * 取未使用的首个点为种子，配其最近的 2 个邻居成组，天然顺路。
 */
function buildGeoRoutes(pois: Awaited<ReturnType<typeof getPois>>) {
  const withPoint = pois
    .map((poi) => ({ poi, point: parseLocation(poi.location) }))
    .filter((item) => item.point) as Array<{ poi: typeof pois[number]; point: { lng: number; lat: number } }>;
  if (withPoint.length < 6) return [];

  const used = new Set<string>();
  // 与 AI 路线保持同一结构，便于调用方统一处理
  const routes: Array<{ id: string; stops: Array<{ name: string; location: string }> } & Record<string, unknown>> = [];

  for (let index = 0; index < 3; index += 1) {
    const available = withPoint.filter((item) => !used.has(item.poi.name));
    if (available.length < 3) break;
    const seed = available[0];
    const neighbors = available
      .filter((item) => item.poi.name !== seed.poi.name)
      .map((item) => ({ item, km: haversineKm(seed.point, item.point) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 2)
      .map((entry) => entry.item);
    if (neighbors.length < 2) break;

    const group = [seed, ...neighbors];
    group.forEach((item) => used.add(item.poi.name));
    const selected = orderByProximity(group.map((item) => item.poi));
    const geometry = routeGeometry(selected);
    const knownCosts = selected.filter((poi) => poi.cost > 0);
    routes.push({
      id: `geo-${index + 1}`,
      title: `${selected[0].area}就近路线`,
      subtitle: selected.map((poi) => poi.name).join(' · ').slice(0, 44),
      accent: '就近顺路',
      weatherFit: '',
      totalTime: `${selected.length * 2} 小时`,
      budget: selected.reduce((sum, poi) => sum + poi.cost, 0),
      budgetKnownCount: knownCosts.length,
      budgetTotalCount: selected.length,
      totalKm: Number(geometry.totalKm.toFixed(1)),
      maxLegKm: Number(geometry.maxLegKm.toFixed(1)),
      stops: selected.map((poi, stopIndex) => ({
        id: `geo${index + 1}-${poi.id || stopIndex}`,
        name: poi.name,
        type: poi.type,
        area: poi.area,
        duration: '约 2 小时',
        cost: poi.cost,
        hasCostData: poi.cost > 0,
        photos: poi.photos,
        rating: poi.rating,
        address: poi.address,
        tel: poi.tel,
        openStatus: poi.openStatus,
        openNote: poi.openNote,
        location: poi.location,
        legKm: stopIndex === 0 ? null : Number((geometry.legs[stopIndex - 1] ?? 0).toFixed(1)),
        source: poi.source,
        reason: `${poi.address || poi.area}${poi.rating ? ` · 高德评分 ${poi.rating}` : ''}`,
      })),
    });
  }
  return routes;
}

export async function onRequestPost(context: { request: Request; env: AppEnv }) {
  try {
    if (!context.env.AMAP_WEB_SERVICE_KEY || !context.env.DEEPSEEK_API_KEY) {
      return json({ error: '服务端尚未配置高德或 AI 密钥' }, 503);
    }
    const raw = await context.request.json() as Partial<PlanRequest>;
    const isDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const startDate = isDate(raw.date) ? String(raw.date) : new Date().toISOString().slice(0, 10);
    // 结束日期必须不早于开始日期，否则回落为单日
    const rawEnd = isDate(raw.endDate) ? String(raw.endDate) : startDate;
    // 区域支持多选；兼容旧的单 area 字段
    const rawAreas = Array.isArray(raw.areas)
      ? raw.areas.map((item) => safeText(item, 20)).filter(Boolean).slice(0, 5)
      : [];
    const legacyArea = safeText(raw.area, 30);
    const areas = rawAreas.length > 0
      ? rawAreas
      : (legacyArea && legacyArea !== '当前位置附近' && legacyArea !== '不限区域' ? [legacyArea] : []);

    const request: PlanRequest = {
      city: safeText(raw.city, 20) || '上海',
      area: areas.length > 0 ? areas.join('、') : '不限区域',
      areas,
      date: startDate,
      endDate: rawEnd >= startDate ? rawEnd : startDate,
      budgetTier: safeText(raw.budgetTier, 16) || '舒适适中',
      budgetHint: safeText(raw.budgetHint, 60) || '不刻意省，愿意为好体验买票',
      interests: Array.isArray(raw.interests) ? raw.interests.map((item) => safeText(item, 12)).filter(Boolean).slice(0, 6) : [],
      partySize: Math.min(Math.max(Number(raw.partySize) || 1, 1), 20),
    };
    const [weather, pois] = await Promise.all([
      getWeather(request.city, request.date, request.endDate, context.env.AMAP_WEB_SERVICE_KEY),
      getPois(request, context.env.AMAP_WEB_SERVICE_KEY),
    ]);
    const routes = await generateRoutes(request, weather, pois, context.env);
    // 同时返回全部候选地点，供前端在行程编辑时替换或追加真实地点
    const candidates = pois.map((poi) => ({
      id: `cand-${poi.id}`,
      name: poi.name,
      type: poi.type,
      area: poi.area,
      duration: '约 2 小时',
      cost: poi.cost,
      hasCostData: poi.cost > 0,
      photos: poi.photos,
      rating: poi.rating,
      address: poi.address,
      tel: poi.tel,
      openStatus: poi.openStatus,
      openNote: poi.openNote,
      location: poi.location,
      source: poi.source,
      reason: `${poi.address || poi.area}${poi.rating ? ` · 高德评分 ${poi.rating}` : ''}`,
    }));
    const verified = {
      total: pois.length,
      openConfirmed: pois.filter((poi) => poi.openStatus === 'open').length,
      openUnknown: pois.filter((poi) => poi.openStatus === 'unknown').length,
      withPhotos: pois.filter((poi) => poi.photos.length > 0).length,
      withRating: pois.filter((poi) => poi.rating).length,
    };

    // 出行环境与住宿：三者互不依赖，并行请求；任一失败都不影响路线本身
    const isMultiDay = request.endDate > request.date;
    const cityCenter = centerOf(
      pois.map((poi) => parseLocation(poi.location)).filter(Boolean) as Array<{ lng: number; lat: number }>,
    );
    // 跨天才需要住宿；以第一条路线的最后一站为中心，保证住得离行程近
    const lodgingAnchor = isMultiDay ? routes[0]?.stops?.at(-1)?.location : undefined;

    const [holiday, air, lodging] = await Promise.all([
      fetchHoliday(request.date),
      cityCenter ? fetchAirQuality(cityCenter.lng, cityCenter.lat, request.date) : Promise.resolve(null),
      lodgingAnchor
        ? findLodging(lodgingAnchor, context.env.AMAP_WEB_SERVICE_KEY).catch(() => [])
        : Promise.resolve([]),
    ]);

    return json({
      weather,
      routes,
      poiCount: pois.length,
      candidates,
      verified,
      holiday,
      air,
      lodging,
      lodgingAnchorName: lodgingAnchor ? routes[0]?.stops?.at(-1)?.name ?? '' : '',
      isMultiDay,
      // 按能力维度列出，而非单一供应商名
      sources: ['真实天气', '真实地点', '节假日日历', '空气质量', 'AI 路线'],
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '路线生成失败' }, 502);
  }
}
