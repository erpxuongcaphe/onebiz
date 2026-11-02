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

function PermissionDenied({ retry }: { retry?: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  async function refreshPermissions() {
    if (!retry || refreshing) return;
    setRefreshing(true);
    setRetryFailed(false);
    try {
      await retry();
    } catch {
      setRetryFailed(true);
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div role="alert" className="mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-3 px-5 py-8 text-center">
      <Icon name="gpp_bad" size={40} className="text-muted-foreground" />
      <p className="text-lg font-medium text-muted-foreground">Không có quyền truy cập</p>
      <p className="text-sm text-muted-foreground">Bạn cần quyền để xem trang này. Liên hệ quản trị viên.</p>
      {retry && <button type="button" disabled={refreshing} onClick={() => { void refreshPermissions(); }} className="min-h-11 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">
        {refreshing ? "Đang kiểm tra..." : "Kiểm tra lại quyền"}
      </button>}
      {retryFailed && <p className="text-sm text-destructive">Chưa kiểm tra được quyền. Vui lòng thử lại.</p>}
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
    return <PermissionDenied retry={retry} />;
  }

  return <>{children}</>;
}
