"use client";
import type { MoneyAccount } from "@/lib/services/supabase/money-accounts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { hasOpeningBalance, moneyAccountKinds } from "./money-account-display";

function AccountStatus({ account }: { account: MoneyAccount }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${account.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
    <span aria-hidden className={`size-1.5 rounded-full ${account.active ? "bg-emerald-600" : "bg-muted-foreground"}`} />
    {account.active ? "Đang dùng" : "Ngừng dùng"}
  </span>;
}

const amount = (value: number | null | undefined) => value == null ? "Chưa xác định" : formatCurrency(value);
const moneyFields = [
  ["opening_balance", "Đầu kỳ"], ["receipts", "Thu trong kỳ"],
  ["payments", "Chi trong kỳ"], ["closing_balance", "Cuối kỳ"],
] as const;

export function MoneyAccountList({ rows, balances, canManage, onEdit }: {
  rows: MoneyAccount[]; balances: boolean; canManage: boolean; onEdit: (account: MoneyAccount) => void;
}) {
  const edit = (account: MoneyAccount) => canManage && <Button size="sm" variant="outline" className="min-h-10 pointer-coarse:min-h-11" onClick={() => onEdit(account)}>
    <Icon name="edit" size={16} />Sửa
  </Button>;
  return <>
    <div className="hidden xl:block overflow-auto max-h-[65dvh] rounded-lg border">
      <table className={`w-full text-[15px] ${balances ? "min-w-[1080px]" : "min-w-[960px]"}`} aria-label={balances ? "Số dư và thu chi theo tài khoản" : "Danh sách tài khoản"}>
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {(balances ? ["Mã", "Tên quỹ / tài khoản", "Ngày bắt đầu số dư", "Đầu kỳ", "Thu trong kỳ", "Chi trong kỳ", "Cuối kỳ", "Thao tác"] : ["Mã", "Tên quỹ / tài khoản", "Loại", "Ngân hàng / đơn vị", "Số tài khoản", "Chủ tài khoản", "Trạng thái", "Thao tác"]).map((label, index) =>
              <th key={label} scope="col" className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${balances && index >= 3 && index <= 6 ? "text-right" : "text-left"} ${label === "Thao tác" ? "sticky right-0 bg-muted" : ""}`}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(account => <tr key={account.id} className="border-t hover:bg-muted/20">
            <td className="px-4 py-4 font-mono text-sm whitespace-nowrap">{account.code}</td>
            <td className="px-4 py-4 min-w-40 max-w-60 break-words font-medium">{account.name}{balances && !account.active && <div className="mt-1"><AccountStatus account={account} /></div>}</td>
            {balances ? <>
              <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">{account.opening_date ? formatShortDate(account.opening_date) : "Chưa khai báo"}</td>
              {moneyFields.map(([key]) => <td key={key} className={`px-4 py-4 text-right whitespace-nowrap tabular-nums ${key === "closing_balance" ? "font-semibold" : ""}`}>{amount(account[key])}</td>)}
            </> : <>
              <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">{moneyAccountKinds[account.kind]}</td>
              <td className="px-4 py-4 min-w-36 max-w-52 break-words">{account.bank_name || "—"}</td>
              <td className="px-4 py-4 font-mono whitespace-nowrap min-w-40">{account.account_number || "—"}</td>
              <td className="px-4 py-4 min-w-36 max-w-52 break-words">{account.account_holder || "—"}</td>
              <td className="px-4 py-4 whitespace-nowrap"><AccountStatus account={account} />
                {!hasOpeningBalance(account) && <p className="mt-1 text-xs text-muted-foreground">Chưa khai báo số dư</p>}
              </td>
            </>}
            <td className="sticky right-0 bg-background px-4 py-4">{edit(account)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:hidden" aria-label="Tài khoản trên điện thoại">
      {rows.map(account => <article key={account.id} className="rounded-lg border bg-card p-4 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="font-semibold break-words">{account.name}</p><p className="mt-1 font-mono text-xs text-muted-foreground break-all">{account.code} · {moneyAccountKinds[account.kind]}</p></div>
          <AccountStatus account={account} />
        </div>
        {balances ? <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
          {moneyFields.map(([key, label]) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums break-words">{amount(account[key])}</dd></div>)}
          <div className="col-span-2"><dt className="text-xs text-muted-foreground">Ngày bắt đầu số dư</dt><dd className="mt-1 text-sm">{account.opening_date ? formatShortDate(account.opening_date) : "Chưa khai báo"}</dd></div>
        </dl> : <dl className="mt-4 space-y-3 border-t pt-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Ngân hàng / đơn vị</dt><dd className="mt-1 break-words">{account.bank_name || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Số tài khoản</dt><dd className="mt-1 font-mono break-all">{account.account_number || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Chủ tài khoản</dt><dd className="mt-1 break-words">{account.account_holder || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Số dư ban đầu</dt><dd className="mt-1">{hasOpeningBalance(account) ? "Đã khai báo" : "Chưa khai báo"}</dd></div>
        </dl>}
        {canManage && <div className="mt-4 flex justify-end">{edit(account)}</div>}
      </article>)}
    </div>
  </>;
}
