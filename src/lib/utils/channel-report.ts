export interface ChannelInvoice {
  id: string;
  total: number | null;
}

export interface ChannelOnlineOrder {
  channel_name: string | null;
  total_amount: number | null;
  invoice_id: string | null;
}

export interface ChannelSalesSummary {
  channel: string;
  revenue: number;
  orders: number;
  avgValue: number;
}

export function summarizeChannelSales(
  invoices: ChannelInvoice[],
  onlineOrders: ChannelOnlineOrder[],
): ChannelSalesSummary[] {
  const invoiceTotals = new Map(
    invoices.map((invoice) => [String(invoice.id), Number(invoice.total ?? 0)]),
  );
  const linkedInvoiceIds = new Set(
    onlineOrders.map((order) => order.invoice_id).filter((id): id is string => Boolean(id)),
  );
  const counterInvoices = invoices.filter((invoice) => !linkedInvoiceIds.has(String(invoice.id)));
  const totals = new Map<string, { revenue: number; orders: number }>();
  totals.set("Tại quầy", {
    revenue: counterInvoices.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0),
    orders: counterInvoices.length,
  });

  const countedOnlineInvoices = new Set<string>();
  for (const order of onlineOrders) {
    const invoiceId = order.invoice_id;
    if (invoiceId && countedOnlineInvoices.has(invoiceId)) continue;
    if (invoiceId) countedOnlineInvoices.add(invoiceId);
    const channel = order.channel_name || "Khác";
    const current = totals.get(channel) ?? { revenue: 0, orders: 0 };
    current.revenue += invoiceId && invoiceTotals.has(invoiceId)
      ? invoiceTotals.get(invoiceId)!
      : Number(order.total_amount ?? 0);
    current.orders += 1;
    totals.set(channel, current);
  }

  return [...totals.entries()].map(([channel, values]) => ({
    channel,
    ...values,
    avgValue: values.orders ? Math.round(values.revenue / values.orders) : 0,
  }));
}
