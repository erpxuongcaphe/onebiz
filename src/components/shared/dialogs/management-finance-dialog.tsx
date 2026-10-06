"use client";

import {useEffect, useRef, useState} from 'react';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Icon} from '@/components/ui/icon';
import {SearchableSelect} from '@/components/ui/searchable-select';
import {useAuth} from '@/lib/contexts';
import {cashDateTimeInput, cashInputToIso, validateCashTime} from '@/lib/cash-time';
import {CashTimeFields, useCashTimeDraft} from '@/components/shared/cash-time-fields';
import {getCashPerformers} from '@/lib/services/supabase/cash-timing';
import {useDurableFormDraft} from '@/lib/hooks/use-durable-form-draft';
import {FinanceRpcError, saveFinanceDocument, settleFinanceDocument,
  type FinanceCategory, type FinanceDocumentInput, type FinanceEvent, type FinancePayment} from '@/lib/services/supabase/management-finance';

type AllocationDraft = {branchId: string; recognitionDate: string; amount: string};
type Attempt = {requestId: string; payload: FinanceDocumentInput | FinancePayment};

export function ManagementFinanceDialog({open, onOpenChange, categories, event, onSuccess}: {
  open: boolean; onOpenChange: (open: boolean) => void; categories: FinanceCategory[];
  event?: FinanceEvent; onSuccess: () => void;
}) {
  const {branches, currentBranch, tenant, user} = useAuth();
  const submissionLock = useRef(false);
  const unreadableRequest = useRef(false);
  const requestKey = tenant && user ? `onebiz_finance_request_v1:${tenant.id}:${user.id}:${event?.id ?? 'new'}` : '';
  const today = cashDateTimeInput().slice(0, 10);
  const [categoryId, setCategoryId] = useState('');
  const [businessDate, setBusinessDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [paymentMode, setPaymentMode] = useState('unpaid');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cashBranch, setCashBranch] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [method, setMethod] = useState<FinancePayment['paymentMethod']>('cash');
  const [direction, setDirection] = useState<'receipt' | 'payment'>('payment');
  const [performers, setPerformers] = useState<Array<{id: string; name: string}>>([]);
  const [performerError, setPerformerError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const {cashTime, setCashTime} = useCashTimeDraft(open);
  const kind = event?.kind ?? categories.find(c => c.id === categoryId)?.kind;
  const branchOptions = branches.map(b => ({value: b.id, label: b.name}));

  useEffect(() => {
    if (!open) return;
    const date = cashDateTimeInput().slice(0, 10);
    setCategoryId(''); setBusinessDate(date); setAmount(''); setCounterparty(''); setNote('');
    setAllocations([{branchId: currentBranch?.id ?? '', recognitionDate: date, amount: ''}]);
    setCashBranch(currentBranch?.id ?? ''); setPaymentMode(event ? 'partial' : 'unpaid');
    setPaymentAmount(''); setAttempt(null); setError('');
    unreadableRequest.current = false;
    if (requestKey) {
      try {
        const stored = window.localStorage.getItem(requestKey);
        if (stored) {
          const pending = JSON.parse(stored) as Attempt;
          if (!pending.requestId || !pending.payload) throw new Error('Invalid pending request');
          setAttempt(pending);
        }
      } catch {unreadableRequest.current = true; setError('Không đọc được yêu cầu đang chờ. Chưa gửi phiếu mới.');}
    }
  }, [open, event?.id, currentBranch?.id, requestKey]);

  useEffect(() => {
    if (!open || !cashBranch) return;
    let active = true;
    setPerformedBy(''); setPerformers([]); setPerformerError('');
    getCashPerformers(cashBranch).then(rows => {if (active) setPerformers(rows);})
      .catch(() => {if (active) setPerformerError('Không tải được người thực hiện.');});
    return () => {active = false;};
  }, [open, cashBranch]);

  const {clearDraft} = useDurableFormDraft({
    form: 'management-finance', entityId: event?.id, open,
    onRequestOpen: () => onOpenChange(true),
    snapshot: {categoryId, businessDate, amount, counterparty, note, allocations, paymentMode, paymentAmount,
      cashBranch, performedBy, method, direction, cashTime, attempt},
    hasContent: d => !!d.amount || !!d.counterparty || !!d.attempt,
    restore: d => {
      setCategoryId(d.categoryId); setBusinessDate(d.businessDate); setAmount(d.amount); setCounterparty(d.counterparty);
      setNote(d.note); setAllocations(d.allocations); setPaymentMode(d.paymentMode); setPaymentAmount(d.paymentAmount);
      setCashBranch(d.cashBranch); setPerformedBy(d.performedBy); setMethod(d.method); setDirection(d.direction);
      setCashTime(d.cashTime); setAttempt(d.attempt);
    },
  });

  async function submit() {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setError('');
    let next = attempt;
    try {
      if (unreadableRequest.current) throw new Error('Cần đối soát yêu cầu đang chờ trước khi tạo phiếu mới.');
      if (!next) {
        let payment: FinancePayment | undefined;
        if (paymentMode !== 'unpaid' || event) {
          const timingError = validateCashTime(cashTime.occurredLocal, cashTime.transactionDate, cashTime.timeReason);
          if (timingError) throw new Error(timingError);
          if (!cashBranch || !performedBy) throw new Error('Chọn chi nhánh thu/chi và người thực hiện.');
          const value = Number(paymentMode === 'full' && !event ? amount : paymentAmount);
          if (!Number.isFinite(value) || value <= 0) throw new Error('Số tiền thanh toán phải lớn hơn 0.');
          payment = {branchId: cashBranch, performedBy, amount: value, paymentMethod: method, direction,
            transactionDate: cashTime.transactionDate, occurredAt: cashInputToIso(cashTime.occurredLocal), timeReason: cashTime.timeReason, note};
        }
        let payload: FinanceDocumentInput | FinancePayment;
        if (event) payload = payment!;
        else {
          const value = Number(amount);
          if (!categoryId || !counterparty.trim() || !Number.isFinite(value) || value <= 0) throw new Error('Điền khoản mục, đối tượng và số tiền hợp lệ.');
          payload = {categoryId, businessDate, amount: value, counterparty: counterparty.trim(), note,
            allocations: allocations.map(a => ({branchId: a.branchId, recognitionDate: a.recognitionDate, amount: Number(a.amount)})),
            ...(payment ? {payment} : {})};
        }
        next = {requestId: crypto.randomUUID(), payload};
        if (!requestKey) throw new Error('Chưa xác định tài khoản tạo phiếu.');
        // Persist synchronously before dispatch; a page reload must reuse the same request.
        window.localStorage.setItem(requestKey, JSON.stringify(next));
        setAttempt(next);
      }
      setSaving(true);
      if (event) await settleFinanceDocument(event.id, next.requestId, next.payload as FinancePayment);
      else await saveFinanceDocument(next.requestId, next.payload as FinanceDocumentInput);
      window.localStorage.removeItem(requestKey);
      clearDraft(); setAttempt(null); onSuccess(); onOpenChange(false);
    } catch (e) {
      // A confirmed SQL rejection rolls back; a transport failure must retain the exact retry payload.
      if (e instanceof FinanceRpcError && e.code && /^(22|23|42|PT)/.test(e.code)) {
        window.localStorage.removeItem(requestKey); setAttempt(null);
      }
      setError(e instanceof Error ? e.message : 'Chưa lưu được phiếu.');
    } finally {submissionLock.current = false; setSaving(false);}
  }

  const patchAllocation = (i: number, patch: Partial<AllocationDraft>) => setAllocations(rows => rows.map((r, n) => n === i ? {...r, ...patch} : r));
  return <Dialog open={open} onOpenChange={value => {if (!saving) onOpenChange(value);}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{event ? `Thanh toán ${event.code}` : 'Ghi nhận thu nhập / chi phí'}</DialogTitle></DialogHeader>
      <fieldset disabled={saving || !!attempt} className="space-y-4 min-w-0">
        {!event && <>
          <label className="grid gap-1 text-sm">Khoản mục
            <SearchableSelect disabled={saving || !!attempt} value={categoryId} onValueChange={setCategoryId} placeholder="Chọn khoản mục chi tiết"
              options={categories.filter(c => !c.is_group).map(c => ({value: c.id, label: c.name, meta: c.code}))}/>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Ngày phát sinh<Input type="date" max={today} value={businessDate} onChange={e => setBusinessDate(e.target.value)}/></label>
            <label className="grid gap-1 text-sm">Tổng số tiền<Input type="number" min="0.01" step="0.01" value={amount} onChange={e => {setAmount(e.target.value); if (allocations.length === 1) patchAllocation(0, {amount: e.target.value});}}/></label>
          </div>
          <label className="grid gap-1 text-sm">Đối tượng<Input value={counterparty} onChange={e => setCounterparty(e.target.value)}/></label>
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2"><h3 className="font-medium text-sm">Phân bổ ghi nhận</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => setAllocations(rows => [...rows, {branchId: '', recognitionDate: businessDate, amount: ''}])}><Icon name="add"/>Thêm phân bổ</Button></div>
            {allocations.map((a, i) => <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <label className="grid gap-1 text-sm">Chi nhánh<SearchableSelect disabled={saving || !!attempt} value={a.branchId} onValueChange={branchId => patchAllocation(i, {branchId})} options={branchOptions} placeholder="Chọn chi nhánh"/></label>
              <label className="grid gap-1 text-sm">Ngày ghi nhận<Input type="date" value={a.recognitionDate} onChange={e => patchAllocation(i, {recognitionDate: e.target.value})}/></label>
              <label className="grid gap-1 text-sm">Số tiền<Input type="number" min="0.01" step="0.01" value={a.amount} onChange={e => patchAllocation(i, {amount: e.target.value})}/></label>
              <Button type="button" variant="ghost" size="icon" title="Xóa phân bổ" aria-label="Xóa phân bổ" disabled={allocations.length === 1} onClick={() => setAllocations(rows => rows.filter((_, n) => n !== i))}><Icon name="delete"/></Button>
            </div>)}
          </div>
        </>}
        {!event && <label className="grid gap-1 text-sm">Thanh toán<select className="h-10 rounded-md border bg-background px-3" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
          <option value="unpaid">Chưa thu / chi</option><option value="full">Thu / chi đủ ngay</option><option value="partial">Thu / chi một phần</option></select></label>}
        {(event || paymentMode !== 'unpaid') && <div className="space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {(event || paymentMode === 'partial') && <label className="grid gap-1 text-sm">Số tiền lần này<Input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}/></label>}
            <label className="grid gap-1 text-sm">Chi nhánh thực thu / chi<SearchableSelect disabled={saving || !!attempt} value={cashBranch} onValueChange={setCashBranch} options={branchOptions} placeholder="Chọn chi nhánh"/></label>
            <label className="grid gap-1 text-sm">Người thực hiện<SearchableSelect disabled={saving || !!attempt} value={performedBy} onValueChange={setPerformedBy} options={performers.map(p => ({value: p.id, label: p.name}))} placeholder="Chọn người thực hiện"/></label>
            <label className="grid gap-1 text-sm">Hình thức<select className="h-10 rounded-md border bg-background px-3" value={method} onChange={e => setMethod(e.target.value as FinancePayment['paymentMethod'])}><option value="cash">Tiền mặt</option><option value="bank_transfer">Chuyển khoản</option><option value="card">Thẻ</option><option value="other">Khác</option></select></label>
            {kind === 'non_pnl' && <label className="grid gap-1 text-sm">Hướng tiền<select className="h-10 rounded-md border bg-background px-3" value={direction} onChange={e => setDirection(e.target.value as 'receipt' | 'payment')}><option value="receipt">Thu</option><option value="payment">Chi</option></select></label>}
          </div>
          {performerError && <p role="alert" className="text-sm text-destructive">{performerError}</p>}
          <CashTimeFields value={cashTime} onChange={setCashTime}/>
        </div>}
        <label className="grid gap-1 text-sm">Nội dung<Input value={note} onChange={e => setNote(e.target.value)}/></label>
      </fieldset>
      {attempt && !saving && <p className="text-sm text-amber-700">Chưa xác nhận kết quả lưu. Thử lại cùng yêu cầu để tránh ghi trùng.</p>}
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Đóng</Button><Button disabled={saving} onClick={submit}><Icon name="save"/>{saving ? 'Đang lưu…' : attempt ? 'Thử lại' : 'Lưu'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
