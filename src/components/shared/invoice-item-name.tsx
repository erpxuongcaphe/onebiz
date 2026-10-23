import {readFnbInvoiceOptions,readFnbInvoiceSize,invoiceNameWithoutSize} from "@/lib/utils/fnb-invoice-options";
/** Compact read-only detail: full note stays readable without another column/card. */
export function InvoiceItemName({name,note,options,size}:{name:string;note?:string|null;options?:unknown;size?:string|null}) {
 const choices=readFnbInvoiceOptions(options),label=readFnbInvoiceSize(name,size);
 return <div className="min-w-0 space-y-0.5">
  <span>{invoiceNameWithoutSize(name,label)}{label ? <span className="text-[13px] font-medium"> · {label}</span> : null}</span>
  {choices.summary ? <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">{choices.summary}</p> : null}
  {note?.trim() ? <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">Ghi chú: {note}</p> : null}
 </div>;
}
