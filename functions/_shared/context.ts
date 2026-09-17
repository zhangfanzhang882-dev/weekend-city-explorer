/**
 * 出行环境补充信息：节假日与空气质量。
 *
 * 两者都用免密钥公开接口，且都做静默降级——它们是"锦上添花"的提示，
 * 外部服务不可用时不应影响路线生成主流程。
 */

export interface HolidayInfo {
  /** 是否法定假日 */
  isHoliday: boolean;
  /** 假日名称，如"国庆节" */
  name: string;
  /** 是否为调休补班日 */
  isMakeupWorkday: boolean;
  /** 给用户的提示，如"国庆假期，热门场馆预计拥挤" */
  note: string;
}

export interface AirInfo {
  /** 美标 AQI */
  aqi: number | null;
  pm25: number | null;
  level: string;
  /** 是否建议以室内为主 */
  preferIndoor: boolean;
  note: string;
}

/**
 * 查询某日节假日信息。
 * 数据源 timor.tech，能正确处理中国特有的调休补班。
 * 失败时返回 null，调用方跳过该提示即可。
 */
export async function fetchHoliday(date: string): Promise<HolidayInfo | null> {
  try {
    const response = await fetch(`https://timor.tech/api/holiday/info/${date}`, {
      headers: { 'user-agent': 'weekend-city-explorer/1.0' },
    });
    if (!response.ok) return null;
    const rawText = await response.text();
    const data = JSON.parse(rawText) as {
      code?: number;
      type?: { type?: number; name?: string };
      holiday?: { holiday?: boolean; name?: string; after?: boolean; target?: string } | null;
    };
    if (data.code !== 0) return null;

    const holiday = data.holiday;
    // type.type: 0=工作日 1=周末 2=节假日 3=调休补班
    const typeCode = data.type?.type ?? 0;
    const isHoliday = typeCode === 2 || Boolean(holiday?.holiday);
    const isMakeupWorkday = typeCode === 3 || (Boolean(holiday) && holiday?.holiday === false);
    const name = holiday?.name || data.type?.name || '';

    let note = '';
    if (isHoliday) note = `${name}假期，热门场馆预计拥挤，建议提早出发或选冷门时段`;
    else if (isMakeupWorkday) note = `${name}，当天为调休上班日，场馆人流接近工作日`;

    return { isHoliday, name, isMakeupWorkday, note };
  } catch {
    // 网络或解析失败：静默降级，不影响主流程
    return null;
  }
}

/** 按 AQI 分级，阈值参考美标 */
function aqiLevel(aqi: number) {
  if (aqi <= 50) return { level: '优', preferIndoor: false };
  if (aqi <= 100) return { level: '良', preferIndoor: false };
  if (aqi <= 150) return { level: '轻度污染', preferIndoor: true };
  if (aqi <= 200) return { level: '中度污染', preferIndoor: true };
  return { level: '重度污染', preferIndoor: true };
}

/**
 * 查询指定坐标当日空气质量。
 * 数据源 Open-Meteo Air Quality，免密钥。取当日各小时峰值作为参考，宁可偏保守。
 *
 * 注意：该接口预报窗口约 5–7 天（实测到 2026-09-23），超出会直接报
 * "start_date is out of allowed range"。此时降级为查询今天并在文案中说明，
 * 而不是静默返回 null —— 近期空气趋势对判断室内/室外仍有参考价值。
 */
export async function fetchAirQuality(lng: number, lat: number, date: string): Promise<AirInfo | null> {
  const query = async (targetDate: string) => {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('hourly', 'pm2_5,us_aqi');
    url.searchParams.set('timezone', 'Asia/Shanghai');
    url.searchParams.set('start_date', targetDate);
    url.searchParams.set('end_date', targetDate);

    const response = await fetch(url.toString());
    const rawText = await response.text();
    const data = JSON.parse(rawText) as {
      error?: boolean;
      hourly?: { pm2_5?: Array<number | null>; us_aqi?: Array<number | null> };
    };
    if (data.error || !response.ok) return null;
    const aqiList = (data.hourly?.us_aqi ?? []).filter((value): value is number => typeof value === 'number');
    const pmList = (data.hourly?.pm2_5 ?? []).filter((value): value is number => typeof value === 'number');
    if (aqiList.length === 0) return null;
    return {
      aqi: Math.round(Math.max(...aqiList)),
      pm25: pmList.length > 0 ? Math.round(Math.max(...pmList)) : null,
    };
  };

  try {
    let measured = await query(date);
    let outOfRange = false;
    if (!measured) {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== date) {
        measured = await query(today);
        outOfRange = Boolean(measured);
      }
    }
    if (!measured) return null;

    const { level, preferIndoor } = aqiLevel(measured.aqi);
    return {
      aqi: measured.aqi,
      pm25: measured.pm25,
      level,
      preferIndoor,
      note: outOfRange
        ? `空气${level}（AQI ${measured.aqi}）· 该日期超出空气预报范围，此为近期参考`
        : `当日空气${level}（AQI ${measured.aqi}），${preferIndoor ? '建议以室内场馆为主' : '适合户外活动'}`,
    };
  } catch {
    return null;
  }
}
