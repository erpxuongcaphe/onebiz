"use client";
import {type ItemColumn} from "./inline-detail-panel/detail-items-table";
import {InvoiceItemName} from "./invoice-item-name";
import {readFnbInvoiceOptions,readFnbInvoiceSize,invoiceNameWithoutSize} from "@/lib/utils/fnb-invoice-options";
import {DEFAULT_INVOICE_DISPLAY,type InvoiceDisplay} from "@/lib/utils/invoice-display";
import {formatCurrency,formatNumber} from "@/lib/format";
type Row=Record<string,unknown>;
export function FnbInvoiceItemLabel({item,display=DEFAULT_INVOICE_DISPLAY,mobile=false}:{item:Row;display?:InvoiceDisplay;mobile?:boolean}) {
 const c=readFnbInvoiceOptions(item.fnbOptions),size=readFnbInvoiceSize(String(item.productName??""),item.variantLabel as string);
 const fields=[["Size",size],["Đá/Nóng",c.temperature],["Mức ngọt",c.sweetness?`Ngọt: ${c.sweetness}`:""],["Mức đá",c.ice?`Mức đá: ${c.ice}`:""],["Tùy chọn khác",c.other]];
 const summary=fields.filter(([field,value])=>value&&!display.hiddenFields.includes(field)).map(([,value])=>value).join(" · ");
 return <div className="min-w-0 space-y-0.5"><InvoiceItemName name={invoiceNameWithoutSize(String(item.productName??""),size)} note={item.note as string}/>
  {summary&&<p className={display.splitOptions&&!mobile?"whitespace-pre-wrap break-words text-[13px] text-foreground lg:hidden":"whitespace-pre-wrap break-words text-[13px] text-foreground"}>{summary}</p>}</div>;
}
export function FnbInvoiceMobileItem({item,display}:{item:Row;display:InvoiceDisplay}) {
 const visible=(field:string)=>!display.hiddenFields.includes(field);
 return <div className="min-w-0 space-y-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0 text-sm font-medium"><FnbInvoiceItemLabel item={item} display={display} mobile/></div><b className="shrink-0 text-primary">{formatCurrency(Number(item.total??0))}</b></div>
  <p className="break-words text-[13px] text-foreground">{[visible("Mã hàng")?String(item.productCode??""):"",`${formatNumber(Number(item.quantity??0))}${visible("ĐVT")?` ${String(item.unit??"")}`:""}${visible("Đơn giá")?` × ${formatCurrency(Number(item.unitPrice??0))}`:""}`,visible("Giảm")?`Giảm: ${formatCurrency(Number(item.discount??0))}`:""].filter(Boolean).join(" · ")}</p></div>;
}
export function fnbItemColumns(display:InvoiceDisplay=DEFAULT_INVOICE_DISPLAY):ItemColumn<Row>[] {
 const choices=(r:Row)=>readFnbInvoiceOptions(r.fnbOptions);
 const columns:ItemColumn<Row>[]=[
 {header:"Mã hàng",accessor:r=>String(r.productCode??"—")},
 {header:"Tên món",className:"min-w-[160px] max-w-[380px]",accessor:r=><FnbInvoiceItemLabel item={r} display={display}/>},
 {header:"Size",hideOn:"tablet",accessor:r=>readFnbInvoiceSize(String(r.productName??""),r.variantLabel as string)||"—"},
 ...([['Đá/Nóng','temperature'],['Mức ngọt','sweetness'],['Mức đá','ice'],['Tùy chọn khác','other']] as const).map(([header,key])=>({header,hideOn:"tablet" as const,accessor:(r:Row)=><span className="block min-w-[76px] max-w-[220px] whitespace-pre-wrap break-words text-[13px]">{choices(r)[key]||"—"}</span>})),
 {header:"ĐVT",accessor:r=>String(r.unit??"—")},
 {header:"SL",align:"right",accessor:r=>formatNumber(Number(r.quantity??0))},
 {header:"Đơn giá",align:"right",accessor:r=>formatCurrency(Number(r.unitPrice??0))},
 {header:"Giảm",align:"right",accessor:r=>formatCurrency(Number(r.discount??0))},
 {header:"Thành tiền",align:"right",accessor:r=><b className="text-primary">{formatCurrency(Number(r.total??0))}</b>},
 ];
 const options=["Size","Đá/Nóng","Mức ngọt","Mức đá","Tùy chọn khác"];
 return columns.filter(c=>!display.hiddenFields.includes(c.header)&&(display.splitOptions||!options.includes(c.header)));
}
