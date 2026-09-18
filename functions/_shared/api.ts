/**
 * 后端共享工具。
 *
 * 说明：Cloudflare Pages Functions 以 `functions/api/` 下的文件为路由，
 * 以 `_` 开头的目录不会被当作路由，因此公共代码放在 `functions/_shared/`。
 * 此前 amapGet / json / safeText 在多个接口文件里各写一份，改一处要改三处，
 * 现统一收敛到这里。
 */

/** 各接口共用的环境变量定义 */
export interface AppEnv {
  AMAP_WEB_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  /** 行程存储；未在控制台绑定时为 undefined，由调用方降级 */
  TRIPS?: TripKV;
}

/** KV 的最小接口，避免引入 @cloudflare/workers-types 依赖 */
export interface TripKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * 统一 JSON 响应。
 * @param maxAge 缓存秒数；0 表示不缓存（错误响应与实时数据用 0）
 */
export const json = (body: unknown, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });

/** 裁剪并去空白，防止超长输入进入下游 */
export const safeText = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

/**
 * 解析响应体为 JSON。
 * 上游异常时可能返回 HTML 错误页（如 Cloudflare 520），直接 .json()
 * 会抛出 "Unexpected token 'e'" 这类对用户无意义的错误，因此先取文本再解析。
 */
export async function parseJsonResponse(response: Response, sourceName: string) {
  const rawText = await response.text();
  try {
    return { data: JSON.parse(rawText) as Record<string, unknown>, ok: true as const };
  } catch {
    throw new Error(`${sourceName}返回异常响应（HTTP ${response.status}），请稍后重试`);
  }
}

/** 调用高德 Web 服务 API，失败时抛出可读错误 */
export async function amapGet(path: string, params: Record<string, string>, key: string) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url.toString());
  const { data } = await parseJsonResponse(response, '高德服务');
  if (!response.ok || data.status !== '1') {
    throw new Error(`高德服务暂不可用：${safeText(data.info, 80) || response.status}`);
  }
  return data;
}

/** 从可能被 ``` 包裹的文本中提取第一个 JSON 对象 */
export function extractJsonObject<T>(raw: string): T {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('AI 未返回有效的结构化内容');

  const body = cleaned.slice(start);
  try {
    return JSON.parse(body) as T;
  } catch {
    // 模型偶尔会漏掉结尾的 ] 或 }（尤其输出较长时）。
    // 扫描括号深度，把缺失的闭合补齐后再解析，避免整条请求因此失败。
    let depth = 0;
    let inString = false;
    let escaped = false;
    const stack: string[] = [];
    for (const char of body) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{' || char === '[') { stack.push(char); depth += 1; }
      if (char === '}' || char === ']') { stack.pop(); depth -= 1; }
    }
    if (depth <= 0) throw new Error('AI 未返回有效的结构化内容');
    const closing = stack.reverse().map((char) => (char === '{' ? '}' : ']')).join('');
    return JSON.parse(body + closing) as T;
  }
}

/**
 * 调用 DeepSeek 对话接口并返回文本内容。
 * 统一处理非 JSON 响应与错误信息提取。
 */
export async function callDeepSeek(
  env: AppEnv,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  temperature = 0.35,
  // 跨天行程的 JSON 明显更长，默认上限会把结果截断成半截 JSON
  maxTokens = 2400,
) {
  const baseUrl = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  const rawText = await response.text();
  let payload: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; error?: { message?: string } } = {};
  let parseFailed = false;
  try {
    payload = JSON.parse(rawText);
  } catch {
    parseFailed = true;
  }

  if (!response.ok) {
    const detail = safeText(payload.error?.message, 120)
      || (parseFailed ? `上游返回异常响应（HTTP ${response.status}）` : String(response.status));
    throw new Error(`AI 服务暂不可用：${detail}。请稍后重试。`);
  }
  if (parseFailed) throw new Error('AI 服务返回了非预期内容，请稍后重试。');

  return payload.choices?.[0]?.message?.content || '';
}

/** 校验 YYYY-MM-DD */
export const isDateString = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));

const pad = (value: number) => String(value).padStart(2, '0');

/** 格式化为 YYYY-MM-DD */
export const formatDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** 列出 [start, end] 之间的所有日期，上限 7 天 */
export function listDates(start: string, end: string): string[] {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [start];
  const days: string[] = [];
  for (let cursor = from; cursor <= to && days.length < 7; cursor.setDate(cursor.getDate() + 1)) {
    days.push(formatDate(cursor));
  }
  return days.length > 0 ? days : [start];
}

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 取某日的中文星期，用于 AI 提示与前端展示 */
export function weekdayOf(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : WEEKDAY_LABEL[parsed.getDay()];
}
