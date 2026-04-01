"use client";

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
import { mainNavItems, type NavGroup } from "./nav-config";
import { cn } from "@/lib/utils";

// --- Branch selector ---

function BranchSelector() {
  const { tenant, branches, currentBranch, switchBranch } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer outline-none"
      >
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[140px]">
          <span className="font-semibold">{tenant?.name ?? "OneBiz"}</span>
          <span className="text-white/60 mx-1">|</span>
          <span className="text-white/80">{currentBranch?.name ?? "---"}</span>
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px]">
        <DropdownMenuLabel>Chọn chi nhánh</DropdownMenuLabel>
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

// --- Nav dropdown (mega-menu style, hover) ---

function NavDropdown({ item }: { item: NavGroup }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = item.items?.some((group) =>
    group.items.some(
      (i) => pathname === i.href || pathname.startsWith(i.href + "/")
    )
  );

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className={cn(
          "flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md transition-colors",
          isActive
            ? "bg-white/20 text-white"
            : "text-white/80 hover:bg-white/10 hover:text-white"
        )}
      >
        {item.label}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && item.items && (
        <div className="absolute top-full left-0 mt-0 pt-1 z-50">
          <div className="bg-white rounded-lg shadow-xl border min-w-[200px] py-2 flex gap-0">
            {item.items.map((group, gi) => (
              <div key={gi} className="px-1 min-w-[180px]">
                {group.groupLabel && (
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.groupLabel}
                  </div>
                )}
                {group.items.map((subItem) => (
                  <Link
                    key={subItem.href}
                    href={subItem.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block px-3 py-2 text-sm rounded-md transition-colors",
                      pathname === subItem.href
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    {subItem.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Simple nav link ---

function NavLink({ item }: { item: NavGroup }) {
  const pathname = usePathname();
  const isActive = pathname === item.href;

  return (
    <Link
      href={item.href!}
      className={cn(
        "px-3 py-2 text-sm font-medium rounded-md transition-colors",
        isActive
          ? "bg-white/20 text-white"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      )}
    >
      {item.label}
    </Link>
  );
}

// --- User dropdown ---

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
      <DropdownMenuTrigger
        className="flex items-center gap-2 px-2 py-1 rounded-md text-white/90 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none"
      >
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

// --- Mobile nav ---

function MobileNav() {
  const pathname = usePathname();
  const { branches, currentBranch, switchBranch } = useAuth();

  return (
    <Sheet>
      <SheetTrigger className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-white hover:bg-white/10 transition-colors">
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] p-0">
        <SheetTitle className="px-4 py-3 border-b font-semibold">
          Menu
        </SheetTitle>
        <nav className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-60px)]">
          {/* Branch selector for mobile */}
          <div className="mb-3 pb-3 border-b">
            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
              Chi nhánh
            </div>
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

          {/* Nav items */}
          {mainNavItems.map((item) => (
            <div key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  className={cn(
                    "block px-3 py-2 rounded-md text-sm font-medium",
                    pathname === item.href
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <div>
                  <div className="px-3 py-2 text-sm font-semibold text-foreground">
                    {item.label}
                  </div>
                  {item.items?.map((group, gi) => (
                    <div key={gi} className="ml-2">
                      {group.groupLabel && (
                        <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase">
                          {group.groupLabel}
                        </div>
                      )}
                      {group.items.map((subItem) => (
                        <Link
                          key={subItem.href}
                          href={subItem.href}
                          className={cn(
                            "block px-3 py-1.5 rounded-md text-sm",
                            pathname === subItem.href
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {subItem.label}
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* POS + user links for mobile */}
          <div className="pt-3 border-t space-y-1">
            <Link
              href="/thong-bao"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted"
            >
              <Bell className="h-4 w-4" />
              Thông báo
              <span className="ml-auto h-5 w-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
                3
              </span>
            </Link>
            <Link
              href="/ho-so"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted"
            >
              <UserCircle className="h-4 w-4" />
              Hồ sơ cá nhân
            </Link>
            <Link
              href="/cai-dat"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted"
            >
              <Settings className="h-4 w-4" />
              Cài đặt
            </Link>
          </div>
          <div className="pt-2 border-t">
            <Link
              href="/pos"
              target="_blank"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700"
            >
              <ShoppingCart className="h-4 w-4" />
              Bán hàng
            </Link>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// --- Main TopNav ---

export function TopNav() {
  return (
    <header className="bg-[hsl(217,91%,40%)] text-white sticky top-0 z-50">
      <div className="flex items-center h-12 px-4">
        {/* Mobile menu */}
        <MobileNav />

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-2 lg:mr-4 shrink-0">
          <span className="text-lg font-bold tracking-tight">OneBiz</span>
        </Link>

        {/* Branch selector */}
        <BranchSelector />

        {/* Divider */}
        <div className="hidden md:block w-px h-5 bg-white/20 mx-2" />

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 min-w-0">
          {mainNavItems.map((item) =>
            item.items ? (
              <NavDropdown key={item.label} item={item} />
            ) : (
              <NavLink key={item.label} item={item} />
            )
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {/* Global search */}
          <Button
            variant="ghost"
            size="icon"
            className="text-white/80 hover:text-white hover:bg-white/10 hidden sm:inline-flex"
            onClick={() => {
              // TODO: open search dialog
            }}
          >
            <Search className="h-4 w-4" />
          </Button>

          {/* Notification bell */}
          <Link href="/thong-bao" className="relative hidden sm:flex">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
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
            >
              <CircleHelp className="h-4 w-4" />
            </Button>
          </Link>

          {/* Divider */}
          <div className="hidden sm:block w-px h-5 bg-white/20 mx-1" />

          {/* User dropdown */}
          <UserDropdown />

          {/* Bán hàng button */}
          <Link href="/pos" target="_blank" className="hidden sm:flex ml-1.5">
            <Button
              size="sm"
              className="bg-green-500 text-white hover:bg-green-600 font-semibold shadow-sm"
            >
              <ShoppingCart className="h-4 w-4 mr-1.5" />
              Bán hàng
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
