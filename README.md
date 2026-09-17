# 城市漫游 · Weekend City Explorer

用一句话说清想去哪，AI 结合真实天气与真实地点，生成走得顺的城市路线。

- 线上地址：https://weekend-city-explorer.pages.dev
- 仓库：`zhangfanzhang882-dev/weekend-city-explorer`（生产分支 `main`）

---

## 一、前后端关系

这是一个 **Cloudflare Pages + Pages Functions** 的一体化部署项目：前后端在同一个仓库、同一个域名下，但代码目录、构建方式和运行环境完全分离。

```
浏览器
  │
  │  ① 页面请求  GET /
  ├──────────────────────────────►  dist/（Vite 构建的静态资源）
  │                                  由 Pages 静态托管，无服务端参与
  │
  │  ② 接口请求  POST /api/plan
  └──────────────────────────────►  functions/api/plan.ts
                                     在 Cloudflare Workers 运行时执行
                                     持有密钥，代理调用高德 / DeepSeek
```

| | 前端 | 后端 |
|---|---|---|
| 代码目录 | `src/` | `functions/` |
| 产物 | `dist/`（静态文件） | 无需构建，Pages 直接部署 |
| 运行环境 | 浏览器 | Cloudflare Workers（边缘） |
| 构建工具 | Vite | 无 |
| 类型配置 | `tsconfig.app.json` | `tsconfig.functions.json` |
| 能否读密钥 | **不能** | 能（通过环境变量） |
| 路由方式 | React Router（`src/app.tsx`） | 文件路径映射（`functions/api/x.ts` → `/api/x`） |

**为什么必须有后端**：高德与 DeepSeek 的密钥不能出现在前端代码里——前端产物是公开可下载的，密钥一旦写进去等于泄露。所有第三方调用都由 `functions/` 代理，浏览器只与本站 `/api/*` 通信。

**前后端唯一的接触面**是 `src/services/api.ts`。前端组件不直接 `fetch`，一律通过这个模块调用；接口的请求与响应类型也在此定义。改接口时前后端各改一处，对齐点明确。

---

## 二、目录结构

```
.
├── functions/                  后端（Cloudflare Pages Functions）
│   ├── _shared/                共享模块（下划线开头不会成为路由）
│   │   ├── api.ts              响应封装、密钥调用、上游错误处理
│   │   ├── geo.ts              距离计算、路线排序、顺路阈值
│   │   ├── opening.ts          营业时间交叉校验
│   │   ├── lodging.ts          住宿搜索（周边 / 关键词）
│   │   └── context.ts          节假日与空气质量（免密钥，静默降级）
│   └── api/                    每个文件对应一个接口
│       ├── intent.ts           POST /api/intent   自然语言 → 结构化条件
│       ├── places.ts           GET  /api/places   城市 / 区域 / 地点搜索
│       ├── plan.ts             POST /api/plan     核心：生成路线
│       └── trip.ts             GET/POST /api/trip 行程读写（KV）
│
├── src/                        前端（React 19 + TypeScript）
│   ├── services/api.ts         【前后端接口层】所有 /api 调用与类型定义
│   ├── pages/                  页面级容器
│   │   ├── HomePage/           首页：AI 输入 + 条件表单 + 方案列表
│   │   └── NotFoundPage/
│   ├── features/journey/       行程业务组件
│   │   ├── JourneyPanel.tsx    四阶段行程主面板
│   │   ├── RouteCard.tsx       方案卡片
│   │   └── RouteMap.tsx        位置关系示意图（纯 SVG）
│   ├── components/             通用组件
│   │   ├── ui/                 shadcn/ui 内置组件（勿修改）
│   │   ├── Layout.tsx
│   │   └── ErrorFallback.tsx
│   ├── data/                   类型定义与静态数据
│   │   ├── trips.ts            IStop / IRoute / ICheckIn
│   │   └── sampleReviews.ts    示例点评（界面上明确标注为示例）
│   ├── hooks/  lib/            自定义 Hooks、工具函数
│   └── index.tsx  app.tsx      入口与路由（勿修改 index.tsx）
│
├── tsconfig.app.json           前端类型检查（include: src）
├── tsconfig.functions.json     后端类型检查（include: functions）
├── wrangler.toml               Pages 配置与 KV 绑定说明
├── .dev.vars                   本地密钥（已 gitignore，不进仓库）
└── .dev.vars.example           密钥模板
```

---

## 三、接口说明

所有接口都在同域 `/api/*` 下，前端通过 `src/services/api.ts` 调用。

### `POST /api/plan` — 生成路线

核心接口。流程：

1. **并行取数**：高德天气（支持日期范围）+ 高德 POI 检索（多区域按配额取样）
2. **交叉校验**：用营业时间过滤当天闭馆的地点
3. **AI 编排**：DeepSeek 从真实候选中选点，提示词内附方位与距中心距离
4. **硬校验**：服务端按最近邻重排消除折返，拒绝单段 > 6km 或跨度 > 12km 的路线
5. **兜底**：AI 路线全被拒时，改用地理聚类生成，保证不会失败
6. **环境与住宿**：并行取节假日、空气质量；跨天行程按第一天最后一站坐标搜附近住宿。三者互不依赖，任一失败都不影响路线

