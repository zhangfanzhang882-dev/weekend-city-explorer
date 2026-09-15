interface Env {
  AMAP_WEB_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

interface PlanRequest {
  city: string;
  area: string;
  date: string;
  endDate: string;
  budget: number;
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

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 交叉校验营业时间。
 * 高德 opentime2 覆盖率约 19/20，包含"周二全天不开放"这类关键信息。
 * 例如上海自然博物馆周二闭馆，不校验就会把它排进周二行程，用户白跑一趟。
 */
function checkOpening(opentime: string | string[] | undefined, date: string) {
  const text = Array.isArray(opentime) ? opentime.join('') : (opentime || '');
  if (!text) return { status: 'unknown' as const, note: '营业时间暂无数据' };

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return { status: 'unknown' as const, note: '营业时间暂无数据' };
  const weekday = WEEKDAY_NAMES[parsed.getDay()];
  const order = ['一', '二', '三', '四', '五', '六', '日'];
  const currentIndex = order.indexOf(weekday.replace('周', ''));

  for (const segment of text.split(/[；;]/).map((item) => item.trim()).filter(Boolean)) {
    if (!/不开放|休馆|闭馆|停止营业/.test(segment)) continue;
    let covers = segment.includes(weekday);
    if (!covers) {
      const range = segment.match(/周([一二三四五六日])\s*[-–至]\s*周([一二三四五六日])/);
      if (range) {
        const from = order.indexOf(range[1]);
        const to = order.indexOf(range[2]);
        covers = from >= 0 && to >= 0 && currentIndex >= from && currentIndex <= to;
      }
    }
    if (covers) return { status: 'closed' as const, note: `${weekday}不开放` };
  }
  return { status: 'open' as const, note: text.slice(0, 60) };
}

/** 解析高德 "lng,lat" 字符串 */
function parseLocation(location: string) {
  const [lng, lat] = location.split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/**
 * 两点直线距离（公里，Haversine）。
 * 实测直线与高德真实路径比值约 1.17–1.43，足以判断"一个在东一个在西"，
 * 且无需额外接口调用。
 */
function haversineKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** 路线地理指标：相邻站点间距、总里程、最远两点跨度 */
function routeGeometry(stops: Array<{ location: string }>) {
  const points = stops.map((stop) => parseLocation(stop.location)).filter(Boolean) as Array<{ lng: number; lat: number }>;
  if (points.length < 2) return { legs: [] as number[], totalKm: 0, maxLegKm: 0, spanKm: 0, measured: false };
  const legs: number[] = [];
  for (let i = 1; i < points.length; i += 1) legs.push(haversineKm(points[i - 1], points[i]));
  let spanKm = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) spanKm = Math.max(spanKm, haversineKm(points[i], points[j]));
  }
  return {
    legs,
    totalKm: legs.reduce((sum, value) => sum + value, 0),
    maxLegKm: Math.max(...legs),
    spanKm,
    measured: points.length === stops.length,
  };
}

/** 单段可接受上限（公里），超过视为不顺路 */
const MAX_LEG_KM = 6;
/** 一日路线总跨度上限（公里） */
const MAX_SPAN_KM = 12;

/**
 * 按最近邻重排站点，消除折返。
 * AI 给的顺序常是随意的（西→东→西），重排后总里程显著下降。
 * 枚举每个起点取总里程最短者；3 个点规模极小，开销可忽略。
 */
function orderByProximity<T extends { location: string }>(stops: T[]): T[] {
  const points = stops.map((stop) => parseLocation(stop.location));
  if (points.some((point) => !point)) return stops;
  const coords = points as Array<{ lng: number; lat: number }>;
  let best = stops;
  let bestTotal = Infinity;
  for (let start = 0; start < stops.length; start += 1) {
    const remaining = stops.map((_, index) => index).filter((index) => index !== start);
    const order = [start];
    let total = 0;
    let current = start;
    while (remaining.length > 0) {
      let nearest = 0;
      let nearestKm = Infinity;
      remaining.forEach((index, position) => {
        const km = haversineKm(coords[current], coords[index]);
        if (km < nearestKm) {
          nearestKm = km;
          nearest = position;
        }
      });
      total += nearestKm;
      current = remaining[nearest];
      order.push(current);
      remaining.splice(nearest, 1);
    }
    if (total < bestTotal) {
      bestTotal = total;
      best = order.map((index) => stops[index]);
    }
  }
  return best;
}

interface RouteDraft {
  title: string;
  subtitle: string;
  accent: string;
  weatherFit: string;
  stopNames: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const safeText = (value: unknown, max: number) =>
  String(value ?? '').trim().slice(0, max);

async function amapGet(path: string, params: Record<string, string>, key: string) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url.toString());
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.status !== '1') {
    throw new Error(`高德服务暂不可用：${safeText(data.info, 80) || response.status}`);
  }
  return data;
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
  // 区域词直接使用用户选择的行政区，让检索真正落在该区域
  const areaPrefix = request.area === '当前位置附近' ? '' : request.area.replace('路线', '').replace('漫游', '');
  const queries = interestKeywords.map((interest) => `${areaPrefix}${interest}`);
  const payloads: Array<Record<string, unknown>> = [];
  for (const keywords of queries) {
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
  return (openable.length >= 6 ? openable : enriched).slice(0, 20);
}

