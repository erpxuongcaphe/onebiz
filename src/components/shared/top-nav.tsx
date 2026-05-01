"use client";

// ---------------------------------------------------------------------------
// TopNav v3 — Stitch style header h-16 bg-surface-container-lowest
// - Light bg (white-ish) + dark text, primary blue accents
// - Layout: AppSwitcher | BranchSelector | [Global Search] | Import + Bell + Help + User + POS CTA
// - Mobile sheet vẫn dùng sidebarNavGroups để có cùng IA với desktop sidebar
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/contexts";
import { getUnreadNotificationCount } from "@/lib/services";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { sidebarNavGroups, isHrefActive, type SidebarLeaf } from "./nav-config";
import { useCommandPalette } from "./command-palette";
import { AppSwitcher } from "./app-switcher";
import { ImportDataDialog } from "./import-data-dialog";
import { LogoIcon } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

// ---------------------------------------------------------------------------
// Branch selector
// ---------------------------------------------------------------------------

function BranchSelector() {
  const { tenant: _tenant, branches, currentBranch, switchBranch, user } = useAuth();
  const canViewAll = user?.role === "owner" || user?.role === "admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hidden md:flex press-scale-sm items-center gap-1.5 px-3 h-9 text-sm text-foreground/90 hover:text-primary hover:bg-surface-container-low rounded-lg cursor-pointer outline-none">
        <Icon name="apartment" size={16} className="shrink-0 text-muted-foreground" />
        <span className="truncate max-w-[180px] font-semibold">
          {currentBranch?.name ?? "Tất cả chi nhánh"}
        </span>
        <Icon name="expand_more" size={14} className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-[220px]">
        <DropdownMenuLabel>Chọn chi nhánh</DropdownMenuLabel>
        {canViewAll && (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => switchBranch(null)}
          >
            <span className="flex-1">Tất cả chi nhánh</span>
            {currentBranch === null && (
              <Icon name="check" size={16} className="text-primary" />
            )}
          </DropdownMenuItem>
        )}
        {branches.map((branch) => (
          <DropdownMenuItem
            key={branch.id}
            className="cursor-pointer"
            onSelect={() => switchBranch(branch.id)}
          >
            <span className="flex-1">{branch.name}</span>
            {currentBranch?.id === branch.id && (
              <Icon name="check" size={16} className="text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Global Search bar (center) — opens command palette on click.
// Stitch style: pill rounded-full bg-surface-container border subtle.
// ---------------------------------------------------------------------------

function GlobalSearchBar() {
  const { openPalette } = useCommandPalette();

  return (
    <button
      type="button"
      onClick={openPalette}
      className={cn(
        "hidden md:flex press-scale-sm items-center gap-3 h-10 w-full max-w-md px-4 rounded-full",
        "bg-surface-container-low hover:bg-surface-container border border-border hover:border-primary-fixed-dim",
        "text-muted-foreground hover:text-foreground text-sm text-left",
        "focus:outline-none focus:ring-2 focus:ring-primary/30"
      )}
    >
      <Icon name="search" size={18} className="shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">
        Tìm sản phẩm, khách hàng, đơn hàng...
      </span>
      <kbd className="hidden lg:inline-flex font-sans items-center gap-0.5 bg-surface-container-high border border-border rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Ctrl K
      </kbd>
    </button>
  );
}

// ---------------------------------------------------------------------------
// User dropdown
// ---------------------------------------------------------------------------

const roleLabels: Record<string, string> = {
  owner: "Chủ cửa hàng",
  admin: "Quản trị viên",
  manager: "Quản lý",
  staff: "Nhân viên",
  cashier: "Thu ngân",
};

function UserDropdown() {
  const router = useRouter();
  const { user, logout } = useAuth();

  // Defensive — user.fullName TS-type string nhưng DB cho phép null nếu profile
  // chưa set tên. Nếu bỏ qua, .split() trên null → crash toàn bộ TopNav → cả app
  // render /error.tsx. Fallback về null để UI hiện icon person.
  const initials =
    user && typeof user.fullName === "string" && user.fullName.trim()
      ? user.fullName
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .filter(Boolean)
          .slice(-2)
          .join("")
          .toUpperCase()
      : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex press-scale-sm items-center gap-2 pl-1 pr-2 py-1 rounded-full text-foreground hover:bg-surface-container-low cursor-pointer outline-none">
        <span className="h-8 w-8 rounded-full bg-primary-fixed text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {initials ?? <Icon name="person" size={18} />}
        </span>
        <span className="hidden xl:block text-sm font-medium truncate max-w-[100px]">
          {user?.fullName ?? "Tài khoản"}
        </span>
        <Icon name="expand_more" size={14} className="hidden xl:block shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[240px]">
        <div className="px-3 py-3">
          <p className="text-sm font-semibold">{user?.fullName}</p>
          <p className="text-xs text-muted-foreground">
            {user ? roleLabels[user.role] ?? user.role : ""}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => router.push("/ho-so")}
          >
            <Icon name="account_circle" size={16} />
            Hồ sơ cá nhân
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => router.push("/cai-dat")}
          >
            <Icon name="settings" size={16} />
            Cài đặt
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onSelect={() => {
            logout();
          }}
        >
          <Icon name="logout" size={16} />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Mobile nav (sheet) — uses sidebarNavGroups for IA consistency with desktop sidebar
// ---------------------------------------------------------------------------

function MobileLeafLink({
  leaf,
  pathname,
  onClose,
}: {
  leaf: SidebarLeaf;
  pathname: string;
  onClose: () => void;
}) {
  const active = isHrefActive(pathname, leaf.href);

  if (leaf.disabled) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground opacity-50">
        {leaf.icon && <Icon name={leaf.icon} size={18} />}
        <span className="flex-1">{leaf.label}</span>
        {leaf.comingSoon && (
          <span className="text-[9px] font-semibold uppercase rounded px-1.5 py-0.5 bg-status-warning/10 text-status-warning border border-status-warning/25">
            Soon
          </span>
        )}
      </div>
    );
  }

  return (
    <Link
      href={leaf.href}
      onClick={onClose}
      className={cn(
        "flex press-scale-sm items-center gap-3 px-3 py-2 rounded-lg text-sm",
        active
          ? "bg-primary-fixed text-primary font-semibold"
          : "text-foreground/80 hover:bg-surface-container-low hover:text-primary"
      )}
    >
      {leaf.icon && <Icon name={leaf.icon} size={18} fill={active} />}
      <span className="flex-1">{leaf.label}</span>
    </Link>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const { branches, currentBranch, switchBranch, user } = useAuth();
  const [open, setOpen] = useState(false);
  const canViewAll = user?.role === "owner" || user?.role === "admin";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="lg:hidden press-scale-sm inline-flex items-center justify-center h-10 w-10 rounded-lg text-foreground hover:bg-surface-container-low">
        <Icon name="menu" size={22} />
      </SheetTrigger>
      <SheetContent side="left" className="w-[320px] p-0">
        <SheetTitle className="px-5 py-4 border-b font-semibold text-base">Menu</SheetTitle>
        <nav className="p-4 space-y-3 overflow-y-auto max-h-[calc(100vh-60px)]">
          {/* Branch selector for mobile */}
          <div className="pb-3 border-b">
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Chi nhánh
            </div>
            {canViewAll && (
              <button
                onClick={() => switchBranch(null)}
                className={cn(
                  "w-full press-scale-sm text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm",
                  currentBranch === null
                    ? "bg-primary-fixed text-primary font-semibold"
                    : "text-foreground/80 hover:bg-surface-container-low"
                )}
              >
                <Icon name="apartment" size={18} />
                Tất cả chi nhánh
                {currentBranch === null && (
                  <Icon name="check" size={16} className="ml-auto" />
                )}
              </button>
            )}
            {branches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => switchBranch(branch.id)}
                className={cn(
                  "w-full press-scale-sm text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm",
                  currentBranch?.id === branch.id
                    ? "bg-primary-fixed text-primary font-semibold"
                    : "text-foreground/80 hover:bg-surface-container-low"
                )}
              >
                <Icon name="apartment" size={18} />
                {branch.name}
                {currentBranch?.id === branch.id && (
                  <Icon name="check" size={16} className="ml-auto" />
                )}
              </button>
            ))}
          </div>

          {/* Sidebar groups */}
          {sidebarNavGroups.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm font-semibold text-foreground">
                <Icon name={group.icon} size={18} />
                {group.label}
              </div>
              <div className="ml-1 space-y-0.5">
                {group.items?.map((leaf) => (
                  <MobileLeafLink
                    key={leaf.href}
                    leaf={leaf}
                    pathname={pathname}
                    onClose={() => setOpen(false)}
                  />
                ))}
                {group.subGroups?.map((sg) => (
                  <div key={sg.label} className="mt-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {sg.label}
                    </div>
                    {sg.items.map((leaf) => (
                      <MobileLeafLink
                        key={leaf.href}
                        leaf={leaf}
                        pathname={pathname}
                        onClose={() => setOpen(false)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* B2B Order Terminal shortcut */}
          <div className="pt-3 border-t">
            <Link
              href="/pos"
              className="flex press-scale items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary-hover ambient-shadow"
              onClick={() => setOpen(false)}
            >
              <Icon name="point_of_sale" size={18} />
              Mở POS
              <Icon name="chevron_right" size={18} className="ml-auto" />
            </Link>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Main TopNav v3 — Stitch white header with blue accents
// ---------------------------------------------------------------------------

export function TopNav() {
  const [importOpen, setImportOpen] = useState(false);

  // Bell badge — load số notification chưa đọc của user hiện tại.
  // Trước đây hardcode "3" → CEO mở thấy 3 dù không có notification thật.
  // Refresh khi tab focus + 60s interval (đủ live cho UX, chưa cần Realtime).
  // Defensive: chỉ fetch khi user đã ready (`tenant` có giá trị) để tránh
  // race condition fetch khi auth context chưa load → throw "Chưa đăng nhập"
  // → có thể bubble lên root error nếu không catch kỹ.
  const { tenant } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!tenant) return; // chờ tenant ready
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const n = await getUnreadNotificationCount();
        if (!cancelled) setUnreadCount(n);
      } catch (err) {
        // fail-soft — log để debug nhưng không bể UI
        console.warn("[TopNav.unreadCount]", err);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    const onFocus = () => fetchCount();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [tenant]);

  return (
    <>
      {/* Stitch style: bg-surface-container-lowest (white) + subtle bottom border.
          h-16 để nghỉ mắt hơn so với h-12 cũ. */}
      <header className="bg-surface-container-lowest/85 backdrop-blur-md text-foreground sticky top-0 z-40 border-b border-border">
        <div className="flex items-center gap-3 h-16 px-4 md:px-6">
          {/* Left: Mobile menu + AppSwitcher + Logo + BranchSelector */}
          <MobileNav />
          <AppSwitcher />
          <Link
            href="/"
            className="flex items-center ml-1 shrink-0 press-scale-sm"
            title="Trang chủ ONEBIZ."
            aria-label="ONEBIZ home"
          >
            {/* Brand icon "O." — navy nền + chấm xanh, 36×36 khớp slot top-nav */}
            <LogoIcon size={36} className="rounded-xl ambient-shadow" />
          </Link>
          <div className="hidden md:block w-px h-6 bg-border ml-1" />
          <BranchSelector />

          {/* Center: Global Search bar (flex-1 to fill) */}
          <div className="flex-1 flex items-center justify-center px-2 min-w-0">
            <GlobalSearchBar />
          </div>

          {/* Right: Quick Import + Bell + Help + User + Bán hàng */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Quick Import — Trung tâm nhập Excel theo schema */}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className={cn(
                "hidden md:inline-flex press-scale-sm items-center gap-2 h-9 px-3.5 rounded-lg text-xs font-semibold",
                "bg-primary-fixed text-primary hover:bg-primary-fixed-dim transition-colors"
              )}
              title="Trung tâm nhập Excel — tải mẫu & đi tới trang nhập"
            >
              <Icon name="cloud_upload" size={16} />
              <span className="hidden lg:inline">Nhập Excel</span>
            </button>

            {/* Mobile-only quick import button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setImportOpen(true)}
              className="text-foreground/70 hover:text-foreground hover:bg-surface-container-low md:hidden"
              title="Trung tâm nhập Excel"
            >
              <Icon name="cloud_upload" size={18} />
            </Button>

            {/* Notification bell — badge hiển thị unread count thật từ DB */}
            <Link href="/thong-bao" className="relative hidden sm:flex">
              <Button
                variant="ghost"
                size="icon"
                className="text-foreground/70 hover:text-foreground hover:bg-surface-container-low"
                title={`Thông báo${unreadCount > 0 ? ` (${unreadCount} chưa đọc)` : ""}`}
              >
                <Icon name="notifications" size={18} />
              </Button>
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-on-primary flex items-center justify-center pointer-events-none ring-2 ring-surface-container-lowest">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>

            {/* Divider */}
            <div className="hidden sm:block w-px h-6 bg-border mx-1" />

            {/* User dropdown */}
            <UserDropdown />

            {/* POS shortcut — Stitch primary CTA */}
            <Link href="/pos" className="hidden sm:flex ml-2">
              <Button
                size="default"
                className="rounded-xl font-semibold ambient-shadow"
              >
                <Icon name="point_of_sale" size={18} className="mr-1.5" />
                Bán hàng
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <ImportDataDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
