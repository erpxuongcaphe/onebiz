import type { FnbBillCardDetail } from "@/lib/fnb-bill-card-details";

export function FnbBillIdentity({ customerName, note, className = "", showCustomer = true }: { customerName?: string | null; note?: string | null; className?: string; showCustomer?: boolean }) {
  const customer = customerName?.trim() || "Khách lẻ";
  const text = note?.trim();
  if (!showCustomer && !text) return null;
  return <span className={`block min-w-0 space-y-1 text-left ${className}`}>
    {showCustomer && <span className="block break-words text-sm font-semibold" title={customer}>Khách: {customer}</span>}
    {text ? <span className="block line-clamp-2 whitespace-pre-line break-words text-sm font-normal text-muted-foreground" title={text}>Ghi chú: {text}</span> : null}
  </span>;
}

export function FnbBillCardHeading({ label, customerName, note, billDetails }: { label: string; customerName?: string | null; note?: string | null; billDetails?: FnbBillCardDetail[] }) {
  const bills = billDetails?.length ? billDetails : [{ id: "bill", orderNumber: "", customerName: customerName?.trim() || "Khách lẻ", note: note?.trim() || "" }];
  return <span className="flex w-full min-w-0 items-start justify-between gap-3">
    <span className="max-w-[40%] shrink-0 break-words text-lg font-bold">{label}</span>
    <span className="min-w-0 flex-1 space-y-2 text-right">
      {bills.map(bill => <span key={bill.id} className="block min-w-0">
        {bills.length > 1 && <span className="block text-xs font-medium text-muted-foreground">{bill.orderNumber}</span>}
        <span className="block line-clamp-2 break-words text-base font-bold text-primary" title={bill.customerName?.trim() || "Khách lẻ"} aria-label={`Khách: ${bill.customerName?.trim() || "Khách lẻ"}`}>{bill.customerName?.trim() || "Khách lẻ"}</span>
        {bill.note?.trim() && <span className="mt-0.5 block line-clamp-2 whitespace-pre-line break-words text-xs font-normal leading-snug text-muted-foreground" title={bill.note.trim()} aria-label={`Ghi chú: ${bill.note.trim()}`}>Ghi chú: {bill.note.trim()}</span>}
      </span>)}
    </span>
  </span>;
}
