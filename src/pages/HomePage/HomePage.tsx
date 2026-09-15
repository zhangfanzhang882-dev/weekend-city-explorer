import { useState } from 'react';
import { CalendarDays, CheckCircle2, CloudSun, LocateFixed, MapPin, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import JourneyPanel from '@/components/JourneyPanel';
import RouteCard from '@/components/RouteCard';
import { ROUTES, type IRoute } from '@/data/trips';

type Screen = 'plan' | 'routes' | 'journey' | 'published';

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>('plan');
  const [city, setCity] = useState('上海');
  const [area, setArea] = useState('当前位置附近');
  const [selectedRoute, setSelectedRoute] = useState<IRoute | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = () => {
    setLocating(true);
    window.setTimeout(() => {
      setCity('上海');
      setArea('静安区附近');
      setLocating(false);
    }, 650);
  };

  const chooseRoute = (route: IRoute) => {
    setSelectedRoute(route);
    setScreen('journey');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (screen === 'journey' && selectedRoute) return <JourneyPanel route={selectedRoute} onBack={() => setScreen('routes')} onPublished={() => setScreen('published')} />;

  if (screen === 'published') {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground"><CheckCircle2 size={38} /></div>
        <Badge variant="secondary">路线发布成功</Badge>
        <h1 className="mt-4 text-4xl font-black tracking-tight">这次周末，真的走过了</h1>
        <p className="mt-3 max-w-md text-muted-foreground">已根据你的打卡、跳过和临时地点生成实际路线。计划没有完成也没关系，真实经历才是攻略。</p>
        <div className="mt-7 w-full rounded-3xl border bg-card p-5 text-left shadow-sm"><div className="text-xs font-bold uppercase tracking-widest text-primary">我的路线攻略</div><div className="mt-2 text-xl font-black">上海阴天散步实录</div><p className="mt-2 text-sm text-muted-foreground">3 个实际地点 · 约 5 小时 · 人均 ¥106</p></div>
        <div className="mt-6 flex gap-3"><Button variant="outline" onClick={() => setScreen('journey')}>继续编辑</Button><Button onClick={() => setScreen('plan')}>规划新周末</Button></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MapPin size={19} /></div><span className="text-lg font-black tracking-tight">周末去野</span></div>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm"><span className="h-2 w-2 rounded-full bg-primary" />演示数据</div>
      </header>

      {screen === 'plan' && (
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.06fr_.94fr] lg:items-center lg:pt-14">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"><Sparkles size={15} />你的周末，不必从搜索开始</div>
            <h1 className="max-w-2xl text-5xl font-black leading-[1.03] tracking-[-0.055em] sm:text-7xl">天气、预算、兴趣，拼成一条刚好的路线。</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">从分散的信息里找灵感，再把它们排成真正走得完的一天。计划可以改变，体验不会浪费。</p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-sm"><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">3 源</b><span className="text-muted-foreground">灵感聚合</span></div><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">3 条</b><span className="text-muted-foreground">路线预览</span></div><div className="rounded-2xl border bg-card p-3"><b className="block text-xl">随时</b><span className="text-muted-foreground">调整计划</span></div></div>
          </div>

          <div className="relative rounded-[34px] border bg-card p-5 shadow-xl shadow-primary/10 sm:p-7">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-accent/70 blur-3xl" />
            <div className="relative">
              <div className="mb-6 flex items-center justify-between"><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Plan your weekend</div><h2 className="mt-1 text-2xl font-black">这周末想去哪？</h2></div><CloudSun className="text-primary" size={30} /></div>
              <div className="space-y-5">
                <div><label className="mb-2 block text-sm font-bold">出发城市</label><div className="grid grid-cols-[1fr_auto] gap-2"><Input value={city} onChange={(event) => setCity(event.target.value)} /><Button variant="outline" onClick={locate}><LocateFixed size={16} />{locating ? '定位中' : '定位'}</Button></div><p className="mt-2 text-xs text-muted-foreground">当前区域：{area} · 可手动修改城市</p></div>
                <div><label className="mb-2 block text-sm font-bold">想去哪里玩</label><div className="grid grid-cols-3 gap-2">{['当前位置附近', '浦西漫游', '沿江路线'].map((item) => <button key={item} onClick={() => setArea(item)} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${area === item ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>{item}</button>)}</div></div>
                <div><label className="mb-2 block text-sm font-bold">选择时间</label><div className="grid grid-cols-2 gap-2"><button className="flex items-center justify-center gap-2 rounded-xl border border-primary bg-primary/5 px-3 py-3 text-sm font-semibold text-primary"><CalendarDays size={16} />本周六 10:00</button><button className="rounded-xl border px-3 py-3 text-sm font-semibold">本周日 13:00</button></div></div>
                <div className="rounded-2xl bg-secondary p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><CloudSun className="text-primary" /><div><div className="font-bold">21–26℃ · 多云转阵雨</div><div className="text-xs text-muted-foreground">16:00 后降雨概率升高</div></div></div><Badge variant="outline">天气友好推荐</Badge></div></div>
                <Button size="lg" className="w-full rounded-xl" onClick={() => setScreen('routes')}><Search size={18} />聚合灵感，生成路线</Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {screen === 'routes' && (
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
          <button className="mb-5 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={() => setScreen('plan')}>← 修改出行条件</button>
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">正在参考 小红书 · 高德 · 美团</div><h2 className="mt-2 text-4xl font-black tracking-tight">为你拼好 3 种周末</h2><p className="mt-2 text-muted-foreground">{city} · {area} · 本周六 · 多云转阵雨</p></div><Badge variant="secondary" className="w-fit">高保真模拟结果</Badge></div>
          <div className="grid gap-5 lg:grid-cols-3">{ROUTES.map((route, index) => <RouteCard key={route.id} route={route} featured={index === 0} onChoose={chooseRoute} />)}</div>
        </section>
      )}
    </main>
  );
}
