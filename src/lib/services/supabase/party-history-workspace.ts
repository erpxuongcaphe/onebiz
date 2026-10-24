import { getClient, handleError } from "./base";
import { readPartyHistoryPages } from "./party-history-reader";

export function getScopedPartyHistory(mode: "customer" | "supplier", partyId: string, branchId: string | null, signal?: AbortSignal) {
  if (!partyId.trim() || branchId !== null && !branchId.trim()) throw new Error("Phạm vi lịch sử không hợp lệ.");
  return readPartyHistoryPages({ mode, partyId, branchId }, async (offset, limit) => {
    signal?.throwIfAborted();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (getClient().rpc as any)("get_party_history_scoped", {
      p_mode: mode, p_party_id: partyId, p_branch_id: branchId, p_offset: offset, p_limit: limit,
    });
    const { data, error } = await (signal && typeof query.abortSignal === "function" ? query.abortSignal(signal) : query);
    if (error) handleError(error, "get_party_history_scoped");
    return data as unknown;
  }, signal);
}
