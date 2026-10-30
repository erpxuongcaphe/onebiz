import { getClient, handleError } from "./base";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";
import { COST_STATUSES, type CostReconciliationResult, type CostReconciliationRow } from "@/lib/reports/cost-reconciliation";

const failure = () => new Error("Nguồn đối soát giá vốn chưa đầy đủ. Vui lòng tải lại.");
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure();
  return value as Record<string, unknown>;
};
const text = (row: Record<string, unknown>, key: string): string => {
  if (typeof row[key] !== "string" || !row[key]) throw failure(); return row[key] as string;
};
const number = (value: unknown): number => {
  if (value === null || value === undefined || value === "" || !["number", "string"].includes(typeof value) || !Number.isFinite(Number(value))) throw failure();
  return Number(value);
};
const nullable = (value: unknown) => value === null ? null : number(value);

export function parseCostReconciliationRow(value: unknown): CostReconciliationRow {
  const row = record(value), status = text(row, "status");
  if (!Object.hasOwn(COST_STATUSES, status) || !Array.isArray(row.pending_components)) throw failure();
  const evidence = record(row.evidence), mode = text(evidence, "mode"), issuedAt = text(row, "issued_at");
  if (!["event_line_mapping", "historical_component_match", "missing_source"].includes(mode) || !Number.isFinite(Date.parse(issuedAt))
    || typeof evidence.has_returns !== "boolean" || (evidence.last_attempt_at !== null && (typeof evidence.last_attempt_at !== "string" || !Number.isFinite(Date.parse(evidence.last_attempt_at))))) throw failure();
  const count = number(evidence.event_count), candidate = nullable(row.candidate_unit_cost);
  if (!Number.isSafeInteger(count) || count < 0 || (candidate !== null && candidate < 0)
    || (status !== "ready" && candidate !== null) || (status === "ready" && (candidate === null || evidence.has_returns || count === 0))) throw failure();
  const quantity = number(row.quantity), factor = nullable(row.conversion_factor);
  if (quantity <= 0 || (factor !== null && factor <= 0)) throw failure();
  const pendingComponents = row.pending_components.map(value => { const p = record(value), quantity = number(p.pending_quantity);
    if (quantity <= 0 || typeof p.cost_known !== "boolean") throw failure();
    return { code: text(p, "code"), name: text(p, "name"), unit: text(p, "unit"), pendingQuantity: quantity, costKnown: p.cost_known }; });
  if ((status === "ready" && pendingComponents.length > 0) || (status === "waiting" && pendingComponents.length === 0)) throw failure();
  return { id: text(row, "id"), invoiceId: text(row, "invoice_id"), invoiceCode: text(row, "invoice_code"), issuedAt,
    branchId: text(row, "branch_id"), branchName: text(row, "branch_name"), productId: text(row, "product_id"),
    code: text(row, "code"), name: text(row, "name"), quantity, unit: text(row, "unit"),
    transactionQuantity: nullable(row.transaction_quantity), transactionUnit: row.transaction_unit === null ? null : text(row, "transaction_unit"),
    conversionFactor: factor, storedUnitCost: nullable(row.stored_unit_cost), candidateUnitCost: candidate,
    status: status as CostReconciliationRow["status"], evidence: { mode: mode as CostReconciliationRow["evidence"]["mode"], eventCount: count,
      hasReturns: evidence.has_returns, lastAttemptAt: evidence.last_attempt_at as string | null },
    pendingComponents,
  };
}

export async function getCostReconciliation(range: { from: string; to: string }, branchId?: string | null): Promise<CostReconciliationResult> {
  const dates = toCreatedAtRangeWindow(range); if (!dates) throw new Error("Khoảng ngày không hợp lệ.");
  const client = getClient();
  const rpc = client.rpc as unknown as (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  const rows: CostReconciliationRow[] = [], ids = new Set<string>(), invoiceStates = new Map<string, string>(); let revision = "", checkedAt = "", expected = -1;
  for (let page = 0; page < 200; page++) {
    const { data, error } = await rpc.call(client, "get_cost_reconciliation_workspace_v1", { p_from: dates.start, p_to: dates.end,
      p_branch_id: branchId ?? null, p_offset: rows.length, p_limit: 250 });
    if (error?.code === "PGRST202") throw new Error("Nguồn đối soát giá vốn chưa được phát hành.");
    if (error) handleError(error, "getCostReconciliation");
    const result = record(data), total = number(result.total);
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(result.rows) || result.rows.length > 250 || !Number.isFinite(Date.parse(text(result, "checked_at")))) throw failure();
    const nextRevision = text(result, "revision");
    if (page === 0) { revision = nextRevision; checkedAt = text(result, "checked_at"); expected = total; }
    if (revision !== nextRevision || expected !== total) throw new Error("Nguồn giá vốn vừa thay đổi. Vui lòng tải lại.");
    const batch = result.rows.map(parseCostReconciliationRow);
    for (const row of batch) {
      const invoiceState = `${row.branchId}:${row.status}`;
      if (ids.has(row.id) || (branchId && row.branchId !== branchId) || (invoiceStates.has(row.invoiceId) && invoiceStates.get(row.invoiceId) !== invoiceState)) throw failure();
      ids.add(row.id); invoiceStates.set(row.invoiceId, invoiceState); rows.push(row);
    }
    if (rows.length > expected || (rows.length < expected && batch.length === 0)) throw failure();
    if (rows.length === expected) return { rows, revision, checkedAt };
  }
  throw new Error("Kỳ đối soát quá lớn. Vui lòng thu hẹp khoảng ngày.");
}
