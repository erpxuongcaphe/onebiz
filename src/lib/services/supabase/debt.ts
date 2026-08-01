/**
 * Supabase service: Debt Aging Analysis (Phân tích tuổi nợ)
 *
 * Sprint 7 "Toàn Cảnh"
 *
 * Analyzes customer and supplier debt by age buckets:
 *   - 0-30 ngày (current)
 *   - 31-60 ngày
 *   - 61-90 ngày
 *   - 90+ ngày (overdue)
 *
 * Source data:
 *   - Customer debt: invoices where debt > 0 (invoice date = age anchor)
 *   - Supplier debt: purchase_orders where debt > 0
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import {
  getPayableAgingReport,
  getReceivableAgingReport,
} from "./finance-marketing-reports";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AgingBucket {
  label: string;
  range: string;
  customerCount: number;
  customerAmount: number;
  supplierCount: number;
  supplierAmount: number;
  totalAmount: number;
}

export interface DebtAgingReport {
  buckets: AgingBucket[];
  totalCustomerDebt: number;
  totalSupplierDebt: number;
  totalDebt: number;
  customersWithDebt: number;
  suppliersWithDebt: number;
}

export interface DebtorDetail {
  id: string;
  code: string;
  name: string;
  phone?: string;
  debt: number;
  ageDays: number;
  bucket: string;
  type: "customer" | "supplier";
  oldestInvoiceDate?: string;
}

/* ------------------------------------------------------------------ */
/*  Quick totals — KPI summary cho cong-no page                        */
/* ------------------------------------------------------------------ */

/**
 * Tổng công nợ KH (phải thu) + tổng công nợ NCC (phải trả) của tenant.
 *
 * Trước đây page `cong-no` reduce ở client từ list `customers`/`suppliers`
 * đã fetch — nhưng list chỉ fetch cho mode hiện tại (KH | NCC), nên khi
 * đang ở tab KH thì `totalSupplierDebt = 0` luôn (sai). Hàm này query
 * cả 2 song song để KPI luôn đúng bất kể tab nào.
 *
 * Note: customer.debt và supplier.debt là field aggregate đã được trigger
 * DB maintain. Query SUM ở DB level để tránh fetch hết rows.
 */
