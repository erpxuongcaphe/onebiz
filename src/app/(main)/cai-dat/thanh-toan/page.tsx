"use client";

/**
 * Cài đặt thanh toán — Sprint C (CEO 14/05/2026).
 *
 * 3 section:
 * 1. **Tài khoản ngân hàng + VietQR auto** — chính, có thể test preview ngay
 * 2. **Phương thức thanh toán hỗ trợ** — info only, hardcoded ở schema
 * 3. **Tích hợp cổng thanh toán** — link sang /cai-dat/ket-noi (chưa làm)
 *
 * VietQR flow:
 * - User chọn ngân hàng từ dropdown 30+ NHTM VN
 * - Nhập STK + tên chủ TK
 * - Toggle "Bật QR auto trên POS"
 * - Preview QR (template print) realtime
 * - Lưu → POS FnB + Retail bill in tự attach QR per đơn
 */

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts/toast-context";
import { useSettings } from "@/lib/contexts/settings-context";
import {
  getTenantBusinessInfo,
  updateTenantBusinessInfo,
} from "@/lib/services";
import {
  VIETQR_BANKS,
  buildVietQrUrl,
  isValidAccountNumber,
  findBank,
} from "@/lib/vietqr";
import { cn } from "@/lib/utils";

export default function PaymentSettingsPage() {
  const { toast } = useToast();
  const { updateSettings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [bankCode, setBankCode] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [accountHolder, setAccountHolder] = useState<string>("");
  const [vietQrEnabled, setVietQrEnabled] = useState<boolean>(false);

  // Load existing settings
  useEffect(() => {
    getTenantBusinessInfo()
      .then((info) => {
        setBankCode(info.bankCode ?? "");
        setAccountNumber(info.bankAccount ?? "");
        setAccountHolder(info.bankHolder ?? info.businessName ?? "");
        setVietQrEnabled(info.vietQrEnabled ?? false);
      })
      .catch(() => {
        // silent — defaults are empty
      })
      .finally(() => setLoading(false));
  }, []);

  // Preview QR — build URL only if all required fields valid
  const previewQrUrl = useMemo(() => {
    if (!bankCode || !accountNumber || !isValidAccountNumber(accountNumber)) {
      return null;
    }
    try {
      return buildVietQrUrl({
        bank: bankCode,
        accountNumber: accountNumber.trim(),
        accountHolder: accountHolder.trim() || undefined,
        // Preview với amount 250k + addInfo demo để user thấy đầy đủ
        amount: 250000,
        addInfo: "HD-DEMO-001",
        template: "compact2",
      });
    } catch {
      return null;
    }
  }, [bankCode, accountNumber, accountHolder]);

  const selectedBank = useMemo(() => findBank(bankCode), [bankCode]);

  // Validation
  const accountValid = accountNumber === "" || isValidAccountNumber(accountNumber);
  const canEnableQr = !!bankCode && !!accountNumber && accountValid;
  const isDirty =
    bankCode !== "" || accountNumber !== "" || accountHolder !== "" || vietQrEnabled;

  const handleSave = async () => {
    if (!bankCode || !accountNumber) {
      toast({
        title: "Thiếu thông tin",
        description: "Vui lòng chọn ngân hàng và nhập số tài khoản.",
        variant: "error",
      });
      return;
    }
    if (!isValidAccountNumber(accountNumber)) {
      toast({
        title: "Số tài khoản không hợp lệ",
        description: "STK phải là 4-20 chữ số, không khoảng trắng.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const bank = findBank(bankCode);
      await updateTenantBusinessInfo({
        bankCode,
        bankBin: bank?.bin,
        bankName: bank?.shortName,
        bankAccount: accountNumber.trim(),
        bankHolder: accountHolder.trim() || undefined,
        vietQrEnabled,
      });
      // Sync sang local settings để POS thấy ngay (không cần refresh)
      updateSettings("payment", {
        bankName: bank?.shortName ?? "",
        bankAccount: accountNumber.trim(),
        bankHolder: accountHolder.trim() || "",
        bankBin: bank?.bin,
        bankCode,
        vietQrEnabled,
      });
      toast({
        title: "Đã lưu cài đặt thanh toán",
        description: vietQrEnabled
          ? "QR VietQR sẽ tự in trên mọi bill thanh toán."
          : "Đã lưu thông tin TK ngân hàng. Bật toggle để in QR tự động.",
        variant: "success",
        duration: 5000,
      });
    } catch (err) {
      toast({
        title: "Lỗi lưu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt thanh toán</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tài khoản ngân hàng + QR VietQR tự động trên bill thanh toán
        </p>
      </div>

      {/* ── Section 1: VietQR Setup ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="qr_code_2" size={18} className="text-primary" />
            VietQR — Tự động in QR thanh toán
          </CardTitle>
          <CardDescription>
            Khách quét QR trên bill → app banking tự điền STK + số tiền + nội
            dung. Dùng chuẩn NAPAS247 — hoạt động với mọi ngân hàng VN.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Left: form */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bank">
                  Ngân hàng <span className="text-status-error">*</span>
                </Label>
                <Select
                  value={bankCode}
                  onValueChange={(v) => setBankCode(v ?? "")}
                  items={VIETQR_BANKS.map((b) => ({
                    value: b.code,
                    label: b.shortName,
                  }))}
                >
                  <SelectTrigger id="bank" className="w-full">
                    <SelectValue placeholder="Chọn ngân hàng...">
                      {(v) => {
                        const bank = findBank(v as string);
                        return bank ? bank.shortName : "Chọn ngân hàng...";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {VIETQR_BANKS.map((b) => (
                      <SelectItem key={b.code} value={b.code}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {b.code}
                          </span>
                          <span>{b.shortName}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedBank && (
                  <p className="text-xs text-muted-foreground">
                    {selectedBank.name} · BIN: <code className="font-mono">{selectedBank.bin}</code>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="account-number">
                  Số tài khoản <span className="text-status-error">*</span>
                </Label>
                <Input
                  id="account-number"
                  inputMode="numeric"
                  placeholder="VD: 0123456789"
                  value={accountNumber}
                  onChange={(e) =>
                    setAccountNumber(e.target.value.replace(/\D/g, ""))
                  }
                  className={cn(
                    !accountValid && "border-status-error",
                  )}
                />
                {!accountValid && (
                  <p className="text-xs text-status-error">
                    STK phải là 4-20 chữ số.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="account-holder">Tên chủ tài khoản</Label>
                <Input
                  id="account-holder"
                  placeholder="VD: NGUYEN VAN A"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Hiển thị trong app banking khi khách quét QR. Để trống sẽ
                  dùng tên doanh nghiệp.
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={vietQrEnabled}
                  disabled={!canEnableQr}
                  onClick={() => setVietQrEnabled(!vietQrEnabled)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5",
                    vietQrEnabled ? "bg-primary" : "bg-muted",
                    !canEnableQr && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                      vietQrEnabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    Bật in QR tự động trên bill
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Khi bật: mọi bill thanh toán POS Retail + FnB sẽ tự gắn
                    QR với số tiền + mã hoá đơn chính xác. Khách chỉ cần quét
                    + bấm chuyển.
                  </p>
                  {!canEnableQr && (
                    <p className="text-xs text-status-warning mt-1">
                      ⚠️ Cần chọn ngân hàng + nhập STK trước
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="space-y-2">
              <Label>Xem trước QR</Label>
              <div className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container-low p-4 min-h-[320px] flex items-center justify-center">
                {previewQrUrl ? (
                  <div className="flex flex-col items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewQrUrl}
                      alt="VietQR preview"
                      className="max-w-[280px] w-full h-auto"
                    />
                    <p className="text-[11px] text-muted-foreground text-center">
                      <Icon name="info" size={11} className="inline mr-0.5 align-text-bottom" />
                      QR demo với số tiền <strong>250.000đ</strong> + mã{" "}
                      <code className="font-mono">HD-DEMO-001</code>. Bill
                      thật sẽ thay bằng số tiền & mã đơn cụ thể.
                    </p>
                  </div>
                ) : (
                  <div className="text-center text-sm text-muted-foreground">
                    <Icon
                      name="qr_code_2"
                      size={48}
                      className="mx-auto mb-2 opacity-30"
                    />
                    <p>Chọn ngân hàng + nhập STK để xem trước QR</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              onClick={handleSave}
              disabled={saving || !isDirty || !accountValid}
            >
              {saving ? (
                <>
                  <Icon
                    name="progress_activity"
                    size={14}
                    className="mr-1 animate-spin"
                  />
                  Đang lưu...
                </>
              ) : (
                <>
                  <Icon name="save" size={14} className="mr-1" />
                  Lưu cài đặt
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Phương thức TT hỗ trợ ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="payments" size={16} className="text-primary" />
            Phương thức thanh toán hỗ trợ
          </CardTitle>
          <CardDescription>
            Mọi phương thức dưới đều có sẵn ở POS Retail + FnB
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { code: "cash", label: "Tiền mặt", icon: "payments" },
              { code: "transfer", label: "Chuyển khoản (có QR auto)", icon: "account_balance" },
              { code: "card", label: "Thẻ tín dụng/ghi nợ", icon: "credit_card" },
              { code: "ewallet", label: "Ví điện tử (Momo/Zalo/VNPay)", icon: "account_balance_wallet" },
            ].map((m) => (
              <div
                key={m.code}
                className="flex items-center gap-3 p-3 rounded-lg border bg-surface-container-lowest"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                  <Icon name={m.icon} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {m.code}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="bg-status-success/10 text-status-success border-status-success/25 text-xs"
                >
                  Đã bật
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
