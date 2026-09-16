interface Env {
  AMAP_WEB_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

interface ParsedIntent {
  city: string;
  areas: string[];
  date: string;
  endDate: string;
  interests: string[];
  budgetTier: string;
  /** 对解析结果的自然语言说明，展示给用户确认 */
  summary: string;
  /** 未能从输入中识别、采用了默认值的字段 */
  assumed: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const safeText = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

async function amapGet(path: string, params: Record<string, string>, key: string) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url.toString());
  const rawText = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(`高德服务返回异常响应（HTTP ${response.status}）`);
  }
  if (!response.ok || data.status !== '1') {
    throw new Error(`高德服务暂不可用：${String(data.info ?? response.status).slice(0, 80)}`);
  }
  return data;
}

/** 校验城市是否真实存在，返回规范化名称；不存在则返回 null */
async function resolveCity(name: string, key: string) {
  if (!name) return null;
  const data = await amapGet('/v3/config/district', { keywords: name, subdistrict: '0', extensions: 'base' }, key);
  const list = (data.districts as Array<{ name?: string; level?: string }> | undefined) ?? [];
  const hit = list.find((item) => item.level === 'city' || item.level === 'province');
  return hit?.name ? hit.name.replace(/市$/, '') : null;
}

/** 取城市下真实区县列表，用于校验 AI 给出的区域名 */
async function listAreas(city: string, key: string) {
  const data = await amapGet('/v3/config/district', { keywords: city, subdistrict: '2', extensions: 'base' }, key);
  const root = (data.districts as Array<Record<string, unknown>> | undefined)?.[0];
  if (!root) return [];
  const collect = (nodes: Array<Record<string, unknown>> | undefined): string[] => {
    if (!nodes?.length) return [];
    const names: string[] = [];
    for (const node of nodes) {
      const nodeName = String(node.name ?? '');
      const level = String(node.level ?? '');
      if (level === 'city' || /城区$/.test(nodeName)) {
        names.push(...collect(node.districts as Array<Record<string, unknown>> | undefined));
        continue;
      }
      if (level === 'district' && nodeName) names.push(nodeName);
    }
    return names;
  };
  return [...new Set(collect(root.districts as Array<Record<string, unknown>> | undefined))];
}

const BUDGET_LABELS = ['穷游党', '经济实惠', '舒适适中', '土豪随意'];

