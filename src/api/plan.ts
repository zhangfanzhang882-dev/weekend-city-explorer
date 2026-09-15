import type { IRoute, IStop } from '@/data/trips';

export interface IWeatherResult {
  date: string;
  condition: string;
  tempHigh: number;
  tempLow: number;
  dayWind: string;
  dayPower: string;
  requestedDate: string;
  requestedEndDate: string;
  coveredDays: number;
  rangeSummary: string;
  forecastStatus: 'exact' | 'out_of_range';
  note: string;
  source: string;
}

/** 数据核验汇总，用于向用户说明这批地点的可信度 */
export interface IVerifiedSummary {
  total: number;
  openConfirmed: number;
  openUnknown: number;
  withPhotos: number;
  withRating: number;
}

export interface IPlanResponse {
  weather: IWeatherResult;
  routes: IRoute[];
  poiCount: number;
  /** 全部真实候选地点，供行程编辑时替换或追加 */
  candidates: IStop[];
  verified: IVerifiedSummary;
  sources: string[];
}

export interface IPlanInput {
  city: string;
  /** 多选区域；空数组表示不限区域 */
  areas: string[];
  date: string;
  endDate: string;
  budget: number;
  /** 预算档位名称，如「经济实惠」 */
  budgetTier: string;
  interests: string[];
  partySize: number;
}

export async function createAiPlan(input: IPlanInput): Promise<IPlanResponse> {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as IPlanResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || '暂时无法生成路线');
  return payload;
}

export interface ICityOption {
  name: string;
  adcode: string;
}

/** 按关键词搜索城市；失败时返回空数组，由调用方回退到手动输入 */
export async function searchCities(keyword: string): Promise<ICityOption[]> {
  const response = await fetch(`/api/places?mode=city&q=${encodeURIComponent(keyword)}`);
  if (!response.ok) return [];
  const payload = await response.json() as { cities?: ICityOption[] };
  return payload.cities ?? [];
}

/** 获取城市下的行政区列表，用于区域推荐 */
export async function fetchAreas(city: string): Promise<string[]> {
  const response = await fetch(`/api/places?mode=area&q=${encodeURIComponent(city)}`);
  if (!response.ok) return [];
  const payload = await response.json() as { areas?: string[] };
  return payload.areas ?? [];
}
