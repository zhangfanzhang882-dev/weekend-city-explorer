import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CloudSun, LocateFixed, MapPin, Plus, Search, Sparkles, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import JourneyPanel from '@/components/JourneyPanel';
import RouteCard from '@/components/RouteCard';
import { createAiPlan, fetchAreas, searchCities, type ICityOption, type IPlanResponse } from '@/api/plan';
import type { IRoute } from '@/data/trips';

type Screen = 'plan' | 'routes' | 'journey' | 'published';

const PRESET_INTERESTS = ['展览', '市集', '演出', '公园', '历史', '咖啡', '徒步', '书店'];

/**
 * 预算档位。
 * 只表达相对消费取向，不写具体金额——同一档位在不同城市、不同场馆的实际花费差异很大，
 * 写死数字会误导用户，也会让 AI 按错误的价格假设选点。
 */
const BUDGET_TIERS = [
  { key: 'free', label: '穷游党', desc: '只挑免费场所', hint: '优先免费开放的公园、公共展区、街区' },
  { key: 'thrifty', label: '经济实惠', desc: '尽量少花钱', hint: '免费为主，可接受少量低价门票' },
  { key: 'comfy', label: '舒适适中', desc: '该花就花', hint: '不刻意省，愿意为好体验买票' },
  { key: 'rich', label: '土豪随意', desc: '不看价格', hint: '只按体验和口碑挑，不考虑花费' },
] as const;

// 点击输入框即展示的默认城市，避免用户面对空白下拉不知道能填什么
const HOT_CITIES: ICityOption[] = [
  { name: '上海', adcode: '310000' },
  { name: '北京', adcode: '110000' },
  { name: '杭州', adcode: '330100' },
  { name: '成都', adcode: '510100' },
  { name: '广州', adcode: '440100' },
  { name: '深圳', adcode: '440300' },
  { name: '南京', adcode: '320100' },
  { name: '西安', adcode: '610100' },
];

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** 默认给出最近的周末区间；今天就是周末时从今天开始 */
function defaultRange() {
  const today = new Date();
  const day = today.getDay();
  const offset = day === 6 || day === 0 ? 0 : 6 - day;
  const start = new Date(today);
  start.setDate(today.getDate() + offset);
  const end = new Date(start);
  end.setDate(start.getDate() + (day === 0 ? 0 : 1));
  return { start: formatDate(start), end: formatDate(end) };
}

const RANGE = defaultRange();
const TODAY = formatDate(new Date());

