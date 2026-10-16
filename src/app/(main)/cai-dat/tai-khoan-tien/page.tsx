"use client";
import { useEffect, useState } from "react";
import { useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import {
  getMoneyAccountWorkspace,
  saveMoneyAccount,
  type MoneyAccount,
} from "@/lib/services/supabase/money-accounts";
import { cashDateTimeInput } from "@/lib/cash-time";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { exportToExcel } from "@/lib/utils/export";

const kinds: Record<MoneyAccount["kind"], string> = {
  cash: "Tiền mặt",
  bank: "Ngân hàng",
  ewallet: "Ví điện tử",
  clearing: "Chờ quyết toán",
};
export default function MoneyAccountsPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { hasPermission } = usePermissions();
  const canRead = hasPermission("finance.view_cash_book");
  const canManage =
    hasPermission("finance.create_transaction") &&
    hasPermission("finance.void_transaction");
  const today = cashDateTimeInput().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<MoneyAccount[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<MoneyAccount | null | undefined>();
  useEffect(() => {
    setRows([]);
    setUnassigned(0);
    setError("");
    if (!isReady || !activeBranchId || !canRead || !from || !to || from > to)
      return;
    let active = true;
    setLoading(true);
    getMoneyAccountWorkspace(activeBranchId, from, to)
      .then((r) => {
        if (active) {
          setRows(r.accounts);
          setUnassigned(r.unassigned_count);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Không tải được số dư tài khoản.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isReady, activeBranchId, canRead, from, to, revision]);
  return (
    <div className="space-y-4 p-4 sm:p-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Quỹ & tài khoản tiền</h1>
          <p className="text-sm text-muted-foreground">{branchLabel}</p>
        </div>
        <div className="flex gap-2">
          {hasPermission("reports.export") && (
            <Button
              variant="outline"
              disabled={loading || !rows.length}
              onClick={async () => {
                try {
                  await exportToExcel(
                    rows.map((r) => ({
                      ...r,
                      branch: branchLabel,
                      kindLabel: kinds[r.kind],
                      from,
                      to,
                    })),
                    [
                      { header: "Chi nhánh", key: "branch", width: 35 },
                      { header: "Mã", key: "code", width: 18 },
                      { header: "Tên quỹ / tài khoản", key: "name", width: 35 },
                      { header: "Loại", key: "kindLabel", width: 20 },
                      { header: "Ngân hàng", key: "bank_name", width: 25 },
                      {
                        header: "Số tài khoản",
                        key: "account_number",
                        width: 25,
                      },
                      {
                        header: "Chủ tài khoản",
                        key: "account_holder",
                        width: 30,
                      },
                      {
                        header: "Ngày bắt đầu số dư",
                        key: "opening_date",
                        width: 22,
                      },
                      {
                        header: "Số dư khai báo",
                        key: "opening_amount",
                        width: 22,
                      },
                      { header: "Từ ngày", key: "from", width: 18 },
                      { header: "Đến ngày", key: "to", width: 18 },
                      {
                        header: "Số dư đầu kỳ",
                        key: "opening_balance",
                        width: 22,
                      },
                      { header: "Thu trong kỳ", key: "receipts", width: 22 },
                      { header: "Chi trong kỳ", key: "payments", width: 22 },
                      {
                        header: "Số dư cuối kỳ",
                        key: "closing_balance",
                        width: 22,
                      },
                    ],
                    `So-tien-${from}-${to}`,
                    { financialTable: true },
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Không xuất được sổ tiền.",
                  );
                }
              }}
            >
              <Icon name="download" />
              Xuất Excel
            </Button>
          )}
          {canManage && (
            <Button disabled={!activeBranchId} onClick={() => setEdit(null)}>
              <Icon name="add" />
              Thêm tài khoản
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-y py-3">
        <label className="text-sm space-y-1">
          Từ ngày
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm space-y-1">
          Đến ngày
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          onClick={() => setRevision((v) => v + 1)}
          disabled={loading}
        >
          <Icon name="refresh" />
          Tải lại
        </Button>
      </div>
      {!canRead ? (
        <p>Bạn chưa có quyền xem sổ quỹ.</p>
      ) : !activeBranchId ? (
        <p>Chọn một chi nhánh để xem và thiết lập số dư tiền.</p>
      ) : from > to ? (
        <p role="alert" className="text-destructive">
          Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.
        </p>
      ) : loading ? (
        <p>Đang tải số dư...</p>
      ) : (
        <>
          {unassigned > 0 && (
            <p
              role="status"
              className="border-l-2 border-status-warning px-3 py-2 text-sm"
            >
              {unassigned} phiếu trong kỳ chưa xác định tài khoản, chưa nằm
              trong số dư các tài khoản dưới đây.
            </p>
          )}
          <div className="overflow-auto max-h-[65dvh] rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {[
                    "Mã",
                    "Quỹ / tài khoản",
                    "Loại",
                    "Số tài khoản",
                    "Ngày số dư gốc",
                    "Đầu kỳ",
                    "Thu",
                    "Chi",
                    "Cuối kỳ",
                    "Trạng thái",
                    "",
                  ].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className="whitespace-nowrap p-3 text-left"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-medium whitespace-nowrap">
                      {r.code}
                    </td>
                    <td className="p-3 min-w-48">
                      {r.name}
                      <span className="block text-xs text-muted-foreground">
                        {r.bank_name} {r.account_holder}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">{kinds[r.kind]}</td>
                    <td className="p-3 whitespace-nowrap font-mono">
                      {r.account_number || "—"}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {r.opening_date || "Chưa khai báo"}
                    </td>
                    {[
                      r.opening_balance,
                      r.receipts,
                      r.payments,
                      r.closing_balance,
                    ].map((v, i) => (
                      <td
                        key={i}
                        className="p-3 text-right whitespace-nowrap tabular-nums"
                      >
                        {v == null ? "Chưa xác định" : formatCurrency(v)}
                      </td>
                    ))}
                    <td className="p-3 whitespace-nowrap">
                      {r.active ? "Đang dùng" : "Ngừng dùng"}
                    </td>
                    <td className="p-3">
                      {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEdit(r)}
                        >
                          <Icon name="edit" size={16} />
                          Sửa
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="p-5 text-sm text-muted-foreground">
                Chưa có quỹ hoặc tài khoản tiền.
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {edit !== undefined && activeBranchId && (
        <MoneyAccountEditor
          key={edit?.id || "new"}
          account={edit}
          branchId={activeBranchId}
          onClose={() => setEdit(undefined)}
          onSaved={() => {
            setEdit(undefined);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function MoneyAccountEditor({
  account,
  branchId,
  onClose,
  onSaved,
}: {
  account: MoneyAccount | null;
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(account?.code || "");
  const [name, setName] = useState(account?.name || "");
  const [kind, setKind] = useState<MoneyAccount["kind"]>(
    account?.kind || "bank",
  );
  const [bankName, setBankName] = useState(account?.bank_name || "");
  const [number, setNumber] = useState(account?.account_number || "");
  const [holder, setHolder] = useState(account?.account_holder || "");
  const [date, setDate] = useState(account?.opening_date || "");
  const [amount, setAmount] = useState<number | null>(
    account?.opening_amount ?? null,
  );
  const [active, setActive] = useState(account?.active ?? true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (saving) return;
    if (
      !code.trim() ||
      !name.trim() ||
      reason.trim().length < 3 ||
      (kind === "bank" &&
        (!bankName.trim() || !number.trim() || !holder.trim())) ||
      !!date !== (amount !== null)
    ) {
      setError(
        "Điền mã, tên, lý do; tài khoản ngân hàng cần đủ ngân hàng, số và chủ tài khoản. Số dư đầu kỳ cần cả ngày và số tiền.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveMoneyAccount(
        account,
        {
          branchId,
          code,
          name,
          kind,
          bankName,
          accountNumber: number,
          accountHolder: holder,
          openingDate: date || null,
          openingAmount: amount,
          active,
        },
        reason.trim(),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được tài khoản.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {account ? "Sửa quỹ / tài khoản" : "Thêm quỹ / tài khoản"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            Mã
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={saving || !!account}
              maxLength={30}
            />
          </label>
          <label className="space-y-1 text-sm">
            Loại
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MoneyAccount["kind"])}
              disabled={saving || !!account}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              {Object.entries(kinds).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            Tên quỹ / tài khoản
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </label>
          {kind !== "cash" && (
            <>
              <label className="space-y-1 text-sm">
                Ngân hàng / đơn vị
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  disabled={saving}
                />
              </label>
              <label className="space-y-1 text-sm">
                Số tài khoản
                <Input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  disabled={saving}
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                Chủ tài khoản
                <Input
                  value={holder}
                  onChange={(e) => setHolder(e.target.value)}
                  disabled={saving}
                />
              </label>
            </>
          )}
          <label className="space-y-1 text-sm">
            Ngày bắt đầu số dư
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm">
            Số dư đầu kỳ
            <NumericInput
              value={amount}
              onChange={setAmount}
              allowNegative
              min={-9999999999999.99}
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            Lý do khai báo / điều chỉnh
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
            />
          </label>
          {account && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                disabled={saving}
              />
              Đang sử dụng
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Đóng
          </Button>
          <Button onClick={save} disabled={saving}>
            <Icon name="save" size={16} />
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
