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
  /** 预算档位名称，如「经济实惠」；不含具体金额 */
  budgetTier: string;
  /** 该档位的消费取向说明，供 AI 理解选点偏好 */
  budgetHint: string;
  interests: string[];
  partySize: number;
}

/** 统一解析响应：非 JSON（如 Cloudflare 520 错误页）时给出可读提示而非原始解析错误 */
async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const rawText = await response.text();
  let payload: (T & { error?: string }) | null = null;
  try {
    payload = JSON.parse(rawText) as T & { error?: string };
  } catch {
    // 上游返回 HTML 或空内容，此时 status 往往是 5xx
    throw new Error(
      response.status >= 500
        ? `服务暂时不可用（HTTP ${response.status}），请稍后重试`
        : fallbackMessage,
    );
  }
  if (!response.ok) throw new Error(payload?.error || fallbackMessage);
  return payload as T;
}

export async function createAiPlan(input: IPlanInput): Promise<IPlanResponse> {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseResponse<IPlanResponse>(response, '暂时无法生成路线，请稍后重试');
}

export interface ICityOption {
  name: string;
  adcode: string;
}

/** 按关键词搜索城市；失败时返回空数组，由调用方回退到手动输入 */
export async function searchCities(keyword: string): Promise<ICityOption[]> {
  try {
    const response = await fetch(`/api/places?mode=city&q=${encodeURIComponent(keyword)}`);
    if (!response.ok) return [];
    const payload = await response.json() as { cities?: ICityOption[] };
    return payload.cities ?? [];
  } catch {
    // 网络或解析异常时静默降级：用户仍可手动输入城市名
    return [];
  }
}

/** 获取城市下的行政区列表，用于区域推荐 */
export async function fetchAreas(city: string): Promise<string[]> {
  try {
    const response = await fetch(`/api/places?mode=area&q=${encodeURIComponent(city)}`);
    if (!response.ok) return [];
    const payload = await response.json() as { areas?: string[] };
    return payload.areas ?? [];
  } catch {
    return [];
  }
}

/**
 * 按关键词搜索真实地点，用于行程编辑时换地点或加地点。
 * 失败时返回空数组，前端仍可从初始候选池挑选。
 */
export async function searchPlaces(keyword: string, city: string): Promise<IStop[]> {
  try {
    const response = await fetch(`/api/places?mode=poi&q=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}`);
    if (!response.ok) return [];
    const payload = await response.json() as { pois?: IStop[] };
    return payload.pois ?? [];
  } catch {
    return [];
  }
}

/** 自然语言解析出的出行参数 */
export interface IParsedIntent {
  city: string;
  areas: string[];
  date: string;
  endDate: string;
  interests: string[];
  budgetTier: string;
  /** 一句话复述解析结果，供用户确认 */
  summary: string;
  /** 用户未明说、采用了默认值的字段 */
  assumed: string[];
}

export interface IIntentResponse {
  intent: IParsedIntent;
  /** 该城市真实区县列表，便于前端同步区域选项 */
  availableAreas: string[];
}

/** 把一句话出行需求解析成结构化参数 */
export async function parseIntent(text: string, today: string, defaultCity: string): Promise<IIntentResponse> {
  const response = await fetch('/api/intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, today, defaultCity }),
  });
  return parseResponse<IIntentResponse>(response, '暂时无法理解这句话，请换个说法');
}
