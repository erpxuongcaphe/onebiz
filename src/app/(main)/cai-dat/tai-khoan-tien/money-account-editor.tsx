"use client";
import { useState } from "react";
import { saveMoneyAccount, deleteMoneyAccount, type MoneyAccount } from "@/lib/services/supabase/money-accounts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { moneyAccountKinds as kinds } from "./money-account-display";
export function MoneyAccountEditor({
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
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (!account || saving) return;
    if (reason.trim().length < 3) {
      setError("Nhập lý do xóa ít nhất 3 ký tự.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await deleteMoneyAccount(account, reason);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được tài khoản.");
    } finally { setSaving(false); }
  };
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
    if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(code.trim().toUpperCase())) {
      setError("Mã tối đa 30 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang hoặc gạch dưới.");
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
      <DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle>
            {account ? "Sửa quỹ / tài khoản" : "Thêm quỹ / tài khoản"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Tách riêng tên gợi nhớ, ngân hàng, số tài khoản và chủ tài khoản để dễ đối chiếu.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            Mã
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={saving}
              maxLength={30}
              placeholder="Ví dụ: NH-MB-01"
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
              placeholder="Ví dụ: MB nhận tiền bán hàng"
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
          <div className="sm:col-span-2 border-t pt-4">
            <h2 className="font-medium">Số dư ban đầu (không bắt buộc)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Chỉ tạo thông tin tài khoản: để trống cả ngày và số tiền, bổ sung sau khi đối soát.
            </p>
          </div>
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
        {deleteRequested && account && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-2">
            <p className="font-medium">Xóa tài khoản {account.code} — {account.name}?</p>
            <p>Chỉ xóa tài khoản tạo nhầm chưa được dùng và không có số dư đầu kỳ khác 0. Tài khoản đã có chứng từ cần bỏ chọn Đang sử dụng để giữ lịch sử.</p>
            <p>Nhập lý do ở ô phía trên, rồi bấm Xác nhận xóa.</p>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={saving} onClick={remove}>Xác nhận xóa</Button>
              <Button variant="outline" disabled={saving} onClick={() => setDeleteRequested(false)}>Giữ tài khoản</Button>
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2 border-t pt-4">
          {account && !deleteRequested && <Button variant="outline" className="text-destructive sm:mr-auto" disabled={saving} onClick={() => setDeleteRequested(true)}>Xóa tài khoản tạo nhầm</Button>}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Đóng
          </Button>
          <Button onClick={save} disabled={saving || deleteRequested}>
            <Icon name="save" size={16} />
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
