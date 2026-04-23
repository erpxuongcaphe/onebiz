"use client";

/**
 * Hồ sơ cá nhân — profile của user đang đăng nhập.
 *
 * Cho phép:
 * - Xem + sửa họ tên, SĐT (email khoá để tránh mất liên kết auth).
 * - Đổi mật khẩu (verify mật khẩu cũ trước rồi updateUser).
 * - Xem role + chi nhánh hiện hành (read-only — admin đổi qua trang User).
 *
 * SĐT bắt buộc format VN để login bằng SĐT work (migration 00036).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/ui/icon";
import { useAuth, useToast } from "@/lib/contexts";
import { createClient } from "@/lib/supabase/client";

/** VN phone: 10-11 số, chấp nhận prefix 0, 84, +84. */
function isValidVnPhone(cleaned: string): boolean {
  if (/^0\d{9,10}$/.test(cleaned)) return true;
  if (/^(\+?84)\d{9,10}$/.test(cleaned)) return true;
  return false;
}

/**
 * Initial 2 ký tự từ họ tên để hiện avatar.
 * Phải defensive với name null/undefined/empty vì DB cho phép null — nếu không
 * `.trim()` trên null → throw TypeError → (main)/error.tsx catch → trang "Đã xảy ra lỗi".
 */
function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = String(name).trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Map role sang nhãn Tiếng Việt. */
function getRoleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Chủ cửa hàng";
    case "admin":
      return "Quản trị viên";
    case "manager":
      return "Quản lý";
    case "cashier":
      return "Thu ngân";
    case "staff":
      return "Nhân viên";
    default:
      return role;
  }
}

