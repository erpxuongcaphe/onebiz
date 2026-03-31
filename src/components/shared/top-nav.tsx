"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ShoppingCart,
  Bell,
  Settings,
  User,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { mainNavItems, type NavGroup } from "./nav-config";
import { cn } from "@/lib/utils";

function NavDropdown({ item }: { item: NavGroup }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = item.items?.some((group) =>
    group.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
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

function MobileNav() {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-white hover:bg-white/10 transition-colors">
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] p-0">
        <SheetTitle className="px-4 py-3 border-b font-semibold">Menu</SheetTitle>
        <nav className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-60px)]">
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
          <div className="pt-2 border-t">
            <Link
              href="/pos"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground"
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

export function TopNav() {
  return (
    <header className="bg-[hsl(217,91%,40%)] text-white sticky top-0 z-50">
      <div className="flex items-center h-12 px-4">
        {/* Mobile menu */}
        <MobileNav />

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-6">
          <span className="text-lg font-bold tracking-tight">OneBiz</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1">
          {mainNavItems.map((item) =>
            item.items ? (
              <NavDropdown key={item.label} item={item} />
            ) : (
              <NavLink key={item.label} item={item} />
            )
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-1 ml-auto">
          <Link href="/thong-bao" className="relative hidden sm:flex">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
            >
              <Bell className="h-4 w-4" />
            </Button>
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
              3
            </span>
          </Link>
          <Link href="/cai-dat" className="hidden sm:flex">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/ho-so">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
            >
              <User className="h-4 w-4" />
            </Button>
          </Link>

          {/* Bán hàng button */}
          <Link href="/pos" target="_blank">
            <Button
              size="sm"
              className="bg-white text-[hsl(217,91%,40%)] hover:bg-white/90 font-semibold hidden sm:flex"
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
