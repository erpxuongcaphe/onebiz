"use client";

/**
 * OTP Issuer — reusable content cấp OTP duyệt từ xa.
 *
 * Dùng ở 2 chỗ với context khác nhau:
 *   - `/cap-otp` (admin desktop, có sidebar/topnav) — `variant="admin"`
 *   - `/manager/otp` (mobile PWA portal, standalone) — `variant="manager"`
 *
 * Logic + UI giống nhau, chỉ khác container layout do route layout cung cấp.
 * CEO 12/05: tách ra để desktop user khi bấm back không bị nhảy về
 * Manager portal (mobile UI) thay vì trang chủ admin.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useAuth, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { formatDate } from "@/lib/format";
import {
  issueManagerOtp,
  getRecentManagerOtps,
  OTP_ACTION_CODES,
  OTP_ACTION_LABELS,
  type IssuedOtp,
  type RecentManagerOtp,
  type OtpActionCode,
} from "@/lib/services/supabase/manager-otp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ActionCard {
  code: OtpActionCode;
  icon: string;
  label: string;
  description: string;
  requiredPermission: string;
  color: string;
}

const ACTION_CARDS: ActionCard[] = [
  {
    code: OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL,
    icon: "receipt_long",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL],
    description: "Cấp cho cashier để hủy bill chưa thu tiền",
    requiredPermission: PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER,
    color: "bg-status-warning/10 text-status-warning border-status-warning/30",
  },
  {
    code: OTP_ACTION_CODES.FNB_CANCEL_UNPAID_ITEM,
    icon: "remove_shopping_cart",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.FNB_CANCEL_UNPAID_ITEM],
    description: "Xóa món đã lưu vào order chưa thanh toán",
    requiredPermission: PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER,
    color: "bg-status-warning/10 text-status-warning border-status-warning/30",
  },
  {
    code: OTP_ACTION_CODES.FNB_DISCOUNT_OVERRIDE,
    icon: "percent",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.FNB_DISCOUNT_OVERRIDE],
    description: "Cashier muốn giảm vượt mức cho phép",
    requiredPermission: PERMISSIONS.POS_FNB_DISCOUNT,
    color: "bg-primary/10 text-primary border-primary/30",
  },
  {
    code: OTP_ACTION_CODES.FNB_EDIT_SENT_ORDER,
    icon: "edit_note",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.FNB_EDIT_SENT_ORDER],
    description: "Thêm/bớt món sau khi đã gửi bếp",
    requiredPermission: PERMISSIONS.POS_FNB_EDIT_SENT_ORDER,
    color: "bg-primary/10 text-primary border-primary/30",
  },
  {
    code: OTP_ACTION_CODES.FNB_VOID_PAID_BILL,
    icon: "money_off",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.FNB_VOID_PAID_BILL],
    description: "Hủy bill đã thu tiền — tự cascade hoàn phiếu thu",
    requiredPermission: PERMISSIONS.POS_FNB_VOID_PAID_BILL,
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
  // Sprint A.7: tách 3 action xóa entity riêng biệt thay vì gộp 'crm.delete_party'
  {
    code: OTP_ACTION_CODES.CRM_DELETE_CUSTOMER,
    icon: "person_remove",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.CRM_DELETE_CUSTOMER],
    description: "Cấp cho nhân viên xoá khách hàng",
    requiredPermission: PERMISSIONS.CUSTOMERS_DELETE,
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
  {
    code: OTP_ACTION_CODES.CRM_DELETE_SUPPLIER,
    icon: "no_accounts",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.CRM_DELETE_SUPPLIER],
    description: "Cấp cho nhân viên xoá nhà cung cấp",
    requiredPermission: PERMISSIONS.SUPPLIERS_DELETE,
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
  {
    code: OTP_ACTION_CODES.PRODUCTS_DELETE,
    icon: "delete_sweep",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.PRODUCTS_DELETE],
    description: "Cấp cho nhân viên xoá sản phẩm",
    requiredPermission: PERMISSIONS.PRODUCTS_DELETE,
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
];

interface OtpIssuerContentProps {
  /** Max width cho hero card. Default `max-w-2xl` (admin desktop có thể dùng nhỏ hơn). */
  maxWidth?: string;
}

