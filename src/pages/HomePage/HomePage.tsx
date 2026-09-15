import { useState } from 'react';
import { CalendarDays, CheckCircle2, CloudSun, LocateFixed, MapPin, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import JourneyPanel from '@/components/JourneyPanel';
import RouteCard from '@/components/RouteCard';
import { createAiPlan, type IPlanResponse } from '@/api/plan';
import type { IRoute } from '@/data/trips';

type Screen = 'plan' | 'routes' | 'journey' | 'published';

const INTERESTS = ['展览', '市集', '演出', '公园', '历史', '咖啡'];

function nextWeekendDates() {
  const today = new Date();
  const day = today.getDay();
  const saturdayOffset = day === 6 ? 0 : (6 - day + 7) % 7;
  const saturday = new Date(today);
  saturday.setDate(today.getDate() + saturdayOffset);
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);
  const format = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dateOfMonth = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${dateOfMonth}`;
  };
  return { saturday: format(saturday), sunday: format(sunday) };
}

const WEEKEND = nextWeekendDates();

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>('plan');
  const [city, setCity] = useState('上海');
  const [area, setArea] = useState('当前位置附近');
  const [date, setDate] = useState(WEEKEND.saturday);
  const [budget, setBudget] = useState(200);
  const [interests, setInterests] = useState<string[]>(['展览', '市集']);
  const [routes, setRoutes] = useState<IRoute[]>([]);
  const [planResult, setPlanResult] = useState<IPlanResponse | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<IRoute | null>(null);
  const [locating, setLocating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const locate = () => {
    setLocating(true);
    window.setTimeout(() => {
      setCity('上海');
      setArea('静安');
      setLocating(false);
    }, 650);
  };

  const toggleInterest = (interest: string) => {
    setInterests((current) => current.includes(interest)
      ? current.filter((item) => item !== interest)
      : [...current, interest]);
  };

  const generatePlan = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await createAiPlan({ city, area, date, budget, interests, partySize: 2 });
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
        <h1 className="mt-4 text-4xl font-black tracking-tight">这次周末，真的走过了</h1>
        <p className="mt-3 max-w-md text-muted-foreground">已根据你的打卡、跳过和临时地点生成实际路线。计划没有完成也没关系，真实经历才是攻略。</p>
        <div className="mt-7 w-full rounded-3xl border bg-card p-5 text-left shadow-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-primary">我的路线攻略</div>
          <div className="mt-2 text-xl font-black">{selectedRoute?.title || '城市周末实录'}</div>
          <p className="mt-2 text-sm text-muted-foreground">来自实际打卡记录 · 可继续编辑后分享</p>
        </div>
        <div className="mt-6 flex gap-3"><Button variant="outline" onClick={() => setScreen('journey')}>继续编辑</Button><Button onClick={() => setScreen('plan')}>规划新周末</Button></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MapPin size={19} /></div><span className="text-lg font-black tracking-tight">周末去野</span></div>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm"><span className="h-2 w-2 rounded-full bg-primary" />真实地点 · AI 路线</div>
      </header>

      {screen === 'plan' && (
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.06fr_.94fr] lg:items-center lg:pt-14">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"><Sparkles size={15} />天气与地点先查证，再由 AI 排路线</div>
            <h1 className="max-w-2xl text-5xl font-black leading-[1.03] tracking-[-0.055em] sm:text-7xl">天气、预算、兴趣，拼成一条刚好的路线。</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">高德提供真实天气和地点候选，AI 只在真实候选中筛选、排序并解释推荐理由。</p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-sm"><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">实时</b><span className="text-muted-foreground">高德天气</span></div><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">真实</b><span className="text-muted-foreground">高德地点</span></div><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">AI</b><span className="text-muted-foreground">路线生成</span></div></div>
          </div>

          <div className="relative rounded-[34px] border bg-card p-5 shadow-xl shadow-primary/10 sm:p-7">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-accent/70 blur-3xl" />
            <div className="relative">
              <div className="mb-6 flex items-center justify-between"><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Plan your weekend</div><h2 className="mt-1 text-2xl font-black">这周末想去哪？</h2></div><CloudSun className="text-primary" size={30} /></div>
              <div className="space-y-5">
                <div><label className="mb-2 block text-sm font-bold">出发城市</label><div className="grid grid-cols-[1fr_auto] gap-2"><Input aria-label="出发城市" value={city} onChange={(event) => setCity(event.target.value)} /><Button variant="outline" onClick={locate}><LocateFixed size={16} />{locating ? '定位中' : '定位'}</Button></div><p className="mt-2 text-xs text-muted-foreground">当前区域：{area} · 可手动修改城市</p></div>
                <div><label className="mb-2 block text-sm font-bold">想去哪里玩</label><div className="grid grid-cols-3 gap-2">{['当前位置附近', '静安', '徐汇滨江'].map((item) => <button key={item} onClick={() => setArea(item)} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${area === item ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>{item}</button>)}</div></div>
                <div><label className="mb-2 block text-sm font-bold">选择时间</label><div className="grid grid-cols-2 gap-2"><button onClick={() => setDate(WEEKEND.saturday)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${date === WEEKEND.saturday ? 'border-primary bg-primary/5 text-primary' : ''}`}><CalendarDays size={16} />本周六</button><button onClick={() => setDate(WEEKEND.sunday)} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${date === WEEKEND.sunday ? 'border-primary bg-primary/5 text-primary' : ''}`}>本周日</button></div><p className="mt-2 text-xs text-muted-foreground">将查询 {date} 的天气预报</p></div>
                <div><label className="mb-2 block text-sm font-bold">兴趣偏好</label><div className="flex flex-wrap gap-2">{INTERESTS.map((interest) => <button key={interest} onClick={() => toggleInterest(interest)} className={`rounded-full border px-3 py-2 text-sm ${interests.includes(interest) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'}`}>{interest}</button>)}</div></div>
                <div><label className="mb-2 block text-sm font-bold">人均预算</label><div className="flex items-center gap-3"><Input aria-label="人均预算" type="number" min="0" max="5000" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /><span className="shrink-0 text-sm font-semibold">元 / 人</span></div></div>
                <div className="rounded-2xl bg-secondary p-4"><div className="flex items-center gap-3"><CloudSun className="text-primary" /><div><div className="font-bold">生成时获取真实天气</div><div className="text-xs text-muted-foreground">地点与天气查询失败时会明确提示，不使用模拟结果顶替</div></div></div></div>
                {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
                <Button size="lg" className="w-full rounded-xl" disabled={generating || interests.length === 0} onClick={() => void generatePlan()}><Search size={18} />{generating ? '正在查天气、地点并生成路线…' : '用真实数据生成 AI 路线'}</Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {screen === 'routes' && planResult && (
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
          <button className="mb-5 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={() => setScreen('plan')}>← 修改出行条件</button>
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">数据来源：{planResult.sources.join(' · ')}</div><h2 className="mt-2 text-4xl font-black tracking-tight">AI 为你拼好 {routes.length} 种周末</h2><p className="mt-2 text-muted-foreground">{city} · {area} · 计划 {date} · 参考天气 {planResult.weather.date} {planResult.weather.condition} · {planResult.weather.tempLow}–{planResult.weather.tempHigh}℃</p>{planResult.weather.forecastStatus === 'out_of_range' && <p className="mt-2 max-w-2xl rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">{planResult.weather.note}</p>}</div><Badge variant="secondary" className="w-fit">{planResult.poiCount} 个真实地点候选</Badge></div>
          <div className="grid gap-5 lg:grid-cols-3">{routes.map((route, index) => <RouteCard key={route.id} route={route} featured={index === 0} onChoose={chooseRoute} />)}</div>
        </section>
      )}
    </main>
  );
}
