export function FnbBillIdentity({ customerName, note, className = "" }: { customerName?: string | null; note?: string | null; className?: string }) {
  const customer = customerName?.trim() || "Khách lẻ";
  const text = note?.trim();
  return <span className={`block min-w-0 space-y-1 text-left ${className}`}>
    <span className="block break-words text-sm font-semibold" title={customer}>Khách: {customer}</span>
    {text ? <span className="block line-clamp-2 whitespace-pre-line break-words text-sm font-normal text-muted-foreground" title={text}>Ghi chú: {text}</span> : null}
  </span>;
}
