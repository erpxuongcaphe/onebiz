import type { SalesReturnRow } from "@/lib/services/supabase/sales-reports";
import { formatDateInputValue } from "@/lib/format";

export interface ReturnDaySummary {
  date: string;
  returnCount: number;
  productLines: number;
  quantity: number;
  value: number;
}

export interface ReturnDocumentSummary {
  id: string;
  code: string;
  date: string;
  invoiceCode: string | null;
  branchName: string | null;
  customerName: string;
  reason: string;
  staffName: string | null;
  productLines: number;
  quantity: number;
  value: number;
}

export interface ReturnReasonSummary {
  reason: string;
  count: number;
  qty: number;
  value: number;
}

export function summarizeSalesReturns(rows: SalesReturnRow[]) {
  const days = new Map<string, ReturnDaySummary & { returnIds: Set<string> }>();
  const documents = new Map<string, ReturnDocumentSummary>();
  const reasons = new Map<string, { reason: string; count: number; qty: number; value: number; returnIds: Set<string> }>();
  const products = new Map<string, { productId: string; productName: string; qty: number; value: number }>();
  const staff = new Map<string, { id: string; name: string; count: number; value: number; returnIds: Set<string> }>();

  for (const row of rows) {
    const date = formatDateInputValue(row.returnDate);
    const day = days.get(date) ?? { date, returnCount: 0, productLines: 0, quantity: 0, value: 0, returnIds: new Set<string>() };
    day.returnIds.add(row.returnId);
    day.returnCount = day.returnIds.size;
    day.productLines += 1;
    day.quantity += row.quantity;
    day.value += row.returnValue;
    days.set(date, day);

    const document = documents.get(row.returnId) ?? {
      id: row.returnId,
      code: row.returnCode,
      date: row.returnDate,
      invoiceCode: row.invoiceCode,
      branchName: row.branchName,
      customerName: row.customerName,
      reason: row.reason,
      staffName: row.createdByName,
      productLines: 0,
      quantity: 0,
      value: 0,
    };
    document.productLines += 1;
    document.quantity += row.quantity;
    document.value += row.returnValue;
    documents.set(row.returnId, document);

    const reason = reasons.get(row.reason) ?? { reason: row.reason, count: 0, qty: 0, value: 0, returnIds: new Set<string>() };
    reason.returnIds.add(row.returnId);
    reason.count = reason.returnIds.size;
    reason.qty += row.quantity;
    reason.value += row.returnValue;
    reasons.set(row.reason, reason);

    const product = products.get(row.productId) ?? { productId: row.productId, productName: row.productName, qty: 0, value: 0 };
    product.qty += row.quantity;
    product.value += row.returnValue;
    products.set(row.productId, product);

    const staffId = row.createdBy ?? "unknown";
    const employee = staff.get(staffId) ?? { id: staffId, name: row.createdByName ?? "Không xác định", count: 0, value: 0, returnIds: new Set<string>() };
    employee.returnIds.add(row.returnId);
    employee.count = employee.returnIds.size;
    employee.value += row.returnValue;
    staff.set(staffId, employee);
  }

  return {
    byDay: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
    byDocument: [...documents.values()].sort((a, b) => b.date.localeCompare(a.date) || b.code.localeCompare(a.code)),
    byReason: [...reasons.values()].sort((a, b) => b.value - a.value),
    byProduct: [...products.values()].sort((a, b) => b.value - a.value),
    byStaff: [...staff.values()].sort((a, b) => b.value - a.value),
    totalValue: rows.reduce((sum, row) => sum + row.returnValue, 0),
    totalQty: rows.reduce((sum, row) => sum + row.quantity, 0),
    returnCount: documents.size,
    productCount: products.size,
  };
}