const pad = (value: number) => String(value).padStart(2, '0');
const formatDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** 最近的周末区间，作为未指定日期时的默认值 */
function defaultRange(today: Date) {
  const day = today.getDay();
  const offset = day === 6 || day === 0 ? 0 : 6 - day;
  const start = new Date(today);
  start.setDate(today.getDate() + offset);
  const end = new Date(start);
  end.setDate(start.getDate() + (day === 0 ? 0 : 1));
  return { start: formatDate(start), end: formatDate(end) };
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    if (!context.env.AMAP_WEB_SERVICE_KEY || !context.env.DEEPSEEK_API_KEY) {
      return json({ error: '服务端尚未配置高德或 AI 密钥' }, 503);
    }
    const body = await context.request.json() as { text?: string; today?: string; defaultCity?: string };
    const text = safeText(body.text, 200);
    if (text.length < 2) return json({ error: '请多写几个字，说明想去哪、什么时候、想看什么' }, 400);

    // 以客户端本地日期为基准，避免服务器时区导致"这周末"算错
    const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : formatDate(new Date());
    const today = new Date(`${todayStr}T00:00:00`);
    const range = defaultRange(today);
    const fallbackCity = safeText(body.defaultCity, 20) || '上海';

    const baseUrl = (context.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const prompt = `把用户的一句话出行需求解析成结构化参数。今天是 ${todayStr}（周${'日一二三四五六'[today.getDay()]}）。

用户输入：${text}

规则：
- city：只填城市名，不带"市"字。用户没提就填"${fallbackCity}"。
- areas：城市内的行政区名数组，必须是真实区县名（如"静安区""西湖区"）。用户没提具体区域就返回空数组。最多 3 个。
- date / endDate：格式 YYYY-MM-DD，必须不早于 ${todayStr}。"这周末"指 ${range.start} 到 ${range.end}；"明天"指今天加一天；只提单日则两者相同。没提就用 ${range.start} 到 ${range.end}。
- interests：想看的内容关键词数组，2 到 5 个，每个不超过 6 字（如"展览""咖啡""摄影展"）。要贴合用户原话，没提就根据语境合理推断。
- budgetTier：只能是 ${BUDGET_LABELS.join('、')} 之一。没提就填"舒适适中"。
- summary：用一句不超过 40 字的中文复述你的理解，第一人称"你"开头。
- assumed：数组，列出用户没明说而你采用默认值的字段名，用中文（如"日期""预算"）。

只返回JSON：{"city":"","areas":[],"date":"","endDate":"","interests":[],"budgetTier":"","summary":"","assumed":[]}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${context.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: context.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是出行需求解析器。只输出JSON，不要解释。不要编造用户没提到的地名。' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const rawText = await response.text();
    let payload: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } = {};
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

    const content = payload.choices?.[0]?.message?.content || '';
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('未能理解这句话，请换个说法');
    const draft = JSON.parse(content.slice(start, end + 1)) as Partial<ParsedIntent>;

    const assumed = Array.isArray(draft.assumed)
      ? draft.assumed.map((item) => safeText(item, 8)).filter(Boolean).slice(0, 5)
      : [];

    // 城市必须真实存在，否则回退默认城市并提示
    const cityGuess = safeText(draft.city, 20);
    const resolvedCity = await resolveCity(cityGuess, context.env.AMAP_WEB_SERVICE_KEY);
    const city = resolvedCity ?? fallbackCity;
    if (!resolvedCity && cityGuess) assumed.push(`城市（未找到"${cityGuess}"）`);

    // 区域必须是该城市真实区县，过滤掉 AI 编造的名称
    const realAreas = await listAreas(city, context.env.AMAP_WEB_SERVICE_KEY);
    const areaGuess = Array.isArray(draft.areas) ? draft.areas.map((item) => safeText(item, 20)) : [];
    const areas = areaGuess
      .map((name) => realAreas.find((real) => real === name || real.includes(name) || name.includes(real)))
      .filter((name): name is string => Boolean(name))
      .slice(0, 3);
    const droppedAreas = areaGuess.length - areas.length;
    if (droppedAreas > 0) assumed.push('部分区域未识别');

    // 日期必须合法且不早于今天
    const isDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    let date = isDate(draft.date) && String(draft.date) >= todayStr ? String(draft.date) : range.start;
    let endDate = isDate(draft.endDate) ? String(draft.endDate) : range.end;
    if (endDate < date) endDate = date;
    // 单次行程限制在 7 天内，避免天气与候选地点失去意义
    const span = (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000;
    if (span > 6) endDate = formatDate(new Date(new Date(`${date}T00:00:00`).getTime() + 6 * 86400000));
    if (date < todayStr) date = todayStr;

    const interests = (Array.isArray(draft.interests) ? draft.interests : [])
      .map((item) => safeText(item, 12))
      .filter(Boolean)
      .slice(0, 6);

    const budgetTier = BUDGET_LABELS.includes(safeText(draft.budgetTier, 16))
      ? safeText(draft.budgetTier, 16)
      : '舒适适中';

    return json({
      intent: {
        city,
        areas,
        date,
        endDate,
        interests: interests.length > 0 ? interests : ['展览', '市集'],
        budgetTier,
        summary: safeText(draft.summary, 60),
        assumed: [...new Set(assumed)],
      },
      availableAreas: realAreas.slice(0, 20),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '解析失败' }, 502);
  }
}
