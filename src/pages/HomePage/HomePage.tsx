import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, CloudSun, LocateFixed, MapPin, Plus, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import JourneyPanel from '@/components/JourneyPanel';
import RouteCard from '@/components/RouteCard';
import { createAiPlan, fetchAreas, searchCities, type ICityOption, type IPlanResponse } from '@/api/plan';
import type { IRoute } from '@/data/trips';

type Screen = 'plan' | 'routes' | 'journey' | 'published';

const PRESET_INTERESTS = ['展览', '市集', '演出', '公园', '历史', '咖啡', '徒步', '书店'];

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
  const [cityOptions, setCityOptions] = useState<ICityOption[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [area, setArea] = useState('当前位置附近');
  const [areaQuery, setAreaQuery] = useState('');
  const [startDate, setStartDate] = useState(RANGE.start);
  const [endDate, setEndDate] = useState(RANGE.end);
  const [budget, setBudget] = useState(200);
  const [interests, setInterests] = useState<string[]>(['展览', '市集']);
  const [interestInput, setInterestInput] = useState('');
  const [routes, setRoutes] = useState<IRoute[]>([]);
  const [planResult, setPlanResult] = useState<IPlanResponse | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<IRoute | null>(null);
  const [locating, setLocating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const cityBoxRef = useRef<HTMLDivElement>(null);

  // 城市关键词搜索：防抖 300ms，避免逐字符打接口
  useEffect(() => {
    const keyword = cityInput.trim();
    const timer = window.setTimeout(() => {
      if (!keyword || keyword === city) {
        setCityOptions([]);
        setCityOpen(false);
        return;
      }
      void searchCities(keyword).then((list) => {
        setCityOptions(list);
        setCityOpen(list.length > 0);
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

  // 点击外部关闭城市下拉
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (cityBoxRef.current && !cityBoxRef.current.contains(event.target as Node)) setCityOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pickCity = (name: string) => {
    setCity(name);
    setCityInput(name);
    setCityOpen(false);
    setArea('当前位置附近');
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
      const result = await createAiPlan({ city, area, date: startDate, endDate, budget, interests, partySize: 2 });
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

  if (screen === 'journey' && selectedRoute) {
    return <JourneyPanel route={selectedRoute} onBack={() => setScreen('routes')} onPublished={() => setScreen('published')} />;
  }

  if (screen === 'published') {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground"><CheckCircle2 size={38} /></div>
        <Badge variant="secondary">路线发布成功</Badge>
        <h1 className="mt-4 text-4xl font-black tracking-tight">这次出行，真的走过了</h1>
        <p className="mt-3 max-w-md text-muted-foreground">已根据你的打卡、跳过和临时地点生成实际路线。计划没有完成也没关系，真实经历才是攻略。</p>
        <div className="mt-7 w-full rounded-3xl border bg-card p-5 text-left shadow-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-primary">我的路线攻略</div>
          <div className="mt-2 text-xl font-black">{selectedRoute?.title || '城市漫游实录'}</div>
          <p className="mt-2 text-sm text-muted-foreground">来自实际打卡记录 · 可继续编辑后分享</p>
        </div>
        <div className="mt-6 flex gap-3"><Button variant="outline" onClick={() => setScreen('journey')}>继续编辑</Button><Button onClick={() => setScreen('plan')}>再规划一次</Button></div>
      </main>
    );
  }

  const days = dayCount(startDate, endDate);
  const filteredAreas = areaQuery.trim()
    ? areas.filter((item) => item.includes(areaQuery.trim()))
    : areas.slice(0, 8);

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
                      aria-label="搜索城市"
                      placeholder="输入城市名搜索，如 杭州"
                      value={cityInput}
                      onChange={(event) => setCityInput(event.target.value)}
                      onFocus={() => cityOptions.length > 0 && setCityOpen(true)}
                    />
                    <Button variant="outline" onClick={locate}><LocateFixed size={16} />{locating ? '定位中' : '定位'}</Button>
                  </div>
                  {cityOpen && cityOptions.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-card shadow-lg">
                      {cityOptions.map((option) => (
                        <button
                          key={`${option.name}-${option.adcode}`}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                          onClick={() => pickCity(option.name)}
                        >
                          <MapPin size={14} className="text-muted-foreground" />{option.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">已选：{city} · 输入关键词可搜索其他城市</p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold" htmlFor="area-input">想去哪里玩</label>
                  <Input
                    id="area-input"
                    aria-label="搜索区域"
                    placeholder={areas.length ? '搜索或从下方推荐中选择' : '正在加载区域推荐…'}
                    value={areaQuery}
                    onChange={(event) => setAreaQuery(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => { setArea('当前位置附近'); setAreaQuery(''); }}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${area === '当前位置附近' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
                    >不限区域</button>
                    {filteredAreas.map((item) => (
                      <button
                        key={item}
                        onClick={() => { setArea(item); setAreaQuery(''); }}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${area === item ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
                      >{item}</button>
                    ))}
                    {areaQuery.trim() && filteredAreas.length === 0 && (
                      <button
                        onClick={() => { setArea(areaQuery.trim()); setAreaQuery(''); }}
                        className="rounded-full border border-dashed border-primary px-3 py-1.5 text-sm text-primary"
                      ><Plus size={13} className="mr-1 inline" />用“{areaQuery.trim()}”搜索</button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">已选：{area}</p>
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

                <div><label className="mb-2 block text-sm font-bold" htmlFor="budget-input">人均预算</label><div className="flex items-center gap-3"><Input id="budget-input" aria-label="人均预算" type="number" min="0" max="5000" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /><span className="shrink-0 text-sm font-semibold">元 / 人</span></div></div>

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
              <p className="mt-2 text-muted-foreground">{city} · {area} · {startDate}{endDate !== startDate ? ` 至 ${endDate}` : ''} · 参考天气 {planResult.weather.date} {planResult.weather.condition} · {planResult.weather.tempLow}–{planResult.weather.tempHigh}℃</p>
              {planResult.weather.forecastStatus === 'out_of_range'
                ? <p className="mt-2 max-w-2xl rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">{planResult.weather.note}</p>
                : planResult.weather.rangeSummary && <p className="mt-2 max-w-2xl rounded-xl bg-secondary px-3 py-2 text-sm text-muted-foreground">{planResult.weather.note}</p>}
            </div>
            <Badge variant="secondary" className="w-fit">{planResult.poiCount} 个真实地点候选</Badge>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">{routes.map((route, index) => <RouteCard key={route.id} route={route} featured={index === 0} onChoose={chooseRoute} />)}</div>
        </section>
      )}
    </main>
  );
}
