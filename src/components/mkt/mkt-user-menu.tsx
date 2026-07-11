"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts";

/** Nút đăng xuất trên header MKT Hub (shell riêng, không có TopNav ERP). */
export function MktUserMenu() {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
    } finally {
      window.location.href = "/dang-nhap";
    }
  }

  return (
    <div className="flex items-center gap-2">
      {user?.email ? (
        <span className="hidden max-w-[180px] truncate text-xs text-on-surface-variant md:inline">
          {user.email}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleLogout}
        disabled={busy}
        title="Đăng xuất"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container disabled:opacity-50"
      >
        <Icon name="logout" size={18} />
        <span className="hidden sm:inline">{busy ? "Đang thoát…" : "Đăng xuất"}</span>
      </button>
    </div>
  );
}
