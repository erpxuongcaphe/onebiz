import { getClient, getCurrentTenantId, handleError } from "./base";
import {
  type PayableAgingRow,
  type ReceivableAgingRow,
} from "./finance-marketing-reports";
import type { DebtAgingReport } from "./debt";
import { isRpcUnavailable } from "./rpc-utils";

export interface DebtPartyRow {
  id: string;
  code: string;
  name: string;
  phone?: string;
  debt: number;
  advance: number;
  netBalance: number;
  documentCount: number;
  ageDays: number;
  bucket: string;
  type: "customer" | "supplier";
  oldestDocumentDate?: string;
  ageBuckets?: {
    bucket0_30: number;
    bucket31_60: number;
    bucket61_90: number;
    bucket91Plus: number;
  };
}

export interface DebtWorkspace {
  totals: {
    customerDebtTotal: number;
    customerCount: number;
    supplierDebtTotal: number;
    supplierCount: number;
    customerAdvanceTotal: number;
    supplierAdvanceTotal: number;
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

interface PartyBalanceSummaryRow {
  partyId: string;
  debt: number;
  advance: number;
}

export async function getCounterpartyBalanceSummary(branchId?: string | null) {
  const supabase = getClient();
  // Generated database types intentionally lag optional forward migrations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_counterparty_balance_summary",
    { p_branch_id: branchId ?? null },
  );
  if (error) {
    if (isRpcUnavailable(error)) return null;
    handleError(error, "getCounterpartyBalanceSummary");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRows = (rows: any[]): PartyBalanceSummaryRow[] =>
    (rows ?? []).map((row) => ({
      partyId: String(row.party_id),
      debt: Number(row.debt ?? 0),
      advance: Number(row.advance ?? 0),
    }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (data ?? {}) as any;
  return {
    customers: mapRows(raw.customers),
    suppliers: mapRows(raw.suppliers),
  };
}

export async function getDebtWorkspace(
  branchId?: string | null,
  options?: { requireBalanceSummary?: boolean },
): Promise<DebtWorkspace> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const [openDebt, balanceSummary] = await Promise.all([
    getOpenDebtAging(branchId),
    getCounterpartyBalanceSummary(branchId),
  ]);
  if (options?.requireBalanceSummary && !balanceSummary) {
    throw new Error("Chưa tải được nguồn tiền ứng. Không thể kết luận số dư công nợ.");
  }

  const receivableRows = positiveReceivables(openDebt.receivables);
  const payableRows = positivePayables(openDebt.payables);
  const customerBalanceMap = new Map(
    (balanceSummary?.customers ?? []).map((row) => [row.partyId, row]),
  );
  const supplierBalanceMap = new Map(
    (balanceSummary?.suppliers ?? []).map((row) => [row.partyId, row]),
  );
  const receivableMap = new Map(
    receivableRows.map((row) => [row.customerId, row]),
  );
  const payableMap = new Map(payableRows.map((row) => [row.supplierId, row]));

  const customerRowIds = Array.from(
    new Set([...receivableMap.keys(), ...customerBalanceMap.keys()]),
  );
  const supplierRowIds = Array.from(
    new Set([...payableMap.keys(), ...supplierBalanceMap.keys()]),
  );
  const customerIds = customerRowIds.filter(
    (id) => id && !id.startsWith("walk-in:"),
  );
  const supplierIds = supplierRowIds.filter((id): id is string => Boolean(id));

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

  const receivables: DebtPartyRow[] = customerRowIds
    .map((customerId) => {
      const row = receivableMap.get(customerId);
      const balance = customerBalanceMap.get(customerId);
      const debt = balance?.debt ?? Number(row?.outstanding ?? 0);
      const advance = balance?.advance ?? 0;
      const meta = customerMeta.get(customerId);
      return {
        id: customerId,
        code:
          meta?.code ?? (customerId.startsWith("walk-in:") ? "KHACH-LE" : "—"),
        name: meta?.name ?? row?.customerName ?? "Khách hàng",
        phone: meta?.phone ?? undefined,
        debt,
        advance,
        netBalance: debt - advance,
        documentCount: Number(row?.invoiceCount ?? 0),
        ageDays: Number(row?.oldestDays ?? 0),
        bucket: bucketLabel(Number(row?.oldestDays ?? 0)),
        type: "customer" as const,
        oldestDocumentDate: row?.oldestInvoiceDate,
        ageBuckets: {
          bucket0_30: Number(row?.bucket0_30 ?? 0),
          bucket31_60: Number(row?.bucket31_60 ?? 0),
          bucket61_90: Number(row?.bucket61_90 ?? 0),
          bucket91Plus: Number(row?.bucket91Plus ?? 0),
        },
      };
    })
    .sort((a, b) => Math.max(b.debt, b.advance) - Math.max(a.debt, a.advance));

  const payables: DebtPartyRow[] = supplierRowIds
    .map((supplierId) => {
      const row = payableMap.get(supplierId);
      const balance = supplierBalanceMap.get(supplierId);
      const debt = balance?.debt ?? Number(row?.outstanding ?? 0);
      const advance = balance?.advance ?? 0;
      const meta = supplierMeta.get(supplierId);
      return {
        id: supplierId,
        code: meta?.code ?? "—",
        name: meta?.name ?? row?.supplierName ?? "Nhà cung cấp",
        phone: meta?.phone ?? undefined,
        debt,
        advance,
        netBalance: debt - advance,
        documentCount: Number(row?.documentCount ?? 0),
        ageDays: Number(row?.oldestDays ?? 0),
        bucket: bucketLabel(Number(row?.oldestDays ?? 0)),
        type: "supplier" as const,
        oldestDocumentDate: row?.oldestDocumentDate,
        ageBuckets: {
          bucket0_30: Number(row?.bucket0_30 ?? 0),
          bucket31_60: Number(row?.bucket31_60 ?? 0),
          bucket61_90: Number(row?.bucket61_90 ?? 0),
          bucket91Plus: Number(row?.bucket91Plus ?? 0),
        },
      };
    })
    .sort((a, b) => Math.max(b.debt, b.advance) - Math.max(a.debt, a.advance));

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

  const customerDebtTotal = receivables.reduce((sum, row) => sum + row.debt, 0);
  const supplierDebtTotal = payables.reduce((sum, row) => sum + row.debt, 0);
  const customerAdvanceTotal = receivables.reduce(
    (sum, row) => sum + row.advance,
    0,
  );
  const supplierAdvanceTotal = payables.reduce(
    (sum, row) => sum + row.advance,
    0,
  );

  return {
    totals: {
      customerDebtTotal,
      customerCount: receivables.filter((row) => row.debt > 0).length,
      supplierDebtTotal,
      supplierCount: payables.filter((row) => row.debt > 0).length,
      customerAdvanceTotal,
      supplierAdvanceTotal,
    },
    aging: {
      buckets,
      totalCustomerDebt: customerDebtTotal,
      totalSupplierDebt: supplierDebtTotal,
      totalDebt: customerDebtTotal + supplierDebtTotal,
      customersWithDebt: receivables.filter((row) => row.debt > 0).length,
      suppliersWithDebt: payables.filter((row) => row.debt > 0).length,
    },
    receivables,
    payables,
    generatedAt: openDebt.generatedAt,
  };
}

interface OpenDebtAgingRow {
  party_id: string;
  party_name: string;
  document_count: number;
  outstanding: number;
  oldest_days: number;
  oldest_date: string;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_91_plus: number;
}

// Never subtract an unused advance from a document's count or age.
async function getOpenDebtAging(branchId?: string | null) {
  const { data, error } = await getClient().rpc(
    "get_counterparty_open_debt_aging" as never,
    { p_branch_id: branchId ?? null } as never,
  );
  if (error) handleError(error, "getOpenDebtAging");
  if (!data)
    throw new Error("Không tải được chi tiết tuổi nợ. Vui lòng tải lại.");
  const raw = data as unknown as {
    generated_at: string;
    customers: OpenDebtAgingRow[];
    suppliers: OpenDebtAgingRow[];
  };
  const amounts = (row: OpenDebtAgingRow) => ({
    outstanding: Number(row.outstanding),
    bucket0_30: Number(row.bucket_0_30),
    bucket31_60: Number(row.bucket_31_60),
    bucket61_90: Number(row.bucket_61_90),
    bucket91Plus: Number(row.bucket_91_plus),
    oldestDays: Number(row.oldest_days),
  });
  return {
    generatedAt: raw.generated_at,
    receivables: raw.customers.map(
      (row): ReceivableAgingRow => ({
        ...amounts(row),
        customerId: row.party_id,
        customerName: row.party_name,
        invoiceCount: Number(row.document_count),
        oldestInvoiceDate: row.oldest_date,
      }),
    ),
    payables: raw.suppliers.map(
      (row): PayableAgingRow => ({
        ...amounts(row),
        supplierId: row.party_id,
        supplierName: row.party_name,
        documentCount: Number(row.document_count),
        oldestDocumentDate: row.oldest_date,
      }),
    ),
  };
}
