"use client";

// ---------------------------------------------------------------------------
// TopNav v2 — Header thanh lịch 48px
// - Đã LOẠI BỎ desktop mega-menu (sidebar v2 đã thay thế role này)
// - Layout: AppSwitcher | Logo | BranchSelector | [Global Search] | Quick Import + Bell + Help + User + Bán hàng
// - Mobile sheet vẫn dùng sidebarNavGroups để có cùng IA với desktop sidebar
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ShoppingCart,
  Bell,
  Menu,
  ChevronDown,
  Search,
  CircleHelp,
  Building2,
  LogOut,
  UserCircle,
  Settings,
  Check,
  Upload,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/lib/contexts";
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
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Branch selector
// ---------------------------------------------------------------------------

function BranchSelector() {
  const { tenant, branches, currentBranch, switchBranch, user } = useAuth();
  const canViewAll = user?.role === "owner" || user?.role === "admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer outline-none">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[160px]">
          <span className="font-semibold">{tenant?.name ?? "OneBiz"}</span>
          <span className="text-white/60 mx-1">|</span>
          <span className="text-white/80">{currentBranch?.name ?? "Tất cả"}</span>
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px]">
        <DropdownMenuLabel>Chọn chi nhánh</DropdownMenuLabel>
        {canViewAll && (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => switchBranch(null)}
          >
            <span className="flex-1">Tất cả chi nhánh</span>
            {currentBranch === null && (
              <Check className="h-4 w-4 text-primary" />
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
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Global Search bar (center) — opens command palette on click
// ---------------------------------------------------------------------------

function GlobalSearchBar() {
  const { openPalette } = useCommandPalette();

  return (
    <button
      type="button"
      onClick={openPalette}
      className={cn(
        "hidden md:flex items-center gap-2.5 h-8 w-full max-w-md px-3 rounded-md",
        "bg-white/15 hover:bg-white/25 border border-white/20 hover:border-white/30",
        "text-white/90 hover:text-white text-sm transition-colors text-left",
        "focus:outline-none focus:ring-2 focus:ring-white/30"
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-white/70" />
      <span className="flex-1 truncate text-white/70">
        Tìm sản phẩm, khách hàng, đơn hàng...
      </span>
      <kbd className="hidden lg:inline-flex font-mono items-center gap-0.5 bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-[10px] font-medium">
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

  const initials = user
    ? user.fullName
        .split(" ")
        .map((w) => w[0])
        .slice(-2)
        .join("")
        .toUpperCase()
    : "??";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 px-1.5 py-1 rounded-md text-white/90 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none">
        <span className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {initials}
        </span>
        <span className="hidden xl:block text-sm font-medium truncate max-w-[100px]">
          {user?.fullName ?? "---"}
        </span>
        <ChevronDown className="h-3 w-3 hidden xl:block shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[220px]">
        <div className="px-2 py-2">
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
            <UserCircle className="h-4 w-4" />
            Hồ sơ cá nhân
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => router.push("/cai-dat")}
          >
            <Settings className="h-4 w-4" />
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
          <LogOut className="h-4 w-4" />
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
  const Icon = leaf.icon;

  if (leaf.disabled) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground opacity-50">
        {Icon && <Icon className="h-4 w-4" />}
        <span className="flex-1">{leaf.label}</span>
        {leaf.comingSoon && (
          <span className="text-[9px] font-semibold uppercase rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200">
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
        "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
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
      <SheetTrigger className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-white hover:bg-white/10 transition-colors">
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] p-0">
        <SheetTitle className="px-4 py-3 border-b font-semibold">Menu</SheetTitle>
        <nav className="p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-60px)]">
          {/* Branch selector for mobile */}
          <div className="pb-3 border-b">
            <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Chi nhánh
            </div>
            {canViewAll && (
              <button
                onClick={() => switchBranch(null)}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
                  currentBranch === null
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Building2 className="h-3.5 w-3.5" />
                Tất cả chi nhánh
                {currentBranch === null && (
                  <Check className="h-3.5 w-3.5 ml-auto" />
                )}
              </button>
            )}
            {branches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => switchBranch(branch.id)}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
                  currentBranch?.id === branch.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Building2 className="h-3.5 w-3.5" />
                {branch.name}
                {currentBranch?.id === branch.id && (
                  <Check className="h-3.5 w-3.5 ml-auto" />
                )}
              </button>
            ))}
          </div>

          {/* Sidebar groups */}
          {sidebarNavGroups.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.label}>
                <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-foreground">
                  <GroupIcon className="h-4 w-4" />
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
            );
          })}

          {/* B2B Order Terminal shortcut */}
          <div className="pt-3 border-t">
            <Link
              href="/pos"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setOpen(false)}
            >
              <ShoppingCart className="h-4 w-4" />
              Mở POS
              <ChevronRight className="h-4 w-4 ml-auto" />
            </Link>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Main TopNav v2
// ---------------------------------------------------------------------------

export function TopNav() {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <header className="bg-[hsl(217,91%,40%)] text-white sticky top-0 z-40">
        <div className="flex items-center gap-2 h-12 px-3">
          {/* Left: Mobile menu + AppSwitcher + Logo + BranchSelector */}
          <MobileNav />
          <AppSwitcher />
          <Link href="/" className="flex items-center gap-2 ml-1 mr-1 shrink-0">
            <span className="text-lg font-bold tracking-tight">OneBiz</span>
          </Link>
          <div className="hidden md:block w-px h-5 bg-white/20" />
          <BranchSelector />

          {/* Center: Global Search bar (flex-1 to fill) */}
          <div className="flex-1 flex items-center justify-center px-2 min-w-0">
            <GlobalSearchBar />
          </div>

          {/* Right: Quick Import + Bell + Help + User + Bán hàng */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Quick Import — prominent (M3 core feature) */}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className={cn(
                "hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium",
                "bg-white/15 hover:bg-white/25 border border-white/20 hover:border-white/30",
                "text-white transition-colors"
              )}
              title="Import dữ liệu cho AI (Excel/CSV)"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Import dữ liệu</span>
            </button>

            {/* Mobile-only quick import button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setImportOpen(true)}
              className="text-white/80 hover:text-white hover:bg-white/10 md:hidden"
              title="Import dữ liệu"
            >
              <Upload className="h-4 w-4" />
            </Button>

            {/* Notification bell */}
            <Link href="/thong-bao" className="relative hidden sm:flex">
              <Button
                variant="ghost"
                size="icon"
                className="text-white/80 hover:text-white hover:bg-white/10"
                title="Thông báo"
              >
                <Bell className="h-4 w-4" />
              </Button>
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center pointer-events-none">
                3
              </span>
            </Link>

            {/* Help */}
            <Link href="/tro-giup" className="hidden sm:flex">
              <Button
                variant="ghost"
                size="icon"
                className="text-white/80 hover:text-white hover:bg-white/10"
                title="Trợ giúp"
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
            </Link>

            {/* Divider */}
            <div className="hidden sm:block w-px h-5 bg-white/20 mx-1" />

            {/* User dropdown */}
            <UserDropdown />

            {/* POS shortcut */}
            <Link href="/pos" className="hidden sm:flex ml-1.5">
              <Button
                size="sm"
                className="bg-emerald-500 text-white hover:bg-emerald-600 font-semibold shadow-sm"
              >
                <ShoppingCart className="h-4 w-4 mr-1.5" />
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
