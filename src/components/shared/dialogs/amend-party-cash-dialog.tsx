"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Icon } from "@/components/ui/icon";
import { MoneyAccountSelect } from "@/components/shared/money-account-select";
import {
  amendPartyCash,
  CashAmendmentRejectedError,
  type CashAmendmentInput,
} from "@/lib/services/supabase/cash-book";
import { cashDateTimeInput, cashInputToIso } from "@/lib/cash-time";
import { formatCurrency } from "@/lib/format";
import type { CashBookEntry } from "@/lib/types";

export function AmendPartyCashDialog({
  row,
  onClose,
  onSuccess,
}: {
  row: CashBookEntry;
  onClose: () => void;
  onSuccess: (replacement: boolean) => void;
}) {
  const [amount, setAmount] = useState<number | null>(row.amount);
  const [method, setMethod] = useState(row.paymentMethod || "cash");
  const [day, setDay] = useState(row.date.slice(0, 10));
  const [at, setAt] = useState(
    row.occurredAt ? cashDateTimeInput(new Date(row.occurredAt)) : "",
  );
  const [account, setAccount] = useState(row.moneyAccountId || "");
  const [note, setNote] = useState(row.note || "");
  const [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState<{
    id: string;
    payload: CashAmendmentInput;
    reason: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (saving) return;
    if (
      !amount ||
      !Number.isFinite(amount) ||
      !day ||
      note.trim().length < 3 ||
      reason.trim().length < 3
    ) {
      setError(
        "Nhập số tiền, ngày ghi nhận, nội dung thu/chi cụ thể và lý do điều chỉnh.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const request = attempt ?? {
        id: crypto.randomUUID(),
        payload: {
          amount,
          paymentMethod: method,
          transactionDate: day,
          occurredAt: at ? cashInputToIso(at) : null,
          moneyAccountId: account || null,
          note: note.trim(),
        },
        reason: reason.trim(),
      };
      setAttempt(request);
      const result = await amendPartyCash(
        row,
        request.id,
        request.payload,
        request.reason,
      );
      onSuccess(result.replacement);
    } catch (err) {
      if (err instanceof CashAmendmentRejectedError) setAttempt(null);
      setError(
        err instanceof Error
          ? err.message
          : "Chưa xác nhận được điều chỉnh. Giữ nguyên nội dung để thử lại cùng yêu cầu.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Sửa {row.type === "receipt" ? "phiếu thu" : "phiếu chi"} {row.code}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            Số tiền
            <NumericInput
              value={amount}
              onChange={setAmount}
              min={0.01}
              disabled={saving || !!attempt}
            />
          </label>
          <label className="space-y-1 text-sm">
            Phương thức
            <select
              value={method}
              disabled={saving || !!attempt}
              onChange={(e) => {
                setMethod(e.target.value);
                setAccount("");
              }}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              {[
                ["cash", "Tiền mặt"],
                ["transfer", "Chuyển khoản"],
                ["card", "Thẻ"],
                ["ewallet", "Ví điện tử"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            Ngày ghi nhận
            <Input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              disabled={saving || !!attempt}
            />
          </label>
          <label className="space-y-1 text-sm">
            Thời điểm thực thu/chi
            <Input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              disabled={saving || !!attempt}
            />
          </label>
          <div className="sm:col-span-2">
            <MoneyAccountSelect
              branchId={row.branchId}
              method={method}
              value={account}
              onChange={setAccount}
              disabled={saving || !!attempt}
            />
          </div>
          <label className="space-y-1 text-sm sm:col-span-2">
            Nội dung thu/chi
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving || !!attempt}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            Lý do điều chỉnh
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving || !!attempt}
            />
          </label>
        </div>
        {amount !== row.amount && (
          <p className="text-sm text-status-warning">
            Số tiền cũ {formatCurrency(row.amount)}. Phiếu cũ được giữ ở trạng
            thái đã hủy; phiếu thay thế sẽ cập nhật công nợ trong cùng giao
            dịch.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={saving || !row.updatedAt} onClick={submit}>
            <Icon name="save" size={16} />
            {saving
              ? "Đang xử lý..."
              : attempt
                ? "Kiểm tra / thử lại yêu cầu"
                : "Lưu điều chỉnh"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
