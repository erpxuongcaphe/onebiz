"use client";
import {getFnbInvoiceExportDetails,fnbInvoiceItemExportColumns} from "@/lib/services/supabase/fnb-invoice-export-details";
import {fnbContextExportColumns} from "@/lib/utils/fnb-invoice-context";
import {useCallback,useEffect,useRef,useState} from "react";
import type {PhamViChiNhanh} from "@/lib/services/supabase/invoice-list-scope";
import {getInvoicesForFilteredExport,type InvoiceExportQuery,type InvoiceExportProgress} from "@/lib/services/supabase/invoice-list-export";
import {exportToExcel,exportToCsv} from "@/lib/utils/export";
import {formatDate} from "@/lib/format";
import {invoiceFnbTypeLabel,invoiceRetailTypeLabel} from "@/lib/utils/invoice-list-filters";

export function useInvoiceListExport(options:{
  scope: PhamViChiNhanh; query: InvoiceExportQuery|null; ready:boolean; allowed:boolean; fnb:boolean;
  onError:(message:string)=>void; onSuccess:(count:number)=>void;
}) {
  const [progress,setProgress]=useState<InvoiceExportProgress|null>(null);
  const active=useRef<AbortController|null>(null);
  const context=JSON.stringify([options.scope,options.query,options.ready,options.allowed,options.fnb]);
  useEffect(()=>()=>{active.current?.abort();},[context]);
  const cancel=useCallback(()=>{active.current?.abort();},[]);
  const start=async(type:"excel"|"csv")=>{
    if(active.current)return;
    if(!options.allowed){options.onError("Anh/chị chưa có quyền xuất hóa đơn.");return;}
    if(!options.ready||!options.query){options.onError("Chờ tải phạm vi và chọn khoảng ngày hợp lệ trước khi xuất.");return;}
    const controller=new AbortController();active.current=controller;setProgress({loaded:0,total:0});
    try {
      const rows=await getInvoicesForFilteredExport(options.scope,options.query,{signal:controller.signal,onProgress:setProgress});
      if(controller.signal.aborted)return;
      if(!rows.length){options.onError("Không có hóa đơn theo bộ lọc đã chọn.");return;}
      const details=await getFnbInvoiceExportDetails(rows,controller.signal);
      if(controller.signal.aborted)return;
      const records=rows.map(row=>({...row,fnbItemSummary:details.summaries.get(row.id)??"",invoiceTypeLabel:options.fnb?invoiceFnbTypeLabel(row.fnbOrderType):row.source==="fnb"?"F&B":invoiceRetailTypeLabel(row.retailSaleType)}));
      const statusLabels:Record<string,string>={completed:"Hoàn thành",processing:"Đang xử lý",cancelled:"Đã hủy",delivery_failed:"Giao thất bại"};
      const columns=[
        {header:"Mã HD",key:"code",width:15},
        {header:"Thời gian",key:"date",width:18,format:(v:string)=>formatDate(v)},
        {header:"Khách hàng",key:"customerName",width:25},
        {header:options.fnb?"Hình thức":"Loại bán",key:"invoiceTypeLabel",width:18},
        ...((options.fnb || rows.some(row=>row.source==="fnb")) ? fnbContextExportColumns : []),
        ...(type==="csv" && rows.some(row=>row.source==="fnb") ? [{header:"Chi tiết món và tùy chọn",key:"fnbItemSummary",width:50}] : []),
        {header:"Tổng tiền",key:"totalAmount",width:15},
        {header:"Giảm giá",key:"discount",width:15},
        {header:"Trạng thái",key:"status",width:15,format:(v:string)=>statusLabels[v]??v},
      ];
      // The final guard also runs after the lazy XLSX import and before download.
      const exportOptions={shouldSave:()=>!controller.signal.aborted,additionalSheets:details.items.length?[{name:"Chi tiết món",data:details.items,columns:fnbInvoiceItemExportColumns}]:[]};
      if(type==="excel")await exportToExcel(records,columns,"danh-sach-hoa-don",exportOptions);
      else await exportToCsv(records,columns,"danh-sach-hoa-don",exportOptions);
      if(!controller.signal.aborted)options.onSuccess(rows.length);
    }catch(error){
      if(!controller.signal.aborted)options.onError(error instanceof Error?error.message:"Không xuất được hóa đơn. Anh/chị vui lòng thử lại.");
    }finally{
      if(active.current===controller){active.current=null;setProgress(null);}
    }
  };
  return {start,cancel,progress};
}
