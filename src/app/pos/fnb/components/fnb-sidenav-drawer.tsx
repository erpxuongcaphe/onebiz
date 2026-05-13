"use client";

/**
 * FnbSidenavDrawer — Sidenav slide-in từ trái (Sprint A — CEO 06/05).
 *
 * CEO feedback: "menu trái nên được ẩn trong biểu tượng 3 gạch khi nào muốn
 * thì mở lên". POS FnB hiện không có sidenav — drawer này cho phép nhân viên
 * quản lý quick-jump sang các module khác (sản phẩm, tồn kho, báo cáo) mà
 * không phải back về trang chủ rồi mở.
 *
 * Pattern: Material 3 navigation drawer
 *  - Trigger: ☰ button trong FnbHeader
 *  - Slide-in từ trái 280px, backdrop blur clickable để đóng
 *  - ESC key đóng (handled bởi parent FnbPosPage keyboard handler)
 *  - z-index 50 (trên mọi cart/dialog ngoại trừ critical alerts)
 */

import Link from "next/link";
import { useEffect } from "react";
import { useAuth } from "@/lib/contexts";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";

interface FnbSidenavDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Open close-shift dialog từ drawer. */
  onCloseShift?: () => void;
  /** Có ca đang mở không — để show "Đóng ca" thay vì "Mở ca". */
  hasOpenShift?: boolean;
  /** Sprint B.5 (CEO 12/05): mở dialog switch user qua PIN POS. */
  onSwitchUser?: () => void;
}

interface NavItem {
  href: string;
  icon: string;
  label: string;
  /** Disable trên fnb subdomain (vì page không có ở fnb.*). */
  fnbExternal?: boolean;
}

const POS_ITEMS: NavItem[] = [
  { href: "/pos/fnb", icon: "restaurant", label: "POS FnB" },
  { href: "/pos/fnb/kds", icon: "restaurant_menu", label: "Màn bếp (KDS)" },
  { href: "/pos", icon: "point_of_sale", label: "POS Retail", fnbExternal: true },
];

const MANAGE_ITEMS: NavItem[] = [
  { href: "/hang-hoa", icon: "inventory_2", label: "Sản phẩm", fnbExternal: true },
  { href: "/hang-hoa/ton-kho", icon: "warehouse", label: "Tồn kho", fnbExternal: true },
  { href: "/khach-hang", icon: "person", label: "Khách hàng", fnbExternal: true },
  { href: "/phan-tich/fnb", icon: "analytics", label: "Báo cáo F&B", fnbExternal: true },
];

const SYSTEM_ITEMS: NavItem[] = [
  { href: "/he-thong/quan-ly-ban", icon: "table_restaurant", label: "Quản lý bàn", fnbExternal: true },
  { href: "/cai-dat", icon: "settings", label: "Cài đặt", fnbExternal: true },
];

export function FnbSidenavDrawer({
  open,
  onClose,
  onCloseShift,
  hasOpenShift,
  onSwitchUser,
}: FnbSidenavDrawerProps) {
  const { user, currentBranch, logout } = useAuth();
  const { isFnb } = useFnbSubdomain();

  // ESC key đóng drawer (redundant với parent handler nhưng an toàn nếu drawer
  // mở từ context khác).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll khi drawer mở
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop — click để đóng */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className="fixed left-0 top-0 bottom-0 z-50 w-72 bg-surface-container-lowest border-r border-outline-variant/30 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200"
        role="dialog"
        aria-label="Điều hướng"
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-outline-variant/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary text-on-primary flex items-center justify-center font-black text-lg shrink-0">
            <Icon name="local_cafe" size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-foreground truncate">
              {currentBranch?.name ?? "Xưởng cà phê"}
            </div>
            <div className="text-xs text-on-surface-variant truncate">
              {user?.fullName ?? "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors"
            aria-label="Đóng"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Nav sections */}
        <div className="flex-1 overflow-y-auto py-2">
          <NavSection label="POS" items={POS_ITEMS} isFnb={isFnb} onClose={onClose} />
          <NavSection label="Quản lý" items={MANAGE_ITEMS} isFnb={isFnb} onClose={onClose} />
          <NavSection label="Hệ thống" items={SYSTEM_ITEMS} isFnb={isFnb} onClose={onClose} />
        </div>

        {/* Footer actions */}
        <div className="border-t border-outline-variant/20 p-2 space-y-1">
          {/* Sprint B.5 (CEO 12/05): switch user qua PIN POS — nhanh 5s
              thay vì logout/login email/password 30-45s */}
          {onSwitchUser && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onSwitchUser();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <Icon name="switch_account" size={18} />
              <span className="flex-1 text-left font-medium">Đổi nhân viên (PIN)</span>
            </button>
          )}
          {onCloseShift && hasOpenShift && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onCloseShift();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container hover:text-foreground transition-colors"
            >
              <Icon name="logout" size={18} />
              <span className="flex-1 text-left font-medium">Đóng ca</span>
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              onClose();
              await logout();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface-variant hover:bg-status-error/10 hover:text-status-error transition-colors"
          >
            <Icon name="exit_to_app" size={18} />
            <span className="flex-1 text-left font-medium">Đăng xuất</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function NavSection({
  label,
  items,
  isFnb,
  onClose,
}: {
  label: string;
  items: NavItem[];
  isFnb: boolean;
  onClose: () => void;
}) {
  // Trên fnb subdomain, các page bên ngoài (hang-hoa, bao-cao, ...) có thể
  // không tồn tại do middleware rewrite. Ẩn item fnbExternal khỏi drawer khi
  // đang ở fnb subdomain — staff click sẽ bị 404.
  const visibleItems = items.filter((it) => !isFnb || !it.fnbExternal);
  if (visibleItems.length === 0) return null;

  return (
    <div className="px-2 mb-2">
      <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-on-surface-variant">
        {label}
      </div>
      <div className="space-y-0.5">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container hover:text-foreground transition-colors",
            )}
          >
            <Icon name={item.icon} size={18} className="shrink-0" />
            <span className="flex-1 truncate font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
