import { useMemo } from 'react';
import type { IStop } from '@/data/trips';

interface RouteMapProps {
  stops: IStop[];
  /** 当前高亮的站点 id */
  activeId?: string;
  className?: string;
}

interface Placed {
  stop: IStop;
  index: number;
  x: number;
  y: number;
  /** 标签锚点：引出线终点 */
  labelX: number;
  labelY: number;
  /** 标签在点的左侧还是右侧，决定文字对齐方向 */
  side: 'left' | 'right';
}

/**
 * 路线位置示意图。
 *
 * 用站点真实经纬度做等距投影后绘制，不依赖地图 SDK：
 * 高德 JS 地图需要另一个「Web端(JS API)」Key 并强制配置安全密钥，
 * 与当前使用的「Web 服务」Key 不通用，因此这里用零依赖方案表达空间关系。
 *
 * 标签采用「点 + 引出折线」：地点之间可能只隔 0.1 km，名称直接贴在点旁会互相压盖，
 * 因此把标签统一拉到画布左右两侧，用折线连回各自的点。
 */
export default function RouteMap({ stops, activeId, className }: RouteMapProps) {
  const layout = useMemo(() => {
    const points = stops
      .map((stop, index) => {
        const [lng, lat] = (stop.location || '').split(',').map(Number);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return { stop, index, lng, lat };
      })
      .filter(Boolean) as Array<{ stop: IStop; index: number; lng: number; lat: number }>;

    if (points.length < 2) return null;

    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    // 纬度方向按 cos(lat) 校正经度跨度，避免高纬度被横向拉伸
    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180);
    const lngSpan = Math.max((maxLng - minLng) * cosLat, 1e-6);
    const latSpan = Math.max(maxLat - minLat, 1e-6);

    // 画布加宽，给两侧标签留足空间：实测 100 宽时长地名会被容器裁切
    const width = 150;
    const height = 62;
    // 左右标签带宽度，点只画在中间区域
    const labelBand = 46;
    const padY = 9;
    const plotLeft = labelBand;
    const plotRight = width - labelBand;
    const scale = Math.min((plotRight - plotLeft) / lngSpan, (height - padY * 2) / latSpan);
    const drawnW = lngSpan * scale;
    const drawnH = latSpan * scale;
    const offsetX = plotLeft + (plotRight - plotLeft - drawnW) / 2;
    const offsetY = padY + (height - padY * 2 - drawnH) / 2;

    const base = points.map((p) => ({
      stop: p.stop,
      index: p.index,
      x: offsetX + (p.lng - minLng) * cosLat * scale,
      // SVG y 轴向下，纬度越大越靠北，需翻转
      y: offsetY + (maxLat - p.lat) * scale,
    }));

    // 标签分配到左右两侧：按 x 排序，靠左的走左侧、靠右的走右侧，
    // 再按各侧纵向均分，保证标签之间始终有固定间距、不重叠。
    const midX = (plotLeft + plotRight) / 2;
    const leftGroup = base.filter((p) => p.x <= midX).sort((a, b) => a.y - b.y);
    const rightGroup = base.filter((p) => p.x > midX).sort((a, b) => a.y - b.y);

    const assign = (group: typeof base, side: 'left' | 'right'): Placed[] => {
      const count = group.length;
      if (count === 0) return [];
      const slotTop = 8;
      const slotBottom = height - 6;
      const step = count === 1 ? 0 : (slotBottom - slotTop) / (count - 1);
      return group.map((p, i) => ({
        ...p,
        side,
        labelX: side === 'left' ? labelBand - 4 : width - labelBand + 4,
        labelY: count === 1 ? p.y : slotTop + step * i,
      }));
    };

    const placed = [...assign(leftGroup, 'left'), ...assign(rightGroup, 'right')]
      .sort((a, b) => a.index - b.index);

    return { placed, width, height };
  }, [stops]);

  if (!layout) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-dashed bg-muted/40 p-6 text-xs text-muted-foreground ${className || ''}`}>
        坐标数据不足，无法绘制位置示意图
      </div>
    );
  }

  const { placed, width, height } = layout;
  // 按行程顺序连线
  const ordered = [...placed].sort((a, b) => a.index - b.index);
  const routePath = ordered.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return (
    <div className={`rounded-2xl border bg-card p-3 ${className || ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold">位置关系示意图</span>
        <span className="text-[10px] text-muted-foreground">按真实坐标等比投影 · 非导航地图</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`路线位置示意：${ordered.map((p) => p.stop.name).join(' 到 ')}`}
      >
        <defs>
          <pattern id="route-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0 L0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.2" className="text-border" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#route-grid)" />

        {/* 行程连线 */}
        <path d={routePath} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2.4 1.6" className="text-primary/50" />

        {/* 相邻站点间距。沿线段法线偏移，避免与站点标记重叠（实测会被圆点压住） */}
        {ordered.slice(1).map((p, i) => {
          const prev = ordered[i];
          const km = p.stop.legKm;
          if (km === null || km === undefined) return null;
          const midX = (prev.x + p.x) / 2;
          const midY = (prev.y + p.y) / 2;
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          // 短线段（两点相距很近）时圆点几乎盖满整段，需要更大的法线偏移才能露出文字
          const offset = len < 12 ? 6.2 : 3.6;
          const nx = (-dy / len) * offset;
          const ny = (dx / len) * offset;
          return (
            <text
              key={`leg-${p.stop.id}`}
              x={midX + nx}
              y={midY + ny}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              style={{ fontSize: '3.1px', paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: '1.4px', strokeLinejoin: 'round' }}
            >
              {km} km
            </text>
          );
        })}

        {/* 引出折线 + 外侧标签 */}
        {placed.map((p) => {
          const active = activeId === p.stop.id;
          // 折线：从点水平走一小段，再斜向标签，最后水平接入文字
          const elbowX = p.side === 'left' ? p.labelX + 5 : p.labelX - 5;
          const leaderPath = `M${p.x.toFixed(2)},${p.y.toFixed(2)} L${elbowX.toFixed(2)},${p.labelY.toFixed(2)} L${p.labelX.toFixed(2)},${p.labelY.toFixed(2)}`;
          // 标签带宽 46，字号 3.4，扣掉序号与间距后约可容纳 10 个中文字符。
          // 超长地名（如"上海大自然野生昆虫馆(东方明珠…"）会溢出 viewBox，需截断。
          const clean = p.stop.name.replace(/[（(][^）)]*[）)]/g, '').trim() || p.stop.name;
          const label = clean.length > 10 ? `${clean.slice(0, 10)}…` : clean;
          return (
            <g key={`leader-${p.stop.id}`}>
              <path
                d={leaderPath}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.35"
                className={active ? 'text-primary' : 'text-border'}
              />
              <circle cx={p.labelX} cy={p.labelY} r="0.7" className={active ? 'fill-primary' : 'fill-muted-foreground/60'} />
              <text
                x={p.side === 'left' ? p.labelX - 2 : p.labelX + 2}
                y={p.labelY}
                textAnchor={p.side === 'left' ? 'end' : 'start'}
                dominantBaseline="middle"
                className={active ? 'fill-foreground font-bold' : 'fill-muted-foreground'}
                style={{ fontSize: '3.4px' }}
              >
                {p.index + 1}. {label}
                <title>{p.stop.name}</title>
              </text>
            </g>
          );
        })}

        {/* 站点标记，画在引出线之上 */}
        {placed.map((p) => {
          const active = activeId === p.stop.id;
          return (
            <g key={p.stop.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={active ? 3.3 : 2.7}
                className={active ? 'fill-primary' : 'fill-primary/85'}
                stroke="var(--card)"
                strokeWidth="0.8"
              />
              <text
                x={p.x}
                y={p.y + 1.15}
                textAnchor="middle"
                className="fill-primary-foreground font-bold"
                style={{ fontSize: '3.1px' }}
              >
                {p.index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
