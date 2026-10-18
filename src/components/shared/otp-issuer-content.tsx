"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { formatDate } from "@/lib/format";
import { getRecentManagerOtps, type IssuedOtp, type RecentManagerOtp } from "@/lib/services/supabase/manager-otp";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogBody } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FnbCancelApprovalInbox } from "./fnb-cancel-approval-inbox";
import { ManagerApprovalInbox } from "./manager-approval-inbox";

export function OtpIssuerContent({ maxWidth = "max-w-2xl" }: { maxWidth?: string }) {
  const { hasPermission } = usePermissions();
  const [issuedOtp, setIssuedOtp] = useState<IssuedOtp | null>(null);
  const [recent, setRecent] = useState<RecentManagerOtp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const seq = ++generation.current; setLoading(true);
    try { const rows = await getRecentManagerOtps(10); if (seq === generation.current) { setRecent(rows); setError(''); } }
    catch(e) { if (seq === generation.current) setError(e instanceof Error ? e.message : 'Không tải được lịch sử.'); }
    finally { if (seq === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  return <><div className={cn('mx-auto space-y-4', maxWidth)}>
    <p className="text-sm text-muted-foreground">Chọn đúng yêu cầu để cấp mã 6 số. Mã nhập một lần trong 2 phút; người xin thực hiện đúng nội dung đã duyệt.</p>
    <ManagerApprovalInbox onIssued={otp => { setIssuedOtp(otp); void load(); }} />
    {hasPermission(PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER) && <FnbCancelApprovalInbox onIssued={otp => { setIssuedOtp(otp); void load(); }} />}
    <section className="space-y-2"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Mã đã cấp gần đây</h2><Button aria-label="Làm mới lịch sử OTP" size="icon" variant="ghost" disabled={loading} onClick={() => void load()}><Icon name="refresh" size={18} /></Button></div>
      {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
      {loading && recent.length === 0 && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {!loading && !error && recent.length === 0 && <p className="text-sm text-muted-foreground">Chưa có mã được cấp gần đây.</p>}
      <div className="divide-y rounded-lg border">{recent.map(otp => <RecentOtpRow key={otp.id} otp={otp} />)}</div>
    </section>
  </div><IssuedOtpDialog otp={issuedOtp} onClose={() => setIssuedOtp(null)} /></>;
}

function RecentOtpRow({ otp }: { otp: RecentManagerOtp }) {
  const statusStyle = otp.isUsed
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : otp.isExpired
      ? "bg-muted text-muted-foreground border-border"
      : "bg-primary/10 text-primary border-primary/30";
  const statusLabel = otp.isUsed
    ? `Đã xác thực${otp.usedByName ? ` · ${otp.usedByName}` : ""}`
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
        <div className="text-xs text-muted-foreground mt-0.5">
          {dateLabel} · {timeLabel}
        </div>
      </div>
      <Badge variant="outline" className={cn("text-xs", statusStyle)}>
        {statusLabel}
      </Badge>
    </div>
  );
}

export function IssuedOtpDialog({
  otp,
  onClose,
}: {
  otp: IssuedOtp | null;
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!otp) return;
    const updateRemaining = () => {
      const expiry = Date.parse(otp.expiresAt);
      setSecondsLeft(Number.isFinite(expiry)
        ? Math.max(0, Math.ceil((expiry - Date.now()) / 1000)) : 0);
    };
    updateRemaining();
    setCopied(false);
    setCopyError(false);
    const interval = setInterval(updateRemaining, 1000);
    document.addEventListener("visibilitychange", updateRemaining);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", updateRemaining);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [otp]);

  const handleCopy = async () => {
    if (!otp || Date.parse(otp.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(otp.expiresAt))) return;
    try {
      await navigator.clipboard.writeText(otp.code);
      setCopied(true);
      setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  if (!otp) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const expired = secondsLeft <= 0;
  const progress = Math.min(100, (secondsLeft / Math.max(1, otp.expiresInSeconds)) * 100);

  return (
    <Dialog open={!!otp} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="pin" size={18} className="text-status-warning" />
            Mã OTP đã cấp
          </DialogTitle>
          <DialogDescription>
            Đọc cho cashier qua điện thoại. Mã dùng được 1 lần trong 2 phút.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 py-2">
          {/* OTP code display */}
          <div
            className={cn(
              "rounded-lg p-3 sm:p-4 text-center transition-colors",
              expired
                ? "bg-muted border border-border"
                : "bg-status-warning/5 border border-status-warning/30",
            )}
          >
            <div className="flex justify-center gap-1.5 sm:gap-2 mb-3">
              {otp.code.split("").map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-12 w-9 sm:h-14 sm:w-12 rounded-md flex items-center justify-center text-2xl sm:text-3xl font-bold font-mono",
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
          {copyError && <p role="alert" className="text-sm text-status-error">Không sao chép được. Anh/chị đọc mã đang hiển thị cho người xin duyệt.</p>}
        </DialogBody>

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
