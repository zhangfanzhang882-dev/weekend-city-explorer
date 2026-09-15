import { useState } from 'react';
import { ArrowRight, Clock3, ImageOff, MapPin, Route, Star, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { IRoute, IStop } from '@/data/trips';

interface RouteCardProps {
  route: IRoute;
  featured?: boolean;
  onChoose: (route: IRoute) => void;
}

/**
 * 封面图。
 * 高德实景照片竖横混杂（375x500、712x931、500x375）。此前用 3.4:1 横条承载，
 * 竖图需放大 1.4 倍再截掉约 2/3 高度，既模糊又看不到主体。
 * 现改为 4:3 画幅；同时优先选用接近该画幅的照片，把裁切量降到最低。
 */
function RouteCover({ route }: { route: IRoute }) {
  const [failedSrc, setFailedSrc] = useState<string[]>([]);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const TARGET = 4 / 3;

  const available = route.stops
    .flatMap((stop) => stop.photos ?? [])
    .filter((url) => !failedSrc.includes(url));

  // 已知宽高比的照片里挑最接近 4:3 的；未测得尺寸前用第一张，避免首屏空白
  const measured = available.filter((url) => ratios[url]);
  const cover = measured.length > 0
    ? measured.reduce((best, url) =>
      Math.abs(ratios[url] - TARGET) < Math.abs(ratios[best] - TARGET) ? url : best)
    : available[0];

  if (!cover) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-secondary">
        <span className="flex flex-col items-center gap-1 text-accent-foreground/60">
          <ImageOff size={26} />
          <span className="text-xs">暂无实景图</span>
        </span>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted">
      {/* 预加载其余照片以测得宽高比，用于挑选最合适的封面 */}
      <div className="hidden">
        {available.filter((url) => url !== cover && !ratios[url]).map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalHeight > 0) {
                setRatios((prev) => ({ ...prev, [url]: img.naturalWidth / img.naturalHeight }));
              }
            }}
            onError={() => setFailedSrc((prev) => [...prev, url])}
          />
        ))}
      </div>
      <img
        src={cover}
        alt={`${route.title}实景`}
        loading="lazy"
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalHeight > 0 && !ratios[cover]) {
            setRatios((prev) => ({ ...prev, [cover]: img.naturalWidth / img.naturalHeight }));
          }
        }}
        onError={() => setFailedSrc((prev) => [...prev, cover])}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />
    </div>
  );
}

/** 站点缩略图：正方形小图，竖图裁切量可接受；无图时用序号占位 */
function StopThumb({ stop, index }: { stop: IStop; index: number }) {
  const [failed, setFailed] = useState(false);
  const photo = stop.photos?.[0];
  if (!photo || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-bold text-secondary-foreground">
        {index + 1}
      </div>
    );
  }
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
      <img
        src={photo}
        alt={stop.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      <span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-br-lg bg-foreground/75 text-[10px] font-bold text-background">
        {index + 1}
      </span>
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
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[28px] border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="relative p-3 pb-0">
        <RouteCover route={route} />
        {featured && (
          <div className="absolute right-5 top-5 z-10 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
            最适合你
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5 pt-4">
        {/* 标签行固定高度，避免有无 accent 造成三卡错位 */}
        <div className="mb-2 h-[22px]">
          {route.accent && <Badge variant="secondary" className="w-fit">{route.accent}</Badge>}
        </div>
        {/* 标题与副标题限定行数，保证三张卡对应区块高度一致 */}
        <h3 className="line-clamp-1 text-2xl font-black leading-tight tracking-tight">{route.title}</h3>
        <p className="mt-1.5 line-clamp-2 min-h-[48px] text-sm leading-6 text-muted-foreground">{route.subtitle}</p>

        <p className="mt-3 line-clamp-2 min-h-[44px] rounded-xl bg-secondary px-3 py-2 text-xs leading-5 text-muted-foreground">
          {route.weatherFit || '未提供天气适配说明'}
        </p>

        <div className="mt-4 flex min-h-[52px] flex-wrap gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5"><Clock3 size={15} />{route.totalTime}</span>
          <span className="flex items-center gap-1.5"><Users size={15} />2–4 人</span>
          {route.totalKm !== undefined && route.totalKm > 0 && (
            <span className="flex items-center gap-1.5" title="站点间直线距离总和">
              <Route size={15} />全程约 {route.totalKm} km
            </span>
          )}
          {hasAnyCost
            ? <span className="font-semibold text-primary">{costPartial ? `已知 ¥${route.budget}/人起` : `约 ¥${route.budget}/人`}</span>
            : <span className="text-muted-foreground">门票价格暂无数据</span>}
        </div>

        {/* flex-1 撑开剩余空间，把按钮压到卡片底部，三张卡按钮同一水平线 */}
        <div className="mt-4 flex-1 space-y-2.5">
          {route.stops.map((stop, index) => (
            <div key={stop.id}>
              {index > 0 && stop.legKm !== null && stop.legKm !== undefined && (
                <div className="ml-7 flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
                  <span className="h-3 w-px bg-border" />
                  <span>约 {stop.legKm} km</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <StopThumb stop={stop} index={index} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold" title={stop.name}>{stop.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin size={11} />{stop.area}</span>
                    <span>·</span>
                    <span>{stop.duration}</span>
                    {stop.rating ? (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-0.5"><Star size={11} className="fill-warning text-warning" />{stop.rating}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button className="mt-5 w-full rounded-xl" onClick={() => onChoose(route)}>
          预览这条路线 <ArrowRight size={16} />
        </Button>
      </div>
    </article>
  );
}
