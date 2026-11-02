import { getClient, getCurrentTenantId, handleError } from "./base";

export interface MoneyAccount {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  kind: "cash" | "bank" | "ewallet" | "clearing";
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  active: boolean;
  opening_date: string | null;
  opening_amount: number | null;
  revision: number;
  opening_balance?: number | null;
  receipts?: number;
  payments?: number;
  closing_balance?: number | null;
}
export function accountSupportsMethod(account: Pick<MoneyAccount, "kind">, method: string) {
  return method === "cash"
    ? account.kind === "cash"
    : method === "transfer"
      ? account.kind === "bank"
      : method === "card"
        ? ["bank", "clearing"].includes(account.kind)
        : ["bank", "clearing", "ewallet"].includes(account.kind);
}
export type MoneyAccountOption = Pick<MoneyAccount, "id" | "branch_id" | "code" | "name" | "kind" | "active">;
/** Posting selectors do not need account balances or opening amounts. */
export async function getMoneyAccountOptions(branchId: string): Promise<MoneyAccountOption[]> {
  if (!branchId) throw new Error("Cần chọn một chi nhánh.");
  const tenant = await getCurrentTenantId();
  const { data, error } = await getClient().from("money_accounts" as never)
    .select("id,branch_id,code,name,kind,active").eq("tenant_id", tenant)
    .eq("branch_id", branchId).eq("active", true).order("code");
  if (error) handleError(error, "getMoneyAccountOptions");
  if (!Array.isArray(data)) throw new Error("Chưa tải được tài khoản tiền.");
  return data as unknown as MoneyAccountOption[];
}
export async function getMoneyAccounts(
  branchId: string,
): Promise<MoneyAccount[]> {
  const tenant = await getCurrentTenantId();
  const { data, error } = await getClient()
    .from("money_accounts" as never)
    .select("*")
    .eq("tenant_id", tenant)
    .eq("branch_id", branchId)
    .order("code");
  if (error) handleError(error, "getMoneyAccounts");
  return (data ?? []) as unknown as MoneyAccount[];
}
export async function getMoneyAccountWorkspace(
  branchId: string,
  from: string,
  to: string,
) {
  const { data, error } = await getClient().rpc(
    "get_money_account_workspace" as never,
    { p_branch_id: branchId, p_from: from, p_to: to } as never,
  );
  if (error) handleError(error, "getMoneyAccountWorkspace");
  const result = data as unknown as {
    accounts: MoneyAccount[];
    unassigned_count: number;
  };
  if (!result || !Array.isArray(result.accounts))
    throw new Error("Chưa tải được sổ tiền theo tài khoản.");
  return result;
}
export async function saveMoneyAccount(
  account: MoneyAccount | null,
  payload: Record<string, unknown>,
  reason: string,
) {
  const { data, error } = await getClient().rpc(
    "save_money_account" as never,
    {
      p_id: account?.id ?? null,
      p_expected_revision: account?.revision ?? null,
      p_payload: payload,
      p_reason: reason,
    } as never,
  );
  if (error) moneyAccountError(error, "saveMoneyAccount");
  return data as unknown as MoneyAccount;
}

function moneyAccountError(error: { code?: string; message: string }, context: string): never {
  if (error.code === "23505") throw new Error("Mã tài khoản đã tồn tại. Anh/chị chọn mã khác.");
  const messages: Record<string, string> = {
    MONEY_ACCOUNT_IN_USE: "Tài khoản đã được dùng trên chứng từ, không thể xóa. Chọn Ngừng sử dụng để giữ lịch sử.",
    MONEY_ACCOUNT_HAS_OPENING_BALANCE: "Tài khoản có số dư đầu kỳ khác 0, không thể xóa. Hãy kiểm tra số dư hoặc ngừng sử dụng.",
    MONEY_ACCOUNT_CHANGED_RELOAD: "Tài khoản vừa được thay đổi. Đóng và tải lại trước khi thao tác.",
    MONEY_ACCOUNT_REASON_REQUIRED: "Nhập lý do ít nhất 3 ký tự.",
    MONEY_ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản hoặc bạn không có quyền truy cập.",
    MONEY_ACCOUNT_MANAGE_DENIED: "Bạn chưa có quyền quản lý tài khoản tiền.",
  };
  if (messages[error.message]) throw new Error(messages[error.message]);
  handleError(error, context);
  throw new Error("Không hoàn tất thao tác tài khoản tiền.");
}

export async function deleteMoneyAccount(account: MoneyAccount, reason: string) {
  const { data, error } = await getClient().rpc("delete_money_account" as never, {
    p_id: account.id, p_expected_revision: account.revision, p_reason: reason.trim(),
  } as never);
  if (error) moneyAccountError(error, "deleteMoneyAccount");
  return data as unknown as string;
}
