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
  /** 标签是否改放到标记上方，用于避免近距离站点标签重叠 */
  labelAbove: boolean;
}

/**
 * 路线示意图。
 *
 * 用站点真实经纬度做等距投影后绘制，不依赖地图 SDK：
 * 高德 JS 地图需要另一个「Web端(JS API)」Key 并强制配置安全密钥，
 * 与当前使用的「Web 服务」Key 不通用，因此这里先用零依赖方案表达空间关系。
 * 标注为“示意图”，不声称是精确地图，也不含底图与行政边界。
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
    const lngSpan = Math.max((maxLng - minLng) * Math.cos((midLat * Math.PI) / 180), 1e-6);
    const latSpan = Math.max(maxLat - minLat, 1e-6);

    const width = 100;
    const height = 62;
    const pad = 14;
    // 用同一比例尺映射两个方向，保持真实相对形状
    const scale = Math.min((width - pad * 2) / lngSpan, (height - pad * 2) / latSpan);
    const drawnW = lngSpan * scale;
    const drawnH = latSpan * scale;
    const offsetX = (width - drawnW) / 2;
    const offsetY = (height - drawnH) / 2;

    const placed: Placed[] = points.map((p) => ({
      stop: p.stop,
      index: p.index,
      x: offsetX + ((p.lng - minLng) * Math.cos((midLat * Math.PI) / 180)) * scale,
      // SVG y 轴向下，纬度越大越靠北，需翻转
      y: offsetY + (maxLat - p.lat) * scale,
      labelAbove: false,
    }));

    // 相距很近的站点标签会重叠（实测 0.1km 的两点标签完全叠在一起）。
    // 按 y 排序后逐个检查，与前一个太近就把标签翻到上方，避免互相遮挡。
    const sorted = [...placed].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const tooClose = Math.abs(cur.y - prev.y) < 7 && Math.abs(cur.x - prev.x) < 26;
      if (tooClose && !prev.labelAbove) cur.labelAbove = true;
    }

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
  const path = placed.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return (
    <div className={`rounded-2xl border bg-card p-3 ${className || ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold">位置关系示意图</span>
        <span className="text-[10px] text-muted-foreground">按真实坐标等比投影 · 非导航地图</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`路线位置示意：${placed.map((p) => p.stop.name).join(' 到 ')}`}
      >
        {/* 参考网格，帮助感知相对距离 */}
        <defs>
          <pattern id="route-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0 L0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.2" className="text-border" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#route-grid)" />

        {/* 连线：先画整体路径 */}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="0.9" strokeDasharray="2 1.4" className="text-primary/55" />

        {/* 每段中点标注距离 */}
        {placed.slice(1).map((p, i) => {
          const prev = placed[i];
          const km = p.stop.legKm;
          if (km === null || km === undefined) return null;
          return (
            <text
              key={`leg-${p.stop.id}`}
              x={(prev.x + p.x) / 2}
              y={(prev.y + p.y) / 2 - 1.2}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: '3px', paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: '1.1px', strokeLinejoin: 'round' }}
            >
              {km} km
            </text>
          );
        })}

        {/* 站点标记 */}
        {placed.map((p) => {
          const active = activeId === p.stop.id;
          return (
            <g key={p.stop.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={active ? 3.4 : 2.6}
                className={active ? 'fill-primary' : 'fill-primary/85'}
                stroke="white"
                strokeWidth="0.7"
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
              <text
                x={p.x}
                y={p.labelAbove ? p.y - 4.4 : p.y + 6.4}
                textAnchor="middle"
                className={active ? 'fill-foreground font-bold' : 'fill-muted-foreground'}
                style={{ fontSize: '3.2px', paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: '1.1px', strokeLinejoin: 'round' }}
              >
                {p.stop.name.length > 11 ? `${p.stop.name.slice(0, 11)}…` : p.stop.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
