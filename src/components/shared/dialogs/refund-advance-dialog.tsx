"use client";
import { useRef, useState } from "react";
import Link from "next/link";
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
import { useAuth } from "@/lib/contexts";
import {
  cashDateTimeInput,
  cashInputToIso,
  validateCashTime,
  formatCashTime,
  formatCashBookDate,
} from "@/lib/cash-time";
import { formatCurrency } from "@/lib/format";
import type { PartyAdvanceLedgerRow } from "@/lib/services/supabase/cash-book";
import {
  refundPartyAdvance,
  AdvanceRefundRejectedError,
  advanceRefundPendingKey,
  type AdvanceRefundInput,
} from "@/lib/services/supabase/advance-refunds";

interface Attempt {
  id: string;
  payload: AdvanceRefundInput;
}
export function RefundAdvanceDialog({
  mode,
  partyId,
  partyName,
  source,
  onClose,
  onSuccess,
}: {
  mode: "customer" | "supplier";
  partyId: string;
  partyName: string;
  source: PartyAdvanceLedgerRow;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { tenant, user } = useAuth();
  const key =
    tenant && user
      ? advanceRefundPendingKey(tenant.id, user.id, mode, source.id)
      : "";
  const [restored] = useState<{ attempt?: Attempt; error?: string }>(() => {
    try {
      const text = key && localStorage.getItem(key);
      if (!text) return {};
      const a = JSON.parse(text) as Attempt;
      if (
        !a.id ||
        a.payload?.mode !== mode ||
        a.payload.partyId !== partyId ||
        a.payload.advanceId !== source.id ||
        a.payload.branchId !== source.branchId ||
        !Number.isFinite(a.payload.amount) ||
        a.payload.amount <= 0
      )
        throw new Error();
      return { attempt: a };
    } catch {
      return {
        error:
          "Không đọc được yêu cầu hoàn đang chờ. Chưa lập phiếu mới; cần đối soát yêu cầu cũ.",
      };
    }
  });
  const [attempt, setAttempt] = useState(restored.attempt);
  const [amount, setAmount] = useState<number | null>(
    restored.attempt?.payload.amount ?? null,
  );
  const [method, setMethod] = useState(
    restored.attempt?.payload.paymentMethod ?? "cash",
  );
  const [account, setAccount] = useState(
    restored.attempt?.payload.moneyAccountId ?? "",
  );
  const [accountRevision, setAccountRevision] = useState(0);
  const [at, setAt] = useState(
    restored.attempt
      ? cashDateTimeInput(new Date(restored.attempt.payload.occurredAt))
      : cashDateTimeInput(),
  );
  const [day, setDay] = useState(
    restored.attempt?.payload.transactionDate ??
      cashDateTimeInput().slice(0, 10),
  );
  const [reason, setReason] = useState(
    restored.attempt?.payload.timeReason ?? "",
  );
  const [note, setNote] = useState(restored.attempt?.payload.note ?? "");
  const [review, setReview] = useState(!!restored.attempt);
  const [error, setError] = useState(restored.error ?? "");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const receiving = mode === "supplier";
  const title = receiving ? "Nhận NCC hoàn ứng" : "Hoàn ứng cho khách";
  const valid =
    !!amount &&
    amount > 0 &&
    Number.isFinite(amount) &&
    amount <= source.remainingAmount &&
    !!account &&
    note.trim().length >= 3;
  const check = () => {
    const timeError = validateCashTime(at, day, reason);
    if (!valid || timeError) {
      setError(
        timeError ||
          "Chọn quỹ/tài khoản, nhập nội dung và số tiền không vượt phần ứng còn lại.",
      );
      return;
    }
    setError("");
    setReview(true);
  };
  const execute = async () => {
    if (lock.current || restored.error || !key) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const request = attempt ?? {
        id: crypto.randomUUID(),
        payload: {
          mode,
          partyId,
          branchId: source.branchId,
          advanceId: source.id,
          amount: amount!,
          paymentMethod: method,
          moneyAccountId: account,
          occurredAt: cashInputToIso(at),
          transactionDate: day,
          timeReason: reason.trim(),
          note: note.trim(),
        },
      };
      // Save before sending. Reopening/reloading must reuse the identical request after a lost response.
      localStorage.setItem(key, JSON.stringify(request));
      setAttempt(request);
      const result = await refundPartyAdvance(request.id, request.payload);
      localStorage.removeItem(key);
      onSuccess(
        result.status === "cancelled"
          ? `Phiếu ${result.cash_code} đã hủy; không ghi hoàn thêm.`
          : `Đã ghi ${receiving ? "phiếu thu" : "phiếu chi"} ${result.cash_code} và cập nhật tiền ứng.`,
      );
    } catch (e) {
      if (e instanceof AdvanceRefundRejectedError) {
        localStorage.removeItem(key);
        setAttempt(undefined);
        setReview(false);
      }
      setError(
        e instanceof Error
          ? e.message
          : "Chưa xác nhận được kết quả. Thử lại cùng yêu cầu, không lập phiếu mới.",
      );
    } finally {
      lock.current = false;
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 border-y py-3 text-sm [&_dd]:break-words">
          <dt>Đối tượng</dt>
          <dd className="font-medium">{partyName}</dd>
          <dt>Chi nhánh</dt>
          <dd>{source.branchName}</dd>
          <dt>Phiếu ứng gốc</dt>
          <dd>{source.cashCode}</dd>
          <dt>Ứng còn lại</dt>
          <dd className="font-semibold tabular-nums">
            {formatCurrency(source.remainingAmount)}
          </dd>
        </dl>
        {receiving && <p className="border-l-2 border-primary pl-3 text-sm"><strong>Tiền từ:</strong> {partyName} hoàn khoản ứng {source.cashCode}. <strong>Tiền vào:</strong> quỹ / tài khoản nhận tiền bên dưới. Không phát sinh chi tiền cho nhà cung cấp.</p>}
        {!review ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Số tiền hoàn
              <NumericInput
                value={amount}
                onChange={setAmount}
                min={0.01}
                disabled={!!attempt}
              />
            </label>
            <label className="space-y-1 text-sm">
              Phương thức
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setAccount("");
                }}
                className="h-10 w-full rounded-md border bg-background px-3"
                disabled={!!attempt}
              >
                <option value="cash">Tiền mặt</option>
                <option value="transfer">Chuyển khoản</option>
                <option value="card">Thẻ</option>
                <option value="ewallet">Ví điện tử</option>
              </select>
            </label>
            <div className="sm:col-span-2 space-y-1">
              <MoneyAccountSelect
                branchId={source.branchId}
                method={method}
                value={account}
                onChange={setAccount}
                disabled={!!attempt}
                label={receiving ? "Quỹ / tài khoản nhận tiền" : undefined}
                refreshKey={accountRevision}
                emptyHint={receiving ? "Chưa có tài khoản nhận phù hợp tại chi nhánh này. Thêm quỹ/tài khoản thực tế rồi tải lại; chưa thể ghi phiếu thu." : undefined}
              />
              {receiving && <Button variant="outline" size="sm" disabled={saving || !!attempt} onClick={() => { setAccount(""); setAccountRevision(value => value + 1); }}>Tải lại tài khoản nhận</Button>}
              <Link
                className="inline-flex py-1 text-sm text-primary"
                href="/cai-dat/tai-khoan-tien"
                target="_blank"
                rel="noopener noreferrer"
              >
                Quản lý quỹ / tài khoản
              </Link>
            </div>
            <label className="space-y-1 text-sm">
              Thời điểm thực {receiving ? "nhận" : "chi"}
              <Input
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                disabled={!!attempt}
              />
            </label>
            <label className="space-y-1 text-sm">
              Ngày ghi nhận
              <Input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                disabled={!!attempt}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              Nội dung hoàn ứng
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={!!attempt}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              Lý do nhập lùi / khác ngày
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!!attempt}
              />
            </label>
          </div>
        ) : (
          <section className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>{receiving ? "Tiền thực nhận" : "Tiền thực chi"}</dt>
              <dd className="text-right text-lg font-semibold tabular-nums">
                {formatCurrency(attempt?.payload.amount ?? amount ?? 0)}
              </dd>
              {!attempt && (
                <>
                  <dt>Ứng còn sau hoàn (dự kiến)</dt>
                  <dd className="text-right tabular-nums">
                    {formatCurrency(
                      Math.max(0, source.remainingAmount - (amount ?? 0)),
                    )}
                  </dd>
                </>
              )}
              <dt>Thời điểm thu/chi</dt>
              <dd>
                {formatCashTime(
                  attempt?.payload.occurredAt ?? cashInputToIso(at),
                )}
              </dd>
              <dt>Ngày ghi nhận</dt>
              <dd>{formatCashBookDate(day)}</dd>
            </dl>
            <MoneyAccountSelect
              branchId={source.branchId}
              method={method}
              value={account}
              onChange={setAccount}
              disabled
              label={receiving ? "Quỹ / tài khoản nhận tiền" : undefined}
            />
            <p className="text-sm whitespace-pre-wrap break-words">{note}</p>
            {attempt && (
              <p className="text-sm text-status-warning">
                Yêu cầu đã gửi đang được đối soát. Thử lại cùng yêu cầu để xác
                nhận kết quả, không lập phiếu mới.
              </p>
            )}
            <p className="border-l-2 border-primary pl-3 text-sm">
              {receiving
                ? "Tạo phiếu thu NCC hoàn tiền ứng."
                : "Tạo phiếu chi hoàn tiền ứng cho khách."}{" "}
              Giảm nguồn ứng, không thay đổi tiền đã thanh toán cho hóa
              đơn/phiếu nhập và không ghi nhận doanh thu/chi phí.
            </p>
          </section>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="mx-0 mb-0 flex-wrap gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Đóng
          </Button>
          {review && !attempt && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setReview(false)}
            >
              Chỉnh lại
            </Button>
          )}
          <Button
            disabled={
              saving || !!restored.error || !key || (!attempt && !valid)
            }
            onClick={review ? execute : check}
          >
            <Icon name={review ? "payments" : "fact_check"} size={16} />
            {saving
              ? "Đang xử lý..."
              : attempt
                ? "Kiểm tra / thử lại yêu cầu"
                : review
                  ? receiving
                    ? "Xác nhận nhận hoàn"
                    : "Xác nhận chi hoàn"
                  : "Kiểm tra phiếu hoàn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
