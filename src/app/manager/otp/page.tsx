"use client";

/**
 * Manager OTP — trang cấp OTP duyệt từ xa cho MOBILE PWA portal.
 *
 * Route: `/manager/otp` — standalone layout (không có sidebar admin), back
 * button quay về `/manager` (Manager portal). Designed cho điện thoại của
 * quản lý ca khi đi vắng.
 *
 * DESKTOP user dùng `/cap-otp` (admin tree, có sidebar đầy đủ). Logic +
 * UI share qua `<OtpIssuerContent />`.
 *
 * Server enforce: chỉ user có permission tương ứng action mới cấp được
 * (migration 00061 RPC issue_manager_otp).
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts";
import { OtpIssuerContent } from "@/components/shared/otp-issuer-content";

export default function ManagerOtpPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* Header — back về /manager (Manager PWA portal) */}
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

      <main className="p-4 sm:p-6">
        <OtpIssuerContent />
      </main>
    </div>
  );
}
