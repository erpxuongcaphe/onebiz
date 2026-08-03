import { getClient, getCurrentTenantId, handleError } from "./base";
import {
  getPayableAgingReport,
  getReceivableAgingReport,
  type PayableAgingRow,
  type ReceivableAgingRow,
} from "./finance-marketing-reports";
import type { DebtAgingReport } from "./debt";

export interface DebtPartyRow {
  id: string;
  code: string;
  name: string;
  phone?: string;
  debt: number;
  documentCount: number;
  ageDays: number;
  bucket: string;
  type: "customer" | "supplier";
  oldestDocumentDate?: string;
}

export interface DebtWorkspace {
  totals: {
    customerDebtTotal: number;
    customerCount: number;
    supplierDebtTotal: number;
    supplierCount: number;
  };
  aging: DebtAgingReport;
  receivables: DebtPartyRow[];
  payables: DebtPartyRow[];
  generatedAt: string;
}

const BUCKETS = [
  {
    label: "Hiện tại",
    range: "0-30 ngày",
    receivableKey: "bucket0_30",
    payableKey: "bucket0_30",
  },
  {
    label: "Quá hạn nhẹ",
    range: "31-60 ngày",
    receivableKey: "bucket31_60",
    payableKey: "bucket31_60",
  },
  {
    label: "Quá hạn trung bình",
    range: "61-90 ngày",
    receivableKey: "bucket61_90",
    payableKey: "bucket61_90",
  },
  {
    label: "Quá hạn nặng",
    range: "90+ ngày",
    receivableKey: "bucket91Plus",
    payableKey: "bucket91Plus",
  },
] as const;

function bucketLabel(days: number): string {
  if (days <= 30) return "0-30 ngày";
  if (days <= 60) return "31-60 ngày";
  if (days <= 90) return "61-90 ngày";
  return "90+ ngày";
}

function positiveReceivables(rows: ReceivableAgingRow[]) {
  return rows.filter((row) => Number(row.outstanding) > 0);
}

function positivePayables(rows: PayableAgingRow[]) {
  return rows.filter((row) => Number(row.outstanding) > 0);
}

export async function getDebtWorkspace(
  branchId?: string | null,
): Promise<DebtWorkspace> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const [receivableReport, payableReport] = await Promise.all([
    getReceivableAgingReport({ branchId: branchId ?? null }),
    getPayableAgingReport({ branchId: branchId ?? null }),
  ]);

  const receivableRows = positiveReceivables(receivableReport.rows);
  const payableRows = positivePayables(payableReport.rows);
  const customerIds = receivableRows
    .map((row) => row.customerId)
    .filter((id) => id && !id.startsWith("walk-in:"));
  const supplierIds = payableRows
    .map((row) => row.supplierId)
    .filter((id): id is string => Boolean(id));

  const [customersResult, suppliersResult] = await Promise.all([
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

  if (customersResult.error) {
    handleError(customersResult.error, "getDebtWorkspace.customers");
  }
  if (suppliersResult.error) {
    handleError(suppliersResult.error, "getDebtWorkspace.suppliers");
  }

  const customerMeta = new Map(
    (customersResult.data ?? []).map((row) => [row.id, row]),
  );
  const supplierMeta = new Map(
    (suppliersResult.data ?? []).map((row) => [row.id, row]),
  );

  const receivables: DebtPartyRow[] = receivableRows
    .map((row) => {
      const meta = customerMeta.get(row.customerId);
      return {
        id: row.customerId,
        code:
          meta?.code ??
          (row.customerId.startsWith("walk-in:") ? "KHACH-LE" : "—"),
        name: meta?.name ?? row.customerName,
        phone: meta?.phone ?? undefined,
        debt: Number(row.outstanding),
        documentCount: Number(row.invoiceCount),
        ageDays: Number(row.oldestDays),
        bucket: bucketLabel(Number(row.oldestDays)),
        type: "customer" as const,
        oldestDocumentDate: row.oldestInvoiceDate,
      };
    })
    .sort((a, b) => b.debt - a.debt);

  const payables: DebtPartyRow[] = payableRows
    .map((row) => {
      const meta = supplierMeta.get(row.supplierId);
      return {
        id: row.supplierId,
        code: meta?.code ?? "—",
        name: meta?.name ?? row.supplierName,
        phone: meta?.phone ?? undefined,
        debt: Number(row.outstanding),
        documentCount: Number(row.documentCount),
        ageDays: Number(row.oldestDays),
        bucket: bucketLabel(Number(row.oldestDays)),
        type: "supplier" as const,
        oldestDocumentDate: row.oldestDocumentDate,
      };
    })
    .sort((a, b) => b.debt - a.debt);

  const buckets = BUCKETS.map((definition) => {
    const customerAmount = receivableRows.reduce(
      (sum, row) => sum + Number(row[definition.receivableKey] ?? 0),
      0,
    );
    const supplierAmount = payableRows.reduce(
      (sum, row) => sum + Number(row[definition.payableKey] ?? 0),
      0,
    );
    return {
      label: definition.label,
      range: definition.range,
      customerCount: receivableRows.filter(
        (row) => Number(row[definition.receivableKey] ?? 0) > 0,
      ).length,
      customerAmount,
      supplierCount: payableRows.filter(
        (row) => Number(row[definition.payableKey] ?? 0) > 0,
      ).length,
      supplierAmount,
      totalAmount: customerAmount + supplierAmount,
    };
  });

  const customerDebtTotal = receivables.reduce(
    (sum, row) => sum + row.debt,
    0,
  );
  const supplierDebtTotal = payables.reduce(
    (sum, row) => sum + row.debt,
    0,
  );

  return {
    totals: {
      customerDebtTotal,
      customerCount: receivables.length,
      supplierDebtTotal,
      supplierCount: payables.length,
    },
    aging: {
      buckets,
      totalCustomerDebt: customerDebtTotal,
      totalSupplierDebt: supplierDebtTotal,
      totalDebt: customerDebtTotal + supplierDebtTotal,
      customersWithDebt: receivables.length,
      suppliersWithDebt: payables.length,
    },
    receivables,
    payables,
    generatedAt:
      receivableReport.generatedAt || payableReport.generatedAt || new Date().toISOString(),
  };
}
