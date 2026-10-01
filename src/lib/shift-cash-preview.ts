export interface ShiftCashRow {
  code: string;
  type: "receipt" | "payment";
  amount: number;
  payment_method: string | null;
  status: string | null;
  reference_type: string | null;
  reference_id: string | null;
  category: string;
  note: string | null;
  created_at: string;
}

export interface ShiftCashEntry {
  code: string;
  type: "receipt" | "payment";
  amount: number;
  category: string;
  note: string | null;
  createdAt: string;
}

export function summarizeShiftCashRows(
  rows: ShiftCashRow[],
  startingCash: number,
  fnbVoidInvoiceIds: ReadonlySet<string>,
) {
  let cashIn = 0;
  let cashOut = 0;
  const salesByMethod: Record<string, number> = {};
  const cashEntries: ShiftCashEntry[] = [];

  for (const row of rows) {
    if (row.status === "cancelled") continue;
    const method = row.payment_method ?? "cash";
    const amount = Number(row.amount ?? 0);

    if (method === "cash") {
      if (row.type === "receipt") cashIn += amount;
      else cashOut += amount;
      cashEntries.push({
        code: row.code,
        type: row.type,
        amount,
        category: row.category,
        note: row.note,
        createdAt: row.created_at,
      });
    }

    const isFnbInvoiceVoid = row.reference_type === "invoice_void" &&
      row.reference_id != null && fnbVoidInvoiceIds.has(row.reference_id);
    if (row.reference_type === "invoice" || row.reference_type === "sales_return" || isFnbInvoiceVoid) {
      const net = row.type === "receipt" ? amount : -amount;
      salesByMethod[method] = (salesByMethod[method] ?? 0) + net;
    }
  }

  const activeMethods = Object.fromEntries(
    Object.entries(salesByMethod).filter(([, amount]) => amount !== 0),
  );
  return {
    cashIn,
    cashOut,
    expectedCash: startingCash + cashIn - cashOut,
    totalSales: Object.values(activeMethods).reduce((sum, amount) => sum + amount, 0),
    salesByMethod: activeMethods,
    cashEntries,
  };
}