export function OtpIssuerContent({ maxWidth = "max-w-2xl" }: OtpIssuerContentProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const [selectedActionCode, setSelectedActionCode] = useState<OtpActionCode>(
    OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL,
  );
  // Day 17/05/2026: bind OTP với mã hoá đơn / mã đơn bếp cụ thể.
  // Cashier đọc mã qua điện thoại → manager nhập trước khi cấp OTP.
  // Server resolve mã → entity_id, RPC verify strict bind đúng target.
  const [targetInvoiceCode, setTargetInvoiceCode] = useState("");
  const [targetKitchenOrderNumber, setTargetKitchenOrderNumber] = useState("");
  const [issuedOtp, setIssuedOtp] = useState<IssuedOtp | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [recent, setRecent] = useState<RecentManagerOtp[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const data = await getRecentManagerOtps(10);
      setRecent(data);
    } catch (err) {
      console.warn("Không tải được lịch sử OTP:", err);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const selectedAction = ACTION_CARDS.find((a) => a.code === selectedActionCode)!;
  const canIssueSelected = hasPermission(selectedAction.requiredPermission);

  // Day 17/05: action nào cần input target để chống OTP "vạn năng"
  const requiresInvoiceCode =
    selectedActionCode === OTP_ACTION_CODES.FNB_VOID_PAID_BILL ||
    selectedActionCode === OTP_ACTION_CODES.FNB_DISCOUNT_OVERRIDE;
  const requiresKitchenOrderNumber =
    selectedActionCode === OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL ||
    selectedActionCode === OTP_ACTION_CODES.FNB_CANCEL_UNPAID_ITEM ||
    selectedActionCode === OTP_ACTION_CODES.FNB_EDIT_SENT_ORDER;

  // Reset target inputs khi đổi action
  const handleActionChange = (next: OtpActionCode) => {
    setSelectedActionCode(next);
    setTargetInvoiceCode("");
    setTargetKitchenOrderNumber("");
    setIssuedOtp(null);
  };

  const handleIssue = async () => {
    if (!canIssueSelected) {
      toast({
        variant: "warning",
        title: "Không có quyền cấp OTP",
        description: `Cần quyền '${selectedAction.requiredPermission}'.`,
      });
      return;
    }
    if (requiresInvoiceCode && !targetInvoiceCode.trim()) {
      toast({
        variant: "warning",
        title: "Cần nhập mã hoá đơn",
        description: "Hỏi cashier mã hoá đơn (vd B-00123) trước khi cấp OTP.",
      });
      return;
    }
    if (requiresKitchenOrderNumber && !targetKitchenOrderNumber.trim()) {
      toast({
        variant: "warning",
        title: "Cần nhập mã đơn bếp",
        description: "Hỏi cashier mã đơn bếp (vd KB-0042) trước khi cấp OTP.",
      });
      return;
    }
    setIssuing(true);
    try {
      const otp = await issueManagerOtp({
        actionCode: selectedActionCode,
        targetInvoiceCode: requiresInvoiceCode
          ? targetInvoiceCode.trim()
          : undefined,
        targetKitchenOrderNumber: requiresKitchenOrderNumber
          ? targetKitchenOrderNumber.trim()
          : undefined,
      });
      setIssuedOtp(otp);
      loadRecent();
    } catch (err) {
      toast({
        variant: "error",
        title: "Không cấp được OTP",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      setIssuing(false);
    }
  };

  return (
    <>
      <div className={cn("mx-auto space-y-4", maxWidth)}>
        {/* Hero — 1 nút cấp OTP duy nhất */}
        <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 rounded-xl bg-status-warning/10 flex items-center justify-center shrink-0">
              <Icon name="vpn_key" size={22} className="text-status-warning" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">Cấp OTP duyệt từ xa</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Cashier gọi xin → chọn action → đọc mã 6 số qua điện thoại
              </p>
            </div>
          </div>

          {/* Action selector */}
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Loại OTP cần cấp
          </label>
          <div className="mt-1.5 space-y-1.5">
            <select
              value={selectedActionCode}
              onChange={(e) => handleActionChange(e.target.value as OtpActionCode)}
              disabled={issuing}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            >
              {ACTION_CARDS.map((a) => {
                const allowed = hasPermission(a.requiredPermission);
                return (
                  <option key={a.code} value={a.code} disabled={!allowed}>
                    {allowed ? "" : "🔒 "}{a.label}
                  </option>
                );
              })}
            </select>
            <div className="flex items-start gap-2 px-1">
              <div className={cn(
                "h-7 w-7 rounded-md flex items-center justify-center shrink-0 border",
                selectedAction.color,
              )}>
                <Icon name={selectedAction.icon} size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground">
                  {selectedAction.description}
                </p>
                {!canIssueSelected && (
                  <p className="text-[11px] text-status-warning mt-0.5 flex items-center gap-1">
                    <Icon name="lock" size={11} />
                    Bạn không có quyền cấp loại này — cần <code className="text-[10px] bg-muted px-1 rounded">{selectedAction.requiredPermission}</code>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Day 17/05: Target binding input cho 3 action sensitive */}
          {(requiresInvoiceCode || requiresKitchenOrderNumber) && (
            <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
              <div className="flex items-start gap-2">
                <Icon
                  name="info"
                  size={14}
                  className="text-primary shrink-0 mt-0.5"
                />
                <p className="text-[11px] text-foreground leading-relaxed">
                  <b>Bảo mật:</b> hỏi cashier đọc mã để OTP chỉ dùng được cho đúng
                  bill đó — chống reuse OTP cho bill khác.
                </p>
              </div>
              {requiresInvoiceCode && (
                <div>
                  <label
                    htmlFor="target-invoice-code"
                    className="block text-[11px] font-medium mb-1"
                  >
                    Mã hoá đơn <span className="text-status-error">*</span>
                  </label>
                  <input
                    id="target-invoice-code"
                    type="text"
                    value={targetInvoiceCode}
                    onChange={(e) => setTargetInvoiceCode(e.target.value)}
                    placeholder="VD: B-00123"
                    disabled={issuing}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                  />
                </div>
              )}
              {requiresKitchenOrderNumber && (
                <div>
                  <label
                    htmlFor="target-ko-number"
                    className="block text-[11px] font-medium mb-1"
                  >
                    Mã đơn bếp <span className="text-status-error">*</span>
                  </label>
                  <input
                    id="target-ko-number"
                    type="text"
                    value={targetKitchenOrderNumber}
                    onChange={(e) =>
                      setTargetKitchenOrderNumber(e.target.value)
                    }
                    placeholder="VD: KB-0042"
                    disabled={issuing}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                  />
                </div>
              )}
            </div>
          )}

          {/* Big issue button */}
          <Button
            size="lg"
            className="w-full mt-4 h-12 text-base font-semibold"
            onClick={handleIssue}
            disabled={!canIssueSelected || issuing}
          >
            {issuing ? (
              <>
                <Icon name="progress_activity" size={18} className="mr-2 animate-spin" />
                Đang sinh mã...
              </>
            ) : (
              <>
                <Icon name="add" size={18} className="mr-1.5" />
                Cấp OTP mới
              </>
            )}
          </Button>

          {/* Quick hint */}
          <div className="mt-3 text-[10px] text-muted-foreground text-center">
            Mã 6 số · TTL 2 phút · dùng 1 lần · {user?.fullName ?? "—"}
          </div>
        </section>

        {/* History */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-semibold text-foreground">
              OTP gần nhất
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadRecent}
              disabled={loadingRecent}
              className="text-xs h-7"
            >
              <Icon
                name="refresh"
                size={14}
                className={cn("mr-1", loadingRecent && "animate-spin")}
              />
              Làm mới
            </Button>
          </div>

          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {loadingRecent ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Icon
                  name="progress_activity"
                  size={20}
                  className="animate-spin inline-block"
                />
                <div className="mt-2">Đang tải...</div>
              </div>
            ) : recent.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Chưa có OTP nào được cấp gần đây.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recent.map((r) => (
                  <RecentOtpRow key={r.id} otp={r} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* OTP display modal */}
      <IssuedOtpDialog
        otp={issuedOtp}
        onClose={() => setIssuedOtp(null)}
      />
    </>
  );
}

// ============================================================
// Subcomponents
// ============================================================

function RecentOtpRow({ otp }: { otp: RecentManagerOtp }) {
  const statusStyle = otp.isUsed
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : otp.isExpired
      ? "bg-muted text-muted-foreground border-border"
      : "bg-primary/10 text-primary border-primary/30";
  const statusLabel = otp.isUsed
    ? `Đã dùng${otp.usedByName ? ` · ${otp.usedByName}` : ""}`
    : otp.isExpired
      ? "Hết hạn"
      : "Đang hiệu lực";
  // Day 17/05: dùng helper formatDate (đã có time) thay vì toLocaleDateString vi-VN
  // → đồng nhất Asia/Ho_Chi_Minh TZ + format DD/MM/YYYY HH:mm
  const time = new Date(otp.createdAt);
  const dt = formatDate(time);
  // formatDate trả "DD/MM/YYYY HH:mm" → tách lại 2 phần để giữ layout 2 dòng
  const parts = dt.split(" ");
  const dateLabel = parts[0] ?? "—";
  const timeLabel = parts[1] ?? "—";

  return (
    <div className="flex items-center gap-3 p-3 hover:bg-surface-container-low transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{otp.actionLabel}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {dateLabel} · {timeLabel}
        </div>
      </div>
      <Badge variant="outline" className={cn("text-[10px]", statusStyle)}>
        {statusLabel}
      </Badge>
    </div>
  );
}

function IssuedOtpDialog({
  otp,
  onClose,
}: {
  otp: IssuedOtp | null;
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!otp) return;
    setSecondsLeft(otp.expiresInSeconds);
    setCopied(false);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [otp]);

  const handleCopy = async () => {
    if (!otp) return;
    try {
      await navigator.clipboard.writeText(otp.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (!otp) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const expired = secondsLeft <= 0;
  const progress = (secondsLeft / otp.expiresInSeconds) * 100;

  return (
    <Dialog open={!!otp} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="pin" size={18} className="text-status-warning" />
            Mã OTP đã cấp
          </DialogTitle>
          <DialogDescription>
            Đọc cho cashier qua điện thoại. Mã dùng được 1 lần trong 2 phút.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* OTP code display */}
          <div
            className={cn(
              "rounded-xl p-6 text-center transition-colors",
              expired
                ? "bg-muted border border-border"
                : "bg-status-warning/5 border border-status-warning/30",
            )}
          >
            <div className="flex justify-center gap-2 mb-3">
              {otp.code.split("").map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-14 w-12 rounded-lg flex items-center justify-center text-3xl font-bold font-mono",
                    expired
                      ? "bg-surface text-muted-foreground border border-border"
                      : "bg-surface text-status-warning border border-status-warning/30",
                  )}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Countdown */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-center gap-1.5 text-sm">
                <Icon
                  name={expired ? "schedule" : "timer"}
                  size={16}
                  className={
                    expired ? "text-muted-foreground" : "text-status-warning"
                  }
                />
                <span
                  className={cn(
                    "font-mono font-medium",
                    expired ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {expired
                    ? "Đã hết hạn"
                    : `${minutes}:${seconds.toString().padStart(2, "0")}`}
                </span>
              </div>
              {!expired && (
                <div className="h-1 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-status-warning transition-all duration-1000"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action hint */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <Icon
                name="phone_in_talk"
                size={16}
                className="text-primary shrink-0 mt-0.5"
              />
              <div>
                <p className="font-medium text-foreground mb-0.5">
                  Hướng dẫn đọc mã
                </p>
                <p>
                  Gọi điện cho cashier đang chờ duyệt — đọc 6 số chậm rãi: vd &quot;8 - 4 - 7 - 2 - 9 - 1&quot;.
                  Tuyệt đối không chụp màn hình hoặc gửi qua tin nhắn.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCopy} disabled={expired}>
            <Icon
              name={copied ? "check" : "content_copy"}
              size={16}
              className="mr-1"
            />
            {copied ? "Đã sao chép" : "Sao chép"}
          </Button>
          <Button onClick={onClose}>
            <Icon name="check" size={16} className="mr-1" />
            Đã đọc xong
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
