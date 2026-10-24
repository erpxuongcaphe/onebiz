"use client";

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { useToast } from '@/lib/contexts';
import { useDurableFormDraft } from '@/lib/hooks/use-durable-form-draft';
import { getWarehouseOrderContext, submitWarehouseOrder, type SupplyProduct, type SupplyWarehouse } from '@/lib/services/supabase/fnb-warehouse-orders';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; onSuccess?: () => void; branchId: string }
type Line = SupplyProduct & { quantity: number; note?: string };

export function CreateFnbWarehouseOrderDialog({ open, onOpenChange, onSuccess, branchId }: Props) {
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<SupplyWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<SupplyProduct[]>([]);
  const [items, setItems] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const branchRef = useRef(branchId);
  branchRef.current = branchId;

  useEffect(() => {
    if (!open) return;
    setItems([]); setNote(''); setSearch(''); setWarehouseId('');
    setRequestId(crypto.randomUUID()); setError(''); setCatalogError('');
  }, [open, branchId]);

  const { clearDraft } = useDurableFormDraft({
    form: 'fnb-warehouse-purchase-order', branchId, open,
    onRequestOpen: () => onOpenChange(true),
    snapshot: { items, note, requestId, warehouseId },
    hasContent: draft => draft.items.length > 0 || !!draft.note.trim(),
    restore: draft => {
      setItems(draft.items); setNote(draft.note); setRequestId(draft.requestId); setWarehouseId(draft.warehouseId);
    },
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProducts([]); setLoading(true); setCatalogError('');
    const timer = setTimeout(() => {
      getWarehouseOrderContext(branchId, search).then(result => {
        if (cancelled) return;
        setWarehouses(result.warehouses); setProducts(result.products);
        setWarehouseId(id => id || (result.warehouses.length === 1 ? result.warehouses[0].id : ''));
      }).catch(e => { if (!cancelled) setCatalogError(e instanceof Error ? e.message : 'Không tải được kho tổng.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, branchId, search]);

  async function send() {
    if (submitLock.current || catalogError) return;
    if (!warehouses.some(w => w.id === warehouseId) || !items.length || items.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) {
      setError('Chọn kho tổng, thêm hàng và nhập số lượng lớn hơn 0.'); return;
    }
    submitLock.current = true; setSaving(true); setError('');
    const submittedBranch = branchId;
    try {
      const result = await submitWarehouseOrder({ branchId, warehouseId, requestId, note,
        items: items.map(i => ({ productId: i.id, quantity: i.quantity, ...(i.note ? { note: i.note } : {}) })) });
      if (!mounted.current || branchRef.current !== submittedBranch) return;
      clearDraft(); onOpenChange(false); onSuccess?.();
      toast({ title: `Đã gửi ${result.code}`, description: `Kho tổng nhận đơn ${result.salesOrderCode} trong Xử lý đặt hàng POS Retail.`, variant: 'success' });
    } catch (e) {
      if (mounted.current && branchRef.current === submittedBranch) setError(e instanceof Error ? e.message : 'Chưa gửi được đơn. Giữ nguyên nội dung và thử lại.');
    } finally { submitLock.current = false; if (mounted.current) setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={next => { if (!submitLock.current) onOpenChange(next); }}>
    <DialogContent className="flex h-[94dvh] max-h-[94dvh] w-[calc(100%-1rem)] max-w-none flex-col sm:w-[96vw] sm:max-w-7xl">
      <DialogHeader><DialogTitle>Đặt hàng nhập từ kho tổng</DialogTitle></DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
        <p className="text-sm text-muted-foreground">Gửi nhu cầu để kho tổng chuẩn bị hàng. Kho có thể điều chỉnh hàng thực giao; chi nhánh xác nhận khi nhận hàng.</p>
        <fieldset disabled={saving} className="space-y-4">
          <div className="sticky top-0 z-10 grid gap-3 bg-popover pb-3 md:grid-cols-3">
          <label className="block text-sm font-medium">Kho cung cấp
            <select aria-label="Kho cung cấp" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3">
              <option value="">Chọn kho tổng</option>
              {warehouses.map(w => <option key={w.supplierId} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <div className="md:col-span-2">
            <label htmlFor="fnb-supply-search" className="text-sm font-medium">Thêm hàng cần đặt</label>
            <Input id="fnb-supply-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm tên hoặc mã hàng" className="mt-1" />
            {search && !catalogError && <div aria-live="polite" className="mt-1 max-h-48 overflow-y-auto rounded-md border">
              {loading ? <p className="p-3 text-sm">Đang tìm hàng…</p> : products.length ? products.map(p => <button type="button" disabled={saving} key={p.id} className="block w-full p-3 text-left text-sm hover:bg-accent" onClick={() => {
                setItems(lines => lines.some(i => i.id === p.id) ? lines.map(i => i.id === p.id ? { ...i, quantity: i.quantity + 1 } : i) : [...lines, { ...p, quantity: 1 }]); setSearch('');
              }}><span className="font-medium">{p.name}</span><span className="ml-2 text-muted-foreground">{p.code} · {p.unit}</span>{p.matchKind === 'near' && <span className="ml-2 inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Gần đúng</span>}</button>) : <p className="p-3 text-sm">Không tìm thấy. Anh/chị có thể đề nghị mặt hàng mới ở ô ghi chú.</p>}
            </div>}
          </div>
          </div>
          <div className="divide-y rounded-md border">
            {items.length > 0 && <div aria-hidden="true" className="hidden gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[2rem_minmax(0,1fr)_6rem_2.5rem_minmax(10rem,15rem)]"><span>STT</span><span>Mặt hàng / ĐVT</span><span>Số lượng</span><span /><span>Ghi chú</span></div>}
            {!items.length ? <p className="p-4 text-sm text-muted-foreground">Chưa có mặt hàng. Tìm hàng phía trên để thêm.</p> : items.map((item, index) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-start gap-x-3 gap-y-2 px-3 py-2 md:grid-cols-[2rem_minmax(0,1fr)_6rem_2.5rem_minmax(10rem,15rem)]">
              <span className="hidden pt-2 text-sm tabular-nums text-muted-foreground md:block">{index + 1}</span>
              <div className="min-w-0"><p className="break-words font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.code} · {item.unit}</p></div>
              <NumericInput aria-label={`Số lượng ${item.name}`} className="h-9 w-24 text-right" value={item.quantity} min={0} decimals={4} onChange={value => setItems(lines => lines.map(i => i.id === item.id ? { ...i, quantity: value ?? 0 } : i))} />
              <Button variant="ghost" className="col-start-3 row-start-1 h-9 px-1 text-xs text-muted-foreground md:col-start-4" aria-label={`Bỏ ${item.name}`} onClick={() => setItems(lines => lines.filter(i => i.id !== item.id))}>Bỏ</Button>
              <div className="col-span-3 row-start-2 min-w-0 md:col-span-1 md:col-start-5 md:row-start-1">
                <label className="mb-1 block text-xs text-muted-foreground md:sr-only" htmlFor={`fnb-line-note-${item.id}`}>Ghi chú {item.code}</label>
                <textarea id={`fnb-line-note-${item.id}`} aria-label={`Ghi chú ${item.code}`} title={item.note || 'Ghi chú riêng cho mã hàng này'} value={item.note ?? ''} maxLength={2000} rows={1} className="h-9 min-h-9 w-full resize-none overflow-hidden rounded-md border border-border/60 bg-muted/15 px-2 py-0 text-xs leading-[34px] placeholder:text-muted-foreground/60 focus:min-h-20 focus:resize-y focus:overflow-y-auto focus:bg-background focus:py-2 focus:leading-5 focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Ghi chú…" onChange={e => setItems(lines => lines.map(i => i.id === item.id ? { ...i, note: e.target.value } : i))} />
              </div>
            </div>)}
          </div>
          <label className="block text-sm font-medium" htmlFor="fnb-supply-note">Ghi chú cho kho tổng / đề nghị mặt hàng mới</label>
          <textarea id="fnb-supply-note" value={note} maxLength={10000} onChange={e => setNote(e.target.value)} rows={3} className="w-full rounded-md border p-3 text-sm" placeholder="Ghi nhu cầu thêm, mặt hàng chưa có, quy cách hoặc lưu ý giao hàng…" />
        </fieldset>
        {(catalogError || error) && <p role="alert" className="text-sm text-destructive">{catalogError || error}</p>}
      </div>
      <DialogFooter className="border-t pt-3">
        <span className="mr-auto text-sm text-muted-foreground">{items.length} mặt hàng · Mã PO cấp khi gửi thành công</span>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Đóng</Button>
        <Button disabled={saving || !!catalogError || !warehouseId || !items.length} onClick={send}>{saving ? 'Đang gửi…' : 'Gửi đặt hàng'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
