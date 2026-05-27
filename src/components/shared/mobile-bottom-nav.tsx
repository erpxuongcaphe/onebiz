"use client";

// ---------------------------------------------------------------------------
// MobileBottomNav — thanh điều hướng cố định ở đáy màn hình cho mobile
// - Hiển thị < md (< 768px), ẩn trên desktop
// - 5 tab chính: Tổng quan, Kho, POS (nổi bật), Đơn hàng, Thêm
// - Auto-highlight theo pathname
// - "Thêm" mở Sheet với FULL menu sync từ sidebarNavGroups (CEO 27/05/2026)
// - Icons: Material Symbols (string names)
//
// Sprint LT-7 (CEO 27/05/2026): rewrite "Thêm" sheet để có ĐẦY ĐỦ chức năng
// như sidebar desktop. Trước đây chỉ có 11 items / 3 sections cứng — CEO báo
// "menu góc dưới click vô vẫn thiếu chức năng". Giờ render từ sidebarNavGroups
// (10 groups, ~70 items), filter theo permission, có search bar + group
// collapsible. Touch target h-11 (44px) chuẩn Apple HIG.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";
import { useAuth } from "@/lib/contexts";
import {
  sidebarNavGroups,
  isHrefActive,
  type SidebarGroup,
  type SidebarLeaf,
} from "./nav-config";

interface TabItem {
  label: string;
  href: string;
  icon: string;
  match?: (pathname: string) => boolean;
}

const PRIMARY_TABS: TabItem[] = [
  {
    label: "Tổng quan",
    href: "/",
    icon: "dashboard",
    match: (p) => p === "/",
  },
  {
    label: "Kho",
    href: "/hang-hoa/ton-kho",
    icon: "warehouse",
    match: (p) =>
      p.startsWith("/hang-hoa") &&
      !p.startsWith("/hang-hoa/san-xuat") &&
      !p.startsWith("/hang-hoa/cong-thuc"),
  },
  // POS nổi ở giữa, mở sheet chọn đúng chế độ bán.
  {
    label: "POS",
    href: "/pos",
    icon: "point_of_sale",
    match: (p) => p.startsWith("/pos"),
  },
  {
    label: "Đơn hàng",
    href: "/don-hang/hoa-don",
    icon: "receipt_long",
    match: (p) => p.startsWith("/don-hang"),
  },
];

/**
 * Flatten 1 group thành array {label, href, icon, permission} để search.
 * Bao gồm cả leaf trực tiếp + leaf trong subGroups.
 */
interface FlatLeaf {
  label: string;
  href: string;
  icon: string;
  permission?: string;
  groupLabel: string;
  subGroupLabel?: string;
  disabled?: boolean;
  comingSoon?: boolean;
  badge?: string;
}

function flattenGroup(group: SidebarGroup): FlatLeaf[] {
  const out: FlatLeaf[] = [];
  group.items?.forEach((leaf) => {
    out.push({
      label: leaf.label,
      href: leaf.href,
      icon: leaf.icon ?? "circle",
      permission: leaf.permission,
      groupLabel: group.label,
      disabled: leaf.disabled,
      comingSoon: leaf.comingSoon,
      badge: leaf.badge,
    });
  });
  group.subGroups?.forEach((sg) => {
    sg.items.forEach((leaf) => {
      out.push({
        label: leaf.label,
        href: leaf.href,
        icon: leaf.icon ?? "circle",
        permission: leaf.permission,
        groupLabel: group.label,
        subGroupLabel: sg.label,
        disabled: leaf.disabled,
        comingSoon: leaf.comingSoon,
        badge: leaf.badge,
      });
    });
  });
  return out;
}

