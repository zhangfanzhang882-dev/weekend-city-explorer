import { useState } from 'react';
import { ArrowRight, Clock3, MapPin, Sparkles, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { IRoute } from '@/data/trips';

interface RouteCardProps {
  route: IRoute;
  featured?: boolean;
  onChoose: (route: IRoute) => void;
}

/** 路线封面：取首个有实景照片的站点，失败则降级为渐变底 */
function RouteCover({ route }: { route: IRoute }) {
  const [failed, setFailed] = useState(false);
  const cover = route.stops.find((stop) => stop.photos?.length)?.photos?.[0];
  if (!cover || failed) {
    return (
      <div className="mb-4 flex h-40 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-secondary">
        <Sparkles size={30} className="text-accent-foreground/60" />
      </div>
    );
  }
  return (
    <div className="mb-4 h-40 overflow-hidden rounded-2xl">
      <img
        src={cover}
        alt={route.title}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />
    </div>
  );
}

export default function RouteCard({ route, featured, onChoose }: RouteCardProps) {
  // 高德多数场馆无价格数据，全部缺失时不能显示“约 ¥0/人”，否则会被误读为免费。
  const hasAnyCost = route.budgetKnownCount === undefined
    ? route.budget > 0
    : route.budgetKnownCount > 0;
  const costPartial = route.budgetKnownCount !== undefined
    && route.budgetTotalCount !== undefined
    && route.budgetKnownCount > 0
    && route.budgetKnownCount < route.budgetTotalCount;

  return (
    <article className={`group relative overflow-hidden rounded-[28px] border bg-card p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg ${featured ? 'border-primary/45' : ''}`}>
      {featured && <div className="absolute right-4 top-4 z-10 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">最适合你</div>}
      <RouteCover route={route} />
      {route.accent && <Badge variant="secondary" className="mb-3">{route.accent}</Badge>}
      <h3 className="text-2xl font-black tracking-tight">{route.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{route.subtitle}</p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <span className="flex items-center gap-1.5"><Clock3 size={15} />{route.totalTime}</span>
        <span className="flex items-center gap-1.5"><Users size={15} />2–4 人</span>
        {hasAnyCost
          ? <span className="font-semibold text-primary">{costPartial ? `已知 ¥${route.budget}/人起` : `约 ¥${route.budget}/人`}</span>
          : <span className="text-muted-foreground">门票价格暂无数据</span>}
      </div>
      <div className="my-5 space-y-0">
        {route.stops.map((stop, index) => (
          <div className="relative flex gap-3 pb-4 last:pb-0" key={stop.id}>
            {index < route.stops.length - 1 && <div className="absolute left-[11px] top-6 h-full w-px bg-border" />}
            <div className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground">{index + 1}</div>
            <div>
              <div className="font-semibold">{stop.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><MapPin size={12} />{stop.area}<span>·</span>{stop.duration}</div>
            </div>
          </div>
        ))}
      </div>
      <Button className="w-full rounded-xl" onClick={() => onChoose(route)}>预览这条路线 <ArrowRight size={16} /></Button>
    </article>
  );
}
