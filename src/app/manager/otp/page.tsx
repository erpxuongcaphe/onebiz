"use client";

/**
 * Manager OTP — trang cấp OTP duyệt từ xa (CEO 12/05/2026).
 *
 * Route: `/manager/otp` — vào được trên cả web thường + Manager PWA + app
 * native sau này. URL giữ stable để dễ wire vào notification / QR code /
 * Zalo OA link.
 *
 * UI:
 *   1. Section trên: 6 action card — click "Cấp OTP" → modal hiển thị mã 6
 *      số to + đếm ngược 2 phút + copy. Manager đọc qua điện thoại.
 *   2. Section dưới: history 10 OTP gần nhất với status (đang hiệu lực /
 *      đã dùng / hết hạn) — cho manager track xem ai đã duyệt gì.
 *
 * Server enforce: chỉ user có permission tương ứng action mới cấp được
 * (migration 00061 RPC issue_manager_otp).
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useAuth, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
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
  /** Permission code cần có để cấp OTP cho action này. */
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
  {
    code: OTP_ACTION_CODES.CRM_DELETE_PARTY,
    icon: "person_remove",
    label: OTP_ACTION_LABELS[OTP_ACTION_CODES.CRM_DELETE_PARTY],
    description: "Cấp cho nhân viên xóa khách hàng / NCC",
    requiredPermission: PERMISSIONS.CUSTOMERS_DELETE,
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
];

export default function ManagerOtpPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const [issuedOtp, setIssuedOtp] = useState<IssuedOtp | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
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

  const handleIssue = async (action: ActionCard) => {
    if (!hasPermission(action.requiredPermission)) {
      toast({
        variant: "warning",
        title: "Không có quyền cấp OTP",
        description: `Cần quyền '${action.requiredPermission}'.`,
      });
      return;
    }
    setIssuing(action.code);
    try {
      const otp = await issueManagerOtp({ actionCode: action.code });
      setIssuedOtp(otp);
      // Refresh history
      loadRecent();
    } catch (err) {
      toast({
        variant: "error",
        title: "Không cấp được OTP",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      setIssuing(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/manager">
            <Button variant="ghost" size="sm" className="-ml-2">
              <Icon name="arrow_back" size={18} />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-foreground">
              Cấp OTP duyệt từ xa
            </h1>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
              Mã 6 số, hiệu lực 2 phút, dùng 1 lần · đăng nhập: {user?.fullName ?? "—"}
            </p>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        {/* Hướng dẫn ngắn */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
          <Icon
            name="info"
            size={20}
            className="text-primary shrink-0 mt-0.5"
          />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Cách dùng</p>
            <ol className="list-decimal list-inside space-y-0.5 mt-1 text-xs">
              <li>Cashier gọi điện / nhắn Zalo cho bạn xin duyệt</li>
              <li>Bạn bấm <strong>Cấp OTP</strong> ở action tương ứng</li>
              <li>Đọc mã 6 số qua điện thoại cho cashier</li>
              <li>Cashier nhập vào POS — mã chỉ dùng được 1 lần</li>
            </ol>
          </div>
        </div>

        {/* 6 action cards */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3 px-1">
            Cấp OTP cho action
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ACTION_CARDS.map((a) => {
              const allowed = hasPermission(a.requiredPermission);
              const isLoading = issuing === a.code;
              return (
                <button
                  key={a.code}
                  onClick={() => handleIssue(a)}
                  disabled={!allowed || isLoading}
                  className={cn(
                    "text-left p-4 rounded-xl border-2 transition-all bg-surface",
                    "hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed",
                    allowed
                      ? "border-border hover:border-primary/40"
                      : "border-border",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 border",
                        a.color,
                      )}
                    >
                      <Icon name={a.icon} size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{a.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {a.description}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        {allowed ? (
                          isLoading ? (
                            <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">
                              <Icon
                                name="progress_activity"
                                size={10}
                                className="animate-spin mr-1"
                              />
                              Đang cấp...
                            </Badge>
                          ) : (
                            <Badge className="bg-status-success/10 text-status-success border-status-success/30 text-[10px]">
                              <Icon name="check_circle" size={10} className="mr-1" />
                              Có quyền
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            <Icon name="lock" size={10} className="mr-1" />
                            Thiếu quyền
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
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
      </main>

      {/* OTP display modal */}
      <IssuedOtpDialog
        otp={issuedOtp}
        onClose={() => setIssuedOtp(null)}
      />
    </div>
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
  const time = new Date(otp.createdAt);
  const timeLabel = time.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateLabel = time.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });

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

  // Đếm ngược + auto-close khi hết hạn
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
                  Gọi điện cho cashier đang chờ duyệt — đọc 6 số chậm rãi: vd "8 - 4 - 7 - 2 - 9 - 1".
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
