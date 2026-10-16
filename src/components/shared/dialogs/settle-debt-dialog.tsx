"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Icon } from "@/components/ui/icon";
import {
  CashTimeFields,
  useCashTimeDraft,
} from "@/components/shared/cash-time-fields";
import { MoneyAccountSelect } from "@/components/shared/money-account-select";
import { cashInputToIso, validateCashTime } from "@/lib/cash-time";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { useAuth, useToast } from "@/lib/contexts";
import { getCounterpartyBalanceSummary } from "@/lib/services/supabase/debt-workspace";
import {
  getOpenInvoicesByCustomer,
  getOpenPurchasesBySupplier,
  settlePartyDocuments,
  PartySettlementRejectedError,
  type OpenInvoiceLine,
  type PartySettlementInput,
} from "@/lib/services/supabase/payments";

interface SettleDebtDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "customer" | "supplier";
  partyId: string;
  branchId?: string | null;
  partyName: string;
  estimatedDebt: number;
  onSuccess?: () => void;
}
export function SettleDebtDialog({
  open,
  onOpenChange,
  mode,
  partyId,
  branchId,
  partyName,
  onSuccess,
}: SettleDebtDialogProps) {
  const { toast } = useToast();
  const { tenant, user } = useAuth();
  const submissionLock = useRef(false);
  const pendingKey =
    tenant && user && branchId
      ? `onebiz_party_settlement_v1:${tenant.id}:${user.id}:${mode}:${partyId}:${branchId}`
      : "";
  const [pendingUnreadable, setPendingUnreadable] = useState(false);
  const [docs, setDocs] = useState<OpenInvoiceLine[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState<number | null>(null);
  const [advance, setAdvance] = useState(0);
  const [source, setSource] = useState<"cash" | "advance">("cash");
  const [method, setMethod] = useState("cash");
  const [account, setAccount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState<{
    id: string;
    payload: PartySettlementInput;
  } | null>(null);
  const { cashTime, setCashTime } = useCashTimeDraft(open);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDocs([]);
    setExcluded(new Set());
    setAmount(null);
    setAdvance(0);
    setSource("cash");
    setMethod("cash");
    setAccount("");
    setNote("");
    setError("");
    setAttempt(null);
    setPendingUnreadable(false);
    let restored: NonNullable<typeof attempt> | null = null;
    if (pendingKey) {
      try {
        const stored = localStorage.getItem(pendingKey);
        if (stored) {
          const pending = JSON.parse(stored) as NonNullable<typeof attempt>;
          if (
            !pending.id ||
            pending.payload?.mode !== mode ||
            pending.payload.partyId !== partyId ||
            pending.payload.branchId !== branchId ||
            !Array.isArray(pending.payload.lines)
          )
            throw new Error("Invalid pending settlement");
          setAttempt(pending);
          restored = pending;
          setSource(pending.payload.source);
          setAmount(pending.payload.lines.reduce((sum, line) => sum + line.amount, 0));
          setNote(pending.payload.note);
          setMethod(pending.payload.paymentMethod || "cash");
          setAccount(pending.payload.moneyAccountId || "");
        }
      } catch {
        setPendingUnreadable(true);
        setError(
          "Không đọc được yêu cầu đang chờ. Chưa gửi thanh toán mới; cần đối soát yêu cầu cũ.",
        );
      }
    }
    if (!branchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const load = async () => {
      const rows =
        mode === "customer"
          ? await getOpenInvoicesByCustomer(partyId, branchId)
          : await getOpenPurchasesBySupplier(partyId, branchId);
      const summary = await getCounterpartyBalanceSummary(branchId);
      if (!summary)
        throw new Error(
          "Chưa xác minh được nguồn tiền ứng; tải lại trước khi thanh toán.",
        );
      const available =
        (mode === "customer" ? summary.customers : summary.suppliers).find(
          (r) => r.partyId === partyId,
        )?.advance || 0;
      if (active) {
        setDocs(rows);
        setAdvance(available);
        if (restored) return;
        setSource(available > 0 ? "advance" : "cash");
        setAmount(
          available > 0
            ? Math.min(
                available,
                rows.reduce((s, r) => s + r.debt, 0),
              )
            : rows.reduce((s, r) => s + r.debt, 0),
        );
      }
    };
    load()
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Không tải được công nợ.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, mode, partyId, branchId, pendingKey]);
  const allocations = useMemo(() => {
    let remaining = amount || 0;
    return docs.map((d) => {
      const allocated = excluded.has(d.id) ? 0 : Math.min(d.debt, remaining);
      remaining = Math.max(0, remaining - allocated);
      return { ...d, allocated };
    });
  }, [docs, excluded, amount]);
  const totalDebt = docs.reduce((s, d) => s + d.debt, 0);
  const totalAllocated = allocations.reduce((s, d) => s + d.allocated, 0);
  const extra = Math.max(0, (amount || 0) - totalAllocated);
  const frozen = saving || !!attempt;
  const execute = async (request: NonNullable<typeof attempt>) => {
    if (submissionLock.current || !pendingKey) return;
    submissionLock.current = true;
    setSaving(true);
    setError("");
    try {
      // Persist before sending, so reopening or reloading cannot create a second payment.
      localStorage.setItem(pendingKey, JSON.stringify(request));
      setAttempt(request);
      const result = await settlePartyDocuments(request.id, request.payload);
      localStorage.removeItem(pendingKey);
      setAttempt(null);
      toast({
        title:
          request.payload.source === "advance"
            ? "Đã cấn tiền ứng"
            : mode === "customer"
              ? "Đã thu nợ"
              : "Đã thanh toán NCC",
        description: `${result.documents.length} chứng từ · ${formatCurrency(request.payload.lines.reduce((sum, line) => sum + line.amount, 0))}`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      if (e instanceof PartySettlementRejectedError) {
        localStorage.removeItem(pendingKey);
        setAttempt(null);
      }
      setError(
        e instanceof Error
          ? e.message
          : "Chưa xác nhận được kết quả; thử lại cùng yêu cầu.",
      );
    } finally {
      submissionLock.current = false;
      setSaving(false);
    }
  };
  const submit = async () => {
    if (saving || !branchId || pendingUnreadable) return;
    if (!pendingKey) {
      setError(
        "Chưa xác định được tài khoản đăng nhập. Tải lại trước khi thanh toán.",
      );
      return;
    }
    if (attempt) {
      await execute(attempt);
      return;
    }
    if (!amount || amount <= 0 || !Number.isFinite(amount) || !totalAllocated) {
      setError("Chọn chứng từ và nhập số tiền lớn hơn 0.");
      return;
    }
    if (note.trim().length < 3) {
      setError("Ghi rõ nội dung thu/chi hoặc lý do cấn tiền ứng.");
      return;
    }
    if (source === "advance" && (amount > advance || extra > 0)) {
      setError(
        "Số tiền cấn không được vượt tiền ứng còn lại hoặc nợ các chứng từ đã chọn.",
      );
      return;
    }
    if (source === "cash" && mode === "customer" && extra > 0) {
      setError(
        "Số tiền thu vượt công nợ đã chọn. Ghi nhận tiền khách trả trước bằng chức năng riêng.",
      );
      return;
    }
    if (source === "cash") {
      const timeError = validateCashTime(
        cashTime.occurredLocal,
        cashTime.transactionDate,
        cashTime.timeReason,
      );
      if (timeError) {
        setError(timeError);
        return;
      }
    }
    setError("");
    try {
      const lines = allocations
        .filter((d) => d.allocated > 0)
        .map((d) => ({ id: d.id, amount: d.allocated }));
      if (source === "cash" && mode === "supplier" && extra > 0)
        lines[lines.length - 1].amount += extra;
      const request = attempt || {
        id: crypto.randomUUID(),
        payload: {
          mode,
          source,
          branchId,
          partyId,
          lines,
          note: note.trim(),
          paymentMethod: method,
          moneyAccountId: account || null,
          ...(source === "cash"
            ? {
                occurredAt: cashInputToIso(cashTime.occurredLocal),
                transactionDate: cashTime.transactionDate,
                timeReason: cashTime.timeReason,
              }
            : {}),
        },
      };
      await execute(request);
    } catch (e) {
      if (e instanceof PartySettlementRejectedError) setAttempt(null);
      setError(
        e instanceof Error
          ? e.message
          : "Chưa xác nhận được kết quả; thử lại cùng yêu cầu.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b p-5">
          <DialogTitle>Thanh toán công nợ · {partyName}</DialogTitle>
          <DialogDescription>
            {mode === "customer" ? "Khách hàng" : "Nhà cung cấp"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto space-y-4 p-5">
          {attempt && (
            <p role="status" className="text-sm text-status-warning">
              Đang giữ yêu cầu {attempt.id}. {attempt.payload.note} ·{" "}
              {formatCurrency(
                attempt.payload.lines.reduce(
                  (sum, line) => sum + line.amount,
                  0,
                ),
              )}
              . Thử lại chỉ kiểm tra yêu cầu này, không tạo lần thanh toán mới.
            </p>
          )}
          {!branchId ? (
            <p role="alert">
              Chọn một chi nhánh để thanh toán hoặc cấn tiền ứng đúng phạm vi.
            </p>
          ) : loading ? (
            <p>Đang tải chứng từ và nguồn tiền ứng...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 border-y py-3 text-sm">
                <div>
                  Còn nợ
                  <p className="font-semibold tabular-nums">
                    {formatCurrency(totalDebt)}
                  </p>
                </div>
                <div>
                  Tiền ứng còn lại
                  <p className="font-semibold tabular-nums text-status-success">
                    {formatCurrency(advance)}
                  </p>
                </div>
              </div>
              <fieldset
                className="flex flex-wrap gap-4 text-sm"
                disabled={frozen}
              >
                <legend className="mb-2 font-medium">Nguồn thanh toán</legend>
                {[
                  ["advance", "Dùng tiền ứng đã ghi nhận"],
                  [
                    "cash",
                    mode === "customer" ? "Thu tiền mới" : "Chi tiền mới",
                  ],
                ].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="party-settlement-source"
                      value={v}
                      checked={source === v}
                      disabled={v === "advance" && advance <= 0}
                      onChange={() => {
                        setSource(v as "cash" | "advance");
                        setAmount(
                          v === "advance"
                            ? Math.min(advance, totalDebt)
                            : totalDebt,
                        );
                      }}
                    />
                    {l}
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  Số tiền
                  <NumericInput
                    value={amount}
                    onChange={setAmount}
                    disabled={frozen}
                  />
                </label>
                {source === "cash" && (
                  <label className="space-y-1 text-sm">
                    Phương thức
                    <select
                      value={method}
                      onChange={(e) => {
                        setMethod(e.target.value);
                        setAccount("");
                      }}
                      disabled={frozen}
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
                )}
              </div>
              {source === "cash" && (
                <>
                  <MoneyAccountSelect
                    branchId={branchId}
                    method={method}
                    value={account}
                    onChange={setAccount}
                    disabled={frozen}
                  />
                  <fieldset disabled={frozen}>
                    <CashTimeFields value={cashTime} onChange={setCashTime} />
                  </fieldset>
                </>
              )}
              <label className="block space-y-1 text-sm">
                {source === "advance"
                  ? "Nội dung cấn tiền ứng"
                  : "Nội dung thu/chi"}
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={frozen}
                />
              </label>
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {[
                        "Chọn",
                        "Chứng từ",
                        "Ngày",
                        "Tổng tiền",
                        "Đã thanh toán",
                        "Còn nợ",
                        "Phân bổ",
                      ].map((h) => (
                        <th key={h} className="whitespace-nowrap p-2 text-left">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Phân bổ ${d.code}`}
                            checked={!excluded.has(d.id)}
                            disabled={frozen}
                            onChange={(e) => {
                              const next = new Set(excluded);
                              if (e.target.checked) next.delete(d.id);
                              else next.add(d.id);
                              setExcluded(next);
                            }}
                          />
                        </td>
                        <td className="p-2 font-medium whitespace-nowrap">
                          {d.code}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {formatShortDate(d.date)}
                        </td>
                        {[d.total, d.paid, d.debt, d.allocated].map((n, i) => (
                          <td
                            key={i}
                            className="p-2 text-right tabular-nums whitespace-nowrap"
                          >
                            {formatCurrency(n)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!docs.length && (
                  <p className="p-4 text-muted-foreground">
                    Không có chứng từ còn nợ.
                  </p>
                )}
              </div>
              {extra > 0 && (
                <p className="text-sm text-status-warning">
                  Vượt nợ chứng từ được chọn: {formatCurrency(extra)}
                  {mode === "supplier" && source === "cash"
                    ? " · Sẽ ghi nhận thành tiền ứng NCC."
                    : ""}
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 border-t p-4">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Đóng
          </Button>
          <Button
            disabled={
              saving ||
              pendingUnreadable ||
              !pendingKey ||
              (!attempt && (loading || !branchId || !docs.length))
            }
            onClick={submit}
          >
            <Icon name="check" size={16} />
            {saving
              ? "Đang xử lý..."
              : attempt
                ? "Kiểm tra / thử lại yêu cầu"
                : source === "advance"
                  ? "Xác nhận cấn tiền ứng"
                  : "Xác nhận thanh toán"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
