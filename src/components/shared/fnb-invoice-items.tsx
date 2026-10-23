"use client";
import {type ItemColumn} from "./inline-detail-panel/detail-items-table";
import {InvoiceItemName} from "./invoice-item-name";
import {readFnbInvoiceOptions,readFnbInvoiceSize,invoiceNameWithoutSize} from "@/lib/utils/fnb-invoice-options";
import {formatCurrency,formatNumber} from "@/lib/format";
type Row=Record<string,unknown>;
export function fnbItemColumns():ItemColumn<Row>[] {
 const choices=(r:Row)=>readFnbInvoiceOptions(r.fnbOptions);
 return [
 {header:"Mã hàng",hideOn:"tablet",accessor:r=>String(r.productCode??"—")},
 {header:"Tên món",className:"min-w-[180px] max-w-[280px]",accessor:r=><div><InvoiceItemName name={invoiceNameWithoutSize(String(r.productName??""),readFnbInvoiceSize(String(r.productName??""),r.variantLabel as string))} note={r.note as string}/><p className="mt-0.5 break-words text-[13px] lg:hidden">{[choices(r).sweetness?`Ngọt: ${choices(r).sweetness}`:"",choices(r).ice?`Đá: ${choices(r).ice}`:"",choices(r).other].filter(Boolean).join(" · ")}</p></div>},
 {header:"Size",accessor:r=>readFnbInvoiceSize(String(r.productName??""),r.variantLabel as string)||"—"},
 ...([['Đá/Nóng','temperature'],['Mức ngọt','sweetness'],['Mức đá','ice'],['Tùy chọn khác','other']] as const).map(([header,key])=>({header,hideOn:key==="temperature"?undefined:"tablet" as const,accessor:(r:Row)=><span className="block min-w-[76px] max-w-[220px] whitespace-pre-wrap break-words text-[13px]">{choices(r)[key]||"—"}</span>})),
 {header:"ĐVT",hideOn:"tablet",accessor:r=>String(r.unit??"—")},
 {header:"SL",align:"right",accessor:r=>formatNumber(Number(r.quantity??0))},
 {header:"Đơn giá",hideOn:"tablet",align:"right",accessor:r=>formatCurrency(Number(r.unitPrice??0))},
 {header:"Giảm",hideOn:"tablet",align:"right",accessor:r=>formatCurrency(Number(r.discount??0))},
 {header:"Thành tiền",align:"right",accessor:r=><b className="text-primary">{formatCurrency(Number(r.total??0))}</b>},
 ];
}
