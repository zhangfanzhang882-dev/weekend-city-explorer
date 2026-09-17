import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Check, CircleDollarSign, Copy, Flag, ImageOff, Link2, MapPin, MessageSquare,
  Navigation, Pencil, Plus, RotateCcw, Search, Share2, SkipForward, Star, Trash2, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import RouteMap from '@/features/journey/RouteMap';
import { searchPlaces } from '@/services/api';
import { getSampleReviews } from '@/data/sampleReviews';
import type { ICheckIn, IRoute, IStop } from '@/data/trips';

/** 四阶段：规划 → 组队 → 进行中 → 已完成 */
export type Stage = 'planning' | 'team' | 'ongoing' | 'done';

const STAGE_META: Array<{ key: Stage; label: string; hint: string }> = [
  { key: 'planning', label: '调整行程', hint: '增删地点、改顺序，确认后再邀请同行' },
  { key: 'team', label: '邀请同行', hint: '生成邀请链接，等同行加入后一起出发' },
  { key: 'ongoing', label: '出发打卡', hint: '边走边打卡，记录真实感受' },
  { key: 'done', label: '发布路线', hint: '按实际走过的路线生成攻略并分享' },
];

/**
 * 路线整体评价的分项维度。
 * 与单个地点的打卡评分区分：这里评的是路线设计本身好不好走、值不值得推荐。
 */
const ROUTE_ASPECTS = [
  { key: 'smooth', label: '顺路程度', hint: '地点之间好走吗' },
  { key: 'pace', label: '节奏松紧', hint: '时间安排合适吗' },
  { key: 'worth', label: '值得程度', hint: '整体值不值得来' },
] as const;

/** 常用费用约定预设，一键填入后仍可自由改写 */
const COST_PRESETS = ['各付各的', '门票自付，交通均摊', '全程 AA', '我请客'];

interface JourneyPanelProps {
  route: IRoute;
  onBack: () => void;
  candidates?: IStop[];
  city?: string;
  date?: string;
  endDate?: string;
}

const parsePoint = (location?: string) => {
  const [lng, lat] = (location || '').split(',').map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
};

const kmBetween = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/** 星级选择 */
function StarPicker({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <button key={score} type="button" aria-label={`${score} 星`} onClick={() => onChange(score)} className="p-1">
          <Star size={20} className={score <= value ? 'fill-warning text-warning' : 'text-muted-foreground'} />
        </button>
      ))}
      <span className="ml-1 text-sm text-muted-foreground">{value > 0 ? `${value} 星` : '点击评分'}</span>
    </div>
  );
}

/** 实景照片，加载失败降级占位 */
function StopPhoto({ stop, size = 'w-20' }: { stop: IStop; size?: string }) {
  const [failed, setFailed] = useState(false);
  const photo = stop.photos?.[0];
  if (!photo || failed) {
    return (
      <div className={`flex aspect-[3/4] ${size} shrink-0 flex-col items-center justify-center gap-1 rounded-2xl bg-muted text-muted-foreground`}>
        <ImageOff size={16} />
        <span className="text-[10px]">暂无图</span>
      </div>
    );
  }
  return (
    <div className={`aspect-[3/4] ${size} shrink-0 overflow-hidden rounded-2xl bg-muted`}>
      <img src={photo} alt={stop.name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </div>
  );
}

/** 历史点评：规划阶段展示，帮助判断值不值得去 */
function ReviewList({ stop }: { stop: IStop }) {
  const reviews = getSampleReviews(stop.name, stop.type);
  if (reviews.length === 0) {
    return <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">暂无历史点评</p>;
  }
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
        <MessageSquare size={12} />历史点评
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">示例数据</span>
      </div>
      {reviews.map((review) => (
        <div key={review.id} className="rounded-xl bg-muted/50 p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((score) => (
                <Star key={score} size={10} className={score <= review.rating ? 'fill-warning text-warning' : 'text-muted-foreground/40'} />
              ))}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">{review.createdAt}</span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{review.text}</p>
        </div>
      ))}
    </div>
  );
}