// Vietnamese normalize: bỏ dấu để search "kho" match "kho hàng" + "khô"
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { posFnbUrl } = useFnbSubdomain();
  const { hasPermission } = useAuth();

  // Ẩn trên trang POS (toàn màn hình)
  if (pathname.startsWith("/pos")) return null;
  // Ẩn trên trang login
  if (pathname.startsWith("/dang-nhap") || pathname.startsWith("/quen-mat-khau")) {
    return null;
  }

  return (
    <>
      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest/95 backdrop-blur-md border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <nav className="flex items-stretch justify-around h-16">
          {PRIMARY_TABS.map((tab) => {
            const active = tab.match ? tab.match(pathname) : pathname === tab.href;
            const isB2B = tab.href === "/pos";

            if (isB2B) {
              return (
                <div
                  key={tab.href}
                  className="relative flex items-center justify-center w-16"
                >
                  <Sheet open={posOpen} onOpenChange={setPosOpen}>
                    <SheetTrigger className="absolute -top-5 press-scale flex h-14 w-14 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground ambient-shadow-lg">
                      <Icon name={tab.icon} size={24} fill />
                      <span className="mt-0.5 text-[9px] font-semibold leading-tight">
                        POS
                      </span>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="p-0 rounded-t-lg" showCloseButton={false}>
                      <SheetTitle className="px-5 py-4 border-b font-semibold">Chọn chế độ POS</SheetTitle>
                      <div className="grid gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                        <Link
                          href="/pos"
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                            <Icon name="shopping_cart" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">POS Retail</span>
                            <span className="block text-xs text-muted-foreground">Hàng đóng gói, bán tại quầy</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </Link>
                        <a
                          href={posFnbUrl()}
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-warning/10 text-status-warning">
                            <Icon name="coffee" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">POS FnB</span>
                            <span className="block text-xs text-muted-foreground">Quầy thu ngân quán cà phê</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </a>
                        <a
                          href={posFnbUrl("/kds")}
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-success/10 text-status-success">
                            <Icon name="restaurant" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">Màn bếp KDS</span>
                            <span className="block text-xs text-muted-foreground">Theo dõi món đang chờ làm</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </a>
                      </div>
                    </SheetContent>
                  </Sheet>
                </div>
              );
            }

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-col press-scale-sm items-center justify-center flex-1 gap-0.5",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon name={tab.icon} size={20} fill={active} weight={active ? 500 : 400} />
                <span className="text-[11px] font-medium">{tab.label}</span>
              </Link>
            );
          })}

          {/* More — FULL menu sheet */}
          <Sheet
            open={moreOpen}
            onOpenChange={(open) => {
              setMoreOpen(open);
              if (!open) setSearchQuery(""); // reset search khi đóng
            }}
          >
            <SheetTrigger className="flex flex-col press-scale-sm items-center justify-center flex-1 gap-0.5 text-muted-foreground hover:text-foreground">
              <Icon name="more_horiz" size={20} />
              <span className="text-[11px] font-medium">Thêm</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[88vh] p-0 rounded-t-xl flex flex-col">
              <MoreSheetContent
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                pathname={pathname}
                onClose={() => setMoreOpen(false)}
                hasPermission={hasPermission}
              />
            </SheetContent>
          </Sheet>
        </nav>
      </div>
      {/* Spacer để content không bị che bởi bottom nav */}
      <div
        className="md:hidden h-16"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-hidden
      />
    </>
  );
}

// ============================================================
// More Sheet — FULL menu sync với sidebar
// ============================================================

