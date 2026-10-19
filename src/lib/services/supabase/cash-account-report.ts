import { getMoneyAccountWorkspace, type MoneyAccount } from "./money-accounts";

export interface CashAccountReportRow extends MoneyAccount { branchName: string; }
export interface CashAccountReport {
  accounts: CashAccountReportRow[];
  failures: { branchId: string; branchName: string; message: string }[];
  unassignedCount: number;
}

/** Reuse the authorized branch register; bound fan-out, never query per voucher. */
export async function getCashAccountReport(branches: { id: string; name: string }[], from: string, to: string): Promise<CashAccountReport> {
  const scope = [...new Map(branches.map(branch => [branch.id, branch])).values()];
  if (!scope.length) throw new Error("Chưa xác định được phạm vi tài khoản tiền.");
  const results: CashAccountReport[] = new Array(scope.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, scope.length) }, async () => {
    while (next < scope.length) {
      const index = next++;
      const branch = scope[index];
      try {
        const result = await getMoneyAccountWorkspace(branch.id, from, to);
        if (!Number.isSafeInteger(result.unassigned_count) || result.unassigned_count < 0 || result.accounts.some(account =>
          account.branch_id !== branch.id || ![account.receipts, account.payments].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) ||
          ![account.opening_balance, account.closing_balance].every(value => value === null || (typeof value === "number" && Number.isFinite(value))))) {
          throw new Error("Sổ tài khoản trả về dữ liệu chưa hợp lệ.");
        }
        results[index] = { accounts: result.accounts.map(account => ({ ...account, branchName: branch.name })), failures: [], unassignedCount: Number(result.unassigned_count) };
      } catch (error) {
        results[index] = { accounts: [], failures: [{ branchId: branch.id, branchName: branch.name, message: error instanceof Error ? error.message : "Không tải được sổ tài khoản" }], unassignedCount: 0 };
      }
    }
  }));
  return { accounts: results.flatMap(result => result.accounts), failures: results.flatMap(result => result.failures), unassignedCount: results.reduce((sum, result) => sum + result.unassignedCount, 0) };
}
