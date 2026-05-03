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

  // PERF F1: KHÔNG block render khi đang load auth.
  // Trước đây isLoading=true → spinner full page → user click chức năng
  // thấy "không load" vì auth chưa xong (cold start ~1s qua 3 round-trip).
  // Giờ:
  // - render children NGAY → page mount, fetch data của nó song song
  // - chỉ chặn khi auth XONG nhưng KHÔNG có quyền (deny chính xác)
  // - permission check trong children dựa vào hasPermission() đã thread-safe
  //   (trả về false khi loading, true/false khi xong)
  // Kết quả: cảm giác app phản hồi tức thì, blank time -> 0.

  // Track slow loading for diagnostic toast (không block UI).
  useEffect(() => {
    if (!isLoading) {
      setSlowLoading(false);
      return;
    }
    const t = setTimeout(() => setSlowLoading(true), 6_000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Chỉ deny khi auth đã hoàn tất + không có quyền.
  // isLoading → cứ render children, để user thấy app phản hồi.
  if (!isLoading && !hasPermission(requires)) {
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

  // Slow loading diagnostic — không block render, chỉ banner nhỏ trên cùng.
  return (
    <>
      {slowLoading && isLoading && (
        <div className="bg-status-warning/10 border-b border-status-warning/30 px-4 py-2 text-xs text-status-warning flex items-center gap-2">
          <Icon name="hourglass_empty" size={14} className="animate-pulse" />
          <span>Đang xác thực lâu hơn thường lệ — kiểm tra kết nối mạng.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-auto underline hover:no-underline"
          >
            Tải lại
          </button>
        </div>
      )}
      {children}
    </>
  );
}
