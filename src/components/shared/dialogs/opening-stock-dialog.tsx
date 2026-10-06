"use client";

import { useRef,useState } from "react";
import Link from "next/link";
import { ImportExcelDialog } from "./import-excel-dialog";
import { initialStockExcelSchema, type InitialStockImportRow } from "@/lib/excel/schemas";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import { commitOpeningStock, previewOpeningStock, openingPurposeLabels, type OpeningPurpose, type OpeningPreviewRow } from "@/lib/services/supabase/opening-stock";
const unitCostFormat=new Intl.NumberFormat("en-US",{maximumFractionDigits:6});

function localNow() {
  const date=new Date();
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export function OpeningStockDialog({open,onOpenChange,onFinished}: {
  open:boolean;onOpenChange:(open:boolean)=>void;onFinished:()=>void;
}) {
  const [purpose,setPurpose]=useState<OpeningPurpose>("migration");
  const requestGeneration=useRef(0);
  const [sourceAt,setSourceAt]=useState(localNow);
  const [reason,setReason]=useState("");
  const [preview,setPreview]=useState<OpeningPreviewRow[]>([]);
  const [zeroConfirmed,setZeroConfirmed]=useState(false);
  const [prepared,setPrepared]=useState<{id:string;rows:InitialStockImportRow[];purpose:OpeningPurpose;sourceAt:string;reason:string;fileName:string}|null>(null);
  const needsZero=preview.some(row=>row.quantity>0&&row.costPrice===0);
  async function prepare(rows:InitialStockImportRow[],file:File) {
    const generation=++requestGeneration.current;
    setPrepared(null);setPreview([]);setZeroConfirmed(false);
    const date=new Date(sourceAt);
    if(!reason.trim()||!Number.isFinite(date.getTime())) throw new Error("Nhập lý do và ngày giờ chốt dữ liệu trước khi chọn file.");
    if(purpose==="opening_cost" && rows.some(row=>row.quantity===0)) throw new Error("Bổ sung giá vốn dùng cho hàng đang có lượng dương. Hãy bỏ các dòng lượng 0 hoặc chọn mục đích khởi tạo tồn.");
    const next=await previewOpeningStock(rows);
    if(generation!==requestGeneration.current) throw new Error("Lượt xem trước đã đóng.");
    if(purpose==="opening_cost"&&next.some(row=>row.delta!==0)) throw new Error("Bổ sung giá vốn giữ nguyên số lượng. Hãy điền lượng đúng bằng tồn đang có tại quán.");
    setPreview(next);
    setPrepared({id:crypto.randomUUID(),rows,purpose,sourceAt:date.toISOString(),reason:reason.trim(),fileName:file.name});
  }
  return <ImportExcelDialog open={open} onOpenChange={next=>{if(!next){requestGeneration.current++;setPrepared(null);}onOpenChange(next);}} schema={initialStockExcelSchema}
    preparePreview={prepare} onFinished={onFinished} retryOnFailure
    confirmDisabled={!prepared || (needsZero&&!zeroConfirmed)}
    onCommit={async()=>{
      if(!prepared) throw new Error("Chọn lại file để cập nhật xem trước.");
      const result=await commitOpeningStock({...prepared,preview});
      return {successCount:result.count,failureCount:0,errors:[]};
    }}
    uploadContent={<div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label htmlFor="opening-purpose" className="text-sm font-medium">Mục đích</label>
          <select id="opening-purpose" value={purpose} onChange={event=>setPurpose(event.target.value as OpeningPurpose)} className="w-full h-11 border rounded-md bg-background px-3 text-sm">
            {Object.entries(openingPurposeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
        <div className="space-y-1"><label htmlFor="opening-source-at" className="text-sm font-medium">Ngày giờ chốt ở nguồn cũ</label>
          <Input id="opening-source-at" type="datetime-local" value={sourceAt} onChange={event=>setSourceAt(event.target.value)} /></div>
      </div>
      <div className="space-y-1"><label htmlFor="opening-reason" className="text-sm font-medium">Lý do / nguồn đối chiếu</label>
        <Input id="opening-reason" value={reason} maxLength={500} onChange={event=>setReason(event.target.value)} placeholder="VD: Chuyển tồn quán từ phần mềm cũ sau khi chốt ca" /></div>
      <p className="text-xs text-muted-foreground">Ngày giờ nguồn dùng để đối chiếu; hệ thống ghi nhận khi anh/chị xác nhận, không sửa ngược lịch sử.</p>
    </div>}
    instructions={<ul className="list-disc pl-4 space-y-1">
      <li>Một file, một chi nhánh. Chi nhánh nhận tồn theo mã trong file; kiểm tra ở bước xem trước.</li>
      <li>Nhập mã nguyên liệu, bao bì hoặc bán thành phẩm giữ tồn. Mã phải có sẵn.</li>
      <li>Lượng và đơn giá theo đơn vị tồn Onebiz. Mã không có trong file giữ nguyên.</li>
      <li>Đã có phát sinh thì đổi lượng tại <Link className="text-primary underline" href="/hang-hoa/kiem-kho">Kiểm kho</Link>; không ghi đè đầu kỳ để sửa lịch sử.</li>
      <li>Toàn bộ file cùng thành công hoặc không ghi. Không tạo công nợ hay phiếu thu/chi.</li>
    </ul>}
    previewContent={<div className="space-y-3">
      <div className="border-b pb-3 text-sm space-y-1">
        <p><b className="text-primary">{preview[0]?.branchCode}</b> · {prepared&&openingPurposeLabels[prepared.purpose]} · {preview.length} mã</p>
        <p>Giá trị tồn trong file: <b>{formatCurrency(preview.reduce((sum,row)=>sum+Number(row.value),0))}</b></p>
        <p className="text-muted-foreground">{prepared?.reason} · Chốt nguồn: {prepared&&new Date(prepared.sourceAt).toLocaleString("vi-VN")}</p>
        <p className="text-muted-foreground">{preview[0]?.fnb ? "Giá vốn riêng của quán; không đổi giá Retail." : "Chi nhánh này dùng giá vốn danh mục chung. Không cho đổi giá nếu chi nhánh khác đang có hàng."}</p>
      </div>
      <div className="overflow-x-auto border rounded-md"><table className="w-full text-sm min-w-[630px]">
        <thead className="bg-primary/5 text-primary"><tr>{["Mã / tên hàng","ĐVT","Đang có","Sau nhập","Thay đổi","Giá vốn","Giá trị"].map(label=><th key={label} className="p-2 text-left font-medium">{label}</th>)}</tr></thead>
        <tbody>{preview.map(row=><tr key={row.productId} className="border-t">
          <td className="p-2"><b>{row.productCode}</b><p className="text-muted-foreground">{row.productName}</p></td>
          <td className="p-2">{row.unit}</td><td className="p-2 tabular-nums">{formatStockQuantity(row.quantityBefore)}</td>
          <td className="p-2 tabular-nums font-medium">{formatStockQuantity(row.quantity)}</td>
          <td className="p-2 tabular-nums text-primary">{row.delta>0?"+":""}{formatStockQuantity(row.delta)}</td>
          <td className="p-2 tabular-nums">{unitCostFormat.format(row.costPrice)}</td><td className="p-2 tabular-nums">{formatCurrency(row.value)}</td>
        </tr>)}</tbody></table></div>
      {preview.some(row=>row.lotNumber||row.expiryDate)&&<div className="text-xs text-muted-foreground space-y-1">{preview.filter(row=>row.lotNumber||row.expiryDate).map(row=><p key={row.productId}>{row.productCode}: lô {row.lotNumber??"tự tạo"} · HSD {row.expiryDate??"chưa xác định"}</p>)}</div>}
      {needsZero&&<label className="flex gap-2 items-start bg-status-warning/10 p-3 text-sm">
        <Checkbox checked={zeroConfirmed} onCheckedChange={value=>setZeroConfirmed(value===true)} aria-label="Xác nhận giá vốn bằng 0" />
        Tôi xác nhận những dòng có hàng nhưng giá vốn 0 là chủ ý, không phải thiếu dữ liệu.
      </label>}
      <p className="text-xs text-muted-foreground">Nếu tồn thay đổi trong lúc xem, hệ thống yêu cầu xem lại trước khi ghi. Mã đã có lịch sử giá vốn giữ nguyên khi lượng và đơn giá khớp.</p>
    </div>} />;
}