export async function getDebtTotals(branchId?: string | null): Promise<{
  customerDebtTotal: number;
  customerCount: number;
  supplierDebtTotal: number;
  supplierCount: number;
}> {
  const [receivable, payable] = await Promise.all([
    getReceivableAgingReport({ branchId: branchId ?? null }),
    getPayableAgingReport({ branchId: branchId ?? null }),
  ]);

  return {
    customerDebtTotal: receivable.rows.reduce(
      (sum, row) => sum + Number(row.outstanding ?? 0),
      0,
    ),
    customerCount: receivable.rows.filter((row) => row.outstanding > 0).length,
    supplierDebtTotal: payable.rows.reduce(
      (sum, row) => sum + Number(row.outstanding ?? 0),
      0,
    ),
    supplierCount: payable.rows.filter((row) => row.outstanding > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/*  Aging report                                                       */
/* ------------------------------------------------------------------ */

function getBucketLabel(days: number): string {
  if (days <= 30) return "0-30 ngày";
  if (days <= 60) return "31-60 ngày";
  if (days <= 90) return "61-90 ngày";
  return "90+ ngày";
}

export async function getDebtAging(branchId?: string | null): Promise<DebtAgingReport> {
  const [receivable, payable] = await Promise.all([
    getReceivableAgingReport({ branchId: branchId ?? null }),
    getPayableAgingReport({ branchId: branchId ?? null }),
  ]);

  const definitions = [
    { label: "Hiện tại", range: "0-30 ngày", receivableKey: "bucket0_30", payableKey: "bucket0_30" },
    { label: "Quá hạn nhẹ", range: "31-60 ngày", receivableKey: "bucket31_60", payableKey: "bucket31_60" },
    { label: "Quá hạn trung bình", range: "61-90 ngày", receivableKey: "bucket61_90", payableKey: "bucket61_90" },
    { label: "Quá hạn nặng", range: "90+ ngày", receivableKey: "bucket91Plus", payableKey: "bucket91Plus" },
  ] as const;

  const buckets: AgingBucket[] = definitions.map((definition) => {
    const customerAmount = receivable.rows.reduce(
      (sum, row) => sum + Number(row[definition.receivableKey] ?? 0),
      0,
    );
    const supplierAmount = payable.rows.reduce(
      (sum, row) => sum + Number(row[definition.payableKey] ?? 0),
      0,
    );

    return {
      label: definition.label,
      range: definition.range,
      customerCount: receivable.rows.filter(
        (row) => Number(row[definition.receivableKey] ?? 0) > 0,
      ).length,
      customerAmount,
      supplierCount: payable.rows.filter(
        (row) => Number(row[definition.payableKey] ?? 0) > 0,
      ).length,
      supplierAmount,
      totalAmount: customerAmount + supplierAmount,
    };
  });

  const totalCustomerDebt = receivable.rows.reduce(
    (sum, row) => sum + Number(row.outstanding ?? 0),
    0,
  );
  const totalSupplierDebt = payable.rows.reduce(
    (sum, row) => sum + Number(row.outstanding ?? 0),
    0,
  );

  return {
    buckets,
    totalCustomerDebt,
    totalSupplierDebt,
    totalDebt: totalCustomerDebt + totalSupplierDebt,
    customersWithDebt: receivable.rows.filter((row) => row.outstanding > 0).length,
    suppliersWithDebt: payable.rows.filter((row) => row.outstanding > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/*  Top debtors (detailed list)                                        */
/* ------------------------------------------------------------------ */

export async function getTopDebtors(
  limit: number = 20,
  branchId?: string | null,
): Promise<DebtorDetail[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const [receivable, payable] = await Promise.all([
    getReceivableAgingReport({ branchId: branchId ?? null }),
    getPayableAgingReport({ branchId: branchId ?? null }),
  ]);

  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const receivableRows = [...receivable.rows]
    .filter((row) => row.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, safeLimit);
  const payableRows = [...payable.rows]
    .filter((row) => row.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, safeLimit);

  const customerIds = receivableRows
    .map((row) => row.customerId)
    .filter((id) => id && !id.startsWith("walk-in:"));
  const supplierIds = payableRows.map((row) => row.supplierId).filter(Boolean);

  const [customersRes, suppliersRes] = await Promise.all([
    customerIds.length > 0
      ? supabase
          .from("customers")
          .select("id, code, name, phone")
          .eq("tenant_id", tenantId)
          .in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length > 0
      ? supabase
          .from("suppliers")
          .select("id, code, name, phone")
          .eq("tenant_id", tenantId)
          .in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (customersRes.error) handleError(customersRes.error, "getTopDebtors.customers");
  if (suppliersRes.error) handleError(suppliersRes.error, "getTopDebtors.suppliers");

  const customerMeta = new Map((customersRes.data ?? []).map((row) => [row.id, row]));
  const supplierMeta = new Map((suppliersRes.data ?? []).map((row) => [row.id, row]));

  const debtors: DebtorDetail[] = [
    ...receivableRows.map((row) => {
      const meta = customerMeta.get(row.customerId);
      return {
        id: row.customerId,
        code: meta?.code ?? (row.customerId.startsWith("walk-in:") ? "KHACH-LE" : "—"),
        name: meta?.name ?? row.customerName,
        phone: meta?.phone ?? undefined,
        debt: row.outstanding,
        ageDays: row.oldestDays,
        bucket: getBucketLabel(row.oldestDays),
        type: "customer" as const,
        oldestInvoiceDate: row.oldestInvoiceDate,
      };
    }),
    ...payableRows.map((row) => {
      const meta = supplierMeta.get(row.supplierId);
      return {
        id: row.supplierId,
        code: meta?.code ?? "—",
        name: meta?.name ?? row.supplierName,
        phone: meta?.phone ?? undefined,
        debt: row.outstanding,
        ageDays: row.oldestDays,
        bucket: getBucketLabel(row.oldestDays),
        type: "supplier" as const,
        oldestInvoiceDate: row.oldestDocumentDate,
      };
    }),
  ];

  debtors.sort((a, b) => b.debt - a.debt);
  return debtors;
}
