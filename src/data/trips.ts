// EXPORTS: IStop, ICheckIn, IRoute, ROUTES
export interface IStop {
  id: string;
  name: string;
  type: string;
  area: string;
  duration: string;
  cost: number;
  /** 该地点是否有真实价格数据；缺失时前端显示“暂无价格”而非 ¥0 */
  hasCostData?: boolean;
  /** 高德返回的真实实景照片（已统一为 https） */
  photos?: string[];
  rating?: number | null;
  address?: string;
  source: string[];
  reason: string;
}

/** 一条打卡记录，形态参考点评：评分 + 文字 + 时间 */
export interface ICheckIn {
  id: string;
  stopId: string;
  rating: number;
  text: string;
  createdAt: string;
  author: string;
}

export interface IRoute {
  id: string;
  title: string;
  subtitle: string;
  totalTime: string;
  budget: number;
  /** 有价格数据的地点数，用于区分“真的免费”与“暂无数据” */
  budgetKnownCount?: number;
  budgetTotalCount?: number;
  weatherFit: string;
  accent: string;
  stops: IStop[];
}

export const ROUTES: IRoute[] = [
  {
    id: 'slow',
    title: '梧桐区慢游',
    subtitle: '展览、咖啡与落日散步',
    totalTime: '6 小时',
    budget: 128,
    weatherFit: '适合多云',
    accent: '文艺松弛',
    stops: [
      { id: 's1', name: '上海图书馆东馆特展', type: '展览', area: '浦东新区', duration: '1.5 小时', cost: 0, source: ['小红书', '高德'], reason: '室内开场，不受午后阵雨影响' },
      { id: 's2', name: '上生·新所周末市集', type: '市集', area: '长宁区', duration: '2 小时', cost: 68, source: ['小红书', '美团'], reason: '独立摊位集中，适合边逛边吃' },
      { id: 's3', name: '苏州河日落步道', type: '散步', area: '普陀区', duration: '1.5 小时', cost: 0, source: ['高德'], reason: '傍晚体感更舒适，沿河拍照友好' },
    ],
  },
  {
    id: 'budget',
    title: '学生省钱局',
    subtitle: '免费展览与城市漫步',
    totalTime: '5 小时',
    budget: 58,
    weatherFit: '雨天可切换',
    accent: '预算友好',
    stops: [
      { id: 'b1', name: '西岸美术馆公共展区', type: '展览', area: '徐汇区', duration: '1.5 小时', cost: 0, source: ['小红书', '高德'], reason: '公共区域免费，空间感适合拍照' },
      { id: 'b2', name: '龙华会周末青年市集', type: '市集', area: '徐汇区', duration: '1.5 小时', cost: 38, source: ['美团', '小红书'], reason: '路线顺路，学生预算内选择多' },
      { id: 'b3', name: '徐汇滨江骑行段', type: '骑行', area: '徐汇区', duration: '1 小时', cost: 6, source: ['高德'], reason: '雨停后可快速切换为户外收尾' },
    ],
  },
  {
    id: 'energy',
    title: '城市能量场',
    subtitle: '沉浸体验、现场演出与夜游',
    totalTime: '7 小时',
    budget: 238,
    weatherFit: '全天室内为主',
    accent: '氛围拉满',
    stops: [
      { id: 'e1', name: '静安大悦城沉浸艺术展', type: '展览', area: '静安区', duration: '2 小时', cost: 88, source: ['小红书', '美团'], reason: '热门沉浸展，适合多人体验' },
      { id: 'e2', name: '创智天地音乐现场', type: '演出', area: '杨浦区', duration: '2 小时', cost: 120, source: ['小红书', '高德'], reason: '周末限定场次，公共交通直达' },
      { id: 'e3', name: '大学路夜间街区', type: '夜游', area: '杨浦区', duration: '1.5 小时', cost: 30, source: ['美团', '高德'], reason: '演出结束后步行可达，夜宵选择多' },
    ],
  },
];
