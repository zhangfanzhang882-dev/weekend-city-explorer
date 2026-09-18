import {
  amapGet, callDeepSeek, extractJsonObject, formatDate, isDateString, json, listDates, safeText, weekdayOf,
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
  /** 单日返回：直接给站点名 */
  stopNames?: string[];
  /** 多日返回：按天分组 */
  days?: Array<{ theme?: string; stopNames?: string[]; ids?: number[] }>;
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

  // 跨天行程需要的不重复地点成倍增加（3条 × N天 × 每天3站），这里放大候选池
  const dayCount = listDates(request.date, request.endDate).length;
  const perQueryOffset = dayCount > 1 ? '12' : '8';
  const queryLimit = dayCount > 1 ? 14 : 10;

  const payloads: Array<Record<string, unknown>> = [];
  for (const keywords of queries.slice(0, queryLimit)) {
    payloads.push(await amapGet('/v3/place/text', {
      keywords,
      city: request.city,
      citylimit: 'true',
      offset: perQueryOffset,
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
    // 保留原文：多日行程需要对每一天分别校验，不能只用首日结果
    const rawOpentime = Array.isArray(poi.biz_ext?.opentime2)
      ? poi.biz_ext.opentime2.join('')
      : (poi.biz_ext?.opentime2 || '');
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
      rawOpentime,
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
  // 只给 AI 决策必需的字段，并用短 id 代替长地点名，避免输出 JSON 过长被截断
  const poiIndexById = new Map<number, (typeof pois)[number]>();
  const poisForPrompt = pois.map((poi, poiIndex) => {
    poiIndexById.set(poiIndex + 1, poi);
    const { photos, location, address, tel, source, rawOpentime, id, ...rest } = poi;
    void photos; void address; void tel; void source; void rawOpentime; void id;
    const point = parseLocation(location);
    const geo = point && center
      ? {
        bearing: `${point.lat >= center.lat ? '北' : '南'}${point.lng >= center.lng ? '东' : '西'}`,
        kmFromCenter: Number(haversineKm(center, point).toFixed(1)),
      }
      : {};
    return { id: poiIndex + 1, ...rest, ...geo };
  });

  // 按天规划：多日行程要求 AI 为每一天分别安排，且当天不能重复用同一地点
  const days = listDates(request.date, request.endDate);
  const dayLabels = days.map((date, index) => `第${index + 1}天 ${date}（${weekdayOf(date)}）`).join('、');
  const perDayStops = days.length >= 3 ? 2 : 3;
  // 单日 6km/12km 是按"一天逛完"设的。跨天时每天可接受稍大范围（仍远小于跨城），
  // 否则 AI 合理的安排会被误杀，全部退化成兜底聚类。
  const legLimit = days.length > 1 ? 8 : MAX_LEG_KM;
  const spanLimit = days.length > 1 ? 16 : MAX_SPAN_KM;

  const dayRule = days.length === 1
    ? `生成3条差异明显的一日路线，每条选 ${perDayStops} 个不同地点。`
    : `本次行程共 ${days.length} 天：${dayLabels}。
生成3套完整方案，每套方案都要覆盖全部 ${days.length} 天。
每天安排 ${perDayStops} 个地点，同一套方案内地点不得重复。
每天的地点要彼此靠近；不同天之间可以换区域，让每天有不同主题。`;

  const prompt = `你是城市路线规划师。请严格从候选地点中选择，不得创造新地点或修改地点名称。

用户条件：${JSON.stringify(request)}
天气：${JSON.stringify(weather)}
候选地点（用 id 引用，不要写地点名）：${JSON.stringify(poisForPrompt)}

${dayRule}

【地理顺路是硬性要求】每个候选地点带 bearing（相对方位）与 kmFromCenter（距中心公里数）。同一天内的地点必须彼此靠近、方位一致，相邻两点距离不得超过 ${legLimit} 公里，当天跨度不得超过 ${spanLimit} 公里。绝对不要把城市东边和西边的地点排进同一天。

【消费取向】用户选择的档位是「${request.budgetTier}」，含义是：${request.budgetHint}。请据此挑选地点类型，但不要在任何字段里编造门票价格或人均花费。

候选地点带 openNote 字段（真实营业时间）。注意不同日期是不同星期，请避免把当天闭馆的场馆排进那一天。

字段要求：
- title：整套方案的名字，不超过 12 个汉字。
- accent：主题标签，4到6个汉字，例如"室内避雨""城市漫步"，不要填颜色值或色号。
- weatherFit：用不超过 20 个汉字说明为什么适合这几天的天气，不要复述日期。
- days：数组，长度必须等于 ${days.length}，按顺序对应 ${dayLabels}。每项含 theme（当天主题，不超过 8 字）与 ids（当天地点的 id 数字数组，不要写地点名）。

只返回JSON，不要任何解释文字：{"routes":[{"title":"","accent":"","weatherFit":"","days":[{"theme":"","ids":[1,2,3]}]}]}`;
  const content = await callDeepSeek(env, [
    { role: 'system', content: '只根据给定真实数据规划路线。禁止编造地点、价格、开放时间或平台评价。' },
    { role: 'user', content: prompt },
  ]);
  // AI 输出被截断时 JSON 解析会失败，这里吞掉异常交给地理兜底，而不是整个请求报错
  let drafts: RouteDraft[] = [];
  try {
    drafts = extractJsonObject<{ routes?: RouteDraft[] }>(content).routes ?? [];
  } catch {
    drafts = [];
  }
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
    // 模型有时会漏掉结尾的 ]，补全后仍是可用数据，只是尾部字段可能为空。
    // 这类草稿不丢弃，缺标题时按当天主题兜一个，避免白白退化成聚类兜底。
    // 兼容两种返回：多日的 days[]，与单日的 stopNames[]
    const rawDays = Array.isArray(draft.days) && draft.days.length > 0
      ? draft.days
      : [{ theme: '', stopNames: draft.stopNames || [] }];

    const usedInRoute = new Set<string>();
    const dayPlans: Array<{ date: string; theme: string; picked: typeof pois }> = [];

    for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
      const draftDay = rawDays[dayIndex] || rawDays[rawDays.length - 1];
      const date = days[dayIndex];
      // 优先用 id（新格式），兼容 stopNames（旧格式/模型偶尔回退）
      const rawRefs: Array<number | string> = Array.isArray(draftDay?.ids) && draftDay.ids.length > 0
        ? draftDay.ids
        : (draftDay?.stopNames || []);
      const picked = rawRefs
        .map((ref) => (typeof ref === 'number' ? poiIndexById.get(ref) : poiMap.get(String(ref))))
        .filter((poi): poi is (typeof pois)[number] => Boolean(poi) && !usedInRoute.has(poi.name))
        // 按当天日期分别校验营业时间：同一场馆可能周二闭馆、周三开放
        .filter((poi) => checkOpening(poi.rawOpentime, date).status !== 'closed')
        .slice(0, perDayStops);
      // AI 当天给的点可能被去重或闭馆过滤掉，从剩余候选里就近补齐，避免某天只剩两站。
      // 补进来的点必须让"补齐后的当天整体"仍然顺路，否则宁可少一站也不破坏地理约束。
      if (picked.length < perDayStops) {
        const anchor = parseLocation(picked[0]?.location || '');
        const nearby = pois
          .filter((poi) => !usedInRoute.has(poi.name) && !picked.some((item) => item.name === poi.name))
          .filter((poi) => checkOpening(poi.rawOpentime, date).status !== 'closed')
          .map((poi) => ({ poi, point: parseLocation(poi.location) }))
          .filter((item) => item.point && (!anchor || haversineKm(anchor, item.point) <= legLimit))
          .sort((a, b) => (anchor ? haversineKm(anchor, a.point!) - haversineKm(anchor, b.point!) : 0));

        for (const item of nearby) {
          if (picked.length >= perDayStops) break;
          const trial = orderByProximity([...picked, item.poi]);
          const geo = routeGeometry(trial);
          if (!geo.measured || (geo.maxLegKm <= legLimit && geo.spanKm <= spanLimit)) {
            picked.push(item.poi);
          }
        }
      }
      if (picked.length < Math.min(2, perDayStops)) return null;
      picked.forEach((poi) => usedInRoute.add(poi.name));
      dayPlans.push({ date, theme: safeText(draftDay?.theme, 16), picked });
    }

    // 地理硬校验按天进行：同一天内必须顺路，不同天之间允许换区域
    const orderedDays = dayPlans.map((plan) => {
      const selected = orderByProximity(plan.picked);
      return { ...plan, selected, geometry: routeGeometry(selected) };
    });
    // 补齐站点后重新校验：补进来的点可能把当天跨度顶超
    const violated = orderedDays.some(
      (day) => day.geometry.measured && (day.geometry.maxLegKm > legLimit || day.geometry.spanKm > spanLimit),
    );
    if (violated) return null;

    const allStops = orderedDays.flatMap((day, dayIndex) =>
      day.selected.map((poi, stopIndex) => ({
        id: `${routeIndex + 1}-${dayIndex + 1}-${poi.id || stopIndex}`,
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
        // 当天首站不显示距离；跨天不连线（隔夜之间没有"上一站"）
        legKm: stopIndex === 0 ? null : Number((day.geometry.legs[stopIndex - 1] ?? 0).toFixed(1)),
        dayIndex,
        date: day.date,
        source: poi.source,
        reason: `${poi.address || poi.area}${poi.rating ? ` · 高德评分 ${poi.rating}` : ''}`,
      })),
    );

    const knownCosts = allStops.filter((stop) => stop.cost > 0);
    const totalKm = orderedDays.reduce((sum, day) => sum + day.geometry.totalKm, 0);
    const maxLegKm = Math.max(...orderedDays.map((day) => day.geometry.maxLegKm), 0);

    return {
      id: `ai-${routeIndex + 1}`,
      title: safeText(draft.title, 24)
        || `${orderedDays[0]?.selected[0]?.area || ''}${orderedDays[0]?.theme || '精选路线'}`.slice(0, 24),
      subtitle: safeText(draft.subtitle, 44),
      accent: cleanAccent(draft.accent),
      weatherFit: cleanWeatherFit(draft.weatherFit),
      totalTime: days.length > 1 ? `${days.length} 天 · 共 ${allStops.length} 站` : `${allStops.length * 2} 小时`,
      budget: allStops.reduce((sum, stop) => sum + stop.cost, 0),
      budgetKnownCount: knownCosts.length,
      budgetTotalCount: allStops.length,
      totalKm: Number(totalKm.toFixed(1)),
      maxLegKm: Number(maxLegKm.toFixed(1)),
      // 每天的概要，供前端分段展示
      dayPlan: orderedDays.map((day, dayIndex) => ({
        dayIndex,
        date: day.date,
        weekday: weekdayOf(day.date),
        theme: day.theme,
        stopCount: day.selected.length,
        totalKm: Number(day.geometry.totalKm.toFixed(1)),
      })),
      stops: allStops,
    };
  }).filter(Boolean);

  // AI 路线可能部分或全部被地理校验拒绝，用确定性聚类补足到 3 条
  if (valid.length < 3) {
    const usedNames = new Set(valid.flatMap((route) => route!.stops.map((stop) => stop.name)));
    const remaining = pois.filter((poi) => !usedNames.has(poi.name));
    const fallback = buildGeoRoutes(remaining, days);
    const merged = [...valid, ...fallback].slice(0, 3);
    if (merged.length >= 2) return merged;
    throw new Error('未能生成地理上顺路的路线，请缩小区域范围后重试');
  }
  return valid;
}

/**
 * 确定性兜底：按地理邻近聚类生成路线，不依赖 AI。
 * 取未使用的首个点为种子，配其最近的 2 个邻居成组，天然顺路。
 */
function buildGeoRoutes(pois: Awaited<ReturnType<typeof getPois>>, days: string[]) {
  // 与 AI 路线使用同一套阈值，避免两条通路标准不一致
  const legLimit = days.length > 1 ? 8 : MAX_LEG_KM;
  const spanLimit = days.length > 1 ? 16 : MAX_SPAN_KM;
  const withPoint = pois
    .map((poi) => ({ poi, point: parseLocation(poi.location) }))
    .filter((item) => item.point) as Array<{ poi: (typeof pois)[number]; point: { lng: number; lat: number } }>;

  const perDayStops = days.length >= 3 ? 2 : 3;
  const needPerRoute = perDayStops * days.length;
  if (withPoint.length < needPerRoute * 2) return [];

  const used = new Set<string>();
  const routes: Array<{
    id: string;
    stops: Array<{ name: string; location: string; dayIndex: number }>;
  } & Record<string, unknown>> = [];

  /** 取一组彼此靠近的点：以首个可用点为种子，配其最近的 n-1 个邻居 */
  const takeCluster = (size: number, skipSeeds: Set<string>) => {
    const available = withPoint.filter((item) => !used.has(item.poi.name));
    const seed = available.find((item) => !skipSeeds.has(item.poi.name));
    if (!seed || available.length < size) return null;
    const neighbors = available
      .filter((item) => item.poi.name !== seed.poi.name)
      .map((item) => ({ item, km: haversineKm(seed.point, item.point) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, size - 1)
      .map((entry) => entry.item);
    if (neighbors.length < size - 1) return null;
    const group = [seed, ...neighbors];
    return { seedName: seed.poi.name, selected: orderByProximity(group.map((item) => item.poi)) };
  };

  for (let index = 0; index < 3; index += 1) {
    // 每条方案按天各取一个就近簇，天与天之间自然落在不同区域
    const dayGroups: Array<{ date: string; selected: typeof pois; geometry: ReturnType<typeof routeGeometry> }> = [];
    for (const date of days) {
      // 最多试几次：某个簇如果自身就超限（候选稀疏时会出现），换下一个种子
      let accepted: { selected: typeof pois; geometry: ReturnType<typeof routeGeometry> } | null = null;
      const rejectedSeeds = new Set<string>();
      for (let attempt = 0; attempt < 6 && !accepted; attempt += 1) {
        const candidate = takeCluster(perDayStops, rejectedSeeds);
        if (!candidate) break;
        const geometry = routeGeometry(candidate.selected);
        if (!geometry.measured || (geometry.maxLegKm <= legLimit && geometry.spanKm <= spanLimit)) {
          // 只有被接受的簇才占用候选，被拒的点仍可被后续方案使用
          candidate.selected.forEach((poi) => used.add(poi.name));
          accepted = { selected: candidate.selected, geometry };
        } else {
          rejectedSeeds.add(candidate.seedName);
        }
      }
      if (!accepted) break;
      dayGroups.push({ date, selected: accepted.selected, geometry: accepted.geometry });
    }
    if (dayGroups.length !== days.length) break;

    const allStops = dayGroups.flatMap((day, dayIndex) =>
      day.selected.map((poi, stopIndex) => ({
        id: `geo${index + 1}-${dayIndex + 1}-${poi.id || stopIndex}`,
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
        legKm: stopIndex === 0 ? null : Number((day.geometry.legs[stopIndex - 1] ?? 0).toFixed(1)),
        dayIndex,
        date: day.date,
        source: poi.source,
        reason: `${poi.address || poi.area}${poi.rating ? ` · 高德评分 ${poi.rating}` : ''}`,
      })),
    );

    const knownCosts = allStops.filter((stop) => stop.cost > 0);
    const totalKm = dayGroups.reduce((sum, day) => sum + day.geometry.totalKm, 0);
    const maxLegKm = Math.max(...dayGroups.map((day) => day.geometry.maxLegKm), 0);

    routes.push({
      id: `geo-${index + 1}`,
      title: `${dayGroups[0].selected[0].area}就近路线`,
      subtitle: allStops.map((stop) => stop.name).join(' · ').slice(0, 44),
      accent: '就近顺路',
      weatherFit: '',
      totalTime: days.length > 1 ? `${days.length} 天 · 共 ${allStops.length} 站` : `${allStops.length * 2} 小时`,
      budget: allStops.reduce((sum, stop) => sum + stop.cost, 0),
      budgetKnownCount: knownCosts.length,
      budgetTotalCount: allStops.length,
      totalKm: Number(totalKm.toFixed(1)),
      maxLegKm: Number(maxLegKm.toFixed(1)),
      dayPlan: dayGroups.map((day, dayIndex) => ({
        dayIndex,
        date: day.date,
        weekday: weekdayOf(day.date),
        theme: `${day.selected[0].area}一带`,
        stopCount: day.selected.length,
        totalKm: Number(day.geometry.totalKm.toFixed(1)),
      })),
      stops: allStops,
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
    // 跨天才需要住宿。锚点必须是【第一天】最后一站——那才是当晚要住的地方，
    // 取整条路线最后一站会锚到第二天的位置，住宿推荐就偏了。
    const firstDayStops = (routes[0]?.stops ?? []).filter((stop) => (stop.dayIndex ?? 0) === 0);
    const anchorStop = firstDayStops.at(-1) ?? routes[0]?.stops?.at(-1);
    const lodgingAnchor = isMultiDay ? anchorStop?.location : undefined;

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
      lodgingAnchorName: lodgingAnchor ? anchorStop?.name ?? '' : '',
      isMultiDay,
      // 按能力维度列出，而非单一供应商名
      sources: ['真实天气', '真实地点', '节假日日历', '空气质量', 'AI 路线'],
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '路线生成失败' }, 502);
  }
}
