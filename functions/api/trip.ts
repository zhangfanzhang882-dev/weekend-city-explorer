/** KV 的最小接口定义，避免引入 @cloudflare/workers-types 依赖 */
interface TripKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  TRIPS?: TripKV;
}

interface TripPayload {
  /** 行程标题 */
  title: string;
  /** 四阶段状态：planning=规划中 team=组队中 ongoing=进行中 done=已完成 */
  stage: 'planning' | 'team' | 'ongoing' | 'done';
  stops: unknown[];
  checkIns?: unknown[];
  members?: unknown[];
  /** 费用约定，用户自由编辑 */
  costRule?: string;
  city?: string;
  date?: string;
  endDate?: string;
  updatedAt?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

/**
 * KV 未绑定时的内存兜底。
 * 仅用于本地或未完成 KV 绑定的环境，Worker 实例回收即丢失，
 * 但能保证接口始终可用、前端不报错。
 */
const memoryStore = new Map<string, string>();

async function readTrip(env: Env, id: string) {
  if (env.TRIPS) return env.TRIPS.get(id);
  return memoryStore.get(id) ?? null;
}

async function writeTrip(env: Env, id: string, value: string) {
  if (env.TRIPS) {
    // 行程数据 30 天后自动过期，避免无限堆积
    await env.TRIPS.put(id, value, { expirationTtl: 60 * 60 * 24 * 30 });
    return;
  }
  memoryStore.set(id, value);
}

/** 生成短易读的行程 ID，用于邀请链接 */
function newTripId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const STAGES = ['planning', 'team', 'ongoing', 'done'] as const;

/** 读取行程 */
export async function onRequestGet(context: { request: Request; env: Env }) {
  const url = new URL(context.request.url);
  const id = (url.searchParams.get('id') || '').trim().slice(0, 24);
  if (!id) return json({ error: '缺少行程 ID' }, 400);

  const raw = await readTrip(context.env, id);
  if (!raw) return json({ error: '行程不存在或已过期' }, 404);
  try {
    return json({ id, trip: JSON.parse(raw), persistent: Boolean(context.env.TRIPS) });
  } catch {
    return json({ error: '行程数据已损坏' }, 500);
  }
}

/** 创建或更新行程；带 id 为更新，不带则创建 */
export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    const body = await context.request.json() as { id?: string; trip?: Partial<TripPayload> };
    const trip = body.trip;
    if (!trip || !Array.isArray(trip.stops) || trip.stops.length === 0) {
      return json({ error: '行程内容不能为空' }, 400);
    }
    const stage = STAGES.includes(trip.stage as typeof STAGES[number]) ? trip.stage : 'planning';
    const id = (body.id || '').trim().slice(0, 24) || newTripId();

    const record: TripPayload = {
      title: String(trip.title ?? '我的城市漫游').slice(0, 40),
      stage: stage as TripPayload['stage'],
      // 限制条目数，避免单条记录过大触发 KV 体积上限
      stops: trip.stops.slice(0, 12),
      checkIns: Array.isArray(trip.checkIns) ? trip.checkIns.slice(0, 100) : [],
      members: Array.isArray(trip.members) ? trip.members.slice(0, 20) : [],
      costRule: String(trip.costRule ?? '').slice(0, 120),
      city: String(trip.city ?? '').slice(0, 20),
      date: String(trip.date ?? '').slice(0, 10),
      endDate: String(trip.endDate ?? '').slice(0, 10),
      updatedAt: new Date().toISOString(),
    };

    await writeTrip(context.env, id, JSON.stringify(record));
    return json({ id, trip: record, persistent: Boolean(context.env.TRIPS) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '保存失败' }, 500);
  }
}
