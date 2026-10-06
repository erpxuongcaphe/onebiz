"use client";
import { useEffect,useState } from "react";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency,formatDate,formatStockQuantity } from "@/lib/format";
import { listOpeningBatches,openingPurposeLabels,type OpeningBatch } from "@/lib/services/supabase/opening-stock";
import { exportToExcelFromSchema } from "@/lib/excel";
import { initialStockExcelSchema } from "@/lib/excel/schemas";
const unitCostFormat=new Intl.NumberFormat("en-US",{maximumFractionDigits:6});

export function OpeningStockHistoryDialog({open,onOpenChange,branchId,batchId}: {open:boolean;onOpenChange:(open:boolean)=>void;branchId?:string;batchId?:string}) {
  const [rows,setRows]=useState<OpeningBatch[]>([]);
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  useEffect(()=>{
    if(!open)return;
    let active=true;setBusy(true);setRows([]);setError("");setSelected(null);
    listOpeningBatches(branchId,batchId).then(data=>{if(active){setRows(data);if(batchId)setSelected(batchId);}}).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[open,branchId,batchId]);
  const detail=rows.find(row=>row.id===selected);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-4xl">
    <DialogHeader><DialogTitle>Lịch sử nhập tồn ban đầu</DialogTitle><DialogDescription>30 đợt gần nhất theo quyền và chi nhánh đang lọc. Phiếu đã ghi giữ nguyên lịch sử.</DialogDescription></DialogHeader>
    <div className="max-h-[65vh] overflow-auto space-y-3">
      {busy&&<p role="status">Đang tải lịch sử...</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
      {!busy&&!error&&!rows.length&&<p className="text-muted-foreground">Chưa có đợt nhập qua luồng tồn ban đầu mới.</p>}
      {rows.map(row=><button key={row.id} onClick={()=>setSelected(row.id)} className="w-full border-b p-3 text-left hover:bg-primary/5 focus-visible:outline-primary">
        <div className="flex flex-wrap justify-between gap-2"><b className="text-primary">{row.rows[0]?.branchCode} · {openingPurposeLabels[row.purpose]}</b><b>{formatCurrency(row.total_value)}</b></div>
        <p className="text-sm">{formatDate(row.created_at)} · {row.rows.length} mã · {row.reason}</p>
      </button>)}
      {detail&&<section className="border rounded-md p-3 space-y-2">
        <div className="flex flex-wrap gap-2 justify-between"><h3 className="font-semibold text-primary">Chi tiết đợt {detail.id.slice(0,8)}</h3><Button variant="outline" onClick={()=>exportToExcelFromSchema(detail.rows.map(row=>({...row,lotNumber:row.lotNumber??undefined,expiryDate:row.expiryDate?new Date(`${row.expiryDate}T00:00:00+07:00`):undefined})),initialStockExcelSchema)}>Xuất Excel</Button></div>
        <p className="text-sm">Chốt nguồn: {formatDate(detail.source_at)} · Ghi nhận: {formatDate(detail.created_at)}</p>
        <p className="text-sm text-muted-foreground">File: {detail.file_name??"—"} · Người ghi: {detail.created_by}</p>
        <div className="overflow-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-primary/5 text-primary"><tr>{["Mã hàng","ĐVT","Trước","Sau","Giá vốn","Giá trị"].map(label=><th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>
          {detail.rows.map(row=><tr key={row.productId} className="border-t"><td className="p-2">{row.productCode}<p className="text-muted-foreground">{row.productName}</p></td><td className="p-2">{row.unit}</td><td className="p-2">{formatStockQuantity(row.quantityBefore)}</td><td className="p-2">{formatStockQuantity(row.quantity)}</td><td className="p-2">{unitCostFormat.format(row.costPrice)}</td><td className="p-2">{formatCurrency(row.value)}</td></tr>)}
        </tbody></table></div>
      </section>}
    </div>
  </DialogContent></Dialog>;
}
