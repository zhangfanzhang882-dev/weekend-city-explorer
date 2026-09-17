/**
 * 营业时间交叉校验。
 *
 * 高德 biz_ext.opentime2 的覆盖率约 19/20，且包含"周二全天不开放"这类关键信息。
 * 例如上海自然博物馆周二闭馆——不做校验就会把它排进周二的行程，用户白跑一趟。
 * 这是本项目"用真实数据交叉验证"的核心一环，因此独立成模块。
 */

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_CHARS = ['一', '二', '三', '四', '五', '六', '日'];

export type OpenStatus = 'open' | 'closed' | 'unknown';

export interface OpeningResult {
  status: OpenStatus;
  /** 展示给用户的说明：营业时段原文，或"周二不开放" */
  note: string;
}

/**
 * 判断某地点在指定日期是否开放。
 * @param opentime 高德返回的营业时间原文，可能是字符串或数组
 * @param date YYYY-MM-DD
 */
export function checkOpening(opentime: string | string[] | undefined, date: string): OpeningResult {
  const text = Array.isArray(opentime) ? opentime.join('') : (opentime || '');
  if (!text) return { status: 'unknown', note: '营业时间暂无数据' };

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return { status: 'unknown', note: '营业时间暂无数据' };

  const weekday = WEEKDAY_NAMES[parsed.getDay()];
  const currentIndex = WEEKDAY_CHARS.indexOf(weekday.replace('周', ''));

  // 按分号切段，逐段判断是否声明当天不开放
  for (const segment of text.split(/[；;]/).map((item) => item.trim()).filter(Boolean)) {
    if (!/不开放|休馆|闭馆|停止营业/.test(segment)) continue;

    let covers = segment.includes(weekday);
    if (!covers) {
      // 展开"周三-周五"这类区间
      const range = segment.match(/周([一二三四五六日])\s*[-–至]\s*周([一二三四五六日])/);
      if (range) {
        const from = WEEKDAY_CHARS.indexOf(range[1]);
        const to = WEEKDAY_CHARS.indexOf(range[2]);
        covers = from >= 0 && to >= 0 && currentIndex >= from && currentIndex <= to;
      }
    }
    if (covers) return { status: 'closed', note: `${weekday}不开放` };
  }

  return { status: 'open', note: text.slice(0, 60) };
}
