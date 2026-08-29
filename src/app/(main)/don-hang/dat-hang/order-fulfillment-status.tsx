import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SalesOrder } from "@/lib/types/orders";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";

export function getOrderInvoiceCodes(
  order: Pick<
    SalesOrder,
    "completedChildCodes" | "fulfilledInvoiceCode" | "invoiceCode"
  >,
): string[] {
  return [
    ...new Set(
      [
        ...(order.completedChildCodes ?? []),
        order.fulfilledInvoiceCode,
        order.invoiceCode,
      ].filter((code): code is string => Boolean(code)),
    ),
  ];
}

export function FulfilledOrderStatus({
  invoiceCodes,
  invoiceCode,
}: {
  invoiceCodes?: string[];
  invoiceCode?: string;
}) {
  const codes = [
    ...new Set([...(invoiceCodes ?? []), ...(invoiceCode ? [invoiceCode] : [])].filter(Boolean)),
  ];
  return (
    <Badge
      variant="default"
      className="h-auto flex-wrap bg-status-success/10 py-1 text-status-success border-status-success/25"
    >
      Đã có hóa đơn số
      {codes.map((invoiceCode, index) => (
        <span key={invoiceCode} className="inline-flex items-center">
          <span aria-hidden="true">{index === 0 ? " " : " / "}</span>
          <Link
            href={buildInvoiceListDeepLink(invoiceCode)}
            className="font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Mở hóa đơn ${invoiceCode}`}
            onClick={(event) => event.stopPropagation()}
          >
            {invoiceCode}
          </Link>
        </span>
      ))}
    </Badge>
  );
}