function parseJsonObject(raw: string) {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回有效路线结构');
  return JSON.parse(cleaned.slice(start, end + 1)) as { routes?: RouteDraft[] };
}

async function generateRoutes(request: PlanRequest, weather: unknown, pois: Awaited<ReturnType<typeof getPois>>, env: Env) {
  const baseUrl = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');

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

  const prompt = `你是周末城市路线规划师。请严格从候选地点中选择，不得创造新地点或修改地点名称。\n\n用户条件：${JSON.stringify(request)}\n天气：${JSON.stringify(weather)}\n候选地点：${JSON.stringify(poisForPrompt)}\n\n生成3条差异明显的一日路线，每条选3个不同地点。\n\n【地理顺路是硬性要求】每个候选地点带 bearing（相对方位）与 kmFromCenter（距中心公里数）。同一条路线内的地点必须彼此靠近、方位一致，相邻两点距离不得超过 ${MAX_LEG_KM} 公里，整条路线跨度不得超过 ${MAX_SPAN_KM} 公里。绝对不要把城市东边和西边的地点放进同一条路线。三条路线之间应通过不同区域或不同主题体现差异。\n\n候选地点还带 openNote 字段（真实营业时间）。请避免把营业时段明显冲突的地点排进同一条路线。\n\n字段要求：\n- accent：该路线的主题标签，4到6个汉字，例如“室内避雨”“城市漫步”，不要填颜色值或色号。\n- weatherFit：用不超过20个汉字说明这条路线为什么适合当天天气，只描述天气与场地的关系，不要复述日期或预报范围。\n\n只返回JSON：{"routes":[{"title":"","subtitle":"","accent":"","weatherFit":"","stopNames":["候选地点原名"]}]}`;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '只根据给定真实数据规划路线。禁止编造地点、价格、开放时间或平台评价。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(`AI 服务暂不可用：${safeText(payload.error?.message, 120) || response.status}`);
  const drafts = parseJsonObject(payload.choices?.[0]?.message?.content || '').routes ?? [];
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
  const routes: Array<Record<string, unknown>> = [];

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

export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    if (!context.env.AMAP_WEB_SERVICE_KEY || !context.env.DEEPSEEK_API_KEY) {
      return json({ error: '服务端尚未配置高德或 AI 密钥' }, 503);
    }
    const raw = await context.request.json() as Partial<PlanRequest>;
    const isDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const startDate = isDate(raw.date) ? String(raw.date) : new Date().toISOString().slice(0, 10);
    // 结束日期必须不早于开始日期，否则回落为单日
    const rawEnd = isDate(raw.endDate) ? String(raw.endDate) : startDate;
    const request: PlanRequest = {
      city: safeText(raw.city, 20) || '上海',
      area: safeText(raw.area, 30) || '当前位置附近',
      date: startDate,
      endDate: rawEnd >= startDate ? rawEnd : startDate,
      budget: Math.min(Math.max(Number(raw.budget) || 200, 0), 5000),
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
    return json({ weather, routes, poiCount: pois.length, candidates, verified, sources: ['高德地图', '高德天气', 'DeepSeek'] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '路线生成失败' }, 502);
  }
}
