import { parseInventoryMovementV2, type InventoryMovementV2Report } from "@/lib/reports/inventory-movement-v2-contract";
import { getClient, getCurrentContext, handleError } from "./base";

/** Scoped read only: no legacy fallback, valuation enrichment or inventory writes. */
export async function getInventoryMovementV2Report(
  options: { branchId?: string | null; signal?: AbortSignal } = {},
): Promise<InventoryMovementV2Report> {
  const { signal } = options;
  const branchId = options.branchId ?? null;
  signal?.throwIfAborted();
  if (branchId !== null && (!branchId.trim() || branchId === "all")) {
    throw new Error("Invalid inventory V2 branch scope");
  }
  const ctx = await getCurrentContext();
  signal?.throwIfAborted();
  // Additive RPC precedes generated database types.
  const request = getClient().rpc("get_inventory_movement_report_v2" as never, {
    p_branch_id: branchId,
  } as never);
  const { data, error } = await (signal && typeof request.abortSignal === "function"
    ? request.abortSignal(signal) : request);
  signal?.throwIfAborted();
  if (error) handleError(error, "getInventoryMovementV2Report");
  return parseInventoryMovementV2(data, { tenantId: ctx.tenantId, branchId });
}
