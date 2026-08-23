import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";

export function FulfilledOrderStatus({ invoiceCode }: { invoiceCode?: string }) {
  return (
    <Badge
      variant="default"
      className="bg-status-success/10 text-status-success border-status-success/25"
    >
      Hoàn tất
      {invoiceCode ? (
        <>
          <span aria-hidden="true"> · </span>
          <Link
            href={buildInvoiceListDeepLink(invoiceCode)}
            className="font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Mở hóa đơn ${invoiceCode}`}
            onClick={(event) => event.stopPropagation()}
          >
            {invoiceCode}
          </Link>
        </>
      ) : null}
    </Badge>
  );
}
