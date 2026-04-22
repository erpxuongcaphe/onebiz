"use client";

/**
 * PermissionPage — Wrapper that guards page content behind a permission check.
 *
 * Usage:
 *   <PermissionPage requires="system.manage_users">
 *     <ActualPageContent />
 *   </PermissionPage>
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePermissions } from "@/lib/permissions";
import { Icon } from "@/components/ui/icon";

interface PermissionPageProps {
  requires: string;
  children: ReactNode;
}

export function PermissionPage({ requires, children }: PermissionPageProps) {
  const { hasPermission, isLoading } = usePermissions();
  const [slowLoading, setSlowLoading] = useState(false);

  // Nếu sau 6s vẫn loading thì show fallback với nút reload — tránh user
  // stuck trên skeleton vô hạn (auth-context đã có timeout 10s, nhưng UX
  // fallback sớm hơn giúp user ý thức có vấn đề).
  useEffect(() => {
    if (!isLoading) {
      setSlowLoading(false);
      return;
    }
    const t = setTimeout(() => setSlowLoading(true), 6_000);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading) {
    if (slowLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Icon name="hourglass_empty" size={40} className="text-muted-foreground animate-pulse" />
          <p className="text-lg font-medium text-muted-foreground">
            Đang xác thực lâu hơn thường lệ…
          </p>
          <p className="text-sm text-muted-foreground">
            Kiểm tra kết nối mạng. Nếu vẫn chậm, bấm nút bên dưới.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    // Skeleton nhẹ thay vì return null — user biết app đang load chứ không
    // phải màn hình trắng.
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"
          aria-label="Đang tải"
        />
      </div>
    );
  }

  if (!hasPermission(requires)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Icon name="gpp_bad" size={40} className="text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">
          Không có quyền truy cập
        </p>
        <p className="text-sm text-muted-foreground">
          Bạn cần quyền để xem trang này. Liên hệ quản trị viên.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
