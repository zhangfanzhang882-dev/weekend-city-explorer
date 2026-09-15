import type { IRoute } from '@/data/trips';

export interface IWeatherResult {
  date: string;
  condition: string;
  tempHigh: number;
  tempLow: number;
  dayWind: string;
  dayPower: string;
  requestedDate: string;
  forecastStatus: 'exact' | 'out_of_range';
  note: string;
  source: string;
}

export interface IPlanResponse {
  weather: IWeatherResult;
  routes: IRoute[];
  poiCount: number;
  sources: string[];
}

export interface IPlanInput {
  city: string;
  area: string;
  date: string;
  budget: number;
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
