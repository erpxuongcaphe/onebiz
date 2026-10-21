export function FnbBillIdentity({ customerName, note, className = "", showCustomer = true }: { customerName?: string | null; note?: string | null; className?: string; showCustomer?: boolean }) {
  const customer = customerName?.trim() || "Khách lẻ";
  const text = note?.trim();
  if (!showCustomer && !text) return null;
  return <span className={`block min-w-0 space-y-1 text-left ${className}`}>
    {showCustomer && <span className="block break-words text-sm font-semibold" title={customer}>Khách: {customer}</span>}
    {text ? <span className="block line-clamp-2 whitespace-pre-line break-words text-sm font-normal text-muted-foreground" title={text}>Ghi chú: {text}</span> : null}
  </span>;
}

export function FnbBillCardHeading({ label, customerName }: { label: string; customerName?: string | null }) {
  const customer = customerName?.trim() || "Khách lẻ";
  return <span className="flex w-full min-w-0 items-start justify-between gap-3">
    <span className="min-w-0 flex-1 break-words text-lg font-bold">{label}</span>
    <span className="min-w-0 flex-1 break-words text-right text-base font-bold text-primary" title={customer} aria-label={`Khách: ${customer}`}>{customer}</span>
  </span>;
}
