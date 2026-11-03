import { getClient, getCurrentTenantId, handleError } from "./base";

export interface CustomerReportBalanceRow {
  customerId: string;
  code: string;
  name: string;
  receivable: number;
  advance: number;
}

interface BalanceScope {
  tenantId: string;
  branchId: string | null;
  branchIds: string[];
  asOf: string;
  revision: string;
  previousReceivable: null;
}

export type CustomerReportBalances = BalanceScope & (
  | {
    canViewDebt: false;
    rows: [];
    totalReceivable: null;
    totalAdvance: null;
    unassignedBalanceRecords: null;
    unresolvedBalanceRecords: null;
    complete: null;
  }
  | {
    canViewDebt: true;
    rows: CustomerReportBalanceRow[];
    totalReceivable: number;
    totalAdvance: number;
    unassignedBalanceRecords: number | null;
    unresolvedBalanceRecords: number;
    complete: boolean;
  }
);

function invalid(): never { throw new Error("REPORT_CUSTOMER_BALANCES_INVALID"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return invalid();
  return value;
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return invalid();
  return value;
}
function count(value: unknown): number {
  const result = amount(value);
  if (!Number.isSafeInteger(result)) return invalid();
  return result;
}

export function parseCustomerReportBalances(
  value: unknown,
  expected: { tenantId: string; branchId: string | null },
): CustomerReportBalances {
  const raw = record(value);
  if (raw.version !== 1 || raw.tenant_id !== expected.tenantId || raw.branch_id !== expected.branchId
    || raw.scope !== (expected.branchId === null ? "company" : "branch")
    || raw.basis !== "current_receivable_and_customer_advance"
    || typeof raw.can_view_debt !== "boolean" || raw.previous_receivable !== null
    || typeof raw.revision !== "string" || !/^[a-f0-9]{32}$/.test(raw.revision)
    || typeof raw.as_of !== "string" || !Number.isFinite(Date.parse(raw.as_of))
    || !Array.isArray(raw.branch_ids) || !Array.isArray(raw.rows)) return invalid();
  const branchIds = raw.branch_ids.map(identifier);
  if (new Set(branchIds).size !== branchIds.length
    || (expected.branchId !== null && (branchIds.length !== 1 || branchIds[0] !== expected.branchId))) return invalid();
  const scope: BalanceScope = {
    ...expected, branchIds, asOf: raw.as_of, revision: raw.revision, previousReceivable: null,
  };
  if (!raw.can_view_debt) {
    if (raw.rows.length || raw.total_receivable !== null || raw.total_advance !== null
      || raw.unassigned_balance_records !== null || raw.unresolved_balance_records !== null
      || raw.complete !== null) return invalid();
    return { ...scope, canViewDebt: false, rows: [], totalReceivable: null, totalAdvance: null,
      unassignedBalanceRecords: null, unresolvedBalanceRecords: null, complete: null };
  }
  const ids = new Set<string>();
  const rows = raw.rows.map(value => {
    const row = record(value);
    const customerId = identifier(row.customer_id);
    if (ids.has(customerId) || typeof row.code !== "string") return invalid();
    ids.add(customerId);
    return { customerId, code: row.code, name: identifier(row.name),
      receivable: amount(row.receivable), advance: amount(row.advance) };
  });
  const totalReceivable = amount(raw.total_receivable), totalAdvance = amount(raw.total_advance);
  if (Math.abs(rows.reduce((sum, row) => sum + row.receivable, 0) - totalReceivable) > 0.01
    || Math.abs(rows.reduce((sum, row) => sum + row.advance, 0) - totalAdvance) > 0.01
    || (!branchIds.length && rows.length)) return invalid();
  const unassignedBalanceRecords = expected.branchId === null ? count(raw.unassigned_balance_records) : null;
  if (expected.branchId !== null && raw.unassigned_balance_records !== null) return invalid();
  const unresolvedBalanceRecords = count(raw.unresolved_balance_records);
  const complete = (unassignedBalanceRecords ?? 0) === 0 && unresolvedBalanceRecords === 0;
  if (raw.complete !== complete) return invalid();
  return { ...scope, canViewDebt: true, rows, totalReceivable, totalAdvance,
    unassignedBalanceRecords, unresolvedBalanceRecords, complete };
}

/** Staged report source; no existing report or POS consumer is switched here. */
export async function getCustomerReportBalances(params: {
  branchId: string | null;
  forExport?: boolean;
}): Promise<CustomerReportBalances> {
  if (params.branchId !== null && !params.branchId.trim()) return invalid();
  if (params.forExport !== undefined && typeof params.forExport !== "boolean") return invalid();
  const tenantId = await getCurrentTenantId();
  const client = getClient() as unknown as {
    rpc(name: string, args: Record<string, string | boolean | null>): PromiseLike<{
      data: unknown;
      error: Parameters<typeof handleError>[0] | null;
    }>;
  };
  const { data, error } = await client.rpc("get_customer_report_balances_v1", {
    p_branch_id: params.branchId, p_for_export: params.forExport === true,
  });
  if (error) handleError(error, "getCustomerReportBalances");
  return parseCustomerReportBalances(data, { tenantId, branchId: params.branchId });
}
