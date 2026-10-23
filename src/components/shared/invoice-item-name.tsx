/** Compact read-only detail: full note stays readable without another column/card. */
export function InvoiceItemName({name,note}:{name:string;note?:string|null}) {
 return <div className="min-w-0 space-y-0.5">
  <span>{name}</span>
  {note?.trim() ? <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">Ghi chú: {note}</p> : null}
 </div>;
}
