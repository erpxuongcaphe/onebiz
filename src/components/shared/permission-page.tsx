"use client";

/**
 * PermissionPage — Wrapper that guards page content behind a permission check.
 *
 * Usage:
 *   <PermissionPage requires="system.manage_users">
 *     <ActualPageContent />
 *   </PermissionPage>
 */

import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { usePermissions } from "@/lib/permissions";

interface PermissionPageProps {
  requires: string;
  children: ReactNode;
}

export function PermissionPage({ requires, children }: PermissionPageProps) {
  const { hasPermission, isLoading } = usePermissions();

  if (isLoading) return null;

  if (!hasPermission(requires)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
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