function MoreSheetContent({
  searchQuery,
  setSearchQuery,
  pathname,
  onClose,
  hasPermission,
}: {
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  pathname: string;
  onClose: () => void;
  hasPermission: (code: string) => boolean;
}) {
  // Search: flatten all leaves, filter by permission, then match query.
  const allLeaves = useMemo(() => {
    const out: FlatLeaf[] = [];
    sidebarNavGroups.forEach((g) => out.push(...flattenGroup(g)));
    return out.filter((l) => !l.permission || hasPermission(l.permission));
  }, [hasPermission]);

  const searchResults = useMemo(() => {
    const q = normalize(searchQuery.trim());
    if (!q) return null;
    return allLeaves.filter(
      (l) =>
        normalize(l.label).includes(q) ||
        normalize(l.groupLabel).includes(q) ||
        (l.subGroupLabel && normalize(l.subGroupLabel).includes(q)),
    );
  }, [searchQuery, allLeaves]);

  return (
    <>
      <SheetTitle className="px-4 py-3 border-b font-semibold text-base shrink-0">
        Menu chức năng
      </SheetTitle>

      {/* Search bar */}
      <div className="px-4 py-2 border-b shrink-0 bg-surface-container-lowest">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Tìm chức năng… (vd: kho, báo cáo, NCC)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-9 pr-9 rounded-lg border border-border bg-surface-container-lowest text-sm outline-none focus:ring-2 focus:ring-primary/40"
            autoFocus={false}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-high"
              aria-label="Xóa tìm kiếm"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {searchResults ? (
          // ── Search results ──
          searchResults.length > 0 ? (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground px-1 pb-1">
                {searchResults.length} kết quả
              </div>
              {searchResults.map((l) => (
                <MenuLeafItem
                  key={l.href}
                  leaf={l}
                  pathname={pathname}
                  onClick={onClose}
                  showBreadcrumb
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Icon name="search_off" size={48} className="text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                Không tìm thấy chức năng &quot;{searchQuery}&quot;
              </p>
            </div>
          )
        ) : (
          // ── Default: render full menu groups ──
          sidebarNavGroups.map((group) => (
            <MenuGroupSection
              key={group.label}
              group={group}
              pathname={pathname}
              onClose={onClose}
              hasPermission={hasPermission}
            />
          ))
        )}
      </div>
    </>
  );
}

// ============================================================
// Menu group section — collapsible
// ============================================================

function MenuGroupSection({
  group,
  pathname,
  onClose,
  hasPermission,
}: {
  group: SidebarGroup;
  pathname: string;
  onClose: () => void;
  hasPermission: (code: string) => boolean;
}) {
  // Filter leaves by permission
  const visibleLeaves =
    group.items?.filter((l) => !l.permission || hasPermission(l.permission)) ?? [];
  const visibleSubGroups =
    group.subGroups
      ?.map((sg) => ({
        ...sg,
        items: sg.items.filter((l) => !l.permission || hasPermission(l.permission)),
      }))
      .filter((sg) => sg.items.length > 0) ?? [];

  // Auto-open nếu group chứa active leaf
  // QUAN TRỌNG: useState phải gọi TRƯỚC any conditional return (React rules-of-hooks).
  const hasActive =
    visibleLeaves.some((l) => isHrefActive(pathname, l.href)) ||
    visibleSubGroups.some((sg) =>
      sg.items.some((l) => isHrefActive(pathname, l.href)),
    );
  const [open, setOpen] = useState(hasActive);

  if (visibleLeaves.length === 0 && visibleSubGroups.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 h-11 px-2 rounded-lg text-sm font-semibold press-scale-sm",
          hasActive
            ? "text-primary"
            : "text-foreground hover:bg-surface-container-low",
        )}
        aria-expanded={open}
      >
        <Icon
          name={group.icon}
          size={20}
          fill={hasActive}
          weight={hasActive ? 500 : 400}
          className="shrink-0"
        />
        <span className="flex-1 text-left">{group.label}</span>
        <Icon
          name="expand_more"
          size={18}
          className={cn(
            "shrink-0 transition-transform duration-150 text-muted-foreground",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="mt-1 ml-3 pl-3 border-l border-border/60 space-y-0.5">
          {visibleLeaves.map((leaf) => (
            <MenuLeafItem
              key={leaf.href}
              leaf={{
                label: leaf.label,
                href: leaf.href,
                icon: leaf.icon ?? "circle",
                groupLabel: group.label,
                disabled: leaf.disabled,
                comingSoon: leaf.comingSoon,
                badge: leaf.badge,
              }}
              pathname={pathname}
              onClick={onClose}
            />
          ))}
          {visibleSubGroups.map((sg) => (
            <div key={sg.label} className="mt-1">
              <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                {sg.label}
              </div>
              {sg.items.map((leaf) => (
                <MenuLeafItem
                  key={leaf.href}
                  leaf={{
                    label: leaf.label,
                    href: leaf.href,
                    icon: leaf.icon ?? "circle",
                    groupLabel: group.label,
                    subGroupLabel: sg.label,
                    disabled: leaf.disabled,
                    comingSoon: leaf.comingSoon,
                    badge: leaf.badge,
                  }}
                  pathname={pathname}
                  onClick={onClose}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Menu leaf item — single link row
// ============================================================

function MenuLeafItem({
  leaf,
  pathname,
  onClick,
  showBreadcrumb = false,
}: {
  leaf: FlatLeaf & Pick<SidebarLeaf, "disabled" | "comingSoon" | "badge">;
  pathname: string;
  onClick: () => void;
  showBreadcrumb?: boolean;
}) {
  const active = isHrefActive(pathname, leaf.href);
  const baseCls = cn(
    "flex items-center gap-3 h-11 px-2 rounded-lg text-sm press-scale-sm",
    active
      ? "bg-primary-fixed text-primary font-semibold"
      : "text-foreground hover:bg-surface-container-low",
    leaf.disabled && "opacity-50 pointer-events-none",
  );

  const breadcrumb = showBreadcrumb
    ? `${leaf.groupLabel}${leaf.subGroupLabel ? " · " + leaf.subGroupLabel : ""}`
    : null;

  const inner = (
    <>
      <Icon
        name={leaf.icon}
        size={18}
        fill={active}
        weight={active ? 500 : 400}
        className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}
      />
      <span className="flex-1 min-w-0">
        <span className="block truncate">{leaf.label}</span>
        {breadcrumb && (
          <span className="block text-[10px] text-muted-foreground truncate">
            {breadcrumb}
          </span>
        )}
      </span>
      {leaf.comingSoon && (
        <span className="text-[9px] font-semibold uppercase rounded px-1.5 py-0.5 bg-status-warning/10 text-status-warning border border-status-warning/25 shrink-0">
          Soon
        </span>
      )}
      {leaf.badge && !leaf.comingSoon && (
        <span className="text-[9px] font-semibold uppercase rounded px-1.5 py-0.5 bg-primary/10 text-primary shrink-0">
          {leaf.badge}
        </span>
      )}
    </>
  );

  if (leaf.disabled) {
    return (
      <div className={baseCls} aria-disabled="true">
        {inner}
      </div>
    );
  }

  return (
    <Link href={leaf.href} onClick={onClick} className={baseCls}>
      {inner}
    </Link>
  );
}
