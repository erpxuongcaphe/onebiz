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
export function accountSupportsMethod(account: MoneyAccount, method: string) {
  return method === "cash"
    ? account.kind === "cash"
    : method === "transfer"
      ? account.kind === "bank"
      : method === "card"
        ? ["bank", "clearing"].includes(account.kind)
        : ["bank", "clearing", "ewallet"].includes(account.kind);
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
  if (error) handleError(error, "saveMoneyAccount");
  return data as unknown as MoneyAccount;
}
