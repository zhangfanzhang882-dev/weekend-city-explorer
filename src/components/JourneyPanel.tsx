import { useMemo, useState } from 'react';
import { Check, CircleDollarSign, GripVertical, ImageOff, MessageSquare, Plus, RotateCcw, Share2, SkipForward, Star, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ICheckIn, IRoute, IStop } from '@/data/trips';

type StopStatus = 'pending' | 'checked' | 'skipped';
interface JourneyPanelProps {
  route: IRoute;
  onBack: () => void;
  onPublished: () => void;
  /** 候选地点，用于「换一个地点」时提供真实备选 */
  candidates?: IStop[];
}

/** 星级选择：点评式打卡的核心输入 */
function StarPicker({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          aria-label={`${score} 星`}
          onClick={() => onChange(score)}
          className="p-1"
        >
          <Star size={20} className={score <= value ? 'fill-warning text-warning' : 'text-muted-foreground'} />
        </button>
      ))}
      <span className="ml-1 text-sm text-muted-foreground">{value > 0 ? `${value} 星` : '点击评分'}</span>
    </div>
  );
}

/** 实景照片，加载失败时降级为占位，不留破图 */
function StopPhoto({ stop }: { stop: IStop }) {
  const [failed, setFailed] = useState(false);
  const photo = stop.photos?.[0];
  if (!photo || failed) {
    return (
      <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl bg-muted text-muted-foreground">
        <ImageOff size={18} />
        <span className="text-[10px]">暂无图</span>
      </div>
    );
  }
  return (
    <img
      src={photo}
      alt={stop.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-20 w-20 shrink-0 rounded-2xl object-cover"
    />
  );
}

export default function JourneyPanel({ route, onBack, onPublished, candidates = [] }: JourneyPanelProps) {
  // 行程可编辑：以本地 stops 为准，支持删除、排序、替换、添加
  const [stops, setStops] = useState<IStop[]>(route.stops);
  const [statuses, setStatuses] = useState<Record<string, StopStatus>>({});
  const [checkIns, setCheckIns] = useState<ICheckIn[]>([]);
  const [activeStop, setActiveStop] = useState<IStop | null>(null);
  const [draftRating, setDraftRating] = useState(0);
  const [draftText, setDraftText] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [swapFor, setSwapFor] = useState<IStop | null>(null);
  const [shared, setShared] = useState('');

  const usedIds = useMemo(() => new Set(stops.map((item) => item.name)), [stops]);
  const availableCandidates = candidates.filter((item) => !usedIds.has(item.name));

  const update = (id: string, status: StopStatus) => setStatuses((prev) => ({ ...prev, [id]: status }));

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
    setSwapFor(null);
  };

  const addStop = (extra: IStop) => {
    setStops((prev) => [...prev, { ...extra, id: `extra-${extra.name}-${prev.length}` }]);
  };

  const submitCheckIn = () => {
    if (!activeStop || draftRating === 0) return;
    setCheckIns((prev) => [
      {
        id: `ci-${activeStop.id}-${prev.length}`,
        stopId: activeStop.id,
        rating: draftRating,
        text: draftText.trim(),
        createdAt: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        author: '我',
      },
      ...prev,
    ]);
    update(activeStop.id, 'checked');
    setActiveStop(null);
    setDraftRating(0);
    setDraftText('');
  };

  const completed = stops.filter((stop) => statuses[stop.id] === 'checked').length;

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <button className="mb-6 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={onBack}>← 返回方案</button>
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">已确认 · 可随时调整</div>
          <h2 className="text-4xl font-black tracking-tight">{route.title}</h2>
          <p className="mt-2 text-muted-foreground">计划只是参考。可以改顺序、换地点、删掉不想去的，也可以边走边打卡。</p>
        </div>
        <Button className="rounded-xl" onClick={() => setInviteOpen(true)}><Users size={17} />邀请同行</Button>
      </div>

      <div className="grid gap-4">
        {stops.map((stop, index) => {
          const status = statuses[stop.id] || 'pending';
          const stopCheckIns = checkIns.filter((item) => item.stopId === stop.id);
          return (
            <article key={stop.id} className={`rounded-3xl border bg-card p-5 transition ${status === 'checked' ? 'border-primary/40 bg-primary/5' : status === 'skipped' ? 'opacity-55' : ''}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
                <div className="flex gap-4">
                  <StopPhoto stop={stop} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold">{index + 1}</span>
                      <h3 className="font-bold">{stop.name}</h3>
                      <Badge variant="outline">{status === 'pending' ? '待出发' : status === 'checked' ? '已打卡' : '已跳过'}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{stop.area} · {stop.duration} · {stop.cost > 0 ? `¥${stop.cost}` : '价格暂无数据'}</p>
                    {stop.rating ? <p className="mt-1 text-xs text-muted-foreground">高德评分 {stop.rating}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">{stop.source.map((source) => <span key={source} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">参考 {source}</span>)}</div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    <Button size="sm" variant={status === 'checked' ? 'default' : 'outline'} onClick={() => { setActiveStop(stop); setDraftRating(0); setDraftText(''); }}><Check size={15} />打卡</Button>
                    <Button size="sm" variant="outline" onClick={() => update(stop.id, status === 'skipped' ? 'pending' : 'skipped')}><SkipForward size={15} />{status === 'skipped' ? '恢复' : '跳过'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShared(stop.name)}><Share2 size={15} />分享</Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    <Button size="sm" variant="ghost" aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}><GripVertical size={14} />上移</Button>
                    <Button size="sm" variant="ghost" aria-label="下移" disabled={index === stops.length - 1} onClick={() => move(index, 1)}>下移</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSwapFor(stop)} disabled={availableCandidates.length === 0}><RotateCcw size={14} />换地点</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" aria-label="删除" disabled={stops.length <= 1} onClick={() => removeStop(stop.id)}><Trash2 size={14} />删除</Button>
                  </div>
                </div>
              </div>

              {stopCheckIns.length > 0 && (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><MessageSquare size={13} />打卡记录 {stopCheckIns.length}</div>
                  {stopCheckIns.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-muted/50 p-3">
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
          );
        })}
      </div>

      {availableCandidates.length > 0 && (
        <div className="mt-4 rounded-3xl border border-dashed p-5">
          <div className="mb-3 text-sm font-bold">加入其他真实地点</div>
          <div className="flex flex-wrap gap-2">
            {availableCandidates.slice(0, 8).map((item) => (
              <button key={item.name} onClick={() => addStop(item)} className="rounded-full border px-3 py-1.5 text-sm hover:bg-muted">
                <Plus size={13} className="mr-1 inline" />{item.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {shared && <div className="mt-4 rounded-2xl bg-accent p-4 text-sm font-medium text-accent-foreground">已生成「{shared}」的分享卡，可复制给同行好友。</div>}

      <div className="mt-6 flex flex-col gap-3 rounded-3xl bg-foreground p-5 text-background sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-bold">当前行程 {stops.length} 个地点，已打卡 {completed} 个</div>
          <div className="mt-1 text-sm text-background/65">跳过和删除的地点不会出现在最终发布的路线里</div>
        </div>
        <Button onClick={onPublished}>结束并发布路线</Button>
      </div>

      <Dialog open={Boolean(activeStop)} onOpenChange={(open) => !open && setActiveStop(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>打卡「{activeStop?.name}」</DialogTitle>
            <DialogDescription>给它打个分，写下你的真实感受。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <StarPicker value={draftRating} onChange={setDraftRating} />
            <Textarea
              placeholder="人多吗？值得去吗？有什么要提醒后来的人？"
              value={draftText}
              maxLength={300}
              rows={4}
              onChange={(event) => setDraftText(event.target.value)}
            />
            <div className="text-right text-xs text-muted-foreground">{draftText.length}/300</div>
            <Button className="w-full" disabled={draftRating === 0} onClick={submitCheckIn}>
              <Check size={16} />{draftRating === 0 ? '请先评分' : '发布打卡'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(swapFor)} onOpenChange={(open) => !open && setSwapFor(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>替换「{swapFor?.name}」</DialogTitle>
            <DialogDescription>从同城真实候选地点中换一个。</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto py-2">
            {availableCandidates.map((item) => (
              <button key={item.name} onClick={() => swapStop(item)} className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left hover:bg-muted">
                <StopPhoto stop={item} />
                <span className="min-w-0">
                  <span className="block font-semibold">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">{item.area}{item.rating ? ` · 评分 ${item.rating}` : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>一起出发</DialogTitle><DialogDescription>生成一张同行邀请卡，首版仅演示邀请与费用约定。</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div><label className="mb-2 block text-sm font-semibold" htmlFor="party-size">同行人数</label><Input id="party-size" defaultValue="还差 2 人" /></div>
            <div><span className="mb-2 block text-sm font-semibold">费用约定</span><div className="flex items-center gap-2 rounded-xl border p-3 text-sm"><CircleDollarSign size={18} className="text-primary" />餐饮与门票各自支付，交通费用均摊</div></div>
            <Button className="w-full" onClick={() => setInviteOpen(false)}><Share2 size={16} />生成邀请卡</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
