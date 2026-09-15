import type { ICheckIn } from '@/data/trips';

/**
 * 示例点评。
 *
 * 说明：当前产品没有真实用户数据积累，这些点评用于演示"选方案时能看到历史评价"
 * 这一交互。所有展示位置都必须标注「示例」，绝不能让用户误认为是真实用户评价。
 * 真实数据只有两类：高德评分与营业时间（来自 API），以及用户本人的打卡记录。
 */
export interface ISampleReview extends Omit<ICheckIn, 'stopId'> {
  /** 命中规则：地点名或类型包含该关键词时展示 */
  match: string;
}

export const SAMPLE_REVIEWS: ISampleReview[] = [
  {
    id: 'sr-museum-1',
    match: '博物馆',
    rating: 5,
    text: '工作日下午人少，讲解牌做得很细，逛完差不多两小时。建议从二楼往下走，动线更顺。',
    createdAt: '9月上旬',
    author: '示',
  },
  {
    id: 'sr-museum-2',
    match: '博物馆',
    rating: 4,
    text: '周末排队要二十分钟左右，建议提前在公众号预约。馆内空调足，夏天很舒服。',
    createdAt: '8月下旬',
    author: '示',
  },
  {
    id: 'sr-exhibition-1',
    match: '展览',
    rating: 4,
    text: '特展票价另算，常设展免费部分也够看。拍照不能用闪光灯，工作人员会提醒。',
    createdAt: '9月上旬',
    author: '示',
  },
  {
    id: 'sr-park-1',
    match: '公园',
    rating: 5,
    text: '傍晚过来最舒服，草坪可以坐。带了野餐垫的话能待挺久，附近有便利店补货。',
    createdAt: '9月中旬',
    author: '示',
  },
  {
    id: 'sr-coffee-1',
    match: '咖啡',
    rating: 4,
    text: '座位不多，高峰期基本要等。豆子偏酸，喜欢深烘的可以让店员换一支。',
    createdAt: '9月上旬',
    author: '示',
  },
  {
    id: 'sr-market-1',
    match: '市集',
    rating: 4,
    text: '摊位周末才全开，平日会少一半。现金和扫码都行，逛一小时够了。',
    createdAt: '8月下旬',
    author: '示',
  },
  {
    id: 'sr-art-1',
    match: '艺术',
    rating: 5,
    text: '空间本身就很出片，展陈换得比较勤。学生证有折扣，记得带。',
    createdAt: '9月中旬',
    author: '示',
  },
];

/** 按地点名与类型匹配示例点评，最多返回 2 条 */
export function getSampleReviews(name: string, type?: string) {
  const haystack = `${name} ${type ?? ''}`;
  return SAMPLE_REVIEWS.filter((review) => haystack.includes(review.match)).slice(0, 2);
}
