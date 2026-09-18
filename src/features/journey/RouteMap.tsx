import { useMemo } from 'react';
import type { IStop } from '@/data/trips';

interface RouteMapProps {
  stops: IStop[];
  /** 当前高亮的站点 id */
  activeId?: string;
  /** 已选住宿：作为独立标记参与投影，不接入折线顺序 */
  lodging?: { name: string; location?: string } | null;
  className?: string;
}

interface Placed {
  stop: IStop;
  index: number;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  side: 'left' | 'right';
  color: string;
}

/**
 * 站点配色：按顺序由浅到深，让用户一眼分清先后，而不必去读圆点里的数字。
 * 取值来自主题绿色系的不同明度，保持整体视觉统一。
 */
const STOP_COLORS = ['#7cc4a4', '#4da881', '#2d8a63', '#1f6b4c', '#154d37', '#0d3526'];

/** 相邻圆点的最小间距，低于此值会强制拉开，避免近距离站点完全重叠 */
const MIN_GAP = 15;

/**
 * 路线位置示意图。
 *
 * 用站点真实经纬度投影后绘制，不依赖地图 SDK（高德 JS 地图需另一种 Key）。
 *
 * 关于「示意」的两层含义：
 * 1. 方位与相对远近来自真实坐标，保持可信；
 * 2. 但纯等比投影下，相距 0.1 km 的两点会完全重叠、无法阅读，
 *    因此在保持原有方位顺序的前提下，对过近的点做最小间距推开。
 *    真实距离始终以连线上的数字为准，图形只负责表达"谁在哪个方向"。
 */
