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
type Line = SupplyProduct & { quantity: number };

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
    setRequestId(crypto.randomUUID()); setError('');
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
    setProducts([]); setLoading(true); setError('');
    const timer = setTimeout(() => {
      getWarehouseOrderContext(branchId, search).then(result => {
        if (cancelled) return;
        setWarehouses(result.warehouses); setProducts(result.products);
        setWarehouseId(id => id || (result.warehouses.length === 1 ? result.warehouses[0].id : ''));
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được kho tổng.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, branchId, search]);

  async function send() {
    if (submitLock.current) return;
    if (!warehouses.some(w => w.id === warehouseId) || !items.length || items.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) {
      setError('Chọn kho tổng, thêm hàng và nhập số lượng lớn hơn 0.'); return;
    }
    submitLock.current = true; setSaving(true); setError('');
    const submittedBranch = branchId;
    try {
      const result = await submitWarehouseOrder({ branchId, warehouseId, requestId, note,
        items: items.map(i => ({ productId: i.id, quantity: i.quantity })) });
      if (!mounted.current || branchRef.current !== submittedBranch) return;
      clearDraft(); onOpenChange(false); onSuccess?.();
      toast({ title: `Đã gửi ${result.code}`, description: `Kho tổng nhận đơn ${result.salesOrderCode} trong Xử lý đặt hàng POS Retail.`, variant: 'success' });
    } catch (e) {
      if (mounted.current && branchRef.current === submittedBranch) setError(e instanceof Error ? e.message : 'Chưa gửi được đơn. Giữ nguyên nội dung và thử lại.');
    } finally { submitLock.current = false; if (mounted.current) setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={next => { if (!submitLock.current) onOpenChange(next); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-3xl">
      <DialogHeader><DialogTitle>Đặt hàng nhập từ kho tổng</DialogTitle></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto">
        <p className="text-sm text-muted-foreground">Gửi nhu cầu để kho tổng chuẩn bị hàng. Kho có thể điều chỉnh hàng thực giao; chi nhánh xác nhận khi nhận hàng.</p>
        <fieldset disabled={saving} className="space-y-4">
          <label className="block text-sm font-medium">Kho cung cấp
            <select aria-label="Kho cung cấp" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3">
              <option value="">Chọn kho tổng</option>
              {warehouses.map(w => <option key={w.supplierId} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <div>
            <label htmlFor="fnb-supply-search" className="text-sm font-medium">Thêm hàng cần đặt</label>
            <Input id="fnb-supply-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm tên hoặc mã hàng" className="mt-1" />
            {search && <div aria-live="polite" className="mt-1 max-h-48 overflow-y-auto rounded-md border">
              {loading ? <p className="p-3 text-sm">Đang tìm hàng…</p> : products.length ? products.map(p => <button type="button" disabled={saving} key={p.id} className="block w-full p-3 text-left text-sm hover:bg-accent" onClick={() => {
                setItems(lines => lines.some(i => i.id === p.id) ? lines.map(i => i.id === p.id ? { ...i, quantity: i.quantity + 1 } : i) : [...lines, { ...p, quantity: 1 }]); setSearch('');
              }}><span className="font-medium">{p.name}</span><span className="ml-2 text-muted-foreground">{p.code} · {p.unit}</span></button>) : <p className="p-3 text-sm">Không tìm thấy. Anh/chị có thể đề nghị mặt hàng mới ở ô ghi chú.</p>}
            </div>}
          </div>
          <div className="divide-y rounded-md border">
            {!items.length ? <p className="p-4 text-sm text-muted-foreground">Chưa có mặt hàng. Tìm hàng phía trên để thêm.</p> : items.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-40 flex-1"><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.code} · {item.unit}</p></div>
              <NumericInput aria-label={`Số lượng ${item.name}`} className="w-28 text-right" value={item.quantity} min={0} decimals={4} onChange={value => setItems(lines => lines.map(i => i.id === item.id ? { ...i, quantity: value ?? 0 } : i))} />
              <Button variant="ghost" aria-label={`Bỏ ${item.name}`} onClick={() => setItems(lines => lines.filter(i => i.id !== item.id))}>Bỏ</Button>
            </div>)}
          </div>
          <label className="block text-sm font-medium" htmlFor="fnb-supply-note">Ghi chú cho kho tổng / đề nghị mặt hàng mới</label>
          <textarea id="fnb-supply-note" value={note} maxLength={10000} onChange={e => setNote(e.target.value)} rows={3} className="w-full rounded-md border p-3 text-sm" placeholder="Ghi nhu cầu thêm, mặt hàng chưa có, quy cách hoặc lưu ý giao hàng…" />
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="border-t pt-3">
        <span className="mr-auto text-sm text-muted-foreground">{items.length} mặt hàng · Mã PO cấp khi gửi thành công</span>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Đóng</Button>
        <Button disabled={saving || !warehouseId || !items.length} onClick={send}>{saving ? 'Đang gửi…' : 'Gửi đặt hàng'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
