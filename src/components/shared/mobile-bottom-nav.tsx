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
// như sidebar desktop, với style ĐẸP cũ giữ lại (grid 3 cột, card vuông
// icon + label). Trước đây chỉ có 11 items / 3 sections cứng — CEO báo
// "menu góc dưới click vô vẫn thiếu chức năng". Giờ render từ sidebarNavGroups
// (10 groups, ~70 items), filter theo permission, có search bar. Touch
// target h-11 (44px) chuẩn Apple HIG. Sheet 80vh (không full-screen).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
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
 * Flat leaf — flattened item từ sidebarNavGroups để render card grid.
 */
interface FlatLeaf {
  label: string;
  href: string;
  icon: string;
  groupLabel: string;
  subGroupLabel?: string;
  disabled?: boolean;
  comingSoon?: boolean;
  badge?: string;
}

function flattenGroup(
  group: SidebarGroup,
  hasPermission: (code: string) => boolean,
): FlatLeaf[] {
  const out: FlatLeaf[] = [];
  group.items?.forEach((leaf) => {
    if (leaf.permission && !hasPermission(leaf.permission)) return;
    out.push({
      label: leaf.label,
      href: leaf.href,
      icon: leaf.icon ?? "circle",
      groupLabel: group.label,
      disabled: leaf.disabled,
      comingSoon: leaf.comingSoon,
      badge: leaf.badge,
    });
  });
  group.subGroups?.forEach((sg) => {
    sg.items.forEach((leaf) => {
      if (leaf.permission && !hasPermission(leaf.permission)) return;
      out.push({
        label: leaf.label,
        href: leaf.href,
        icon: leaf.icon ?? "circle",
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

  // CEO 27/05/2026: Đóng sheet khi pathname đổi (navigate qua menu item).
  // Tránh trường hợp Link click → page chuyển → sheet vẫn open trong state.
  // Disable rule: legitimate cross-cutting concern syncing với external nav.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setMoreOpen(false);
    setPosOpen(false);
    setSearchQuery("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname]);

  // CEO 27/05/2026: Browser back / hardware back → đóng sheet thay vì navigate.
  // Khi sheet mở → pushState 1 history entry. User bấm back → popstate fire →
  // ta đóng sheet. Nếu sheet đã đóng và user bấm back → navigate bình thường.
  useEffect(() => {
    const anyOpen = moreOpen || posOpen;
    if (!anyOpen) return;
    // Push placeholder history entry để bắt back button
    const stateKey = "__mobileNavSheet";
    if (typeof window !== "undefined") {
      window.history.pushState({ [stateKey]: true }, "");
    }
    const handlePopstate = () => {
      if (moreOpen) setMoreOpen(false);
      if (posOpen) setPosOpen(false);
    };
    window.addEventListener("popstate", handlePopstate);
    return () => {
      window.removeEventListener("popstate", handlePopstate);
    };
  }, [moreOpen, posOpen]);

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
                    <SheetContent
                      side="bottom"
                      className="data-[side=bottom]:h-auto max-h-[80vh] p-0 rounded-t-2xl flex flex-col"
                      showCloseButton={false}
                    >
                      <SheetTitle className="px-5 py-4 border-b font-semibold shrink-0">Chọn chế độ POS</SheetTitle>
                      <div className="grid gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-y-auto">
                        {/* CEO 04/06/2026: mobile POS chooser cũng mở tab mới. */}
                        <a
                          href="/pos"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                            <Icon name="shopping_cart" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold flex items-center gap-1">
                              POS Retail
                              <Icon name="open_in_new" size={12} className="text-muted-foreground" />
                            </span>
                            <span className="block text-xs text-muted-foreground">Hàng đóng gói, bán tại quầy</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </a>
                        <a
                          href={posFnbUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-warning/10 text-status-warning">
                            <Icon name="coffee" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold flex items-center gap-1">
                              POS FnB
                              <Icon name="open_in_new" size={12} className="text-muted-foreground" />
                            </span>
                            <span className="block text-xs text-muted-foreground">Quầy thu ngân quán cà phê</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </a>
                        <a
                          href={posFnbUrl("/kds")}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-success/10 text-status-success">
                            <Icon name="restaurant" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold flex items-center gap-1">
                              Màn bếp KDS
                              <Icon name="open_in_new" size={12} className="text-muted-foreground" />
                            </span>
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
            <SheetContent
              side="bottom"
              className="data-[side=bottom]:h-[80vh] p-0 rounded-t-2xl flex flex-col overflow-hidden"
              showCloseButton={false}
            >
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
// More Sheet — FULL menu sync với sidebar, style grid 3 cột (đẹp cũ)
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
  // Flatten all leaves cho search
  const allLeaves = useMemo(() => {
    const out: FlatLeaf[] = [];
    sidebarNavGroups.forEach((g) => out.push(...flattenGroup(g, hasPermission)));
    return out;
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
      {/* Sheet title + close button area */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <SheetTitle className="font-semibold text-base">Menu chức năng</SheetTitle>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-low"
          aria-label="Đóng menu"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

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
        className="flex-1 overflow-y-auto px-4 py-3 space-y-5"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {searchResults ? (
          searchResults.length > 0 ? (
            <section>
              <div className="text-[11px] text-muted-foreground px-1 pb-2">
                {searchResults.length} kết quả cho &quot;{searchQuery}&quot;
              </div>
              <div className="grid grid-cols-3 gap-3">
                {searchResults.map((l) => (
                  <MenuCardItem
                    key={l.href}
                    leaf={l}
                    pathname={pathname}
                    onClick={onClose}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Icon name="search_off" size={48} className="text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                Không tìm thấy chức năng &quot;{searchQuery}&quot;
              </p>
            </div>
          )
        ) : (
          // Render full menu groups dạng grid 3 cột
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
// Menu group section — GRID 3 cột (visual style cũ giữ lại)
// Mỗi group là 1 section với header + grid 3 cột cards.
// Flatten subGroup items vào parent group (mobile không cần nested hierarchy).
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
  const flatLeaves = flattenGroup(group, hasPermission);
  if (flatLeaves.length === 0) return null;

  const hasActive = flatLeaves.some((l) => isHrefActive(pathname, l.href));

  return (
    <section>
      {/* Section header — small + clean */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <Icon
          name={group.icon}
          size={16}
          fill={hasActive}
          className={cn("shrink-0", hasActive ? "text-primary" : "text-muted-foreground")}
        />
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            hasActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          {group.label}
        </span>
        <span className="text-[10px] text-muted-foreground/70 font-normal normal-case">
          · {flatLeaves.length}
        </span>
      </div>

      {/* Grid 3 cột — card vuông icon + label (style cũ đẹp) */}
      <div className="grid grid-cols-3 gap-3">
        {flatLeaves.map((leaf) => (
          <MenuCardItem
            key={leaf.href}
            leaf={leaf}
            pathname={pathname}
            onClick={onClose}
          />
        ))}
      </div>
    </section>
  );
}

// ============================================================
// Menu card item — card vuông icon trên + label dưới (style cũ đẹp)
// ============================================================

function MenuCardItem({
  leaf,
  pathname,
  onClick,
}: {
  leaf: FlatLeaf & Pick<SidebarLeaf, "disabled" | "comingSoon" | "badge">;
  pathname: string;
  onClick: () => void;
}) {
  const active = isHrefActive(pathname, leaf.href);
  const baseCls = cn(
    "relative flex flex-col items-center justify-start gap-1.5 p-3 rounded-xl border press-scale-sm min-h-[84px]",
    active
      ? "bg-primary-fixed border-primary/30 text-primary"
      : "bg-surface-container-lowest hover:bg-surface-container-low border-border/50 text-foreground",
    leaf.disabled && "opacity-50 pointer-events-none",
  );

  const inner = (
    <>
      <Icon
        name={leaf.icon}
        size={22}
        fill={active}
        weight={active ? 500 : 400}
        className={cn("shrink-0 mt-0.5", active ? "text-primary" : "text-muted-foreground")}
      />
      <span className="text-[11px] font-medium text-center leading-tight line-clamp-2">
        {leaf.label}
      </span>
      {leaf.comingSoon && (
        <span className="absolute top-1 right-1 text-[8px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-status-warning/15 text-status-warning border border-status-warning/30 leading-tight">
          Soon
        </span>
      )}
      {leaf.badge && !leaf.comingSoon && (
        <span className="absolute top-1 right-1 text-[8px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 leading-tight">
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
