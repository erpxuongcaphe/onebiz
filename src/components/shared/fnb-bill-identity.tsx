import { getFnbBillCardIdentity, type FnbBillCardDetail } from "@/lib/fnb-bill-card-details";

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
  const identities = billDetails?.length ? billDetails.map(bill => getFnbBillCardIdentity(bill.customerName, bill.note)) : [getFnbBillCardIdentity(customerName, note)];
  const text = [...new Set(identities.map(identity => identity.text))].join(" · ");
  const description = identities.map(identity => `${identity.isNote ? "Ghi chú" : "Khách"}: ${identity.text}`).join(" · ");
  return <span className="flex w-full min-w-0 items-start justify-between gap-3">
    <span className="min-w-0 flex-1 break-words text-lg font-bold">{label}</span>
    <span className="min-w-0 flex-1 break-words text-right text-base font-bold text-primary" title={text} aria-label={description}><span className="line-clamp-2 whitespace-pre-line">{text}</span></span>
  </span>;
}
