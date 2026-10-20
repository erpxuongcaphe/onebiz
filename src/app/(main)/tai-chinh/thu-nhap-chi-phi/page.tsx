"use client";

import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/lib/contexts';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Icon} from '@/components/ui/icon';
import {SearchableSelect} from '@/components/ui/searchable-select';
import {PageHeader} from '@/components/shared/page-header';
import {ReportTableFrame} from '@/components/shared/report';
import {financeReportRangeError} from '@/lib/reports/finance-report-input';
import {cashPaymentMethodLabel} from '@/lib/utils/cash-book-labels';
import {ManagementFinanceDialog} from '@/components/shared/dialogs/management-finance-dialog';
import {FinanceImportDialog} from '@/components/shared/dialogs/finance-import-dialog';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog';
import {cashDateTimeInput, formatCashBookDate, formatCashTime} from '@/lib/cash-time';
import {formatCurrency,formatNumber} from '@/lib/format';
import {CASH_FLOW_LABELS, summarizeRecognition} from '@/lib/utils/finance-report-reconciliation';
import {exportToExcel} from '@/lib/utils/export';
import {financeCategoryMonths} from '@/lib/reports/finance-category-months';
import {getFinanceCategories, getFinanceWorkspace, getAllFinanceRows, saveFinanceCategory, cancelFinanceDocument,
  type FinanceKind, type CashFlowActivity, type FinanceCategory, type FinanceEvent, type FinanceFilters, type FinanceWorkspace} from '@/lib/services/supabase/management-finance';

