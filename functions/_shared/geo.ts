/**
 * 地理计算工具。
 *
 * 距离一律用直线（Haversine）计算，不调高德距离测量接口：
 * 实测直线距离与真实路径距离比值约 1.17–1.43，足以判断"一个在东一个在西"，
 * 且零额外接口调用、瞬时返回。真实路程差异已在前端文案中如实说明。
 */

export interface GeoPoint {
  lng: number;
  lat: number;
}

/** 解析高德 "lng,lat" 字符串；非法输入返回 null */
export function parseLocation(location: string): GeoPoint | null {
  const [lng, lat] = (location || '').split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/** 两点间球面直线距离（公里） */
export function haversineKm(a: GeoPoint, b: GeoPoint) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** 一组坐标的几何中心 */
export function centerOf(points: GeoPoint[]): GeoPoint | null {
  if (points.length === 0) return null;
  return {
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
  };
}

/** 路线地理指标：相邻站点间距、总里程、最远两点跨度 */
export function routeGeometry(stops: Array<{ location: string }>) {
  const points = stops.map((stop) => parseLocation(stop.location)).filter(Boolean) as GeoPoint[];
  if (points.length < 2) {
    return { legs: [] as number[], totalKm: 0, maxLegKm: 0, spanKm: 0, measured: false };
  }
  const legs: number[] = [];
  for (let i = 1; i < points.length; i += 1) legs.push(haversineKm(points[i - 1], points[i]));
  let spanKm = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      spanKm = Math.max(spanKm, haversineKm(points[i], points[j]));
    }
  }
  return {
    legs,
    totalKm: legs.reduce((sum, value) => sum + value, 0),
    maxLegKm: Math.max(...legs),
    spanKm,
    measured: points.length === stops.length,
  };
}

/**
 * 按最近邻重排站点，消除折返。
 * AI 给出的顺序常是随意的（西→东→西），重排后总里程显著下降。
 * 枚举每个起点取总里程最短者；单条路线仅 3 个点，开销可忽略。
 */
export function orderByProximity<T extends { location: string }>(stops: T[]): T[] {
  const points = stops.map((stop) => parseLocation(stop.location));
  if (points.some((point) => !point)) return stops;
  const coords = points as GeoPoint[];

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

/** 单段可接受上限（公里），超过视为不顺路 */
export const MAX_LEG_KM = 6;
/** 一日路线总跨度上限（公里） */
export const MAX_SPAN_KM = 12;
