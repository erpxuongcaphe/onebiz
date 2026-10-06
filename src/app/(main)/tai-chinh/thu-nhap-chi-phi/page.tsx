"use client";

import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/lib/contexts';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Icon} from '@/components/ui/icon';
import {SearchableSelect} from '@/components/ui/searchable-select';
import {PageHeader} from '@/components/shared/page-header';
import {ManagementFinanceDialog} from '@/components/shared/dialogs/management-finance-dialog';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog';
import {cashDateTimeInput, formatCashBookDate, formatCashTime} from '@/lib/cash-time';
import {formatCurrency} from '@/lib/format';
import {CASH_FLOW_LABELS, summarizeRecognition} from '@/lib/utils/finance-report-reconciliation';
import {exportToExcel} from '@/lib/utils/export';
import {getFinanceCategories, getFinanceWorkspace, getAllFinanceRows, saveFinanceCategory, cancelFinanceDocument,
  type CashFlowActivity, type FinanceCategory, type FinanceEvent, type FinanceFilters, type FinanceWorkspace} from '@/lib/services/supabase/management-finance';

export default function ManagementFinancePage() {
  const {activeBranchId, hasPermission, isLoading} = useAuth();
  const today = cashDateTimeInput().slice(0, 10);
  const [filters, setFilters] = useState<FinanceFilters>({from: today.slice(0, 7) + '-01', to: today});
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [data, setData] = useState<FinanceWorkspace | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState<FinanceEvent>();
  const [expanded, setExpanded] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [parentId, setParentId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [cashFlowActivity, setCashFlowActivity] = useState<CashFlowActivity>('unclassified');
  const [view, setView] = useState<'documents' | 'categories'>('documents');
  const [categoryRows, setCategoryRows] = useState<FinanceEvent[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [cancelling, setCancelling] = useState<FinanceEvent>();
  const [reason, setReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const canRead = hasPermission('finance.view_cash_book');
  const canCreate = hasPermission('finance.create_transaction');
  const canCancel = hasPermission('finance.void_transaction');
  const scoped = {...filters, branchId: activeBranchId};

  useEffect(() => {
    if (isLoading || !canRead) return;
    let active = true;
    setLoading(true); setError(''); setData(null);
    getFinanceWorkspace({...filters, branchId: activeBranchId}, page).then(result => {if (active) setData(result);})
      .catch(e => {if (active) setError(e instanceof Error ? e.message : 'Không tải được báo cáo.');})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [isLoading, canRead, activeBranchId, filters, page, revision]);
  useEffect(() => {
    if (isLoading || !canRead) return;
    let active = true;
    getFinanceCategories().then(rows => {if (active) setCategories(rows);})
      .catch(e => {if (active) setError(e instanceof Error ? e.message : 'Không tải được khoản mục.');});
    return () => {active = false;};
  }, [isLoading, canRead]);
  useEffect(() => {setPage(0);}, [activeBranchId]);
  useEffect(() => {
    if (isLoading || !canRead || view !== 'categories') return;
    let active = true;
    setCategoryLoading(true); setCategoryRows([]); setError('');
    getAllFinanceRows({...filters,branchId:activeBranchId})
      .then(rows => {if (active) setCategoryRows(rows);})
      .catch(e => {if (active) setError(e instanceof Error ? e.message : 'Không tải đủ khoản ghi nhận.');})
      .finally(() => {if (active) setCategoryLoading(false);});
    return () => {active = false;};
  }, [isLoading,canRead,view,filters,activeBranchId,revision]);
  const patch = useCallback((value: Partial<FinanceFilters>) => {setFilters(f => ({...f, ...value})); setPage(0);}, []);

  async function download() {
    setExporting(true); setError('');
    try {
      const rows = await getAllFinanceRows(scoped);
      if (view === 'categories') {
        await exportToExcel(summarizeRecognition(rows),[
          {header:'Mã khoản mục',key:'code'},{header:'Khoản mục',key:'name'},{header:'Loại',key:'kind'},
          {header:'Số khoản',key:'count'},{header:'Ghi nhận trong bộ lọc',key:'amount'},
          {header:'Tổng khoản gốc',key:'totalSource'},{header:'Đã thanh toán toàn khoản đến cuối kỳ',key:'settled'},
          {header:'Còn phải thu / chi toàn khoản',key:'outstanding'},
        ],`ghi-nhan-theo-khoan-muc-${filters.from}-${filters.to}`);
        return;
      }
      await exportToExcel(rows.map(r => ({code: r.code, date: r.business_date, category: `${r.category_code} · ${r.category_name}`,
        counterparty: r.counterparty, amount: r.amount, recognized: r.report_amount, settled: r.settled_amount,
        status: r.status === 'posted' ? 'Đã ghi nhận' : 'Đã hủy',
        allocations: r.allocations.map(a => `${a.branch_name} / ${a.recognition_date}: ${a.amount}`).join('; '),
        cash: r.settlements.map(s => `${s.code} / ${s.transaction_date} / ${s.status}: ${s.amount}`).join('; '), creator: r.created_by_name})),
        [{header: 'Mã', key: 'code'}, {header: 'Ngày phát sinh', key: 'date'}, {header: 'Khoản mục', key: 'category'},
          {header: 'Đối tượng', key: 'counterparty'}, {header: 'Tổng khoản', key: 'amount'}, {header: 'Ghi nhận trong bộ lọc', key: 'recognized'},
          {header: 'Đã thanh toán toàn khoản đến cuối kỳ', key: 'settled'}, {header: 'Trạng thái', key: 'status'},
          {header: 'Phân bổ', key: 'allocations'}, {header: 'Phiếu thu/chi', key: 'cash'}, {header: 'Người tạo', key: 'creator'}],
        `thu-nhap-chi-phi-${filters.from}-${filters.to}`);
    } catch (e) {setError(e instanceof Error ? e.message : 'Không xuất được báo cáo.');}
    finally {setExporting(false);}
  }

  async function saveCategory() {
    if (actionSaving) return;
    setActionSaving(true); setActionError('');
    try {
      const parent = categories.find(c => c.id === parentId && c.is_group);
      if (!parent) throw new Error('Chọn nhóm khoản mục.');
      await saveFinanceCategory({code: categoryCode, name: categoryName, kind: parent.kind, parentId, cashFlowActivity});
      setCategories(await getFinanceCategories()); setCategoryOpen(false);
    } catch (e) {setActionError(e instanceof Error ? e.message : 'Chưa lưu được khoản mục.');}
    finally {setActionSaving(false);}
  }
  async function cancelDocument() {
    if (!cancelling || actionSaving) return;
    setActionSaving(true); setActionError('');
    try {
      await cancelFinanceDocument(cancelling.id, reason);
      setCancelling(undefined); setRevision(r => r + 1);
    } catch (e) {setActionError(e instanceof Error ? e.message : 'Chưa hủy được khoản ghi nhận.');}
    finally {setActionSaving(false);}
  }

  if (isLoading) return <p className="p-6">Đang tải…</p>;
  if (!canRead) return <p className="p-6">Tài khoản chưa có quyền xem thu nhập / chi phí.</p>;
  return <div className="space-y-4 p-4 sm:p-6">
    <PageHeader title="Thu nhập và chi phí"/>
    <div className="flex flex-wrap gap-2">
      {canCreate && <Button onClick={() => {setSettling(undefined); setOpen(true);}} disabled={!categories.length}><Icon name="add"/>Ghi nhận mới</Button>}
      {canCreate && <Button variant="outline" onClick={() => {setCategoryOpen(true); setParentId(''); setCategoryCode(''); setCategoryName(''); setCashFlowActivity('unclassified'); setActionError('');}}><Icon name="category"/>Thêm khoản mục</Button>}
      <Button variant="outline" disabled={loading || exporting || !data} onClick={download}><Icon name="download"/>{exporting ? 'Đang xuất…' : 'Xuất Excel'}</Button>
      <Button variant="outline" onClick={() => setRevision(r => r + 1)} disabled={loading}><Icon name="refresh"/>Tải lại</Button>
      <Button variant="outline" render={<Link href="/so-quy"/>}><Icon name="payments"/>Sổ quỹ</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">Ghi nhận từ ngày<Input type="date" value={filters.from} onChange={e => patch({from: e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Đến ngày<Input type="date" value={filters.to} onChange={e => patch({to: e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Loại khoản<select className="h-10 rounded-md border bg-background px-3" value={filters.kind ?? ''} onChange={e => patch({kind: e.target.value as FinanceFilters['kind'] || undefined, categoryId: undefined})}><option value="">Tất cả</option><option value="expense">Chi phí</option><option value="income">Thu nhập</option><option value="non_pnl">Ngoài kết quả kinh doanh</option></select></label>
      <label className="grid gap-1 text-sm">Khoản mục<SearchableSelect value={filters.categoryId} onValueChange={value => patch({categoryId: value || undefined})} placeholder="Tất cả khoản mục"
        options={[{value: '', label: 'Tất cả khoản mục'}, ...categories.filter(c => !c.is_group && (!filters.kind || c.kind === filters.kind)).map(c => ({value: c.id, label: c.name, meta: c.code}))]}/></label>
      <label className="grid gap-1 text-sm">Mã / đối tượng<Input type="search" value={filters.search ?? ''} onChange={e => patch({search: e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Trạng thái<select className="h-10 rounded-md border bg-background px-3" value={filters.status ?? ''} onChange={e => patch({status: e.target.value as FinanceFilters['status'] || undefined})}><option value="">Tất cả</option><option value="posted">Đã ghi nhận</option><option value="cancelled">Đã hủy</option></select></label>
      <label className="grid gap-1 text-sm">Thanh toán đến cuối kỳ<select className="h-10 rounded-md border bg-background px-3" value={filters.paymentState ?? ''} onChange={e => patch({paymentState: e.target.value as FinanceFilters['paymentState'] || undefined})}><option value="">Tất cả</option><option value="unpaid">Chưa thanh toán</option><option value="partial">Một phần</option><option value="paid">Đủ</option></select></label>
      <label className="grid gap-1 text-sm">Sắp xếp<select className="h-10 rounded-md border bg-background px-3" value={filters.sort ?? 'date_desc'} onChange={e => patch({sort: e.target.value as FinanceFilters['sort']})}><option value="date_desc">Ngày phát sinh mới nhất</option><option value="date_asc">Ngày phát sinh cũ nhất</option><option value="amount_desc">Ghi nhận cao nhất</option><option value="amount_asc">Ghi nhận thấp nhất</option></select></label>
    </div>
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {data && <div className="grid gap-4 border-y py-3 sm:grid-cols-3">
      <div><span className="text-sm text-muted-foreground">Thu nhập ghi nhận</span><p className="font-semibold">{formatCurrency(data.summary.income)}</p></div>
      <div><span className="text-sm text-muted-foreground">Chi phí ghi nhận</span><p className="font-semibold">{formatCurrency(data.summary.expense)}</p></div>
      <div><span className="text-sm text-muted-foreground">Ngoài kết quả kinh doanh</span><p className="font-semibold">{formatCurrency(data.summary.non_pnl)}</p></div>
    </div>}
    <div role="tablist" aria-label="Góc nhìn thu nhập chi phí" className="flex border-b gap-4">
      {([['documents','Theo chứng từ'],['categories','Theo khoản mục']] as const).map(([value,label]) => <button key={value} role="tab" aria-selected={view === value} className={`py-2 text-sm border-b-2 ${view === value ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground'}`} onClick={() => setView(value)}>{label}</button>)}
    </div>
    {view === 'categories' && <section aria-label="Ghi nhận theo khoản mục" className="space-y-2">
      <div className="overflow-x-auto border rounded-md"><table className="w-full min-w-[750px] text-sm"><thead className="bg-muted"><tr>{['Khoản mục','Số khoản','Ghi nhận trong bộ lọc','Tổng khoản gốc','Đã thanh toán toàn khoản','Còn phải thu / chi toàn khoản'].map(h => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{summarizeRecognition(categoryRows).map(r => <tr key={`${r.kind}:${r.code}`} className="border-t"><td className="p-3"><button className="text-primary text-left" onClick={() => {const cat = categories.find(c => c.code === r.code); if (cat) {patch({categoryId:cat.id}); setView('documents');}}}>{r.name}<span className="block text-xs text-muted-foreground">{r.code}</span></button></td>{[r.count,formatCurrency(r.amount),formatCurrency(r.totalSource),formatCurrency(r.settled),formatCurrency(r.outstanding)].map((value,i) => <td key={i} className="p-3 text-right tabular-nums">{value}</td>)}</tr>)}</tbody></table></div>
      {categoryLoading && <p>Đang tải toàn bộ khoản ghi nhận…</p>}
      {!categoryLoading && !categoryRows.length && !error && <p className="text-sm text-muted-foreground">Không có khoản ghi nhận trong bộ lọc.</p>}
      <p className="text-xs text-muted-foreground">Đã hủy không cộng vào bảng. Thanh toán và số còn lại tính trên toàn khoản đến ngày cuối kỳ, không chia giả theo tỷ lệ chi nhánh.</p>
    </section>}
    {view === 'documents' && <><div className="overflow-x-auto border rounded-md">
      <table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted"><tr>{['Khoản ghi nhận','Ngày phát sinh','Khoản mục / đối tượng','Ghi nhận trong bộ lọc','Đã thanh toán toàn khoản','Trạng thái',''].map((h, i) => <th key={i} className="p-3 text-left whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{data?.items.map(r => <FinanceRow key={r.id} row={r} expanded={expanded === r.id} onExpand={() => setExpanded(expanded === r.id ? undefined : r.id)}
          canSettle={canCreate && r.status === 'posted'} onSettle={() => {setSettling(r); setOpen(true);}}
          canCancel={canCancel && r.status === 'posted'} onCancel={() => {setCancelling(r); setReason(''); setActionError('');}}/>)}</tbody>
      </table>
      {loading && <p className="p-6 text-center">Đang tải số liệu…</p>}
      {!loading && data?.items.length === 0 && <p className="p-6 text-center text-muted-foreground">Không có khoản ghi nhận trong bộ lọc.</p>}
    </div>
    <div className="flex items-center justify-between gap-2 text-sm"><span>{data?.total ?? 0} khoản · trang {page + 1}</span><div className="flex gap-2">
      <Button variant="outline" size="icon" aria-label="Trang trước" title="Trang trước" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}><Icon name="chevron_left"/></Button>
      <Button variant="outline" size="icon" aria-label="Trang sau" title="Trang sau" disabled={loading || !data || (page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}><Icon name="chevron_right"/></Button>
    </div></div></>}
    <ManagementFinanceDialog open={open} onOpenChange={setOpen} categories={categories} event={settling} onSuccess={() => setRevision(r => r + 1)}/>
    <Dialog open={categoryOpen} onOpenChange={value => {if (!actionSaving) setCategoryOpen(value);}}><DialogContent><DialogHeader><DialogTitle>Thêm khoản mục chi tiết</DialogTitle></DialogHeader>
      <label className="grid gap-1 text-sm">Nhóm khoản mục<SearchableSelect value={parentId} onValueChange={setParentId} options={categories.filter(c => c.is_group).map(c => ({value: c.id, label: c.name, meta: c.code}))} placeholder="Chọn nhóm"/></label>
      <label className="grid gap-1 text-sm">Mã khoản mục<Input value={categoryCode} maxLength={32} onChange={e => setCategoryCode(e.target.value.toUpperCase())}/></label>
      <label className="grid gap-1 text-sm">Tên khoản mục<Input value={categoryName} onChange={e => setCategoryName(e.target.value)}/></label>
      <label className="grid gap-1 text-sm">Hoạt động dòng tiền<select value={cashFlowActivity} className="h-10 rounded-md border bg-background px-3" onChange={e => setCashFlowActivity(e.target.value as CashFlowActivity)}>{Object.entries(CASH_FLOW_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      <DialogFooter><Button variant="outline" disabled={actionSaving} onClick={() => setCategoryOpen(false)}>Đóng</Button><Button disabled={actionSaving} onClick={saveCategory}><Icon name="save"/>{actionSaving ? 'Đang lưu…' : 'Lưu'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!cancelling} onOpenChange={value => {if (!value && !actionSaving) setCancelling(undefined);}}><DialogContent><DialogHeader><DialogTitle>Hủy ghi nhận {cancelling?.code}</DialogTitle></DialogHeader>
      <p className="text-sm">Phiếu thu/chi liên kết phải được hủy trong Sổ quỹ trước. Lịch sử ghi nhận vẫn được giữ.</p>
      <label className="grid gap-1 text-sm">Lý do hủy<Input value={reason} onChange={e => setReason(e.target.value)}/></label>
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      <DialogFooter><Button variant="outline" disabled={actionSaving} onClick={() => setCancelling(undefined)}>Đóng</Button><Button variant="destructive" disabled={actionSaving || reason.trim().length < 3} onClick={cancelDocument}>Hủy ghi nhận</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}

function FinanceRow({row: r, expanded, onExpand, canSettle, onSettle, canCancel, onCancel}: {row: FinanceEvent; expanded: boolean; onExpand: () => void; canSettle: boolean; onSettle: () => void; canCancel: boolean; onCancel: () => void}) {
  return <><tr className="border-t">
    <td className="p-3"><button className="text-primary font-medium" onClick={onExpand} aria-expanded={expanded}>{r.code}</button></td>
    <td className="p-3">{formatCashBookDate(r.business_date)}</td><td className="p-3"><div>{r.category_name}</div><div className="text-muted-foreground">{r.counterparty}</div></td>
    <td className="p-3 text-right tabular-nums">{formatCurrency(r.report_amount)}</td><td className="p-3 text-right tabular-nums">{formatCurrency(r.settled_amount)}</td>
    <td className="p-3">{r.status === 'cancelled' ? 'Đã hủy' : 'Đã ghi nhận'}</td><td className="p-3">{canSettle && <Button size="sm" variant="outline" onClick={onSettle}><Icon name="payments"/>Thanh toán</Button>}</td>
  </tr>{expanded && <tr className="border-t bg-muted/30"><td colSpan={7} className="p-4 space-y-3">
    <p>Tổng khoản: <strong>{formatCurrency(r.amount)}</strong> · Người tạo: {r.created_by_name}</p>
    <div className="grid gap-4 lg:grid-cols-2"><div><h3 className="font-medium mb-2">Phân bổ ghi nhận</h3>{r.allocations.map((a, i) => <p key={i}>{a.branch_name} · {formatCashBookDate(a.recognition_date)} · {formatCurrency(a.amount)}</p>)}</div>
      <div><h3 className="font-medium mb-2">Phiếu thu / chi liên kết</h3>{r.settlements.length === 0 ? <p>Chưa có phiếu thu / chi.</p> : r.settlements.map(s => <p key={s.id}>{s.code} · {formatCashTime(s.occurred_at)} · {s.performed_by_name || 'Chưa ghi nhận'} · {formatCurrency(s.amount)} · {s.status === 'cancelled' ? 'Đã hủy' : 'Hoàn tất'}</p>)}</div></div>
    {r.note && <p className="break-words">{r.note}</p>}
    {canCancel && <Button size="sm" variant="outline" onClick={onCancel}><Icon name="cancel"/>Hủy ghi nhận</Button>}
  </td></tr>}</>;
}