export default function ManagementFinancePage() {
  const {activeBranchId:globalBranchId, branches, hasPermission, isLoading} = useAuth();
  const [localBranch,setLocalBranch]=useState<string>();
  const [urlReady,setUrlReady]=useState(false);
  useEffect(()=>{setLocalBranch(new URLSearchParams(window.location.search).get('branch')??undefined);setUrlReady(true);},[]);
  const branchDenied=!!localBranch && localBranch!=='all' && !branches?.some(branch=>branch.id===localBranch);
  const activeBranchId=localBranch==='all'?undefined:localBranch??globalBranchId;
  const cashBranchName = (id: string) => branches?.find(branch => branch.id === id)?.name ?? 'Chưa xác định';
  const today = cashDateTimeInput().slice(0, 10);
  const [filters, setFilters] = useState<FinanceFilters>({from: today.slice(0, 7) + '-01', to: today, kind: 'expense'});
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const initialCategoryApplied=useRef(false);
  const internalCategory=categories.find(category=>category.code==='CP-VH-NOIBO' && category.kind==='expense' && !category.is_group);
  const internalView=!!internalCategory && filters.kind==='expense' && filters.categoryId===internalCategory.id;
  const [data, setData] = useState<FinanceWorkspace | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settling, setSettling] = useState<FinanceEvent>();
  const [expanded, setExpanded] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryKind, setCategoryKind] = useState<FinanceKind>('expense');
  const [categoryTarget, setCategoryTarget] = useState<((id: string) => void) | null>(null);
  const [parentId, setParentId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [cashFlowActivity, setCashFlowActivity] = useState<CashFlowActivity>('unclassified');
  const [view, setView] = useState<'documents' | 'categories' | 'months'>('documents');
  const [categoryRows, setCategoryRows] = useState<FinanceEvent[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [cancelling, setCancelling] = useState<FinanceEvent>();
  const [reason, setReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const canRead = urlReady && !branchDenied && hasPermission('finance.view_cash_book');
  const canCreate = hasPermission('finance.create_transaction');
  const canCancel = hasPermission('finance.void_transaction');
  const canExport = hasPermission('reports.export');
  const scoped = {...filters, branchId: activeBranchId};
  const reportPeriod = new URLSearchParams({preset:'custom',from:filters.from,to:filters.to,view:'table',branch:activeBranchId??'all'}).toString();
  const rangeError = financeReportRangeError(filters.from, filters.to);

  useEffect(() => {
    if (isLoading || !canRead || rangeError) {setData(null); setLoading(false); return;}
    let active = true;
    setLoading(true); setError(''); setData(null);
    getFinanceWorkspace({...filters, branchId: activeBranchId}, page).then(result => {if (active) setData(result);})
      .catch(e => {if (active) setError(e instanceof Error ? e.message : 'Không tải được báo cáo.');})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [isLoading, canRead, activeBranchId, filters, page, revision, rangeError]);
  useEffect(() => {
    if (isLoading || !canRead) return;
    let active = true;
    getFinanceCategories().then(rows => {if (active) setCategories(rows);})
      .catch(e => {if (active) setError(e instanceof Error ? e.message : 'Không tải được khoản mục.');});
    return () => {active = false;};
  }, [isLoading, canRead]);
  useEffect(() => {setPage(0);}, [activeBranchId]);
  useEffect(() => {
    if (isLoading || !canRead || view === 'documents' || rangeError) {setCategoryRows([]); setCategoryLoading(false); return;}
    let active = true;
    setCategoryLoading(true); setCategoryRows([]); setError('');
    getAllFinanceRows({...filters,branchId:activeBranchId})
      .then(rows => {if (active) setCategoryRows(rows);})
      .catch(e => {if (active) setError(e instanceof Error ? e.message : 'Không tải đủ khoản ghi nhận.');})
      .finally(() => {if (active) setCategoryLoading(false);});
    return () => {active = false;};
  }, [isLoading,canRead,view,filters,activeBranchId,revision,rangeError]);
  const patch = useCallback((value: Partial<FinanceFilters>) => {setFilters(f => ({...f, ...value})); setPage(0);}, []);
  useEffect(()=>{
    if(initialCategoryApplied.current || !categories.length) return;
    initialCategoryApplied.current=true;
    if(new URLSearchParams(window.location.search).get('category')==='CP-VH-NOIBO' && internalCategory) {
      patch({kind:'expense',categoryId:internalCategory.id,paymentState:undefined});
    }
  },[categories,internalCategory,patch]);
  function openCategory(kind: FinanceKind, selectCreated?: (id: string) => void) {
    setCategoryKind(kind); setCategoryTarget(() => selectCreated ?? null); setCategoryOpen(true);
    setParentId(''); setCategoryCode(''); setCategoryName(''); setCashFlowActivity('unclassified'); setActionError('');
  }

  async function download() {
    if (!canExport || exporting || rangeError || loading || categoryLoading || error) return;
    setExporting(true); setError('');
    try {
      const rows = await getAllFinanceRows(scoped);
      if (view === 'months') {
        const matrix = financeCategoryMonths(rows, filters.from, filters.to, activeBranchId);
        await exportToExcel(matrix.rows.map(r => ({code:r.code,name:r.name,kind:r.kind === 'income' ? 'Thu nhập' : r.kind === 'expense' ? 'Chi phí' : 'Ngoài kết quả kinh doanh',total:r.total,...Object.fromEntries(matrix.months.map(m => [m,r.values[m] ?? 0]))})),
          [{header:'Mã khoản mục',key:'code'},{header:'Khoản mục',key:'name'},{header:'Loại',key:'kind'},...matrix.months.map(m => ({header:m,key:m})),{header:'Tổng ghi nhận',key:'total'}],`ghi-nhan-theo-thang-${filters.from}-${filters.to}`);
        return;
      }
      if (view === 'categories') {
        await exportToExcel(summarizeRecognition(rows).map(r => ({...r,kind:r.kind === 'income' ? 'Thu nhập' : r.kind === 'expense' ? 'Chi phí' : 'Ngoài kết quả kinh doanh'})),[
          {header:'Mã khoản mục',key:'code'},{header:'Khoản mục',key:'name'},{header:'Loại',key:'kind'},
          {header:'Số khoản',key:'count'},{header:'Ghi nhận trong bộ lọc',key:'amount'},
          {header:'Tổng khoản gốc',key:'totalSource'},{header:'Đã thanh toán toàn khoản đến cuối kỳ',key:'settled'},
          {header:'Còn phải thu / chi toàn khoản',key:'outstanding'},
        ],`ghi-nhan-theo-khoan-muc-${filters.from}-${filters.to}`);
        return;
      }
      await exportToExcel(rows.map(r => ({code: r.code, date: r.business_date, category: `${r.category_code} · ${r.category_name}`,
        counterparty: r.counterparty, amount: r.amount, recognized: r.report_amount, settled: r.source_type === 'internal_receipt' ? 'Theo đơn nội bộ' : r.settled_amount,
        status: r.status === 'posted' ? 'Đã ghi nhận' : 'Đã hủy',sourceOrder:r.source_sale_code,sku:r.source_product_code,product:r.source_product_name,quantity:r.source_quantity,unit:r.source_unit,unitPrice:r.source_unit_price,note:r.note,
        allocations: r.allocations.map(a => `${a.branch_name} / ${a.recognition_date}: ${a.amount}`).join('; '),
        cash: r.settlements.map(s => `${s.code} / ${cashBranchName(s.branch_id)} / ${formatCashBookDate(s.transaction_date)} / ${formatCashTime(s.occurred_at)} / ${s.performed_by_name || 'Chưa ghi nhận'} / ${cashPaymentMethodLabel(s.payment_method)} / ${s.status === 'cancelled' ? 'Đã hủy' : s.status === 'completed' ? 'Hoàn tất' : 'Chưa hoàn tất'}: ${s.amount}`).join('; '), creator: r.created_by_name})),
        [{header: 'Mã', key: 'code'}, {header: 'Ngày phát sinh', key: 'date'}, {header: 'Khoản mục', key: 'category'},
          {header: 'Đối tượng', key: 'counterparty'}, {header: 'Tổng khoản', key: 'amount'}, {header: 'Ghi nhận trong bộ lọc', key: 'recognized'},
          {header: 'Đã thanh toán toàn khoản đến cuối kỳ', key: 'settled'}, {header: 'Trạng thái', key: 'status'},
          {header:'Đơn nội bộ',key:'sourceOrder'},{header:'Mã hàng',key:'sku'},{header:'Mặt hàng',key:'product'},{header:'Số lượng',key:'quantity',precision:4},{header:'ĐVT',key:'unit'},{header:'Đơn giá',key:'unitPrice',precision:8},{header:'Nội dung',key:'note'},
          {header: 'Phân bổ', key: 'allocations'}, {header: 'Phiếu thu/chi', key: 'cash'}, {header: 'Người tạo', key: 'creator'}],
        `thu-nhap-chi-phi-${filters.from}-${filters.to}`,{financialTable:true});
    } catch (e) {setError(e instanceof Error ? e.message : 'Không xuất được báo cáo.');}
    finally {setExporting(false);}
  }

  async function saveCategory() {
    if (actionSaving) return;
    setActionSaving(true); setActionError('');
    try {
      const parent = categories.find(c => c.id === parentId && c.is_group);
      if (!parent || parent.kind !== categoryKind) throw new Error('Chọn nhóm khoản mục đúng loại.');
      const created = await saveFinanceCategory({code: categoryCode, name: categoryName, kind: parent.kind, parentId, cashFlowActivity});
      setCategories(await getFinanceCategories()); setCategoryOpen(false);
      categoryTarget?.(created.id); setCategoryTarget(null);
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

  if (isLoading || !urlReady) return <p className="p-6">Đang tải…</p>;
  if (branchDenied) return <p role="alert" className="p-6">Không có quyền xem chi phí tại chi nhánh này.</p>;
  if (!canRead) return <p className="p-6">Tài khoản chưa có quyền xem thu nhập / chi phí.</p>;
  return <div className="min-w-0 space-y-4 p-4 sm:p-6">
    <PageHeader title="Thu nhập và chi phí"/>
    <div role="tablist" aria-label="Loại nghiệp vụ tài chính" className="flex flex-wrap gap-1 border-b">
      {([['income','Thu nhập khác'],['expense','Chi phí'],['non_pnl','Ngoài kết quả kinh doanh']] as const).map(([kind,label]) => <button key={kind} role="tab" aria-selected={filters.kind === kind} className={`min-h-11 border-b-2 px-3 text-sm ${filters.kind === kind ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`} onClick={() => {patch({kind, categoryId: undefined}); setExpanded(undefined);}}>{label}</button>)}
    </div>
    {filters.kind==='expense'&&<div role="tablist" aria-label="Nhóm chi phí" className="flex flex-wrap gap-1 border-b">
      <button role="tab" aria-selected={!internalView} className={`min-h-10 border-b-2 px-3 text-sm ${!internalView?'border-primary font-semibold text-primary':'border-transparent text-muted-foreground'}`} onClick={()=>patch({categoryId:undefined,paymentState:undefined})}>Tất cả chi phí</button>
      <button role="tab" aria-selected={internalView} disabled={!internalCategory} className={`min-h-10 border-b-2 px-3 text-sm disabled:opacity-50 ${internalView?'border-primary font-semibold text-primary':'border-transparent text-muted-foreground'}`} onClick={()=>{patch({categoryId:internalCategory?.id,paymentState:undefined});setView('documents');}}>Vật tư nội bộ</button>
    </div>}
    <div className="flex flex-wrap gap-2">
      {canCreate && !internalView && <Button onClick={() => {setSettling(undefined); setOpen(true);}}><Icon name="add"/>{filters.kind === 'income' ? 'Ghi nhận thu nhập' : filters.kind === 'expense' ? 'Ghi nhận chi phí' : 'Ghi nhận khoản ngoài KQKD'}</Button>}
      {internalView&&<Button nativeButton={false} variant="outline" render={<Link href={`/hang-hoa/nhap-hang/noi-bo?branch=${encodeURIComponent(activeBranchId??'all')}`}/>}><Icon name="move_to_inbox"/>Phiếu nhận nội bộ</Button>}
      {canCreate && <Button variant="outline" disabled={!activeBranchId || !categories.length} onClick={()=>setImportOpen(true)}><Icon name="upload"/>Nhập tài chính</Button>}
      {canCreate && <Button variant="outline" onClick={() => openCategory(filters.kind ?? 'expense')}><Icon name="category"/>Thêm khoản mục</Button>}
      {canExport && <Button variant="outline" disabled={loading || categoryLoading || exporting || !data || !!error || !!rangeError} onClick={download}><Icon name="download"/>{exporting ? 'Đang xuất…' : 'Xuất Excel'}</Button>}
      <Button variant="outline" onClick={() => setRevision(r => r + 1)} disabled={loading}><Icon name="refresh"/>Tải lại</Button>
      <Button variant="outline" onClick={() => {const [year,month]=today.split('-').map(Number); patch({from:new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,10),to:new Date(Date.UTC(year,month-1,0)).toISOString().slice(0,10)});}}><Icon name="calendar_today"/>Tháng trước</Button>
      <Button nativeButton={false} variant="outline" render={<Link href="/so-quy"/>}><Icon name="payments"/>Sổ quỹ</Button>
      <Button nativeButton={false} variant="outline" render={<Link href={`/phan-tich/bao-cao-tai-chinh?${reportPeriod}`}/>}><Icon name="bar_chart"/>Kết quả kinh doanh</Button>
      <Button nativeButton={false} variant="outline" render={<Link href={`/phan-tich/luong-tien?${reportPeriod}`}/>}><Icon name="payments"/>Dòng tiền</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">Chi nhánh ghi nhận<select className="h-10 min-w-0 rounded-md border bg-background px-2" value={localBranch??globalBranchId??'all'} onChange={e=>{setLocalBranch(e.target.value);setPage(0);}}><option value="all">Tất cả chi nhánh được phép</option>{branches?.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Ghi nhận từ ngày<Input type="date" value={filters.from} onChange={e => patch({from: e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Đến ngày<Input type="date" value={filters.to} onChange={e => patch({to: e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Khoản mục<SearchableSelect value={filters.categoryId} onValueChange={value => patch({categoryId: value || undefined})} placeholder="Tất cả khoản mục"
        options={[{value: '', label: 'Tất cả khoản mục'}, ...categories.filter(c => !c.is_group && c.kind === filters.kind).map(c => ({value: c.id, label: c.name, meta: c.code}))]}/></label>
      <label className="grid gap-1 text-sm">Mã / đối tượng<Input type="search" value={filters.search ?? ''} onChange={e => patch({search: e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Trạng thái<select className="h-10 rounded-md border bg-background px-3" value={filters.status ?? ''} onChange={e => patch({status: e.target.value as FinanceFilters['status'] || undefined})}><option value="">Tất cả</option><option value="posted">Đã ghi nhận</option><option value="cancelled">Đã hủy</option></select></label>
      <label className="grid gap-1 text-sm">Thanh toán đến cuối kỳ<select className="h-10 rounded-md border bg-background px-3" value={filters.paymentState ?? ''} onChange={e => patch({paymentState: e.target.value as FinanceFilters['paymentState'] || undefined})}><option value="">Tất cả</option><option value="unpaid">Chưa thanh toán</option><option value="partial">Một phần</option><option value="paid">Đủ</option></select></label>
      <label className="grid gap-1 text-sm">Sắp xếp<select className="h-10 rounded-md border bg-background px-3" value={filters.sort ?? 'date_desc'} onChange={e => patch({sort: e.target.value as FinanceFilters['sort']})}><option value="date_desc">Ngày phát sinh mới nhất</option><option value="date_asc">Ngày phát sinh cũ nhất</option><option value="amount_desc">Ghi nhận cao nhất</option><option value="amount_asc">Ghi nhận thấp nhất</option></select></label>
    </div>
    {(rangeError || error) && <p role="alert" className="text-sm text-destructive break-words">{rangeError || error}</p>}
    {data && <div className="grid gap-4 border-y py-3 sm:grid-cols-3">
      <div><span className="text-sm text-muted-foreground">{filters.kind === 'income' ? 'Thu nhập khác ghi nhận' : filters.kind === 'expense' ? 'Chi phí ghi nhận' : 'Ngoài kết quả kinh doanh'}</span><p className="font-semibold tabular-nums">{formatCurrency(data.summary[filters.kind ?? 'expense'])}</p></div>
      <div><span className="text-sm text-muted-foreground">Số khoản theo bộ lọc</span><p className="font-semibold tabular-nums">{new Intl.NumberFormat('en-US').format(data.total)}</p></div>
      <div><span className="text-sm text-muted-foreground">Chi nhánh ghi nhận</span><p className="font-semibold">{activeBranchId ? cashBranchName(activeBranchId) : 'Các chi nhánh được phép'}</p></div>
    </div>}
    <div role="tablist" aria-label="Góc nhìn thu nhập chi phí" className="flex border-b gap-4">
      {([['documents','Theo chứng từ'],['categories','Theo khoản mục'],['months','Theo tháng']] as const).map(([value,label]) => <button key={value} role="tab" aria-selected={view === value} className={`py-2 text-sm border-b-2 ${view === value ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground'}`} onClick={() => setView(value)}>{label}</button>)}
    </div>
    {view === 'months' && <FinanceMonthTable rows={categoryRows} from={filters.from} to={filters.to} branchId={activeBranchId} loading={categoryLoading} error={rangeError || error} />}
    {view === 'categories' && <FinanceCategoryTable rows={categoryRows} loading={categoryLoading} error={rangeError || error} onSelect={code => {const cat = categories.find(c => c.code === code); if (cat) {patch({categoryId:cat.id}); setView('documents');}}}/>}
    {view === 'documents' && <><ReportTableFrame tablePreferenceKey="finance.recognition.documents" allowColumnSelection={false}><div className="overflow-x-auto border rounded-md">
      <table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted"><tr>{['Khoản ghi nhận','Ngày phát sinh',...(internalView?['Đơn nội bộ','Mã hàng / tên hàng','Số lượng','ĐVT','Đơn giá','Chi nhánh ghi nhận']:['Khoản mục / đối tượng']),'Ghi nhận trong bộ lọc','Đã thanh toán toàn khoản','Trạng thái',''].map((h, i) => <th key={i} className="p-3 text-left whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{data?.items.map(r => <FinanceRow key={r.id} row={r} internalView={internalView} cashBranchName={cashBranchName} expanded={expanded === r.id} onExpand={() => setExpanded(expanded === r.id ? undefined : r.id)}
          canSettle={canCreate && r.status === 'posted'} onSettle={() => {setSettling(r); setOpen(true);}}
          canCancel={canCancel && r.status === 'posted'} onCancel={() => {setCancelling(r); setReason(''); setActionError('');}}/>)}</tbody>
      </table>
      {loading && <p className="p-6 text-center">Đang tải số liệu…</p>}
      {!loading && data?.items.length === 0 && <p className="p-6 text-center text-muted-foreground">Không có khoản ghi nhận trong bộ lọc.</p>}
    </div></ReportTableFrame>
    <div className="flex items-center justify-between gap-2 text-sm"><span>{data?.total ?? 0} khoản · trang {page + 1}</span><div className="flex gap-2">
      <Button variant="outline" size="icon" aria-label="Trang trước" title="Trang trước" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}><Icon name="chevron_left"/></Button>
      <Button variant="outline" size="icon" aria-label="Trang sau" title="Trang sau" disabled={loading || !data || (page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}><Icon name="chevron_right"/></Button>
    </div></div></>}
    <ManagementFinanceDialog key={settling?.id ?? filters.kind} open={open} onOpenChange={setOpen} categories={categories} event={settling} recordKind={filters.kind ?? 'expense'} onCreateCategory={openCategory} onSuccess={() => setRevision(r => r + 1)}/>
    <FinanceImportDialog open={importOpen} onOpenChange={setImportOpen} categories={categories} onFinished={()=>setRevision(r=>r+1)}/>
    <Dialog open={categoryOpen} onOpenChange={value => {if (!actionSaving) setCategoryOpen(value);}}><DialogContent><DialogHeader><DialogTitle>Thêm khoản mục {categoryKind === 'income' ? 'thu nhập' : categoryKind === 'expense' ? 'chi phí' : 'ngoài KQKD'}</DialogTitle></DialogHeader>
      <label className="grid gap-1 text-sm">Nhóm khoản mục<SearchableSelect disabled={actionSaving} value={parentId} onValueChange={setParentId} options={categories.filter(c => c.is_group && c.kind === categoryKind).map(c => ({value: c.id, label: c.name, meta: c.code}))} placeholder="Chọn nhóm"/></label>
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

function FinanceCategoryTable({rows,loading,error,onSelect}: {rows:FinanceEvent[];loading:boolean;error:string;onSelect:(code:string) => void}) {
  if (loading) return <p>Đang tải toàn bộ khoản ghi nhận…</p>;
  if (error) return null;
  let groups: ReturnType<typeof summarizeRecognition>;
  try {groups = summarizeRecognition(rows);} catch (e) {return <p role="alert" className="text-destructive">{e instanceof Error ? e.message : 'Không đối soát được khoản ghi nhận.'}</p>;}
  return <section aria-label="Ghi nhận theo khoản mục" className="min-w-0 space-y-2">
    <ReportTableFrame tablePreferenceKey="finance.recognition.categories"><div className="overflow-x-auto border rounded-md">
      <table className="w-full min-w-[900px] text-sm"><thead className="bg-muted"><tr>{['Khoản mục','Loại','Số khoản','Ghi nhận trong bộ lọc','Tổng khoản gốc','Đã thanh toán đến cuối kỳ','Còn phải thu / chi toàn khoản'].map((h,i) => <th key={h} className={`p-3 ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead><tbody>
        {groups.map(r => <tr key={`${r.kind}:${r.code}`} className="border-t hover:bg-muted/30"><td className="p-3"><button className="text-primary text-left font-medium" onClick={() => onSelect(r.code)}>{r.name}<span className="block text-xs text-muted-foreground">{r.code}</span></button></td><td className="p-3">{r.kind === 'income' ? 'Thu nhập' : r.kind === 'expense' ? 'Chi phí' : 'Ngoài kết quả kinh doanh'}</td>{[r.count,formatCurrency(r.amount),formatCurrency(r.totalSource),formatCurrency(r.settled),formatCurrency(r.outstanding)].map((value,i) => <td key={i} className="p-3 text-right tabular-nums">{value}</td>)}</tr>)}
      </tbody></table>
    </div></ReportTableFrame>
    {!groups.length && <p className="text-sm text-muted-foreground">Không có khoản đang ghi nhận trong bộ lọc.</p>}
    <p className="text-xs text-muted-foreground">Đã hủy không cộng vào bảng. Thanh toán và số còn lại tính trên toàn khoản đến ngày cuối kỳ, không chia theo tỷ lệ chi nhánh.</p>
  </section>;
}

function FinanceMonthTable({rows,from,to,branchId,loading,error}: {rows:FinanceEvent[];from:string;to:string;branchId?:string;loading:boolean;error:string}) {
  if (loading) return <p>Đang tải toàn bộ khoản ghi nhận…</p>;
  if (error) return null;
  let matrix: ReturnType<typeof financeCategoryMonths>;
  try {matrix = financeCategoryMonths(rows,from,to,branchId);} catch (e) {return <p role="alert" className="text-destructive">{e instanceof Error ? e.message : 'Kỳ báo cáo không hợp lệ.'}</p>;}
  return <section aria-label="Thu nhập chi phí theo tháng" className="min-w-0 space-y-2">
    <ReportTableFrame tablePreferenceKey="finance.recognition.months"><div className="overflow-x-auto border rounded-md"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-left">Khoản mục</th><th className="p-3 text-left">Loại</th>{matrix.months.map(m => <th key={m} className="p-3 text-right whitespace-nowrap">{m}</th>)}<th className="p-3 text-right whitespace-nowrap">Tổng ghi nhận</th></tr></thead><tbody>
      {matrix.rows.map(r => <tr key={`${r.kind}:${r.code}`} className="border-t"><td className="sticky left-0 bg-background p-3 whitespace-nowrap"><strong>{r.name}</strong><span className="block text-xs text-muted-foreground">{r.code}</span></td><td className="p-3 whitespace-nowrap">{r.kind === 'income' ? 'Thu nhập' : r.kind === 'expense' ? 'Chi phí' : 'Ngoài kết quả kinh doanh'}</td>{matrix.months.map(m => <td key={m} className="p-3 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.values[m] ?? 0)}</td>)}<td className="p-3 text-right font-semibold tabular-nums">{formatCurrency(r.total)}</td></tr>)}
    </tbody></table></div></ReportTableFrame>
    {!matrix.rows.length && <p className="text-sm text-muted-foreground">Không có khoản ghi nhận trong bộ lọc.</p>}
  </section>;
}

function FinanceRow({row: r, internalView, cashBranchName, expanded, onExpand, canSettle, onSettle, canCancel, onCancel}: {row: FinanceEvent; internalView:boolean; cashBranchName:(id:string) => string; expanded: boolean; onExpand: () => void; canSettle: boolean; onSettle: () => void; canCancel: boolean; onCancel: () => void}) {
  const fromReceipt = r.source_type === 'internal_receipt';
  return <><tr className="border-t">
    <td className="p-3"><button className="text-primary font-medium" onClick={onExpand} aria-expanded={expanded}>{r.code}</button></td>
    <td className="p-3">{formatCashBookDate(r.business_date)}</td>{internalView?<><td className="p-3">{r.source_sale_code??'—'}</td><td className="p-3"><div className="font-medium">{r.source_product_code??'—'}</div><div>{r.source_product_name??r.note}</div></td><td className="p-3 text-right tabular-nums">{r.source_quantity==null?'—':formatNumber(r.source_quantity)}</td><td className="p-3">{r.source_unit??'—'}</td><td className="p-3 text-right tabular-nums">{r.source_unit_price==null?'—':formatCurrency(r.source_unit_price)}</td><td className="p-3">{[...new Set(r.allocations.map(a=>a.branch_name))].join(', ')}</td></>:<td className="p-3"><div>{r.category_name}</div><div className="text-muted-foreground">{r.counterparty}</div></td>}
    <td className="p-3 text-right tabular-nums">{formatCurrency(r.report_amount)}</td><td className="p-3 text-right tabular-nums">{fromReceipt ? 'Theo đơn nội bộ' : formatCurrency(r.settled_amount)}</td>
    <td className="p-3">{r.status === 'cancelled' ? 'Đã hủy' : 'Đã ghi nhận'}</td><td className="p-3">{canSettle && !fromReceipt && <Button size="sm" variant="outline" onClick={onSettle}><Icon name="payments"/>Thanh toán</Button>}</td>
  </tr>{expanded && <tr className="border-t bg-muted/30"><td colSpan={internalView?12:7} className="p-4 space-y-3">
    <p>Tổng khoản: <strong>{formatCurrency(r.amount)}</strong> · Người tạo: {r.created_by_name}</p>
    <div className="grid gap-4 lg:grid-cols-2"><div><h3 className="font-medium mb-2">Phân bổ ghi nhận</h3>{r.allocations.map((a, i) => <p key={i}>{a.branch_name} · {formatCashBookDate(a.recognition_date)} · {formatCurrency(a.amount)}</p>)}</div>
      <div className="min-w-0"><h3 className="font-medium mb-2">{fromReceipt?'Thanh toán theo đơn gốc':'Phiếu thu / chi liên kết'}</h3>{r.settlements.length === 0 ? <p>{fromReceipt?'Theo đơn nội bộ; không phát sinh phiếu chi riêng.':'Chưa có phiếu thu / chi.'}</p> : <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-background"><tr>{['Mã phiếu','Chi nhánh thu/chi','Ngày chứng từ','Thực thu/chi','Người thu/chi','Phương thức','Số tiền','Trạng thái'].map(h => <th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{r.settlements.map(s => <tr key={s.id} className="border-t"><td className="p-2 font-medium whitespace-nowrap">{s.code}</td><td className="p-2">{cashBranchName(s.branch_id)}</td><td className="p-2 whitespace-nowrap">{formatCashBookDate(s.transaction_date)}</td><td className="p-2 whitespace-nowrap">{formatCashTime(s.occurred_at)}</td><td className="p-2">{s.performed_by_name || 'Chưa ghi nhận'}</td><td className="p-2">{cashPaymentMethodLabel(s.payment_method)}</td><td className="p-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(s.amount)}</td><td className="p-2">{s.status === 'cancelled' ? 'Đã hủy' : s.status === 'completed' ? 'Hoàn tất' : 'Chưa hoàn tất'}</td></tr>)}</tbody></table></div>}</div></div>
    {r.note && <p className="break-words">{r.note}</p>}
    {fromReceipt && <div className="border-l-2 border-amber-500 pl-3 text-sm"><Link className="font-medium text-primary underline" href={`/hang-hoa/nhap-hang/noi-bo?sale=${encodeURIComponent(r.source_sale_id ?? '')}&branch=${encodeURIComponent(r.allocations[0]?.branch_id ?? '')}`}>Phiếu nhận nội bộ</Link>{r.can_view_consolidated_cost && <p>Chi phí hợp nhất: {r.consolidated_amount == null ? 'Chưa có giá vốn nguồn' : formatCurrency(r.consolidated_amount)}</p>}</div>}
    {canCancel && !fromReceipt && <Button size="sm" variant="outline" onClick={onCancel}><Icon name="cancel"/>Hủy ghi nhận</Button>}
  </td></tr>}</>;
}
