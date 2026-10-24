import {matchesFnbChoiceFilter,hasFnbChoiceFilter,type FnbChoiceFilter} from "@/lib/utils/fnb-invoice-choice-filter";
import type {Invoice} from "@/lib/types";
import {getClient} from "./base";
import {getFnbInvoiceItemDetails} from "./fnb-invoice-item-details";
import {readHistoryPages} from "./read-history-pages";
import {readFnbInvoiceOptions,readFnbInvoiceSize,invoiceNameWithoutSize} from "@/lib/utils/fnb-invoice-options";
interface Line {id:string;invoice_id:string;product_id?:string;product_name:string;quantity:number;returned_qty:number;unit:string;unit_price:number;total:number;note:string|null;products:{code:string}|null}
export const fnbInvoiceItemExportColumns=[
 {header:"Mã hóa đơn",key:"invoiceCode",width:16},{header:"Bàn",key:"tableName",width:14},{header:"Khu vực",key:"areaName",width:18},
 {header:"Mã hàng",key:"productCode",width:18},{header:"Tên món",key:"productName",width:30},{header:"Size",key:"size",width:14},
 {header:"ĐVT",key:"unit",width:10},{header:"Số lượng",key:"quantity",width:12,precision:4},{header:"Đã trả",key:"returnedQuantity",width:12,precision:4},
 {header:"Đá/Nóng",key:"temperature",width:14},{header:"Mức ngọt",key:"sweetness",width:24},{header:"Mức đá",key:"ice",width:20},
 {header:"Tùy chọn khác",key:"other",width:30},{header:"Ghi chú món",key:"itemNote",width:35},{header:"Ghi chú đơn POS",key:"orderNote",width:35},
 {header:"Đơn giá",key:"unitPrice",width:15},{header:"Thành tiền dòng",key:"lineTotal",width:18},
];
/** All matched F&B invoice lines, in bounded batches. Incomplete metadata aborts the export. */
export async function getFnbInvoiceExportDetails(invoices:Invoice[],signal?:AbortSignal,filter:FnbChoiceFilter={}) {
 const parents=new Map(invoices.filter(i=>i.source==="fnb").map(i=>[i.id,i]));
 const ids=[...parents.keys()],items:Record<string,unknown>[]=[],summaries=new Map<string,string[]>();
 const check=()=>{if(signal?.aborted)throw new DOMException("Đã hủy xuất hóa đơn.","AbortError");};
 for(let start=0;start<ids.length;start+=100){
  check();const batch=ids.slice(start,start+100);
  const [details,lines]=await Promise.all([
   getFnbInvoiceItemDetails(batch,signal),
   readHistoryPages<Line>(async(offset,size)=>{
    check();const result=await getClient().from("invoice_items_scoped").select("id,invoice_id,product_id,product_name,quantity,returned_qty,unit,unit_price,total,note,products:products_scoped!invoice_items_product_id_fkey(code)",{count:"exact"}).in("invoice_id",batch).order("id").range(offset,offset+size-1);
    check();return {...result,data:result.data as unknown as Line[]|null};
   }),
  ]);check();
  if(lines.length!==details.size || lines.some(line=>!details.has(line.id)||details.get(line.id)?.invoice_id!==line.invoice_id))throw new Error("Chưa tải đủ món và tùy chọn của hóa đơn. Chưa tạo file; vui lòng thử lại.");
  for(const line of lines){
   const invoice=parents.get(line.invoice_id);if(!invoice)throw new Error("Dòng món ngoài phạm vi xuất.");
   const detail=details.get(line.id)!,choices=readFnbInvoiceOptions(detail.modifier_selections),note=line.note??detail.note??"",size=readFnbInvoiceSize(line.product_name,detail.variant_label);
   if(!matchesFnbChoiceFilter(line.product_name,detail.variant_label,detail.modifier_selections,filter,line.product_id))continue;
   items.push({invoiceCode:invoice.code,tableName:invoice.tableName??"",areaName:invoice.areaName??"",productCode:line.products?.code??"",productName:invoiceNameWithoutSize(line.product_name,size),size,unit:line.unit,quantity:Number(line.quantity),returnedQuantity:Number(line.returned_qty??0),temperature:choices.temperature,sweetness:choices.sweetness,ice:choices.ice,other:choices.other,itemNote:note,orderNote:invoice.posNote??"",unitPrice:Number(line.unit_price),lineTotal:Number(line.total)});
   const text=[`${line.quantity} × ${line.product_name}`,choices.full,note?`Ghi chú: ${note}`:""].filter(Boolean).join(" · ");
   const list=summaries.get(line.invoice_id)??[];list.push(text);summaries.set(line.invoice_id,list);
  }
 }
 if(hasFnbChoiceFilter(filter)&&ids.some(id=>!summaries.has(id)))throw new Error("Món khớp bộ lọc đã thay đổi trong lúc xuất. Chưa tạo file; vui lòng thử lại.");
 return {items,summaries:new Map([...summaries].map(([id,lines])=>[id,lines.join("\n")]))};
}
