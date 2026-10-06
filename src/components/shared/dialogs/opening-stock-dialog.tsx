"use client";

import { useRef,useState } from "react";
import Link from "next/link";
import { ImportExcelDialog } from "./import-excel-dialog";
import { OpeningStockManualEntry, type OpeningEntrySummary } from "./opening-stock-manual-entry";
import { initialStockExcelSchema, type InitialStockImportRow } from "@/lib/excel/schemas";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import { commitOpeningStock, previewOpeningStock, openingPurposeLabels, type OpeningPurpose, type OpeningPreviewRow } from "@/lib/services/supabase/opening-stock";
const unitCostFormat=new Intl.NumberFormat("en-US",{maximumFractionDigits:6});
const purposeHelp:Record<OpeningPurpose,string>={migration:"Chuyển số dư đã chốt từ phần mềm đang dùng sang Onebiz.",new_branch:"Khởi tạo hàng thực có cho chi nhánh mới.",start_tracking:"Bắt đầu theo dõi kho cho hàng đang có; không thay lịch sử đã phát sinh.",opening_cost:"Bổ sung giá vốn ban đầu, giữ nguyên lượng đang có."};

function localNow() {
  const date=new Date();
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export function OpeningStockDialog({open,onOpenChange,onFinished,mode="file"}: {
  open:boolean;onOpenChange:(open:boolean)=>void;onFinished:()=>void;mode?:"file"|"manual";
}) {
  const [purpose,setPurpose]=useState<OpeningPurpose>("migration");
  const requestGeneration=useRef(0);
  const [sourceAt,setSourceAt]=useState(localNow);
  const [reason,setReason]=useState("");
  const [entrySummary,setEntrySummary]=useState<OpeningEntrySummary>({count:0,value:0,incomplete:0});
  const [preview,setPreview]=useState<OpeningPreviewRow[]>([]);
  const [zeroConfirmed,setZeroConfirmed]=useState(false);
  const [prepared,setPrepared]=useState<{id:string;rows:InitialStockImportRow[];purpose:OpeningPurpose;sourceAt:string;reason:string;fileName:string}|null>(null);
  const needsZero=preview.some(row=>row.quantity>0&&row.costPrice===0);
  async function prepare(rows:InitialStockImportRow[],file:File) {
    const generation=++requestGeneration.current;
    setPrepared(null);setPreview([]);setZeroConfirmed(false);
    const date=new Date(sourceAt);
    if(!reason.trim()||!Number.isFinite(date.getTime())) throw new Error("Nhập lý do và ngày giờ chốt dữ liệu trước khi xem trước.");
    if(date.getTime()>Date.now()+5*60*1000) throw new Error("Ngày giờ chốt dữ liệu không được ở tương lai. Kiểm tra lại giờ trên thiết bị hoặc chọn đúng thời điểm chốt nguồn.");
    if(purpose==="opening_cost" && rows.some(row=>row.quantity===0)) throw new Error("Bổ sung giá vốn dùng cho hàng đang có lượng dương. Hãy bỏ các dòng lượng 0 hoặc chọn mục đích khởi tạo tồn.");
    const next=await previewOpeningStock(rows);
    if(generation!==requestGeneration.current) throw new Error("Lượt xem trước đã đóng.");
    if(purpose==="opening_cost"&&next.some(row=>row.delta!==0)) throw new Error("Bổ sung giá vốn giữ nguyên số lượng. Hãy điền lượng đúng bằng tồn đang có tại quán.");
    setPreview(next);
    setPrepared({id:crypto.randomUUID(),rows,purpose,sourceAt:date.toISOString(),reason:reason.trim(),fileName:file.name});
  }
  const contextContent=<div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label htmlFor="opening-purpose" className="text-sm font-medium">Mục đích</label>
          <select id="opening-purpose" value={purpose} onChange={event=>setPurpose(event.target.value as OpeningPurpose)} className="w-full h-11 border rounded-md bg-background px-3 text-sm">
            {Object.entries(openingPurposeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
        <div className="space-y-1"><label htmlFor="opening-source-at" className="text-sm font-medium">Ngày giờ chốt ở nguồn cũ</label>
          <Input id="opening-source-at" type="datetime-local" value={sourceAt} onChange={event=>setSourceAt(event.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{purposeHelp[purpose]}</p>
      <div className="space-y-1"><label htmlFor="opening-reason" className="text-sm font-medium">Lý do / nguồn đối chiếu</label>
        <Input id="opening-reason" value={reason} maxLength={500} onChange={event=>setReason(event.target.value)} placeholder="VD: Chuyển tồn quán từ phần mềm cũ sau khi chốt ca" /></div>
      <p className="text-xs text-muted-foreground">Ngày giờ nguồn dùng để đối chiếu; hệ thống ghi nhận khi anh/chị xác nhận, không sửa ngược lịch sử.</p>
    </div>;
  return <ImportExcelDialog open={open} onOpenChange={next=>{if(!next){requestGeneration.current++;setPrepared(null);}onOpenChange(next);}} schema={initialStockExcelSchema}
    title={mode==="manual"?"Nhập tồn ban đầu trực tiếp":undefined}
    entryContent={mode==="manual"?(onPreview,busy)=><OpeningStockManualEntry onPreview={onPreview} busy={busy} contextContent={contextContent} onSummary={setEntrySummary}/>:undefined}
    entryFormId={mode==="manual"?"opening-manual-form":undefined} entrySubmitDisabled={entrySummary.count===0}
    entrySummary={<div><p className="font-semibold text-primary">{entrySummary.count} mã · {formatCurrency(entrySummary.value)} <span className="text-xs font-normal">₫</span></p>{entrySummary.incomplete>0&&<p className="text-xs text-status-warning">{entrySummary.incomplete} hàng chưa đủ thông tin</p>}</div>}
    compactInstructions showSteps
    preparePreview={prepare} onFinished={onFinished} retryOnFailure
    confirmDisabled={!prepared || (needsZero&&!zeroConfirmed)}
    onCommit={async()=>{
      if(!prepared) throw new Error("Xem trước lại dữ liệu trước khi xác nhận.");
      const result=await commitOpeningStock({...prepared,preview});
      return {successCount:result.count,failureCount:0,errors:[]};
    }}
    uploadContent={contextContent}
    instructions={<ul className="list-disc pl-4 space-y-1">
      <li>{mode==="manual"?"Một đợt, một chi nhánh. Kiểm tra chi nhánh nhận tồn ở bước xem trước.":"Một file, một chi nhánh. Chi nhánh nhận tồn theo mã trong file; kiểm tra ở bước xem trước."}</li>
      <li>Nhập mã nguyên liệu, bao bì hoặc bán thành phẩm giữ tồn. Mã phải có sẵn.</li>
      <li>Lượng và đơn giá theo đơn vị tồn Onebiz. Hàng không có trong đợt nhập giữ nguyên.</li>
      <li>Đã có phát sinh thì đổi lượng tại <Link className="text-primary underline" href="/hang-hoa/kiem-kho">Kiểm kho</Link>; không ghi đè đầu kỳ để sửa lịch sử.</li>
      <li>Toàn bộ đợt cùng thành công hoặc không ghi. Không tạo công nợ hay phiếu thu/chi.</li>
    </ul>}
    previewContent={<div className="space-y-3">
      <div className="border-b pb-3 text-sm space-y-1">
        <p><b className="text-primary">{preview[0]?.branchCode}</b> · {prepared&&openingPurposeLabels[prepared.purpose]} · {preview.length} mã</p>
        <p>Giá trị tồn đợt nhập: <b>{formatCurrency(preview.reduce((sum,row)=>sum+Number(row.value),0))}</b></p>
        <p className="text-muted-foreground">{prepared?.reason} · Chốt nguồn: {prepared&&new Date(prepared.sourceAt).toLocaleString("vi-VN")}</p>
        <p className="text-muted-foreground">{preview[0]?.fnb ? "Giá vốn riêng của quán; không đổi giá Retail." : "Chi nhánh này dùng giá vốn danh mục chung. Không cho đổi giá nếu chi nhánh khác đang có hàng."}</p>
      </div>
      <div className="hidden sm:block overflow-x-auto border rounded-md"><table className="w-full text-sm min-w-[630px]">
        <thead className="bg-primary/5 text-primary"><tr>{["Mã / tên hàng","ĐVT","Đang có","Sau nhập","Thay đổi","Giá vốn","Giá trị"].map(label=><th key={label} className="p-2 text-left font-medium">{label}</th>)}</tr></thead>
        <tbody>{preview.map(row=><tr key={row.productId} className="border-t">
          <td className="p-2"><b>{row.productCode}</b><p className="text-muted-foreground">{row.productName}</p></td>
          <td className="p-2">{row.unit}</td><td className="p-2 tabular-nums">{formatStockQuantity(row.quantityBefore)}</td>
          <td className="p-2 tabular-nums font-medium">{formatStockQuantity(row.quantity)}</td>
          <td className="p-2 tabular-nums text-primary">{row.delta>0?"+":""}{formatStockQuantity(row.delta)}</td>
          <td className="p-2 tabular-nums">{unitCostFormat.format(row.costPrice)}</td><td className="p-2 tabular-nums">{formatCurrency(row.value)}</td>
        </tr>)}</tbody></table></div>
      <div className="sm:hidden space-y-2">{preview.map(row=><section key={row.productId} className="rounded-md border p-3 space-y-2">
        <div><p className="font-semibold text-sm">{row.productName}</p><p className="text-xs text-primary">{row.productCode} · ĐVT: {row.unit}</p></div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">{[
          ["Đang có",`${formatStockQuantity(row.quantityBefore)} ${row.unit}`],
          ["Sau nhập",`${formatStockQuantity(row.quantity)} ${row.unit}`],
          ["Thay đổi",`${row.delta>0?"+":""}${formatStockQuantity(row.delta)} ${row.unit}`],
          [`Giá vốn / ${row.unit}`,unitCostFormat.format(row.costPrice)],
        ].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="tabular-nums font-medium">{value}</dd></div>)}</dl>
        <div className="border-t pt-2 flex justify-between text-sm"><span>Giá trị tồn</span><b className="text-primary">{formatCurrency(row.value)} ₫</b></div>
      </section>)}</div>
      {preview.some(row=>row.lotNumber||row.expiryDate||row.note)&&<div className="text-sm text-muted-foreground space-y-1">{preview.filter(row=>row.lotNumber||row.expiryDate||row.note).map(row=><p key={row.productId}><b>{row.productCode}</b>: lô {row.lotNumber??"tự tạo khi tạo tồn mới"} · HSD {row.expiryDate?row.expiryDate.split("-").reverse().join("/"):"chưa xác định"}{row.note&&` · ${row.note}`}</p>)}</div>}
      {needsZero&&<label className="flex gap-2 items-start bg-status-warning/10 p-3 text-sm">
        <Checkbox checked={zeroConfirmed} onCheckedChange={value=>setZeroConfirmed(value===true)} aria-label="Xác nhận giá vốn bằng 0" />
        Tôi xác nhận những dòng có hàng nhưng giá vốn 0 là chủ ý, không phải thiếu dữ liệu.
      </label>}
      <p className="text-xs text-muted-foreground">Nếu tồn thay đổi trong lúc xem, hệ thống yêu cầu xem lại trước khi ghi. Mã đã có lịch sử giá vốn giữ nguyên khi lượng và đơn giá khớp.</p>
    </div>} />;
}