/** 计算区间天数，用于展示"共 N 天" */
function dayCount(start: string, end: string) {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / 86400000);
  return diff >= 0 ? diff + 1 : 0;
}

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>('plan');
  const [city, setCity] = useState('上海');
  const [cityInput, setCityInput] = useState('上海');
  const [cityOptions, setCityOptions] = useState<ICityOption[]>(HOT_CITIES);
  const [cityOpen, setCityOpen] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [areaQuery, setAreaQuery] = useState('');
  const [areaExpanded, setAreaExpanded] = useState(false);
  const [startDate, setStartDate] = useState(RANGE.start);
  const [endDate, setEndDate] = useState(RANGE.end);
  const [budgetTier, setBudgetTier] = useState<typeof BUDGET_TIERS[number]['key']>('comfy');
  const [interests, setInterests] = useState<string[]>(['展览', '市集']);
  const [interestInput, setInterestInput] = useState('');
  const [routes, setRoutes] = useState<IRoute[]>([]);
  const [planResult, setPlanResult] = useState<IPlanResponse | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<IRoute | null>(null);
  const [locating, setLocating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<'recommend' | 'distance' | 'rating' | 'cheap'>('recommend');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const cityBoxRef = useRef<HTMLDivElement>(null);

  // 城市关键词搜索：防抖 300ms，避免逐字符打接口
  useEffect(() => {
    const keyword = cityInput.trim();
    const timer = window.setTimeout(() => {
      // 无关键词或未改动时展示热门城市，让点击即可看到可选项
      if (!keyword || keyword === city) {
        setCityOptions(HOT_CITIES);
        return;
      }
      void searchCities(keyword).then((list) => {
        setCityOptions(list.length > 0 ? list : HOT_CITIES);
        setCityOpen(true);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cityInput, city]);

  // 城市确定后加载该城市的行政区，作为区域推荐
  useEffect(() => {
    let alive = true;
    void fetchAreas(city).then((list) => {
      if (alive) setAreas(list);
    });
    return () => { alive = false; };
  }, [city]);

  // 点击外部关闭城市下拉。
  // 注意：document 上的 mousedown 会先于 input 的 onClick 触发，若无条件关闭，
  // 会与 onClick 的展开在同一次点击中相互抵消，导致点击输入框无法弹出下拉。
  // 因此这里显式区分：点在输入框或下拉内保持展开，点"定位"按钮及其他区域才关闭。
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-city-picker]')) {
        setCityOpen(true);
        return;
      }
      setCityOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const pickCity = (name: string) => {
    setCity(name);
    setCityInput(name);
    setCityOpen(false);
    setSelectedAreas([]);
    setAreaQuery('');
    setAreaExpanded(false);
  };

  /** 区域多选切换 */
  const toggleArea = (name: string) => {
    setSelectedAreas((current) => (current.includes(name)
      ? current.filter((item) => item !== name)
      : current.length >= 5 ? current : [...current, name]));
    setAreaQuery('');
  };

  const locate = () => {
    setLocating(true);
    if (!navigator.geolocation) {
      setLocating(false);
      setError('当前浏览器不支持定位，请手动输入城市');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        // 浏览器仅返回经纬度，逆地理编码需服务端密钥；此处保留已选城市并提示
        setLocating(false);
        setError('');
      },
      () => {
        setLocating(false);
        setError('定位未授权，可直接搜索城市名');
      },
      { timeout: 8000 },
    );
  };

  const addInterest = (raw: string) => {
    const value = raw.trim().slice(0, 12);
    if (!value || interests.includes(value) || interests.length >= 6) return;
    setInterests((current) => [...current, value]);
    setInterestInput('');
  };

  const toggleInterest = (interest: string) => {
    setInterests((current) => current.includes(interest)
      ? current.filter((item) => item !== interest)
      : current.length >= 6 ? current : [...current, interest]);
  };

  const generatePlan = async () => {
    setGenerating(true);
    setError('');
    try {
      const tier = BUDGET_TIERS.find((item) => item.key === budgetTier) ?? BUDGET_TIERS[2];
      const result = await createAiPlan({
        city,
        areas: selectedAreas,
        date: startDate,
        endDate,
        // 只传消费取向，不传金额：具体价格因城市和场馆而异，写死数字会误导选点
        budgetTier: tier.label,
        budgetHint: tier.hint,
        interests,
        partySize: 2,
      });
      setPlanResult(result);
      setRoutes(result.routes);
      setScreen('routes');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '路线生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  };

  const chooseRoute = (route: IRoute) => {
    setSelectedRoute(route);
    setScreen('journey');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** 自定义方案：以评分最高的点为起点，配其最近的邻居，兼顾质量与顺路 */
  const startCustomRoute = () => {
    const pool = planResult?.candidates ?? [];
    if (pool.length < 2) {
      setError('候选地点不足，无法自定义方案');
      return;
    }
    const point = (location?: string) => {
      const [lng, lat] = (location || '').split(',').map(Number);
      return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
    };
    const km = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
      const toRad = (value: number) => (value * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
      return 6371 * 2 * Math.asin(Math.sqrt(h));
    };

    // 以评分最高者为种子，再取距它最近的两个点，避免起手就是一条横跨全城的路线
    const ranked = [...pool].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const seed = ranked[0];
    const seedPoint = point(seed.location);
    const rest = ranked.filter((item) => item.name !== seed.name);
    const neighbors = seedPoint
      ? rest
        .map((item) => ({ item, p: point(item.location) }))
        .filter((entry) => entry.p)
        .sort((a, b) => km(seedPoint, a.p!) - km(seedPoint, b.p!))
        .slice(0, 2)
        .map((entry) => entry.item)
      : rest.slice(0, 2);

    const seeds = [seed, ...neighbors].map((stop, index) => ({ ...stop, id: `custom-${index}-${stop.name}` }));
    chooseRoute({
      id: 'custom',
      title: '我自己拼的路线',
      subtitle: '从真实候选地点里自由组合',
      accent: '自定义',
      weatherFit: '',
      totalTime: `${seeds.length * 2} 小时`,
      budget: seeds.reduce((sum, stop) => sum + stop.cost, 0),
      budgetKnownCount: seeds.filter((stop) => stop.cost > 0).length,
      budgetTotalCount: seeds.length,
      stops: seeds,
    });
  };

  /** 方案排序与筛选 */
  const sortedRoutes = useMemo(() => {
    const avgRating = (route: IRoute) => {
      const rated = route.stops.filter((stop) => stop.rating);
      return rated.length === 0 ? 0 : rated.reduce((sum, stop) => sum + (stop.rating ?? 0), 0) / rated.length;
    };
    let list = [...routes];
    if (onlyOpen) {
      // 只保留全部站点当天都不闭馆的方案
      list = list.filter((route) => route.stops.every((stop) => stop.openStatus !== 'closed'));
    }
    if (sortBy === 'distance') list.sort((a, b) => (a.totalKm ?? Infinity) - (b.totalKm ?? Infinity));
    if (sortBy === 'rating') list.sort((a, b) => avgRating(b) - avgRating(a));
    if (sortBy === 'cheap') list.sort((a, b) => a.budget - b.budget);
    return list;
  }, [routes, sortBy, onlyOpen]);

  if (screen === 'journey' && selectedRoute) {
    return (
      <JourneyPanel
        route={selectedRoute}
        candidates={planResult?.candidates ?? []}
        city={city}
        date={startDate}
        endDate={endDate}
        onBack={() => setScreen('routes')}
      />
    );
  }

  const days = dayCount(startDate, endDate);
  const matchedAreas = areaQuery.trim()
    ? areas.filter((item) => item.includes(areaQuery.trim()))
    : areas;
  // 区域较多时默认折叠，避免表单过长；搜索状态下直接展示全部匹配项
  const areaCollapsed = !areaQuery.trim() && !areaExpanded && matchedAreas.length > 8;
  const filteredAreas = areaCollapsed ? matchedAreas.slice(0, 8) : matchedAreas;

  return (
    <main className="min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MapPin size={19} /></div><span className="text-lg font-black tracking-tight">城市漫游</span></div>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm"><span className="h-2 w-2 rounded-full bg-primary" />真实地点 · AI 路线</div>
      </header>

      {screen === 'plan' && (
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.06fr_.94fr] lg:items-center lg:pt-14">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"><Sparkles size={15} />先查真实天气与地点，再排路线</div>
            <h1 className="max-w-2xl text-5xl font-black leading-[1.03] tracking-[-0.055em] sm:text-7xl">告诉我哪天有空，<br />路线我来安排。</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">选好城市、日期和想看的东西，AI 会结合当天天气与真实地点，给你几条走得顺的路线。</p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-sm"><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">实时</b><span className="text-muted-foreground">高德天气</span></div><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">真实</b><span className="text-muted-foreground">高德地点</span></div><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">AI</b><span className="text-muted-foreground">路线生成</span></div></div>
          </div>

          <div className="relative rounded-[34px] border bg-card p-5 shadow-xl shadow-primary/10 sm:p-7">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-accent/70 blur-3xl" />
            <div className="relative">
              <div className="mb-6 flex items-center justify-between"><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Plan your trip</div><h2 className="mt-1 text-2xl font-black">这次想去哪？</h2></div><CloudSun className="text-primary" size={30} /></div>
              <div className="space-y-5">
                <div ref={cityBoxRef} className="relative">
                  <label className="mb-2 block text-sm font-bold" htmlFor="city-input">出发城市</label>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      id="city-input"
                      data-city-picker
                      aria-label="搜索城市"
                      placeholder="输入城市名搜索，如 杭州"
                      value={cityInput}
                      onChange={(event) => setCityInput(event.target.value)}
                      onFocus={() => setCityOpen(true)}
                    />
                    <Button variant="outline" onClick={locate}><LocateFixed size={16} />{locating ? '定位中' : '定位'}</Button>
                  </div>
                  {cityOpen && cityOptions.length > 0 && (
                    <div data-city-picker className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-card shadow-lg">
                      <div className="border-b bg-muted/50 px-3 py-1.5 text-[11px] font-bold tracking-wide text-muted-foreground">
                        {cityOptions === HOT_CITIES ? '热门城市' : '搜索结果'}
                      </div>
                      {/* 限高并允许滚动，城市较多时不会撑破弹层 */}
                      <div className="max-h-56 overflow-y-auto overscroll-contain">
                        {cityOptions.map((option) => (
                          <button
                            key={`${option.name}-${option.adcode}`}
                            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted ${option.name === city ? 'font-bold text-primary' : ''}`}
                            onClick={() => pickCity(option.name)}
                          >
                            <MapPin size={14} className={option.name === city ? 'text-primary' : 'text-muted-foreground'} />{option.name}
                            {option.name === city && <span className="ml-auto text-xs">当前</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">已选：{city} · 输入关键词可搜索其他城市</p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold" htmlFor="area-input">想去哪里玩<span className="ml-1 font-normal text-muted-foreground">可多选</span></label>
                  <Input
                    id="area-input"
                    aria-label="搜索区域"
                    placeholder={areas.length ? '搜索区域，或从下方点选（可多选）' : '正在加载区域推荐…'}
                    value={areaQuery}
                    onChange={(event) => setAreaQuery(event.target.value)}
                  />

                  {/* 已选区域独立成行，便于确认与移除 */}
                  {selectedAreas.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedAreas.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                          {item}
                          <button aria-label={`移除 ${item}`} onClick={() => toggleArea(item)} className="ml-0.5 rounded-full p-0.5 hover:bg-primary-foreground/20"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => { setSelectedAreas([]); setAreaQuery(''); }}
                      aria-pressed={selectedAreas.length === 0}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${selectedAreas.length === 0 ? 'border-primary bg-primary text-primary-foreground font-semibold' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                    >{selectedAreas.length === 0 ? '不限区域' : '清空，改为不限'}</button>
                    {filteredAreas.filter((item) => !selectedAreas.includes(item)).map((item) => (
                      <button
                        key={item}
                        onClick={() => toggleArea(item)}
                        className="rounded-full border bg-card px-3 py-1.5 text-sm transition hover:bg-muted"
                      >+ {item}</button>
                    ))}
                    {areaQuery.trim() && filteredAreas.length === 0 && (
                      <button
                        onClick={() => toggleArea(areaQuery.trim())}
                        className="rounded-full border border-dashed border-primary px-3 py-1.5 text-sm text-primary"
                      ><Plus size={13} className="mr-1 inline" />用“{areaQuery.trim()}”搜索</button>
                    )}
                    {areaCollapsed && (
                      <button
                        onClick={() => setAreaExpanded(true)}
                        className="rounded-full border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                      >展开全部 {matchedAreas.length} 个</button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selectedAreas.length === 0
                      ? '未限定区域，将在全城范围内找地点'
                      : `已选 ${selectedAreas.length}/5 个区域，每个区域都会检索候选地点`}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold">出行日期</label>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Input aria-label="开始日期" type="date" min={TODAY} value={startDate} onChange={(event) => {
                      const value = event.target.value;
                      setStartDate(value);
                      if (endDate < value) setEndDate(value);
                    }} />
                    <span className="text-sm text-muted-foreground">至</span>
                    <Input aria-label="结束日期" type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button onClick={() => { setStartDate(RANGE.start); setEndDate(RANGE.end); }} className="rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-muted"><CalendarDays size={12} className="mr-1 inline" />这个周末</button>
                    <button onClick={() => { setStartDate(TODAY); setEndDate(TODAY); }} className="rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-muted">就今天</button>
                    <span className="text-xs text-muted-foreground">共 {days} 天</span>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold" htmlFor="interest-input">想看什么</label>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      id="interest-input"
                      aria-label="自定义兴趣关键词"
                      placeholder="输入任意关键词，如 摄影展、精酿"
                      value={interestInput}
                      maxLength={12}
                      onChange={(event) => setInterestInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addInterest(interestInput);
                        }
                      }}
                    />
                    <Button variant="outline" onClick={() => addInterest(interestInput)} disabled={!interestInput.trim() || interests.length >= 6}><Plus size={16} />添加</Button>
                  </div>
                  {interests.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {interests.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                          {item}
                          <button aria-label={`移除 ${item}`} onClick={() => toggleInterest(item)} className="ml-0.5 rounded-full p-0.5 hover:bg-primary-foreground/20"><X size={13} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PRESET_INTERESTS.filter((item) => !interests.includes(item)).map((interest) => (
                      <button key={interest} onClick={() => toggleInterest(interest)} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted">+ {interest}</button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">已选 {interests.length}/6 个，回车即可添加自定义关键词</p>
                </div>

                <div>
                  <span className="mb-2 block text-sm font-bold">消费取向</span>
                  <div className="grid grid-cols-2 gap-2">
                    {BUDGET_TIERS.map((tier) => (
                      <button
                        key={tier.key}
                        onClick={() => setBudgetTier(tier.key)}
                        aria-pressed={budgetTier === tier.key}
                        title={tier.hint}
                        className={`rounded-xl border px-3 py-2.5 text-left transition ${budgetTier === tier.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
                      >
                        <span className="block text-sm font-bold">{tier.label}</span>
                        <span className={`block text-xs ${budgetTier === tier.key ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{tier.desc}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {BUDGET_TIERS.find((tier) => tier.key === budgetTier)?.hint}
                  </p>
                </div>

                {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
                <Button size="lg" className="w-full rounded-xl" disabled={generating || interests.length === 0} onClick={() => void generatePlan()}><Search size={18} />{generating ? '正在查天气、地点并生成路线…' : '生成我的路线'}</Button>
                {interests.length === 0 && <p className="text-center text-xs text-muted-foreground">请至少选择或添加一个想看的内容</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {screen === 'routes' && planResult && (
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
          <button className="mb-5 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={() => setScreen('plan')}>← 修改出行条件</button>
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">数据来源：{planResult.sources.join(' · ')}</div>
              <h2 className="mt-2 text-4xl font-black tracking-tight">为你排好了 {routes.length} 条路线</h2>
              <p className="mt-2 text-muted-foreground">{city} · {selectedAreas.length > 0 ? selectedAreas.join('、') : '不限区域'} · {startDate}{endDate !== startDate ? ` 至 ${endDate}` : ''} · 参考天气 {planResult.weather.date} {planResult.weather.condition} · {planResult.weather.tempLow}–{planResult.weather.tempHigh}℃</p>
              {planResult.weather.forecastStatus === 'out_of_range'
                ? <p className="mt-2 max-w-2xl rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">{planResult.weather.note}</p>
                : planResult.weather.rangeSummary && <p className="mt-2 max-w-2xl rounded-xl bg-secondary px-3 py-2 text-sm text-muted-foreground">{planResult.weather.note}</p>}
            </div>
            <Badge variant="secondary" className="w-fit">{planResult.poiCount} 个真实地点候选</Badge>
          </div>
          {planResult.verified && (
            <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 rounded-2xl border bg-card px-4 py-3 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">数据核验</span>
              <span>营业时间已确认 {planResult.verified.openConfirmed}/{planResult.verified.total}</span>
              <span>含实景照片 {planResult.verified.withPhotos}/{planResult.verified.total}</span>
              <span>含评分 {planResult.verified.withRating}/{planResult.verified.total}</span>
              {planResult.verified.openUnknown > 0 && <span className="text-warning">{planResult.verified.openUnknown} 个地点营业时间无数据，出发前请自行确认</span>}
            </div>
          )}
          {/* 排序与自定义：默认方案之外给用户主动权 */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">排序</span>
            {([
              { key: 'recommend', label: '推荐顺序' },
              { key: 'distance', label: '路程最短' },
              { key: 'rating', label: '评分最高' },
              { key: 'cheap', label: '花费最少' },
            ] as const).map((option) => (
              <button
                key={option.key}
                onClick={() => setSortBy(option.key)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${sortBy === option.key ? 'border-primary bg-primary text-primary-foreground font-semibold' : 'bg-card hover:bg-muted'}`}
              >{option.label}</button>
            ))}
            <button
              onClick={() => setOnlyOpen((value) => !value)}
              className={`ml-1 rounded-full border px-3 py-1.5 text-sm transition ${onlyOpen ? 'border-primary bg-primary text-primary-foreground font-semibold' : 'bg-card hover:bg-muted'}`}
            >仅看当天营业</button>
            <Button variant="outline" className="ml-auto" onClick={startCustomRoute}>
              <Wand2 size={15} />自己拼一条
            </Button>
          </div>

          <div className="grid items-stretch gap-5 lg:grid-cols-3">
            {sortedRoutes.map((route, index) => (
              <RouteCard key={route.id} route={route} featured={index === 0 && sortBy === 'recommend'} onChoose={chooseRoute} />
            ))}
          </div>
          {sortedRoutes.length === 0 && (
            <div className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              没有符合当前筛选条件的方案，可放宽筛选或点「自己拼一条」。
            </div>
          )}
        </section>
      )}
    </main>
  );
}
