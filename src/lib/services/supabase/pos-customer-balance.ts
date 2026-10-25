import { getClient, handleError } from "./base";

export interface PosCustomerBalance {
  customerId: string;
  branchId: string;
  canViewDebt: boolean;
  debt: number | null;
  advance: number | null;
  netBalance: number | null;
}

export function parsePosCustomerBalance(value: unknown, customerId: string, branchId: string): PosCustomerBalance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Chưa xác nhận được số dư khách.");
  const row = value as Record<string, unknown>;
  if (row.customerId !== customerId || row.branchId !== branchId || typeof row.canViewDebt !== "boolean") {
    throw new Error("Số dư khách không đúng phạm vi.");
  }
  const money = (key: string): number | null => {
    if (!row.canViewDebt) {
      if (row[key] !== null) throw new Error("Nguồn số dư trả dữ liệu ngoài quyền.");
      return null;
    }
    const raw = row[key];
    if ((typeof raw !== "number" && typeof raw !== "string") || raw === ""
      || typeof raw === "string" && !raw.trim() || !Number.isFinite(Number(raw))) {
      throw new Error("Số dư khách chưa đầy đủ.");
    }
    return Number(raw);
  };
  const debt = money("debt"), advance = money("advance"), netBalance = money("netBalance");
  if (row.canViewDebt && (debt! < 0 || advance! < 0 || Math.abs(debt! - advance! - netBalance!) > 0.01)) {
    throw new Error("Số dư khách chưa khớp.");
  }
  return { customerId, branchId, canViewDebt: row.canViewDebt, debt, advance, netBalance };
}

export async function getPosCustomerBalance(customerId: string, branchId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!customerId.trim() || !branchId.trim() || branchId === "all") throw new Error("Thiếu khách hoặc chi nhánh.");
  const request = getClient().rpc("get_pos_customer_balance_scoped" as never, {
    p_customer_id: customerId, p_branch_id: branchId,
  } as never);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  signal?.throwIfAborted();
  if (error) handleError(error, "getPosCustomerBalance");
  return parsePosCustomerBalance(data, customerId, branchId);
}