export default function JourneyPanel({ route, onBack, candidates = [], city, date, endDate }: JourneyPanelProps) {
  const [stage, setStage] = useState<Stage>('planning');
  const [stops, setStops] = useState<IStop[]>(route.stops);
  const [statuses, setStatuses] = useState<Record<string, 'pending' | 'checked' | 'skipped'>>({});
  const [checkIns, setCheckIns] = useState<ICheckIn[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState('');
  // 费用约定可自由编辑，默认给一个常见方案
  const [costRule, setCostRule] = useState('门票自付，交通均摊');
  // 路线整体评价：在结束行程时填写，趁记忆新鲜
  const [finishOpen, setFinishOpen] = useState(false);
  const [routeRating, setRouteRating] = useState(0);
  const [aspectScores, setAspectScores] = useState<Record<string, number>>({});
  const [routeComment, setRouteComment] = useState('');
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [activeStop, setActiveStop] = useState<IStop | null>(null);
  const [draftRating, setDraftRating] = useState(0);
  const [draftText, setDraftText] = useState('');
  const [swapFor, setSwapFor] = useState<IStop | null>(null);
  // 地点选择器状态：用单一 mode 表示当前用途，避免 swapFor 与 addOpen 两个布尔量
  // 相互覆盖导致替换后弹窗切换成「加入新地点」而不关闭
  const [pickerMode, setPickerMode] = useState<'closed' | 'swap' | 'add'>('closed');
  const [placeQuery, setPlaceQuery] = useState('');
  const [searchResults, setSearchResults] = useState<IStop[]>([]);
  const [searching, setSearching] = useState(false);
  const [tripId, setTripId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [copied, setCopied] = useState(false);

  const usedNames = useMemo(() => new Set(stops.map((item) => item.name)), [stops]);
  const availableCandidates = candidates.filter((item) => !usedNames.has(item.name));

  // 关键词搜索真实地点，防抖 400ms 避免逐字打接口；仅弹窗打开时生效。
  // 所有 setState 都放进 timeout 回调，避免 effect 内同步更新引发级联渲染。
  useEffect(() => {
    const keyword = placeQuery.trim();
    const active = pickerMode !== 'closed';
    const timer = window.setTimeout(() => {
      if (!active || keyword.length < 1) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      void searchPlaces(keyword, city || '上海')
        .then((list) => setSearchResults(list.filter((item) => !usedNames.has(item.name))))
        .finally(() => setSearching(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [placeQuery, pickerMode, city, usedNames]);

  /** 关闭弹窗时清理搜索状态，避免下次打开残留上次结果 */
  const closePicker = () => {
    setPickerMode('closed');
    setSwapFor(null);
    setPlaceQuery('');
    setSearchResults([]);
    setSearching(false);
  };

  // 行程被编辑后服务端距离失效，按当前顺序重算
  const stopsWithDistance = useMemo(() => stops.map((stop, index) => {
    if (index === 0) return { ...stop, legKm: null };
    const from = parsePoint(stops[index - 1].location);
    const to = parsePoint(stop.location);
    if (!from || !to) return { ...stop, legKm: null };
    return { ...stop, legKm: Number(kmBetween(from, to).toFixed(1)) };
  }), [stops]);

  const totalKm = stopsWithDistance.reduce((sum, stop) => sum + (stop.legKm ?? 0), 0);
  const editable = stage === 'planning';
  const stageIndex = STAGE_META.findIndex((item) => item.key === stage);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    setStops((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeStop = (id: string) => setStops((prev) => prev.filter((item) => item.id !== id));

  const swapStop = (replacement: IStop) => {
    if (!swapFor) return;
    setStops((prev) => prev.map((item) => (item.id === swapFor.id ? { ...replacement, id: swapFor.id } : item)));
    closePicker();
  };

  const addStop = (extra: IStop) => {
    setStops((prev) => [...prev, { ...extra, id: `extra-${extra.name}-${prev.length}` }]);
    closePicker();
  };

  /** 保存行程到服务端；组队与完成阶段需要落库以便分享 */
  const persist = async (nextStage: Stage) => {
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/trip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: tripId || undefined,
          trip: {
            title: route.title,
            stage: nextStage,
            stops,
            checkIns,
            members,
            costRule,
            // 路线整体评价，仅在结束时填写
            routeReview: routeRating > 0
              ? { rating: routeRating, aspects: aspectScores, comment: routeComment.trim(), recommend }
              : null,
            city,
            date,
            endDate,
          },
        }),
      });
      const rawText = await response.text();
      let payload: { id?: string; persistent?: boolean; error?: string } = {};
      try {
        payload = JSON.parse(rawText);
      } catch {
        // 上游返回 HTML 错误页时给出可读提示，而非原始 JSON 解析错误
        throw new Error(`保存失败：服务暂时不可用（HTTP ${response.status}），请稍后重试`);
      }
      if (!response.ok) throw new Error(payload.error || '保存失败');
      if (payload.id) setTripId(payload.id);
      setPersistent(payload.persistent !== false);
      // 切换阶段时清理弹窗与草稿，否则打卡弹窗会残留到下一阶段且标题为空
      setActiveStop(null);
      setSwapFor(null);
      setDraftRating(0);
      setDraftText('');
      setStage(nextStage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const submitCheckIn = () => {
    if (!activeStop || draftRating === 0) return;
    setCheckIns((prev) => [{
      id: `ci-${activeStop.id}-${prev.length}`,
      stopId: activeStop.id,
      rating: draftRating,
      text: draftText.trim(),
      createdAt: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      author: '我',
    }, ...prev]);
    setStatuses((prev) => ({ ...prev, [activeStop.id]: 'checked' }));
    setActiveStop(null);
    setDraftRating(0);
    setDraftText('');
  };

  const visited = stops.filter((stop) => statuses[stop.id] === 'checked');
  const inviteLink = tripId ? `${window.location.origin}/?trip=${tripId}` : '';

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveError('复制失败，请手动选中链接复制');
    }
  };

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <button className="mb-6 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={onBack}>← 返回方案列表</button>

      {/* 阶段指示器：让用户清楚自己在流程的哪一步 */}
      <ol className="mb-7 flex flex-wrap gap-2">
        {STAGE_META.map((item, index) => {
          const done = index < stageIndex;
          const current = index === stageIndex;
          return (
            <li key={item.key} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${current ? 'border-primary bg-primary text-primary-foreground font-bold' : done ? 'border-primary/40 bg-primary/5 text-primary' : 'text-muted-foreground'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${current ? 'bg-primary-foreground text-primary' : done ? 'bg-primary/15' : 'bg-muted'}`}>
                {done ? <Check size={11} /> : index + 1}
              </span>
              {item.label}
            </li>
          );
        })}
      </ol>

      <div className="mb-7">
        <h2 className="text-4xl font-black tracking-tight">{route.title}</h2>
        <p className="mt-2 text-muted-foreground">{STAGE_META[stageIndex].hint}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{stops.length} 个地点</span>
          {totalKm > 0 && <span>全程约 {totalKm.toFixed(1)} km</span>}
          {members.length > 0 && <span>同行 {members.length} 人</span>}
          {stage === 'ongoing' && <span>已打卡 {visited.length}/{stops.length}</span>}
        </div>
      </div>

      <div className="mb-6"><RouteMap stops={stopsWithDistance} activeId={activeStop?.id} /></div>

      {stage === 'done' ? (
        <PublishedView
          route={route}
          visited={visited}
          checkIns={checkIns}
          members={members}
          costRule={costRule}
          totalKm={totalKm}
          tripId={tripId}
          routeReview={routeRating > 0 ? { rating: routeRating, aspects: aspectScores, comment: routeComment.trim(), recommend } : null}
          onRestart={onBack}
        />
      ) : (
        <>
          <div className="grid gap-4">
            {stopsWithDistance.map((stop, index) => {
              const status = statuses[stop.id] || 'pending';
              const stopCheckIns = checkIns.filter((item) => item.stopId === stop.id);
              return (
                <div key={stop.id}>
                  {index > 0 && stop.legKm !== null && stop.legKm !== undefined && (
                    <div className="mb-2 ml-6 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-4 w-px bg-border" /><span>距上一站约 {stop.legKm} km</span>
                    </div>
                  )}
                  <article className={`rounded-3xl border bg-card p-5 transition ${status === 'checked' ? 'border-primary/40 bg-primary/5' : status === 'skipped' ? 'opacity-55' : ''}`}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
                      <div className="flex gap-4">
                        <StopPhoto stop={stop} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold">{index + 1}</span>
                            <h3 className="font-bold">{stop.name}</h3>
                            {stage === 'ongoing' && (
                              <Badge variant="outline">{status === 'pending' ? '待出发' : status === 'checked' ? '已打卡' : '已跳过'}</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{stop.area} · {stop.duration} · {stop.cost > 0 ? `¥${stop.cost}` : '价格暂无数据'}</p>
                          {stop.rating ? <p className="mt-1 text-xs text-muted-foreground">高德评分 {stop.rating}</p> : null}
                          {stop.openNote && (
                            <p className={`mt-1 text-xs ${stop.openStatus === 'closed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {stop.openStatus === 'closed' ? '⚠ ' : '营业：'}{stop.openNote}
                            </p>
                          )}
                          {stop.tel && <p className="mt-1 text-xs text-muted-foreground">电话 {stop.tel}</p>}

                          {/* 规划阶段看历史点评辅助决策；进行中阶段专注自己打卡 */}
                          {editable && <ReviewList stop={stop} />}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {editable && (
                          <div className="flex flex-wrap gap-1.5 sm:justify-end">
                            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)}>上移</Button>
                            <Button size="sm" variant="ghost" disabled={index === stops.length - 1} onClick={() => move(index, 1)}>下移</Button>
                            <Button size="sm" variant="ghost" onClick={() => { setPlaceQuery(''); setSwapFor(stop); setPickerMode('swap'); }}><RotateCcw size={14} />换地点</Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={stops.length <= 2} onClick={() => removeStop(stop.id)}><Trash2 size={14} />删除</Button>
                          </div>
                        )}
                        {stage === 'ongoing' && (
                          <div className="flex flex-wrap gap-1.5 sm:justify-end">
                            <Button size="sm" variant={status === 'checked' ? 'default' : 'outline'} onClick={() => { setActiveStop(stop); setDraftRating(0); setDraftText(''); }}><Check size={15} />打卡</Button>
                            <Button size="sm" variant="outline" onClick={() => setStatuses((prev) => ({ ...prev, [stop.id]: status === 'skipped' ? 'pending' : 'skipped' }))}>
                              <SkipForward size={15} />{status === 'skipped' ? '恢复' : '跳过'}
                            </Button>
                          </div>
                        )}
                        {stop.location && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={`https://uri.amap.com/marker?position=${stop.location}&name=${encodeURIComponent(stop.name)}&src=weekend-city-explorer&coordinate=gaode`} target="_blank" rel="noreferrer noopener">
                              <Navigation size={15} />导航
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 自己的打卡记录 */}
                    {stopCheckIns.length > 0 && (
                      <div className="mt-4 space-y-3 border-t pt-4">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-primary"><MessageSquare size={13} />我的打卡 {stopCheckIns.length}</div>
                        {stopCheckIns.map((item) => (
                          <div key={item.id} className="rounded-2xl bg-primary/5 p-3">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{item.author}</span>
                              <span className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((score) => <Star key={score} size={12} className={score <= item.rating ? 'fill-warning text-warning' : 'text-muted-foreground/40'} />)}
                              </span>
                              <span className="ml-auto text-[11px] text-muted-foreground">{item.createdAt}</span>
                            </div>
                            {item.text && <p className="mt-2 whitespace-pre-wrap text-sm">{item.text}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
          </div>

          {/* 仅规划阶段允许追加地点 */}
          {editable && (
            <div className="mt-4 rounded-3xl border border-dashed p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-bold"><Plus size={14} />加入其他地点</span>
                <Button size="sm" variant="outline" onClick={() => { setPlaceQuery(''); setSwapFor(null); setPickerMode('add'); }}>
                  <Search size={14} />搜索地点
                </Button>
              </div>
              {availableCandidates.length > 0 ? (
                <>
                  <div className="mb-2 text-xs text-muted-foreground">从本次候选中快速添加，或点右上角搜索全城</div>
                  <div className="flex flex-wrap gap-2">
                    {availableCandidates.slice(0, 8).map((item) => (
                      <button key={item.name} onClick={() => addStop(item)} className="rounded-full border px-3 py-1.5 text-sm hover:bg-muted">
                        {item.name}{item.rating ? ` · ${item.rating}` : ''}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">候选已全部加入，可点「搜索地点」查找其他地方</div>
              )}
            </div>
          )}

          {/* 组队阶段：邀请链接与同行管理 */}
          {stage === 'team' && (
            <div className="mt-5 rounded-3xl border bg-card p-5">
              <div className="flex items-center gap-2 text-sm font-bold"><Link2 size={15} />邀请链接</div>
              {inviteLink ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-muted px-3 py-2.5 text-xs">{inviteLink}</code>
                    <Button variant="outline" onClick={() => void copyLink()}><Copy size={15} />{copied ? '已复制' : '复制'}</Button>
                  </div>
                  {!persistent && (
                    <p className="mt-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                      服务端尚未绑定 KV 存储，此链接仅在当前服务实例内有效，暂不能跨设备打开。
                    </p>
                  )}
                </>
              ) : <p className="mt-2 text-xs text-muted-foreground">正在生成…</p>}

              <div className="mt-5 border-t pt-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold"><Users size={15} />同行成员</div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    aria-label="同行成员昵称"
                    placeholder="输入同行昵称，模拟对方接受邀请"
                    value={memberInput}
                    maxLength={12}
                    onChange={(event) => setMemberInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && memberInput.trim()) {
                        event.preventDefault();
                        setMembers((prev) => (prev.length >= 8 ? prev : [...prev, memberInput.trim()]));
                        setMemberInput('');
                      }
                    }}
                  />
                  <Button variant="outline" disabled={!memberInput.trim() || members.length >= 8} onClick={() => { setMembers((prev) => [...prev, memberInput.trim()]); setMemberInput(''); }}>
                    <Plus size={15} />加入
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm text-primary-foreground">我（发起人）</span>
                  {members.map((name, index) => (
                    <span key={`${name}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-sm">
                      {name}
                      <button aria-label={`移除 ${name}`} onClick={() => setMembers((prev) => prev.filter((_, i) => i !== index))} className="ml-0.5 text-muted-foreground hover:text-destructive">×</button>
                    </span>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold" htmlFor="cost-rule">
                    <CircleDollarSign size={15} className="text-primary" />费用约定
                  </label>
                  <Textarea
                    id="cost-rule"
                    aria-label="费用约定"
                    placeholder="写清怎么分摊，例如：门票各自买，打车和晚饭 AA"
                    value={costRule}
                    maxLength={120}
                    rows={2}
                    className="resize-none"
                    onChange={(event) => setCostRule(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {COST_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setCostRule(preset)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition ${costRule === preset ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                      >{preset}</button>
                    ))}
                    <span className="ml-auto text-[11px] text-muted-foreground">{costRule.length}/120</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {saveError && <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</div>}

          {/* 阶段推进 */}
          <div className="mt-6 flex flex-col gap-3 rounded-3xl bg-foreground p-5 text-background sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-bold">{STAGE_META[stageIndex].label}</div>
              <div className="mt-1 text-sm text-background/65">
                {stage === 'planning' && '确认地点和顺序后再进入下一步，之后行程将锁定'}
                {stage === 'team' && (members.length > 0 ? `已有 ${members.length} 位同行加入，可以出发了` : '可以先复制链接邀请，也可以直接出发')}
                {stage === 'ongoing' && (visited.length > 0 ? `已打卡 ${visited.length} 个地点` : '到达地点后点「打卡」记录感受')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {stage === 'planning' && (
                <Button disabled={saving || stops.length < 2} onClick={() => void persist('team')}>
                  {saving ? '保存中…' : '确认行程，去邀请'}<ArrowRight size={16} />
                </Button>
              )}
              {stage === 'team' && (
                <>
                  <Button variant="secondary" onClick={() => setStage('planning')}><Pencil size={15} />回去改行程</Button>
                  <Button disabled={saving} onClick={() => void persist('ongoing')}>{saving ? '保存中…' : '出发'}<ArrowRight size={16} /></Button>
                </>
              )}
              {stage === 'ongoing' && (
                <Button disabled={saving || visited.length === 0} onClick={() => setFinishOpen(true)}>
                  {visited.length === 0 ? '至少打卡一个地点' : '结束行程，写总评'}<Flag size={16} />
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* 结束行程：先写整条路线的总评，趁记忆新鲜 */}
      <Dialog open={finishOpen && stage === 'ongoing'} onOpenChange={(open) => !open && setFinishOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle>这条路线走下来怎么样？</DialogTitle>
            <DialogDescription>
              评价整条路线的安排，会和你的打卡一起出现在发布的攻略里。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <div>
              <div className="mb-1.5 text-sm font-semibold">整体评分</div>
              <StarPicker value={routeRating} onChange={setRouteRating} />
            </div>

            <div className="space-y-2.5">
              <div className="text-sm font-semibold">分项评价<span className="ml-1 text-xs font-normal text-muted-foreground">可跳过</span></div>
              {ROUTE_ASPECTS.map((aspect) => (
                <div key={aspect.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2">
                  <span className="text-sm">
                    {aspect.label}
                    <span className="ml-1.5 text-xs text-muted-foreground">{aspect.hint}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        type="button"
                        aria-label={`${aspect.label} ${score} 星`}
                        onClick={() => setAspectScores((prev) => ({ ...prev, [aspect.key]: score }))}
                        className="p-0.5"
                      >
                        <Star size={15} className={score <= (aspectScores[aspect.key] ?? 0) ? 'fill-warning text-warning' : 'text-muted-foreground/40'} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-1.5 text-sm font-semibold">会推荐给朋友吗</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setRecommend(true)}
                  aria-pressed={recommend === true}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${recommend === true ? 'border-primary bg-primary text-primary-foreground font-semibold' : 'bg-card hover:bg-muted'}`}
                >会推荐</button>
                <button
                  onClick={() => setRecommend(false)}
                  aria-pressed={recommend === false}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${recommend === false ? 'border-destructive bg-destructive/10 text-destructive font-semibold' : 'bg-card hover:bg-muted'}`}
                >算了吧</button>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-sm font-semibold">
                总体感受<span className="ml-1 text-xs font-normal text-muted-foreground">选填</span>
              </div>
              <Textarea
                aria-label="路线总体感受"
                placeholder="这条路线的顺序合理吗？哪段最值得？有什么要提醒后来的人？"
                value={routeComment}
                maxLength={300}
                rows={4}
                className="resize-none"
                onChange={(event) => setRouteComment(event.target.value)}
              />
              <div className="mt-1 text-right text-xs text-muted-foreground">{routeComment.length}/300</div>
            </div>

            {saveError && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</div>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="sm:flex-1"
                disabled={saving}
                onClick={() => { setFinishOpen(false); void persist('done'); }}
              >跳过，直接发布</Button>
              <Button
                className="sm:flex-[2]"
                disabled={saving || routeRating === 0}
                onClick={() => { setFinishOpen(false); void persist('done'); }}
              >
                <Flag size={16} />{saving ? '发布中…' : routeRating === 0 ? '请先给整体评分' : '提交评价并发布'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 打卡弹窗：仅进行中阶段可用，避免其他阶段残留空标题弹窗 */}
      <Dialog open={Boolean(activeStop) && stage === 'ongoing'} onOpenChange={(open) => !open && setActiveStop(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>打卡「{activeStop?.name}」</DialogTitle>
            <DialogDescription>给它打个分，写下你的真实感受。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <StarPicker value={draftRating} onChange={setDraftRating} />
            <Textarea placeholder="人多吗？值得去吗？有什么要提醒后来的人？" value={draftText} maxLength={300} rows={4} onChange={(event) => setDraftText(event.target.value)} />
            <div className="text-right text-xs text-muted-foreground">{draftText.length}/300</div>
            <Button className="w-full" disabled={draftRating === 0} onClick={submitCheckIn}>
              <Check size={16} />{draftRating === 0 ? '请先评分' : '发布打卡'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 地点选择器：换地点与加地点共用，都支持搜索全城真实地点 */}
      <Dialog open={pickerMode !== 'closed' && editable} onOpenChange={(open) => !open && closePicker()}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>{pickerMode === 'swap' && swapFor ? `替换「${swapFor.name}」` : '加入新地点'}</DialogTitle>
            <DialogDescription>
              搜索{city || '本市'}的真实地点，或从本次候选中选择。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <Input
              aria-label="搜索地点"
              placeholder="输入地点名或类型，如 咖啡、美术馆、外滩"
              value={placeQuery}
              maxLength={20}
              autoFocus
              onChange={(event) => setPlaceQuery(event.target.value)}
            />

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {/* 输入后立即显示等待态：searching 要等防抖结束才置位，此处用结果是否匹配当前词兜底 */}
              {placeQuery.trim() && (searching || searchResults.length === 0) && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {searching ? '搜索中…' : `没找到「${placeQuery.trim()}」相关地点，换个词试试`}
                </div>
              )}

              {!searching && searchResults.length > 0 && (
                <>
                  <div className="px-1 text-[11px] font-bold text-muted-foreground">搜索结果 · 高德地图</div>
                  {searchResults.map((item) => (
                    <PlaceOption key={item.id} stop={item} onPick={() => (pickerMode === 'swap' ? swapStop(item) : addStop(item))} />
                  ))}
                </>
              )}

              {!placeQuery.trim() && (
                availableCandidates.length > 0 ? (
                  <>
                    <div className="px-1 text-[11px] font-bold text-muted-foreground">本次候选地点</div>
                    {availableCandidates.map((item) => (
                      <PlaceOption key={item.id} stop={item} onPick={() => (pickerMode === 'swap' ? swapStop(item) : addStop(item))} />
                    ))}
                  </>
                ) : (
                  <div className="py-6 text-center text-sm text-muted-foreground">候选已全部加入，请用上方搜索</div>
                )
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** 地点选项行：带实景图、区域与评分，供替换与添加复用 */
function PlaceOption({ stop, onPick }: { stop: IStop; onPick: () => void }) {
  return (
    <button onClick={onPick} className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition hover:bg-muted">
      <StopPhoto stop={stop} size="w-14" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{stop.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {stop.area || stop.type}{stop.rating ? ` · 评分 ${stop.rating}` : ''}
        </span>
        {stop.address && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{stop.address}</span>}
      </span>
    </button>
  );
}

/** 已完成：按实际走过的地点生成攻略 */
function PublishedView({ route, visited, checkIns, members, costRule, totalKm, tripId, routeReview, onRestart }: {
  route: IRoute;
  visited: IStop[];
  checkIns: ICheckIn[];
  members: string[];
  costRule: string;
  totalKm: number;
  routeReview: { rating: number; aspects: Record<string, number>; comment: string; recommend: boolean | null } | null;
  tripId: string;
  onRestart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareLink = tripId ? `${window.location.origin}/?trip=${tripId}` : '';
  const avgRating = checkIns.length > 0
    ? (checkIns.reduce((sum, item) => sum + item.rating, 0) / checkIns.length).toFixed(1)
    : null;

  return (
    <div>
      <div className="rounded-3xl border bg-card p-6">
        <Badge variant="secondary" className="mb-3">路线已发布</Badge>
        <h3 className="text-3xl font-black tracking-tight">{route.title}</h3>
        <p className="mt-2 text-muted-foreground">这是你实际走过的路线，没去的地点已自动移除。</p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-secondary p-3"><div className="text-xl font-black">{visited.length}</div><div className="text-xs text-muted-foreground">实际打卡</div></div>
          <div className="rounded-2xl bg-secondary p-3"><div className="text-xl font-black">{totalKm.toFixed(1)}</div><div className="text-xs text-muted-foreground">全程 km</div></div>
          <div className="rounded-2xl bg-secondary p-3"><div className="text-xl font-black">{members.length + 1}</div><div className="text-xs text-muted-foreground">同行人数</div></div>
          <div className="rounded-2xl bg-secondary p-3"><div className="text-xl font-black">{avgRating ?? '—'}</div><div className="text-xs text-muted-foreground">地点均分</div></div>
        </div>

        {/* 路线综合评价：整条路线的整体结论，与下方单点打卡区分 */}
        {routeReview && (
          <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-sm font-bold">路线综合评价</span>
              <span className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((score) => (
                  <Star key={score} size={14} className={score <= routeReview.rating ? 'fill-warning text-warning' : 'text-muted-foreground/40'} />
                ))}
              </span>
              <span className="text-sm font-bold text-primary">{routeReview.rating}.0</span>
              {routeReview.recommend !== null && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${routeReview.recommend ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {routeReview.recommend ? '会推荐给朋友' : '不太推荐'}
                </span>
              )}
            </div>

            {ROUTE_ASPECTS.some((aspect) => routeReview.aspects[aspect.key]) && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {ROUTE_ASPECTS.filter((aspect) => routeReview.aspects[aspect.key]).map((aspect) => (
                  <span key={aspect.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {aspect.label}
                    <span className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <Star key={score} size={10} className={score <= routeReview.aspects[aspect.key] ? 'fill-warning text-warning' : 'text-muted-foreground/30'} />
                      ))}
                    </span>
                  </span>
                ))}
              </div>
            )}

            {routeReview.comment && (
              <p className="mt-3 whitespace-pre-wrap border-t border-primary/15 pt-3 text-sm leading-6">{routeReview.comment}</p>
            )}
          </div>
        )}

        {costRule.trim() && (
          <div className="mt-5 flex items-start gap-2 rounded-2xl bg-secondary p-3.5 text-sm">
            <CircleDollarSign size={16} className="mt-0.5 shrink-0 text-primary" />
            <span><span className="font-semibold">费用约定：</span>{costRule}</span>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {visited.map((stop, index) => {
            const own = checkIns.filter((item) => item.stopId === stop.id);
            return (
              <div key={stop.id} className="rounded-2xl border p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{index + 1}</span>
                  <span className="font-bold">{stop.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} />{stop.area}</span>
                </div>
                {own.map((item) => (
                  <div key={item.id} className="mt-2 rounded-xl bg-muted/50 p-2.5">
                    <span className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((score) => <Star key={score} size={11} className={score <= item.rating ? 'fill-warning text-warning' : 'text-muted-foreground/40'} />)}
                    </span>
                    {item.text && <p className="mt-1.5 text-sm leading-6">{item.text}</p>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 rounded-3xl border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-bold"><Share2 size={15} />分享这条路线</div>
        {shareLink ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-muted px-3 py-2.5 text-xs">{shareLink}</code>
            <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(shareLink).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }}>
              <Copy size={15} />{copied ? '已复制' : '复制'}
            </Button>
          </div>
        ) : <p className="mt-2 text-xs text-muted-foreground">链接生成中…</p>}
      </div>

      <div className="mt-5 flex justify-center"><Button variant="outline" onClick={onRestart}>再规划一次</Button></div>
    </div>
  );
}
