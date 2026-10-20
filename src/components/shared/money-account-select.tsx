"use client";
import { useEffect, useId, useState } from "react";
import {
  accountSupportsMethod,
  getMoneyAccounts,
  type MoneyAccount,
} from "@/lib/services/supabase/money-accounts";

export function MoneyAccountSelect({
  branchId,
  method,
  value,
  onChange,
  disabled = false,
  label = "Quỹ / tài khoản thu chi",
  refreshKey = 0,
  emptyHint,
}: {
  branchId?: string | null;
  method: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
  refreshKey?: number;
  emptyHint?: string;
}) {
  const id = useId();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!branchId) {
      setAccounts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setAccounts([]);
    getMoneyAccounts(branchId)
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "Không tải được tài khoản tiền.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, refreshKey]);
  const choices = accounts.filter(
    (a) => (a.active || a.id === value) && accountSupportsMethod(a, method),
  );
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled || loading || !branchId}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border bg-background px-3"
      >
        <option value="">
          {loading ? "Đang tải..." : "Chưa xác định tài khoản"}
        </option>
        {choices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.name}
            {a.account_number ? ` · ${a.account_number}` : ""}
            {!a.active ? " (Ngừng dùng)" : ""}
          </option>
        ))}
      </select>
      {!loading && !error && branchId && !choices.length && emptyHint && <p role="status" className="text-xs text-muted-foreground">{emptyHint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
