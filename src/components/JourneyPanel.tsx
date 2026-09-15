import { useState } from 'react';
import { Check, CircleDollarSign, Plus, RotateCcw, Share2, SkipForward, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { IRoute } from '@/data/trips';

type StopStatus = 'pending' | 'checked' | 'skipped' | 'replaced';
interface JourneyPanelProps { route: IRoute; onBack: () => void; onPublished: () => void; }

export default function JourneyPanel({ route, onBack, onPublished }: JourneyPanelProps) {
  const [statuses, setStatuses] = useState<Record<string, StopStatus>>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [extraAdded, setExtraAdded] = useState(false);

  const update = (id: string, status: StopStatus) => setStatuses((prev) => ({ ...prev, [id]: status }));
  const completed = route.stops.filter((stop) => statuses[stop.id] === 'checked' || statuses[stop.id] === 'replaced').length + (extraAdded ? 1 : 0);

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <button className="mb-6 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={onBack}>← 返回方案</button>
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">已确认 · 行程进行中</div>
          <h2 className="text-4xl font-black tracking-tight">{route.title}</h2>
          <p className="mt-2 text-muted-foreground">计划只是参考，随时记录你真正走过的上海。</p>
        </div>
        <Button className="rounded-xl" onClick={() => setInviteOpen(true)}><Users size={17} />邀请同行</Button>
      </div>

      <div className="grid gap-4">
        {route.stops.map((stop, index) => {
          const status = statuses[stop.id] || 'pending';
          return (
            <article key={stop.id} className={`rounded-3xl border bg-card p-5 transition ${status === 'checked' ? 'border-primary/40 bg-primary/5' : status === 'skipped' ? 'opacity-55' : ''}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary font-black">{index + 1}</div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{status === 'replaced' ? `${stop.name}附近室内替代点` : stop.name}</h3><Badge variant="outline">{status === 'pending' ? '待出发' : status === 'checked' ? '已打卡' : status === 'skipped' ? '已跳过' : '已替换'}</Badge></div>
                    <p className="mt-1 text-sm text-muted-foreground">{stop.area} · {stop.duration} · {stop.cost > 0 ? `¥${stop.cost}` : '价格暂无数据'}</p>
                    <div className="mt-2 flex gap-1.5">{stop.source.map((source) => <span key={source} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">参考 {source}</span>)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button size="sm" variant={status === 'checked' ? 'default' : 'outline'} onClick={() => update(stop.id, 'checked')}><Check size={15} />打卡</Button>
                  <Button size="sm" variant="outline" onClick={() => update(stop.id, 'skipped')}><SkipForward size={15} />跳过</Button>
                  <Button size="sm" variant="outline" onClick={() => update(stop.id, 'replaced')}><RotateCcw size={15} />替换</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShared(true)}><Share2 size={15} />分享</Button>
                </div>
              </div>
            </article>
          );
        })}
        {extraAdded && <article className="rounded-3xl border border-dashed border-primary/40 bg-primary/5 p-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus size={18} /></div><div><h3 className="font-bold">临时发现：街角独立书店</h3><p className="text-sm text-muted-foreground">已加入实际路线 · 预计停留 40 分钟</p></div></div></article>}
      </div>

      {shared && <div className="mt-4 rounded-2xl bg-accent p-4 text-sm font-medium text-accent-foreground">地点分享卡已生成，可复制给同行好友。</div>}

      <div className="mt-6 flex flex-col gap-3 rounded-3xl bg-foreground p-5 text-background sm:flex-row sm:items-center sm:justify-between">
        <div><div className="font-bold">实际行程已记录 {completed} 个地点</div><div className="mt-1 text-sm text-background/65">没去的地点不会出现在最终发布路线中</div></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setExtraAdded(true)}><Plus size={16} />补充临时地点</Button><Button onClick={onPublished}>结束并发布路线</Button></div>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>一起出发</DialogTitle><DialogDescription>生成一张同行邀请卡，首版仅演示邀请与费用约定。</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div><label className="mb-2 block text-sm font-semibold">同行人数</label><Input defaultValue="还差 2 人" /></div>
            <div><label className="mb-2 block text-sm font-semibold">费用约定</label><div className="flex items-center gap-2 rounded-xl border p-3 text-sm"><CircleDollarSign size={18} className="text-primary" />餐饮与门票各自支付，交通费用均摊</div></div>
            <Button className="w-full" onClick={() => setInviteOpen(false)}><Share2 size={16} />生成邀请卡</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
