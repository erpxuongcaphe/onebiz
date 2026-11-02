import type { MoneyAccount } from "@/lib/services/supabase/money-accounts";

export const moneyAccountKinds: Record<MoneyAccount["kind"], string> = {
  cash: "Tiền mặt", bank: "Ngân hàng", ewallet: "Ví điện tử", clearing: "Chờ quyết toán",
};

export function hasOpeningBalance(account: MoneyAccount) {
  return account.opening_date != null && account.opening_amount != null;
}
