interface Env {
  AMAP_WEB_SERVICE_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

// 诊断端点：只报告环境变量是否绑定成功及长度，绝不返回密钥内容本身。
// 用于排查 Pages 环境变量未生效的问题，确认无误后可删除。
export function onRequestGet(context: { env: Env }) {
  const inspect = (value?: string) => ({
    present: Boolean(value && value.length > 0),
    length: value ? value.length : 0,
    hasWhitespace: value ? value !== value.trim() : false,
  });

  return new Response(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      env: {
        AMAP_WEB_SERVICE_KEY: inspect(context.env.AMAP_WEB_SERVICE_KEY),
        DEEPSEEK_API_KEY: inspect(context.env.DEEPSEEK_API_KEY),
        DEEPSEEK_BASE_URL: inspect(context.env.DEEPSEEK_BASE_URL),
        DEEPSEEK_MODEL: inspect(context.env.DEEPSEEK_MODEL),
      },
      expected: {
        AMAP_WEB_SERVICE_KEY: 32,
        DEEPSEEK_API_KEY: 35,
      },
    }, null, 2),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}
