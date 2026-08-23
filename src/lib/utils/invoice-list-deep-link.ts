const INVOICE_LIST_PATH = "/don-hang/hoa-don";

export type InvoiceListDeepLink = {
  code: string | null;
  openDetail: boolean;
};

export type InvoiceListDeepLinkFilters = {
  datePreset: "all" | null;
  statuses: string[] | null;
  types: string[] | null;
};

/** Creates a read-only deep link from an order's child sale to its invoice. */
export function buildInvoiceListDeepLink(invoiceCode: string): string {
  const code = invoiceCode.trim();
  if (!code) return INVOICE_LIST_PATH;

  const params = new URLSearchParams({ tim: code, mo: "1" });
  return `${INVOICE_LIST_PATH}?${params.toString()}`;
}

export function readInvoiceListDeepLink(search: string): InvoiceListDeepLink {
  const params = new URLSearchParams(search);
  const code = params.get("tim")?.trim() || null;

  return {
    code,
    openDetail: code !== null && params.get("mo") === "1",
  };
}

/** Returns only the list filters that a direct-open link is allowed to reset. */
export function getInvoiceListDeepLinkFilters(
  target: InvoiceListDeepLink,
): InvoiceListDeepLinkFilters {
  if (!target.openDetail) {
    return { datePreset: null, statuses: null, types: null };
  }

  return {
    datePreset: "all",
    statuses: [],
    types: ["no_delivery", "delivery"],
  };
}

export function findInvoiceListRowByCode<T extends { code: string }>(
  invoices: readonly T[],
  invoiceCode: string,
): number {
  return invoices.findIndex((invoice) => invoice.code === invoiceCode);
}
