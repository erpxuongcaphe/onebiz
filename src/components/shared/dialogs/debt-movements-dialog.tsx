"use client";

import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Icon} from '@/components/ui/icon';
import {ReportTableFrame} from '@/components/shared/report';
import {usePermissions} from '@/lib/permissions/use-permission';
import {cashDateTimeInput,formatCashBookDate} from '@/lib/cash-time';
import {formatCurrency} from '@/lib/format';
import {getDebtMovements,type DebtMovementReport,type DebtMovement} from '@/lib/services/supabase/debt-movements';
import {financeReportRangeError} from '@/lib/reports/finance-report-input';
import {exportToExcel} from '@/lib/utils/export';

const labels:Record<string,string>={invoice:'Hóa đơn',purchase_order:'Phiếu nhập',sales_return:'Trả hàng bán',supplier_return:'Trả NCC',cash:'Thu/chi',opening:'Đầu kỳ',adjustment:'Điều chỉnh',allocation:'Cấn ứng trước'};
function sourceLink(row:DebtMovement) {
  const routes:Record<string,string>={invoice:'/don-hang/hoa-don',purchase_order:'/hang-hoa/nhap-hang',sales_return:'/don-hang/tra-hang',supplier_return:'/hang-hoa/tra-hang-nhap'};
  return routes[row.kind]?`${routes[row.kind]}?focus=${encodeURIComponent(row.id)}`:null;
}
export function DebtMovementsDialog({open,onOpenChange,mode,partyId,partyName,branchId,branchLabel}:{open:boolean;onOpenChange:(value:boolean)=>void;mode:'customer'|'supplier';partyId:string;partyName:string;branchId?:string;branchLabel:string}) {
  const today=cashDateTimeInput().slice(0,10);
  const [from,setFrom]=useState(`${today.slice(0,7)}-01`);const [to,setTo]=useState(today);
  const [report,setReport]=useState<DebtMovementReport>();const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const [search,setSearch]=useState('');const [kind,setKind]=useState('');const [status,setStatus]=useState('');const [sort,setSort]=useState('date');const [direction,setDirection]=useState<'asc'|'desc'>('asc');const [page,setPage]=useState(0);
  const [revision,setRevision]=useState(0);const [expanded,setExpanded]=useState('');const [exporting,setExporting]=useState(false);
  const {hasPermission}=usePermissions();const rangeError=financeReportRangeError(from,to);
  useEffect(()=>{
    if(!open) return;
    setReport(undefined);setError('');setPage(0);setExpanded('');
    if(!branchId || rangeError) {setError(rangeError||'Chọn một chi nhánh trước khi xem biến động.');setLoading(false);return;}
    let active=true;setLoading(true);
    getDebtMovements(mode,partyId,branchId,from,to).then(data=>{if(active)setReport(data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Không tải được biến động công nợ.');}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[open,mode,partyId,branchId,from,to,revision,rangeError]);
  const rows=useMemo(()=>{
    const needle=search.trim().toLocaleLowerCase('vi');
    return (report?.items??[]).filter(r=>(!kind||r.kind===kind)&&(!status||r.status===status)&&(!needle||`${r.code} ${r.note} ${labels[r.kind]??r.kind}`.toLocaleLowerCase('vi').includes(needle)))
      .sort((a,b)=>{const cmp=sort==='amount'?a.amount-b.amount:sort==='balance'?a.balance-b.balance:sort==='code'?a.code.localeCompare(b.code,'vi',{numeric:true}):`${a.date}|${a.created_at}|${a.key}`.localeCompare(`${b.date}|${b.created_at}|${b.key}`);return direction==='asc'?cmp:-cmp;});
  },[report,search,kind,status,sort,direction]);
  const pages=Math.max(1,Math.ceil(rows.length/50));const currentPage=Math.min(page,pages-1);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="w-[calc(100vw-1rem)] max-w-[1200px] min-w-0"><DialogHeader><DialogTitle>Biến động công nợ · {partyName}</DialogTitle></DialogHeader>
    <div className="max-h-[75vh] overflow-y-auto min-w-0 space-y-3">
      <p className="text-sm font-medium">{branchLabel}</p>
      <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Từ ngày<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-sm">Đến ngày<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <Button variant="outline" disabled={loading} onClick={()=>setRevision(v=>v+1)}><Icon name="refresh"/>Tải lại</Button>
        {hasPermission('reports.export')&&<Button variant="outline" disabled={!report||loading||exporting||!!rangeError} onClick={async()=>{setExporting(true);setError('');try{await exportToExcel(rows.map(r=>({...r,kind:labels[r.kind]??r.kind,increase:Math.max(0,r.delta),decrease:Math.max(0,-r.delta),branch:branchLabel,party:partyName,period:`${from} - ${to}`,opening:report?.opening,closing:report?.closing,currentNet:report?.current_net,difference:report?.difference,basis:'Chứng từ hiện còn hiệu lực'})),[{header:'Đối tượng',key:'party'},{header:'Chi nhánh',key:'branch'},{header:'Kỳ',key:'period'},{header:'Ngày',key:'date'},{header:'Mã chứng từ',key:'code'},{header:'Loại',key:'kind'},{header:'Trạng thái',key:'status'},{header:'Giá trị chứng từ',key:'amount'},{header:'Tăng',key:'increase'},{header:'Giảm',key:'decrease'},{header:'Số dư sau dòng',key:'balance'},{header:'Đầu kỳ',key:'opening'},{header:'Cuối kỳ',key:'closing'},{header:'Số dư hiện tại',key:'currentNet'},{header:'Chênh đối soát hiện tại',key:'difference'},{header:'Cơ sở',key:'basis'},{header:'Ghi chú',key:'note'}],`Bien-dong-cong-no-${mode}-${from}-${to}`);}catch(e){setError(e instanceof Error?e.message:'Không xuất được file.');}finally{setExporting(false);}}}><Icon name="download"/>Xuất Excel</Button>}
      </div>
      {error&&<p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      {loading&&<p>Đang tải toàn bộ lịch sử…</p>}
      {report&&<>
        <div className="grid grid-cols-2 gap-3 border-y py-3 sm:grid-cols-4">{[['Đầu kỳ',report.opening],['Tăng',report.increase],['Giảm',report.decrease],['Cuối kỳ',report.closing]].map(([label,value])=><div key={label}><span className="text-xs text-muted-foreground">{label}</span><p className="font-semibold tabular-nums">{formatCurrency(Number(value))}</p></div>)}</div>
        <p className="text-xs text-muted-foreground">Số dư tái lập theo ngày của chứng từ hiện còn hiệu lực, không phải bản chụp trạng thái tại ngày quá khứ. Số dư âm là tiền trả trước/ứng còn được sử dụng. Cấn ứng không tạo thêm dòng tiền.</p>
        {(Math.abs(report.difference)>0.01||report.unmapped>0)&&<p role="alert" className="border-l-2 border-status-warning p-3 text-sm">Cần đối soát nguồn: chênh với số dư hiện tại {formatCurrency(report.difference)}; {report.unmapped} dòng chưa đủ căn cứ hoặc phiếu nhập nhận từng phần. Không tự bù chênh vào đầu kỳ.</p>}
        <div className="flex flex-wrap gap-2"><Input aria-label="Tìm biến động" placeholder="Mã chứng từ, ghi chú" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} className="min-w-40 flex-1"/>
          <select aria-label="Loại biến động" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}} className="h-10 rounded border bg-background px-2"><option value="">Tất cả loại</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Trạng thái biến động" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}} className="h-10 rounded border bg-background px-2"><option value="">Tất cả trạng thái</option>{[...new Set(report.items.map(r=>r.status))].map(s=><option key={s} value={s}>{s==='cancelled'?'Đã hủy':['completed','confirmed'].includes(s)?'Hoàn tất':s==='partial'?'Một phần':'Chưa hoàn tất'}</option>)}</select>
          <select aria-label="Sắp xếp biến động" value={sort} onChange={e=>setSort(e.target.value)} className="h-10 rounded border bg-background px-2"><option value="date">Ngày</option><option value="code">Mã</option><option value="amount">Giá trị</option><option value="balance">Số dư</option></select>
          <select aria-label="Chiều sắp xếp biến động" value={direction} onChange={e=>setDirection(e.target.value as 'asc'|'desc')} className="h-10 rounded border bg-background px-2"><option value="asc">Tăng dần</option><option value="desc">Giảm dần</option></select>
        </div>
        <p className="text-xs">{rows.length} kết quả lọc / {report.total} dòng. Số dư theo trình tự phát sinh, giữ nguyên khi lọc và sắp xếp.</p>
        <ReportTableFrame tablePreferenceKey="finance.debt.movements" allowColumnSelection={false}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Ngày','Mã chứng từ','Loại','Giá trị','Tăng','Giảm','Số dư','Trạng thái'].map(h=><th key={h} className="p-2 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{rows.slice(currentPage*50,(currentPage+1)*50).map(r=><DebtMovementRow key={r.key} row={r} expanded={expanded===r.key} onExpand={()=>setExpanded(expanded===r.key?'':r.key)}/>)}</tbody></table></div></ReportTableFrame>
        {!rows.length&&<p>Không có biến động trong bộ lọc.</p>}
        <div className="flex justify-end items-center gap-2 text-sm"><Button variant="outline" size="icon" title="Trang trước" aria-label="Trang trước" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><Icon name="chevron_left"/></Button><span>{currentPage+1}/{pages}</span><Button variant="outline" size="icon" title="Trang sau" aria-label="Trang sau" disabled={currentPage+1===pages} onClick={()=>setPage(currentPage+1)}><Icon name="chevron_right"/></Button></div>
      </>}
    </div>
  </DialogContent></Dialog>;
}
function DebtMovementRow({row:r,expanded,onExpand}:{row:DebtMovement;expanded:boolean;onExpand:()=>void}) {
  const link=sourceLink(r);
  return <><tr className="border-t"><td className="p-2 whitespace-nowrap">{formatCashBookDate(r.date)}</td><td className="p-2"><button className="text-primary font-medium" onClick={onExpand} aria-expanded={expanded}>{r.code}</button></td><td className="p-2">{labels[r.kind]??r.kind}</td>{[r.amount,Math.max(0,r.delta),Math.max(0,-r.delta),r.balance].map((v,i)=><td key={i} className="p-2 whitespace-nowrap text-right tabular-nums">{formatCurrency(v)}</td>)}<td className="p-2">{r.status==='cancelled'?'Đã hủy':['completed','confirmed'].includes(r.status)?'Hoàn tất':r.status==='partial'?'Một phần':'Chưa hoàn tất'}</td></tr>
    {expanded&&<tr><td colSpan={8} className="bg-muted/30 p-3 text-sm"><p className="break-words whitespace-pre-wrap">{r.note||'Không có ghi chú.'}</p>{link&&<Link href={link} className="inline-flex py-2 text-primary">Mở chứng từ và dòng hàng</Link>}{r.unmapped&&<p className="text-status-warning">Dòng này cần đối soát căn cứ ghi nhận.</p>}</td></tr>}</>;
}
