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
  requires: string | readonly string[];
  children: ReactNode;
}

function PermissionLoading({retry}: {retry?: () => Promise<void>}) {
  const [slowLoading, setSlowLoading] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlowLoading(true), 6_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div role="status" className="flex min-h-48 flex-wrap items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
      <Icon name="hourglass_empty" size={20} className="animate-pulse" />
      <span>{slowLoading ? "Đang xác thực lâu hơn thường lệ. Kiểm tra kết nối mạng." : "Đang xác thực quyền truy cập..."}</span>
      {slowLoading && <button type="button" onClick={() => { if (retry) void retry(); else window.location.reload(); }} className="min-h-10 px-2 font-medium text-primary underline">Tải lại</button>}
    </div>
  );
}

export function PermissionPage({ requires, children }: PermissionPageProps) {
  const { hasPermission, isLoading, loadError, retry } = usePermissions();
  const requiredPermissions = Array.isArray(requires) ? requires : [requires];
  const isAllowed = requiredPermissions.some(permission => hasPermission(permission));
  if (isLoading) return <PermissionLoading retry={retry} />;
  if (loadError) return (
    <div role="alert" className="mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-3 px-5 py-8 text-center">
      <Icon name="wifi_off" size={32} className="text-muted-foreground" />
      <p className="text-lg font-semibold">Chưa kiểm tra được quyền truy cập</p>
      <p className="text-sm text-muted-foreground">{loadError}</p>
      <button type="button" onClick={() => { void retry?.(); }} className="min-h-11 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-on-primary">Thử lại</button>
    </div>
  );
  if (!isAllowed) {
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
