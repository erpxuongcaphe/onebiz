import { getClient, handleError } from "./base";
import { readPartyHistoryPages, readPartyHistoryPagesV2 } from "./party-history-reader";

export function getScopedPartyHistory(mode: "customer" | "supplier", partyId: string, branchId: string | null, signal?: AbortSignal) {
  return readScopedPartyHistory(mode, partyId, branchId, false, signal);
}

export function getScopedPartyHistoryV2(mode: "customer" | "supplier", partyId: string, branchId: string | null, signal?: AbortSignal) {
  return readScopedPartyHistory(mode, partyId, branchId, true, signal);
}

function readScopedPartyHistory(mode: "customer" | "supplier", partyId: string, branchId: string | null, v2: true, signal?: AbortSignal): ReturnType<typeof readPartyHistoryPagesV2>;
function readScopedPartyHistory(mode: "customer" | "supplier", partyId: string, branchId: string | null, v2: false, signal?: AbortSignal): ReturnType<typeof readPartyHistoryPages>;
function readScopedPartyHistory(mode: "customer" | "supplier", partyId: string, branchId: string | null, v2: boolean, signal?: AbortSignal) {
  if (!partyId.trim() || branchId !== null && !branchId.trim()) throw new Error("Phạm vi lịch sử không hợp lệ.");
  const rpcName = v2 ? "get_party_history_scoped_v2" : "get_party_history_scoped";
  const read = async (offset: number, limit: number) => {
    signal?.throwIfAborted();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (getClient().rpc as any)(rpcName, {
      p_mode: mode, p_party_id: partyId, p_branch_id: branchId, p_offset: offset, p_limit: limit,
    });
    const { data, error } = await (signal && typeof query.abortSignal === "function" ? query.abortSignal(signal) : query);
    if (error) handleError(error, rpcName);
    return data as unknown;
  };
  return v2 ? readPartyHistoryPagesV2({ mode, partyId, branchId }, read, signal)
    : readPartyHistoryPages({ mode, partyId, branchId }, read, signal);
}