export default function HoSoPage() {
  const { user, tenant, currentBranch, refreshProfile, isLoading } = useAuth();
  const { toast } = useToast();
  // createClient() singleton — useMemo để client ổn định giữa các render.
  const supabase = useMemo(() => createClient(), []);

  // Profile form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Sync form state với user khi auth load xong.
  useEffect(() => {
    if (user) {
      setFullName(user.fullName ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  // Guard — auth chưa load hoặc user null (nên không bao giờ xảy ra trong route protected)
  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"
          aria-label="Đang tải"
        />
      </div>
    );
  }

  // Defensive fallbacks — các field tuy typed là required nhưng DB có thể null
  // (email cho user SĐT-only, fullName chưa set). Nếu không phòng ngừa, crash
  // ở getInitials / Input.value / .trim() → error boundary bật lên.
  const safeFullName = user.fullName ?? "";
  const safeEmail = user.email ?? "";
  const safePhone = user.phone ?? "";
  const safeRole = user.role ?? "staff";

  const handleSaveProfile = async () => {
    const nameTrimmed = fullName.trim();
    if (!nameTrimmed) {
      toast({
        title: "Họ tên trống",
        description: "Nhập họ tên để lưu thay đổi.",
        variant: "error",
      });
      return;
    }

    const phoneCleaned = phone.replace(/[\s-]/g, "");
    if (!phoneCleaned) {
      toast({
        title: "Thiếu số điện thoại",
        description: "Cần SĐT để có thể đăng nhập bằng SĐT.",
        variant: "error",
      });
      return;
    }
    if (!isValidVnPhone(phoneCleaned)) {
      toast({
        title: "SĐT không hợp lệ",
        description: "Nhập đúng định dạng VN (VD: 0912345678 hoặc +84912345678).",
        variant: "error",
      });
      return;
    }

    setSavingProfile(true);
    try {
      // Check trùng SĐT trong cùng tenant (trừ chính mình). DB có unique
      // partial index (normalize_phone) nhưng pre-check để message thân thiện.
      // Skip nếu tenantId rỗng (fallback profile khi DB chưa ready).
      if (user.tenantId && phoneCleaned !== safePhone) {
        const { data: dup } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("tenant_id", user.tenantId)
          .eq("phone", phoneCleaned)
          .eq("is_active", true)
          .neq("id", user.id)
          .maybeSingle();

        if (dup) {
          toast({
            title: "SĐT đã được dùng",
            description: `SĐT này đã gán cho nhân viên "${dup.full_name}". Mỗi người cần SĐT riêng.`,
            variant: "error",
            duration: 7000,
          });
          setSavingProfile(false);
          return;
        }
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: nameTrimmed,
          phone: phoneCleaned,
        })
        .eq("id", user.id);

      if (error) {
        // Thường là unique constraint hit (race condition với pre-check).
        const msg = error.message.toLowerCase();
        const friendly = msg.includes("duplicate") || msg.includes("unique")
          ? "SĐT này đã được dùng bởi tài khoản khác trong cửa hàng."
          : error.message;
        toast({
          title: "Không lưu được",
          description: friendly,
          variant: "error",
          duration: 7000,
        });
        setSavingProfile(false);
        return;
      }

      await refreshProfile();
      toast({
        title: "Đã lưu",
        description: "Hồ sơ đã được cập nhật.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi không xác định",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast({
        title: "Thiếu mật khẩu hiện tại",
        description: "Nhập mật khẩu đang dùng để xác minh.",
        variant: "error",
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        title: "Mật khẩu quá ngắn",
        description: "Mật khẩu mới cần ít nhất 6 ký tự.",
        variant: "error",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Mật khẩu không khớp",
        description: "Mật khẩu xác nhận phải trùng mật khẩu mới.",
        variant: "error",
      });
      return;
    }
    if (newPassword === currentPassword) {
      toast({
        title: "Mật khẩu trùng",
        description: "Mật khẩu mới phải khác mật khẩu hiện tại.",
        variant: "error",
      });
      return;
    }

    setSavingPassword(true);
    try {
      // Verify mật khẩu cũ bằng signInWithPassword. Supabase cho phép gọi
      // lại với credentials hiện tại — không làm mất session. Yêu cầu user
      // có email (user SĐT-only sẽ bỏ flow này qua nhánh reset riêng).
      if (!safeEmail) {
        toast({
          title: "Tài khoản không có email",
          description: "Dùng 'Quên mật khẩu' để đặt lại thay vì đổi tại đây.",
          variant: "error",
        });
        setSavingPassword(false);
        return;
      }
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: safeEmail,
        password: currentPassword,
      });
      if (verifyError) {
        toast({
          title: "Mật khẩu hiện tại sai",
          description: "Nhập đúng mật khẩu đang dùng để xác minh.",
          variant: "error",
        });
        setSavingPassword(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        toast({
          title: "Không đổi được mật khẩu",
          description: updateError.message,
          variant: "error",
        });
        setSavingPassword(false);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Đã đổi mật khẩu",
        description: "Dùng mật khẩu mới cho lần đăng nhập tiếp theo.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi không xác định",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const initials = getInitials(safeFullName);
  const roleLabel = getRoleLabel(safeRole);
  const hasProfileChanges =
    fullName.trim() !== safeFullName ||
    phone.replace(/[\s-]/g, "") !== safePhone;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-card p-4">
        <h1 className="text-xl font-semibold">Hồ sơ cá nhân</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 max-w-3xl">
        {/* Thông tin cá nhân */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Thông tin cá nhân</CardTitle>
            <CardDescription>
              Cập nhật họ tên + SĐT. Email khoá để giữ liên kết tài khoản.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
                {initials}
              </div>
              <div className="space-y-1">
                <p className="font-medium">{safeFullName || "(Chưa đặt tên)"}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary">{roleLabel}</Badge>
                  {tenant?.name && (
                    <span className="text-xs text-muted-foreground">
                      · {tenant.name}
                    </span>
                  )}
                  {currentBranch?.name && (
                    <span className="text-xs text-muted-foreground">
                      · {currentBranch.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="full-name">
                  Họ tên <span className="text-destructive">*</span>
                </label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  value={safeEmail}
                  placeholder="(Không có email)"
                  disabled
                />
                <p className="text-xs text-muted-foreground">
                  Email liên kết với tài khoản đăng nhập, không đổi được.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="phone">
                  Số điện thoại <span className="text-destructive">*</span>
                </label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0912345678"
                />
                <p className="text-xs text-muted-foreground">
                  Dùng SĐT này để đăng nhập thay email.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="role">
                  Vai trò
                </label>
                <Input id="role" value={roleLabel} disabled />
                <p className="text-xs text-muted-foreground">
                  Đổi vai trò qua trang Quản lý người dùng.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSaveProfile}
                disabled={savingProfile || !hasProfileChanges}
              >
                <Icon name="save" size={16} />
                {savingProfile ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Đổi mật khẩu */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Đổi mật khẩu</CardTitle>
            <CardDescription>
              Cần xác minh mật khẩu hiện tại trước khi đặt mật khẩu mới.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-1 max-w-sm">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="current-password">
                  Mật khẩu hiện tại
                </label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="new-password">
                  Mật khẩu mới
                </label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Ít nhất 6 ký tự"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="confirm-password">
                  Xác nhận mật khẩu mới
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleChangePassword}
                disabled={
                  savingPassword ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword
                }
              >
                <Icon name="save" size={16} />
                {savingPassword ? "Đang đổi..." : "Cập nhật mật khẩu"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Hoạt động — placeholder đến khi wire audit_log */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Hoạt động gần đây</CardTitle>
            <CardDescription>
              Lịch sử thao tác của bạn — sẽ sớm hiện ở đây.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <Icon name="history" size={32} />
              <p className="text-sm">Tính năng sắp có.</p>
              <p className="text-xs">
                Audit log đã ghi nhận đủ — chờ UI hiển thị.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
