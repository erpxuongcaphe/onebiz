'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Icon} from '@/components/ui/icon';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {formatCurrency} from '@/lib/format';
import {formatCashBookDate,formatCashTime} from '@/lib/cash-time';
import {cashPaymentMethodLabel} from '@/lib/utils/cash-book-labels';
import {CASH_FLOW_LABELS,reconcileCashFlow} from '@/lib/utils/finance-report-reconciliation';
import type {CashFlowActivity} from '@/lib/services/supabase/management-finance';

export type CashFlowReconciliation = ReturnType<typeof reconcileCashFlow>;

export function CashFlowReconciliationTable({report}: {report: CashFlowReconciliation}) {
  const [activity,setActivity] = useState<CashFlowActivity | ''>('');
  const [search,setSearch] = useState('');
  const [sort,setSort] = useState('date_desc');
  const [page,setPage] = useState(0);
  const [selected,setSelected] = useState<CashFlowReconciliation['detail'][number]>();
  const query = search.trim().toLocaleLowerCase('vi');
  const rows = report.detail.filter(r => (!activity || r.activity === activity) && (!query || [r.code,r.eventCode,r.counterparty,r.category,r.categoryCode,r.branchName,r.performedByName].join(' ').toLocaleLowerCase('vi').includes(query)))
    .sort((a,b) => (sort === 'amount_desc' ? b.amount-a.amount : sort === 'amount_asc' ? a.amount-b.amount : sort === 'date_asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || a.id.localeCompare(b.id));
  const currentPage = Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));
  return <section className="space-y-3" aria-label="Đối soát dòng tiền theo hoạt động">
    <h2 className="text-base font-semibold">Dòng tiền theo hoạt động</h2>
    <div className="overflow-x-auto border rounded-md"><table className="w-full min-w-[600px] text-sm"><thead className="bg-muted"><tr>{['Hoạt động','Số phiếu','Thu','Chi','Ròng'].map(h => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{report.totals.map(r => <tr key={r.activity} className="border-t"><td className="p-3"><button className="text-primary" onClick={() => {setActivity(r.activity);setPage(0);}}>{CASH_FLOW_LABELS[r.activity]}</button></td>{[r.count,formatCurrency(r.receipt),formatCurrency(r.payment),formatCurrency(r.net)].map((value,i) => <td key={i} className="p-3 text-right tabular-nums">{value}</td>)}</tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td className="p-3">Tổng kỳ</td><td className="p-3 text-right">{report.detail.length}</td><td className="p-3 text-right">{formatCurrency(report.receipt)}</td><td className="p-3 text-right">{formatCurrency(report.payment)}</td><td className="p-3 text-right">{formatCurrency(report.receipt-report.payment)}</td></tr></tfoot></table></div>
    <p className="text-xs text-muted-foreground">Phiếu hoàn tất theo ngày hạch toán; mỗi phiếu tính một lần. Khoản chưa đủ căn cứ giữ ở Chưa phân loại. Lãi vay thuộc tài trợ; lãi tiền gửi thuộc đầu tư theo chính sách báo cáo quản trị này.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="grid gap-1 text-sm">Hoạt động<select className="h-10 border rounded-md bg-background px-3" value={activity} onChange={e => {setActivity(e.target.value as CashFlowActivity | '');setPage(0);}}><option value="">Tất cả</option>{Object.entries(CASH_FLOW_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Mã phiếu / đối tượng<Input value={search} onChange={e => {setSearch(e.target.value);setPage(0);}} type="search"/></label>
      <label className="grid gap-1 text-sm">Sắp xếp<select className="h-10 border rounded-md bg-background px-3" value={sort} onChange={e => {setSort(e.target.value);setPage(0);}}><option value="date_desc">Ngày mới nhất</option><option value="date_asc">Ngày cũ nhất</option><option value="amount_desc">Số tiền cao nhất</option><option value="amount_asc">Số tiền thấp nhất</option></select></label>
    </div>
    <div className="overflow-x-auto border rounded-md"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted"><tr>{['Phiếu','Ngày hạch toán','Khoản mục / nguồn','Chi nhánh / người thực hiện','Đối tượng','Thu','Chi'].map(h => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{rows.slice(currentPage*50,(currentPage+1)*50).map(r => <tr key={r.id} className="border-t"><td className="p-3"><button className="text-primary" onClick={() => setSelected(r)}>{r.code}</button></td><td className="p-3 whitespace-nowrap">{formatCashBookDate(r.date)}</td><td className="p-3">{r.category}<span className="block text-xs text-muted-foreground">{r.categoryCode || CASH_FLOW_LABELS[r.activity]}{r.eventCode && ` · ${r.eventCode}`}</span></td><td className="p-3">{r.branchName || 'Chưa ghi nhận'}<span className="block text-xs text-muted-foreground">{r.performedByName || 'Chưa ghi nhận'}</span></td><td className="p-3">{r.counterparty}</td><td className="p-3 text-right tabular-nums">{r.type === 'receipt' ? formatCurrency(r.amount) : '—'}</td><td className="p-3 text-right tabular-nums">{r.type === 'payment' ? formatCurrency(r.amount) : '—'}</td></tr>)}</tbody></table>{!rows.length && <p className="p-4 text-sm text-muted-foreground">Không có phiếu khớp bộ lọc.</p>}</div>
    <div className="flex items-center justify-between text-sm"><span>{rows.length} phiếu · trang {currentPage+1}</span><div className="flex gap-2"><Button variant="outline" size="icon" title="Trang trước" aria-label="Trang trước" disabled={!currentPage} onClick={() => setPage(currentPage-1)}><Icon name="chevron_left"/></Button><Button variant="outline" size="icon" title="Trang sau" aria-label="Trang sau" disabled={(currentPage+1)*50>=rows.length} onClick={() => setPage(currentPage+1)}><Icon name="chevron_right"/></Button></div></div>
    <Dialog open={!!selected} onOpenChange={open => {if (!open) setSelected(undefined);}}><DialogContent><DialogHeader><DialogTitle>Phiếu {selected?.code}</DialogTitle></DialogHeader>{selected && <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">{[['Loại',selected.type === 'receipt' ? 'Thu' : 'Chi'],['Số tiền',formatCurrency(selected.amount)],['Ngày hạch toán',formatCashBookDate(selected.date)],['Thực thu / chi',selected.occurredAt ? formatCashTime(selected.occurredAt) : 'Chưa ghi nhận'],['Hoạt động',CASH_FLOW_LABELS[selected.activity]],['Khoản mục',selected.category],['Khoản ghi nhận',selected.eventCode || 'Chưa liên kết'],['Chứng từ gốc',selected.referenceCode || 'Chưa liên kết'],['Chi nhánh',selected.branchName || 'Chưa ghi nhận'],['Người thực hiện',selected.performedByName || 'Chưa ghi nhận'],['Người tạo',selected.createdByName || 'Chưa ghi nhận'],['Hình thức',cashPaymentMethodLabel(selected.paymentMethod)],['Đối tượng',selected.counterparty],['Nội dung',selected.note || '—']].map(([label,value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-words min-w-0">{value}</dd></div>)}</dl>}</DialogContent></Dialog>
  </section>;
}