请求：`{ city, areas[], date, endDate, budgetTier, budgetHint, interests[], partySize }`
响应：`{ weather, routes[], candidates[], verified, holiday, air, lodging[], isMultiDay, poiCount, sources[] }`

> 关于为什么不接大众点评 / 携程：这些平台的开放接口只面向企业或代理商——美团要求营业执照、等保证明与保证金，去哪儿要求代理商资质，Booking 要求先成为 Affiliate Partner。个人开发者无法准入，因此改用高德已覆盖的住宿 POI 数据实现同等能力。

### `POST /api/intent` — 自然语言解析

把「这周末想在静安区看展喝咖啡，尽量少花钱」解析成结构化条件。

**关键约束**：AI 给出的地名一律不信任。城市要查高德行政区确认存在，区域必须匹配该城市真实区县列表，编造的直接丢弃；日期校验格式且不早于今天，单次不超过 7 天。

### `GET /api/places` — 地点查询

按 `mode` 分四种：`city`（城市搜索）、`area`（区县列表）、`poi`（地点搜索，用于换地点/加地点）、`lodging`（住宿搜索，传 `near` 坐标走周边、否则按关键词搜全城）。行政区缓存 1 天，POI 与住宿缓存 5 分钟。

### `GET/POST /api/trip` — 行程读写

行程、打卡、同行、费用约定、路线评价存入 KV，30 天过期。**未绑定 KV 时自动降级为内存存储**，接口仍可用，但邀请链接无法跨设备打开，界面会如实提示。

---

## 四、本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入真实密钥
npm run dev:live                 # 推荐：前后端一起起
```

打开 **http://localhost:5173**（注意是 `http`，本地无 HTTPS）。

`dev:live` 同时启动两个进程：

- **Vite**（5173）：前端，改代码浏览器立即刷新
- **wrangler**（8788）：后端 Functions，加载 `.dev.vars` 里的真实密钥

Vite 把 `/api/*` 代理到 8788（见 `vite.config.ts`），所以前端热更新与真实接口可以同时用。**改了 `functions/` 下的代码需要重启** `dev:live`，因为 wrangler 跑的是构建产物。

| 命令 | 用途 |
|---|---|
| `npm run dev:live` | 前后端一起起（日常开发用这个） |
| `npm run dev` | 只起前端，`/api` 不可用 |
| `npm run lint` | 前端类型 + 后端类型 + ESLint 三项 |
| `npm run build` | 生产构建到 `dist/` |

---

## 五、部署

推送到 `main` 后 Cloudflare Pages 自动构建，域名不变。

```bash
npm run lint && npm run build    # 先本地验证
git add . && git commit -m "..."
git push origin main             # 约 90 秒后线上生效
```

### 线上配置（在 Cloudflare 控制台完成）

**环境变量**（Settings → Environment variables → Production）：

| 变量 | 类型 |
|---|---|
| `AMAP_WEB_SERVICE_KEY` | Secret |
| `DEEPSEEK_API_KEY` | Secret |
| `DEEPSEEK_BASE_URL` | Text（`https://api.deepseek.com`） |
| `DEEPSEEK_MODEL` | Text（`deepseek-chat`） |

**KV 绑定**（Settings → Bindings，可选）：变量名必须为 `TRIPS`，用于行程持久化与跨设备邀请链接。不绑也能跑，走内存降级。

> 改完环境变量必须**重新触发一次部署**才生效——变量绑定在具体部署上，旧部署读不到新值。

---

## 六、数据来源与口径

| 数据 | 来源 | 说明 |
|---|---|---|
| 天气 | 高德天气 | 仅覆盖近几日；超出预报窗口会明确提示 |
| 地点、评分、照片、营业时间、电话 | 高德 POI | 照片统一升级为 https，避免被浏览器拦截 |
| 路线组合与文案 | DeepSeek | 只能从真实候选中选择，服务端逐个校验地点名 |
| 站点间距离 | 本地 Haversine 计算 | **直线距离**，实测约为真实路程的 70%–85% |
| 住宿推荐 | 高德住宿类 POI 周边搜索 | 跨天行程才出现，以当天最后一站为圆心 2.5km |
| 节假日与调休 | timor.tech 公开接口 | 免密钥；用于提示假期拥挤度 |
| 空气质量 | Open-Meteo Air Quality | 免密钥；预报窗口约 5–7 天，超出会降级为近期参考值 |
| 历史点评 | 内置示例 | 界面上明确标注「示例数据」，不冒充真实用户评价 |
| 打卡与路线评价 | 用户产生 | 存 KV |

**不编造数据**是硬约束：多数场馆无票价数据时显示「门票价格暂无数据」而非 ¥0；营业时间缺失时提示「出发前请自行确认」；AI 返回的地点名对不上真实候选就丢弃。

---

## 七、技术栈

React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · lucide-react · react-router-dom · Vite 8 · Cloudflare Pages Functions · Cloudflare KV

主题色定义在 `src/tailwind-theme.css`，HSL 用空格分隔：`--primary: hsl(150 60% 40%);`