export default function RouteMap({ stops, activeId, lodging, className }: RouteMapProps) {
  const layout = useMemo(() => {
    const points = stops
      .map((stop, index) => {
        const [lng, lat] = (stop.location || '').split(',').map(Number);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return { stop, index, lng, lat };
      })
      .filter(Boolean) as Array<{ stop: IStop; index: number; lng: number; lat: number }>;

    if (points.length < 2) return null;

    // 住宿只参与坐标范围与绘制，不进入折线顺序（它不是"第几站"）
    const [lodgeLng, lodgeLat] = (lodging?.location || '').split(',').map(Number);
    const lodgePoint = lodging && Number.isFinite(lodgeLng) && Number.isFinite(lodgeLat)
      ? { name: lodging.name, lng: lodgeLng, lat: lodgeLat }
      : null;

    const lngs = [...points.map((p) => p.lng), ...(lodgePoint ? [lodgePoint.lng] : [])];
    const lats = [...points.map((p) => p.lat), ...(lodgePoint ? [lodgePoint.lat] : [])];
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180);
    const lngSpan = Math.max((maxLng - minLng) * cosLat, 1e-6);
    const latSpan = Math.max(maxLat - minLat, 1e-6);

    const width = 132;
    const height = 72;
    // 左右标签带；点绘制在中间区域，引出线因此不会过长
    const labelBand = 38;
    const plotLeft = labelBand;
    const plotRight = width - labelBand;
    const padY = 11;
    const scale = Math.min((plotRight - plotLeft) / lngSpan, (height - padY * 2) / latSpan);
    const drawnW = lngSpan * scale;
    const drawnH = latSpan * scale;
    const offsetX = plotLeft + (plotRight - plotLeft - drawnW) / 2;
    const offsetY = padY + (height - padY * 2 - drawnH) / 2;

    const raw = points.map((p) => ({
      stop: p.stop,
      index: p.index,
      x: offsetX + (p.lng - minLng) * cosLat * scale,
      y: offsetY + (maxLat - p.lat) * scale,
    }));

    // 推开重叠：按行程顺序逐个检查，与已放置的点太近时沿远离方向平移。
    // 只调整绘制位置，不改变真实距离标注。
    const placedPoints = raw.map((item) => ({ ...item }));
    for (let i = 1; i < placedPoints.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const a = placedPoints[j];
        const b = placedPoints[i];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= MIN_GAP) continue;
        // 完全重合时给一个默认方向，避免除零
        if (dist < 0.01) {
          dx = 0.6;
          dy = -0.8;
          dist = 1;
        }
        const push = (MIN_GAP - dist) / dist;
        b.x += dx * push;
        b.y += dy * push;
      }
    }

    // 平移后可能越界，整体收回绘制区内
    const clampGroup = (values: number[], min: number, max: number) => {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (lo < min) return min - lo;      // 整体右/下移
      if (hi > max) return max - hi;      // 整体左/上移
      return 0;
    };
    const dxFix = clampGroup(placedPoints.map((p) => p.x), plotLeft, plotRight);
    const dyFix = clampGroup(placedPoints.map((p) => p.y), padY, height - padY);
    placedPoints.forEach((p) => {
      p.x += dxFix;
      p.y += dyFix;
    });

    // 标签分左右两侧，并按纵向均分槽位，保证彼此不重叠
    const midX = (plotLeft + plotRight) / 2;
    const leftGroup = placedPoints.filter((p) => p.x <= midX).sort((a, b) => a.y - b.y);
    const rightGroup = placedPoints.filter((p) => p.x > midX).sort((a, b) => a.y - b.y);

    const assign = (group: typeof placedPoints, side: 'left' | 'right'): Placed[] => {
      const count = group.length;
      if (count === 0) return [];
      const slotTop = 9;
      const slotBottom = height - 7;
      const step = count === 1 ? 0 : (slotBottom - slotTop) / (count - 1);
      return group.map((p, i) => ({
        ...p,
        side,
        color: STOP_COLORS[p.index % STOP_COLORS.length],
        labelX: side === 'left' ? labelBand - 3 : width - labelBand + 3,
        labelY: count === 1 ? p.y : slotTop + step * i,
      }));
    };

    const placed = [...assign(leftGroup, 'left'), ...assign(rightGroup, 'right')]
      .sort((a, b) => a.index - b.index);

    // 住宿单独投影：用与站点相同的变换，保证相对位置真实
    const lodgeXY = lodgePoint
      ? {
        name: lodgePoint.name,
        x: offsetX + (lodgePoint.lng - minLng) * cosLat * scale,
        y: offsetY + (maxLat - lodgePoint.lat) * scale,
      }
      : null;

    return { placed, width, height, lodgeXY };
  }, [stops, lodging]);

  if (!layout) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-dashed bg-muted/40 p-6 text-xs text-muted-foreground ${className || ''}`}>
        坐标数据不足，无法绘制位置示意图
      </div>
    );
  }

  const { placed, width, height } = layout;
  const ordered = [...placed].sort((a, b) => a.index - b.index);
  const routePath = ordered.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return (
    <div className={`rounded-2xl border bg-card p-3 ${className || ''}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-bold">位置关系示意图</span>
        <span className="text-[10px] text-muted-foreground">方位来自真实坐标 · 距离见连线数字 · 非导航地图</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`路线位置示意：${ordered.map((p) => p.stop.name).join(' 到 ')}`}
      >
        <defs>
          <pattern id="route-grid" width="11" height="11" patternUnits="userSpaceOnUse">
            <path d="M11 0 L0 0 0 11" fill="none" stroke="currentColor" strokeWidth="0.18" className="text-border" />
          </pattern>
          <marker id="route-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,1 L8,5 L0,9 z" className="fill-primary/70" />
          </marker>
        </defs>
        <rect width={width} height={height} rx="2" fill="url(#route-grid)" />

        {/* 行程连线：加箭头标明前进方向 */}
        <path
          d={routePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
          strokeDasharray="2.6 1.8"
          markerEnd="url(#route-arrow)"
          className="text-primary/60"
        />

        {/* 相邻站点真实距离，沿线段法线偏移避免被圆点压住 */}
        {ordered.slice(1).map((p, i) => {
          const prev = ordered[i];
          const km = p.stop.legKm;
          if (km === null || km === undefined) return null;
          const midPointX = (prev.x + p.x) / 2;
          const midPointY = (prev.y + p.y) / 2;
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          // 短线段时圆点几乎盖满整段，需要更大法线偏移才能露出文字
          const offset = len < 20 ? 6.4 : 4.2;
          return (
            <text
              x={midPointX + (-dy / len) * offset}
              y={midPointY + (dx / len) * offset}
              key={`leg-${p.stop.id}`}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              style={{ fontSize: '2.9px', paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: '1.5px', strokeLinejoin: 'round' }}
            >
              {km} km
            </text>
          );
        })}

        {/* 引出折线与外侧标签 */}
        {placed.map((p) => {
          const active = activeId === p.stop.id;
          const elbowX = p.side === 'left' ? p.labelX + 6 : p.labelX - 6;
          const leaderPath = `M${p.x.toFixed(2)},${p.y.toFixed(2)} L${elbowX.toFixed(2)},${p.labelY.toFixed(2)} L${p.labelX.toFixed(2)},${p.labelY.toFixed(2)}`;
          // 标签带宽 38、字号 3，扣掉序号与色块后约容纳 8 个中文字符
          const clean = p.stop.name.replace(/[（(][^）)]*[）)]/g, '').trim() || p.stop.name;
          const label = clean.length > 8 ? `${clean.slice(0, 8)}…` : clean;
          return (
            <g key={`leader-${p.stop.id}`}>
              <path d={leaderPath} fill="none" stroke={active ? p.color : 'currentColor'} strokeWidth="0.3" className={active ? '' : 'text-border'} />
              {/* 标签前的小色块，与圆点同色，建立视觉对应 */}
              <circle cx={p.labelX} cy={p.labelY} r="1.1" fill={p.color} />
              <text
                x={p.side === 'left' ? p.labelX - 2.4 : p.labelX + 2.4}
                y={p.labelY}
                textAnchor={p.side === 'left' ? 'end' : 'start'}
                dominantBaseline="middle"
                className={active ? 'fill-foreground font-bold' : 'fill-foreground/75'}
                style={{ fontSize: '3px' }}
              >
                {p.index + 1}. {label}
                <title>{p.stop.name}</title>
              </text>
            </g>
          );
        })}

        {/* 站点标记：颜色按顺序渐深，直观表达先后 */}
        {placed.map((p) => {
          const active = activeId === p.stop.id;
          return (
            <g key={p.stop.id}>
              {active && <circle cx={p.x} cy={p.y} r="4.6" fill={p.color} opacity="0.22" />}
              <circle cx={p.x} cy={p.y} r={active ? 3.3 : 2.9} fill={p.color} stroke="var(--card)" strokeWidth="0.9" />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="font-bold"
                fill="#fff"
                style={{ fontSize: '3px' }}
              >
                {p.index + 1}
              </text>
            </g>
          );
        })}

        {/* 住宿：菱形标记 + 虚线引导，与编号站点明确区分 */}
        {layout.lodgeXY && (
          <g>
            <rect
              x={layout.lodgeXY.x - 2.6}
              y={layout.lodgeXY.y - 2.6}
              width={5.2}
              height={5.2}
              rx={1}
              fill="#f5f2ea"
              stroke="#b45309"
              strokeWidth={0.9}
              transform={`rotate(45 ${layout.lodgeXY.x} ${layout.lodgeXY.y})`}
            />
            <text
              x={layout.lodgeXY.x}
              y={layout.lodgeXY.y + 6.6}
              textAnchor="middle"
              fill="#b45309"
              className="font-bold"
              style={{ fontSize: '2.9px' }}
            >
              住宿
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
