"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts";
import { useBreakpoint } from "@/lib/hooks/use-breakpoint";
import {
  sidebarNavGroups,
  isHrefActive,
  isGroupActive,
  type SidebarGroup,
  type SidebarLeaf,
  type SidebarSubGroup,
} from "./nav-config";
import { Icon } from "@/components/ui/icon";

const COLLAPSED_KEY = "onebiz.sidebar.collapsed";

// ============================================================
// Hooks
// ============================================================

function usePersistedCollapsed(defaultValue = false) {
  const [collapsed, setCollapsed] = useState(defaultValue);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored != null) setCollapsed(stored === "1");
    } catch {
      /* noop */
    }
  }, []);

  // Persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [collapsed]);

  return [collapsed, setCollapsed] as const;
}

// ============================================================
// Leaf item (level 3 — actual link)
// ============================================================

function LeafLink({
  leaf,
  pathname,
  indent = 0,
}: {
  leaf: SidebarLeaf;
  pathname: string;
  indent?: number;
}) {
  const active = isHrefActive(pathname, leaf.href);
  const disabled = !!leaf.disabled;

  const inner = (
    <>
      {leaf.icon && (
        <Icon
          name={leaf.icon}
          size={16}
          fill={active}
          weight={active ? 500 : 400}
          className={cn("shrink-0", active ? "text-sidebar-primary" : "text-sidebar-foreground/65")}
        />
      )}
      <span className="truncate flex-1">{leaf.label}</span>
      {leaf.comingSoon && (
        <span className="text-[9px] font-semibold uppercase rounded px-2 py-0.5 bg-status-warning/10 text-status-warning border border-status-warning/25">
          Soon
        </span>
      )}
      {leaf.badge && !leaf.comingSoon && (
        <span className="text-[9px] font-semibold uppercase rounded px-2 py-0.5 bg-primary/10 text-primary">
          {leaf.badge}
        </span>
      )}
      {leaf.mode === "pos" && !leaf.comingSoon && (
        <span
          aria-hidden
          className="text-[9px] font-semibold uppercase rounded px-1 py-0.5 bg-status-success/10 text-status-success border border-status-success/25"
          title="Mở chế độ toàn màn hình"
        >
          B2B
        </span>
      )}
    </>
  );

  // Stitch style (dashboard_qu_n_tr_desktop mockup):
  // - active: bg-primary-fixed + text-primary + font-bold + border-r-4 border-primary
  //   (accent bar phải để visual-emphasis mạnh hơn chỉ bg-tint)
  // - hover inactive: text-primary + bg-surface-container-low (subtle blue-tint)
  // - press-scale từ globals cho tactile feedback khi click
  const baseClass = cn(
    "group press-scale-sm flex items-center gap-3 rounded-lg text-sm",
    "h-8 pr-3",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold border-r-4 border-sidebar-primary"
      : "text-sidebar-foreground/78 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground",
    disabled && "opacity-50 pointer-events-none"
  );

  if (disabled) {
    return (
      <div
        className={baseClass}
        style={{ paddingLeft: `${indent * 12 + 12}px` }}
        aria-disabled="true"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={leaf.href}
      className={baseClass}
      style={{ paddingLeft: `${indent * 12 + 12}px` }}
      target={leaf.mode === "pos" ? "_self" : undefined}
    >
      {inner}
    </Link>
  );
}

// ============================================================
// Sub-group section (level 2 — collapsible accordion)
// ============================================================
//
// Stitch design improvement (Sprint UX):
//   - Trước: label "SẢN PHẨM" 10px xám flat, không click được, mỗi
//     subgroup luôn render hết items → sidebar rất cao.
//   - Sau: button collapsible, chevron xoay khi toggle. Default mở
//     nếu chứa active leaf, đóng nếu không. Label 12px font-semibold
//     dễ đọc. Khi đóng → hiện count "(5)" để user biết bao nhiêu items.
//   - Tiết kiệm 60% chiều cao khi user chỉ cần 1 subgroup tại 1 thời điểm.

function SubGroupSection({
  subGroup,
  pathname,
  filterPerm,
  /**
   * Force expanded (không collapsible) — dùng cho flyout khi sidebar
   * collapsed. Trong flyout, user hover thấy ngay full menu, không
   * cần click thêm.
   */
  alwaysOpen = false,
}: {
  subGroup: SidebarSubGroup;
  pathname: string;
  filterPerm?: (code: string) => boolean;
  alwaysOpen?: boolean;
}) {
  const visibleItems = subGroup.items.filter(
    (l) => !l.permission || !filterPerm || filterPerm(l.permission),
  );

  // Auto-open khi subgroup chứa active leaf — UX expectation chuẩn.
  const hasActive = visibleItems.some((l) => isHrefActive(pathname, l.href));
  const [open, setOpen] = useState<boolean>(alwaysOpen || hasActive);

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  if (visibleItems.length === 0) return null;

  // Flyout mode: render đơn giản, không click toggle.
  if (alwaysOpen) {
    return (
      <div className="mt-1">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-[10px] font-semibold text-sidebar-foreground/50 uppercase">
          {subGroup.icon && <Icon name={subGroup.icon} size={14} />}
          {subGroup.label}
        </div>
        <div className="space-y-0.5">
          {visibleItems.map((leaf) => (
            <LeafLink key={leaf.href} leaf={leaf} pathname={pathname} indent={1} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full press-scale-sm flex items-center gap-2 px-3 h-8 rounded-lg text-xs font-semibold transition-colors",
          hasActive
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/68 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
      >
        {subGroup.icon && (
          <Icon
            name={subGroup.icon}
            size={14}
            className={cn("shrink-0", hasActive && "text-sidebar-primary")}
          />
        )}
        <span className="flex-1 text-left">{subGroup.label}</span>
        {!open && (
            <span className="text-[10px] font-medium text-sidebar-foreground/45 tabular-nums">
            {visibleItems.length}
          </span>
        )}
        <Icon
          name="expand_more"
          size={14}
          className={cn(
            "shrink-0 transition-transform duration-150 text-sidebar-foreground/45",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 stitch-fade-in">
          {visibleItems.map((leaf) => (
            <LeafLink key={leaf.href} leaf={leaf} pathname={pathname} indent={1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Top-level group (expanded mode — accordion)
// ============================================================

function GroupExpanded({
  group,
  open,
  onToggle,
  pathname,
  filterPerm,
}: {
  group: SidebarGroup;
  open: boolean;
  onToggle: () => void;
  pathname: string;
  filterPerm?: (code: string) => boolean;
}) {
  const active = isGroupActive(pathname, group);

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full press-scale-sm flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors",
          active
            ? "text-sidebar-accent-foreground font-semibold bg-sidebar-accent"
            : "text-sidebar-foreground/84 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon
          name={group.icon}
          size={20}
          fill={active}
          weight={active ? 500 : 400}
          className={cn("shrink-0", active && "text-sidebar-primary")}
        />
        <span className="flex-1 text-left truncate">{group.label}</span>
        <Icon
          name="expand_more"
          size={16}
          className={cn(
            "shrink-0 transition-transform duration-150",
            active && "text-sidebar-primary",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="mt-0.5 mb-1 space-y-0.5 pl-1 stitch-fade-in">
          {group.items?.filter((l) => !l.permission || !filterPerm || filterPerm(l.permission)).map((leaf) => (
            <LeafLink key={leaf.href} leaf={leaf} pathname={pathname} indent={1} />
          ))}
          {group.subGroups?.map((sg) => (
            <SubGroupSection key={sg.label} subGroup={sg} pathname={pathname} filterPerm={filterPerm} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Top-level group (collapsed mode — icon + hover flyout)
// ============================================================

function GroupCollapsed({
  group,
  pathname,
}: {
  group: SidebarGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  // Sprint UI-FIX (CEO 08/05): pos kèm `triggerTop` để render bridge zone
  // bridging trigger → popup, tránh mouse rớt qua gap khi popup top:16 mà
  // trigger ở dưới đáy viewport (gap dọc 900px+).
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    triggerTop: number;
    triggerHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Sprint UI-FIX v3 (CEO 08/05): popupRef để filter scroll events — chỉ
  // close khi scroll diễn ra ngoài popup, không close khi user cuộn nội
  // dung dài bên trong popup.
  const popupRef = useRef<HTMLDivElement>(null);
  const active = isGroupActive(pathname, group);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    // Sprint UI-FIX (CEO 08/05): Tăng 120ms → 280ms để user di chuột chậm
    // từ trigger sang popup (gap dọc lớn) vẫn kịp.
    closeTimer.current = setTimeout(() => setOpen(false), 280);
  };

  const handleOpen = () => {
    cancelClose();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Sprint UI-FIX (CEO 08/05): Smart placement — align với trigger nếu
      // popup fits viewport, fallback top:16 khi quá cao.
      // Trước (chỉ top:16) gây gap dọc 900px+ khi trigger ở dưới đáy → mouse
      // di chuyển chậm qua no-man's-land → 120ms timer fire trước khi vào
      // popup → close. Giờ align trigger.top → gap chỉ 6px ngang dễ vượt.
      const VIEWPORT_PADDING = 16;
      // Estimate popup height ~ 600px (với scroll nội bộ nếu lớn hơn)
      const ESTIMATED_POPUP_HEIGHT = 600;
      const viewportH = window.innerHeight;
      // Try align với trigger top
      let popupTop = rect.top;
      // Nếu trigger gần đáy → popup vượt biên → bám đáy
      if (rect.top + ESTIMATED_POPUP_HEIGHT > viewportH - VIEWPORT_PADDING) {
        popupTop = Math.max(
          VIEWPORT_PADDING,
          viewportH - ESTIMATED_POPUP_HEIGHT - VIEWPORT_PADDING,
        );
      }
      setPos({
        top: popupTop,
        left: rect.right + 6,
        triggerTop: rect.top,
        triggerHeight: rect.height,
      });
    }
    setOpen(true);
  };

  // Close on scroll/resize so the flyout doesn't float in stale position.
  // Sprint UI-FIX v3 (CEO 08/05): chỉ close khi scroll OUTSIDE popup —
  // ignore scroll bên trong popup (popup có overflow-y-auto cho list dài
  // như "Báo cáo" 14 items, user cần cuộn được mà không bị popup tự đóng).
  useEffect(() => {
    if (!open) return;
    const scrollHandler = (e: Event) => {
      // Nếu scroll target là popup hoặc descendant → ignore (cuộn nội bộ).
      const target = e.target as Node | null;
      if (target && popupRef.current?.contains(target)) return;
      // Scroll OUTSIDE popup (page scroll, sidebar scroll, ...) → close
      // để popup không float ở vị trí cũ stale.
      setOpen(false);
    };
    const resizeHandler = () => setOpen(false);
    window.addEventListener("scroll", scrollHandler, true);
    window.addEventListener("resize", resizeHandler);
    return () => {
      window.removeEventListener("scroll", scrollHandler, true);
      window.removeEventListener("resize", resizeHandler);
    };
  }, [open]);

  // Sprint UI-FIX v4 (CEO 08/05): MEASURE popup thật sau mount + reposition
  // để tránh popup vượt biên đáy. Estimate cũ 600px underestimate cho "Báo
  // cáo" (~800-850px với 5 sub-groups + 14 items), gây cắt phần dưới popup.
  //
  // useLayoutEffect chạy sau DOM mount + trước paint → user không thấy
  // flicker reposition.
  useLayoutEffect(() => {
    if (!open) return;
    const popupEl = popupRef.current;
    const buttonEl = buttonRef.current;
    if (!popupEl || !buttonEl) return;
    const popupH = popupEl.getBoundingClientRect().height;
    const triggerRect = buttonEl.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const PAD = 16;

    // Default: align với trigger.top
    let newTop = triggerRect.top;
    // Nếu popup vượt biên đáy → đẩy lên sao cho bottom = viewportH - PAD.
    // Math.max(PAD, ...) đảm bảo top không âm khi popup quá cao.
    if (newTop + popupH > viewportH - PAD) {
      newTop = Math.max(PAD, viewportH - popupH - PAD);
    }

    setPos((prev) => {
      if (!prev) return prev;
      // Avoid infinite loop — chỉ update nếu khác > 1px
      if (Math.abs(prev.top - newTop) < 1) return prev;
      return { ...prev, top: newTop };
    });
  }, [open]);

  return (
    <div
      className="relative"
      onMouseEnter={handleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={buttonRef}
        type="button"
        title={group.label}
        className={cn(
          "w-10 h-10 mx-auto press-scale-sm flex items-center justify-center rounded-lg",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/78 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon name={group.icon} size={20} fill={active} weight={active ? 500 : 400} />
      </button>

      {open && pos && (
        <>
          {/* Sprint UI-FIX (CEO 08/05): Bridge zone — invisible div phủ vùng
              trigger → popup. Khi popup ở top:16 mà trigger ở dưới, mouse
              phải di chuyển dọc qua "no-man's-land" → bridge này catch
              mouseenter để cancelClose, popup không bị rớt. */}
          <div
            className="fixed z-[99]"
            style={{
              top: Math.min(pos.top, pos.triggerTop),
              left: pos.left - 6,
              width: 12,
              height:
                Math.abs(pos.top - pos.triggerTop) + pos.triggerHeight + 12,
              // pointerEvents auto để bridge nhận mouseenter; visually trong suốt
              pointerEvents: "auto",
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            aria-hidden
          />
          <div
            ref={popupRef}
            className="fixed z-[100] stitch-fade-in"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="bg-sidebar text-sidebar-foreground rounded-lg ambient-shadow-lg min-w-[240px] max-w-[280px] py-2 max-h-[calc(100vh-32px)] flex flex-col border border-sidebar-border">
              <div className="px-3 py-2 text-xs font-semibold text-sidebar-foreground/55 uppercase border-b border-sidebar-border mb-1 shrink-0">
                {group.label}
              </div>
              <div className="px-1 space-y-0.5 overflow-y-auto flex-1">
                {group.items?.map((leaf) => (
                  <LeafLink
                    key={leaf.href}
                    leaf={leaf}
                    pathname={pathname}
                    indent={0}
                  />
                ))}
                {group.subGroups?.map((sg) => (
                  <SubGroupSection
                    key={sg.label}
                    subGroup={sg}
                    pathname={pathname}
                    alwaysOpen
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Sidebar root
// ============================================================

export function AppSidebar() {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const [userCollapsed, setUserCollapsed] = usePersistedCollapsed(false);

  // Tablet portrait/landscape (768-1023): FORCE collapsed rail mode.
  // Lý do: ở md (768-1023) main content đã chật, sidebar full 224px chiếm
  // 22% viewport. Rail 64px chỉ chiếm 6%, vẫn cho user navigate qua flyout.
  // Ở lg+ (≥1024) tôn trọng user choice từ localStorage.
  const isLargeScreen = useBreakpoint("lg");
  const collapsed = isLargeScreen ? userCollapsed : true;
  const setCollapsed = isLargeScreen ? setUserCollapsed : (() => {});

  // Keyboard shortcut Ctrl+B / Cmd+B → toggle sidebar collapse.
  // Pattern chuẩn từ VS Code, Linear, Notion. Discoverable qua tooltip
  // ở toggle button.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        // Bỏ qua nếu user đang gõ trong input/textarea (tránh override
        // browser bookmark).
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setCollapsed]);

  // Track which top-level groups are open in expanded mode.
  // Defaults: any group whose child route is active.
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    for (const g of sidebarNavGroups) {
      if (isGroupActive(pathname, g)) set.add(g.label);
    }
    return set;
  }, [pathname]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpen);

  // Re-sync open state when pathname changes (auto-expand parent of current page).
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      for (const g of sidebarNavGroups) {
        if (isGroupActive(pathname, g)) next.add(g.label);
      }
      return next;
    });
  }, [pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const topGroups = sidebarNavGroups.filter((g) => !g.pinBottom);
  const bottomGroups = sidebarNavGroups.filter((g) => g.pinBottom);

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        // Hiện từ md (768) thay vì lg (1024) — tablet iPad portrait có nav.
        // Tại md (768-1023) auto force collapsed rail (xem isLargeScreen logic
        // ở trên), tại lg+ tôn trọng user choice.
        "hidden md:flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 transition-[width] duration-200",
        // w-56 (224px) thay vì w-64 (256px) — tiết kiệm 32px cho main content.
        // Collapsed w-16 (64px) — icon comfortable touch target + flyout đầy đủ.
        // Responsive Sprint A9 (CEO 25/05/2026): trên laptop 13" (1280px viewport
        // / xl: breakpoint) w-48 (192px) để main content có thêm 32px chỗ thở.
        // 15.6" laptop (>=1536px / 2xl:) giữ w-56 như cũ. Collapsed luôn w-16.
        collapsed ? "w-16" : "w-48 2xl:w-56"
      )}
    >
      {/* Stitch header — chỉ toggle button, logo đã có ở top-nav (tránh lặp brand)
          Toggle ẩn ở md (768-1023) vì state forced rail; chỉ hiện ở lg+. */}
      <div className={cn("flex items-center justify-end h-14 border-b border-sidebar-border", collapsed ? "px-2" : "px-3")}>
        {isLargeScreen && (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "h-9 w-9 press-scale-sm inline-flex items-center justify-center rounded-lg text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "mx-auto"
            )}
            aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
            title={collapsed ? "Mở rộng (Ctrl+B)" : "Thu gọn (Ctrl+B)"}
          >
            {collapsed ? (
              <Icon name="left_panel_open" size={20} />
            ) : (
              <Icon name="left_panel_close" size={20} />
            )}
          </button>
        )}
      </div>

      {/* Top groups */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-visible py-3",
          collapsed ? "px-2" : "px-3"
        )}
      >
        <div className="space-y-0.5">
          {topGroups.map((g) =>
            collapsed ? (
              <GroupCollapsed key={g.label} group={g} pathname={pathname} />
            ) : (
              <GroupExpanded
                key={g.label}
                group={g}
                open={openGroups.has(g.label)}
                onToggle={() => toggleGroup(g.label)}
                pathname={pathname}
                filterPerm={hasPermission}
              />
            )
          )}
        </div>
      </nav>

      {/* Bottom-pinned groups (Hệ thống) */}
      <div className={cn("border-t border-sidebar-border py-3", collapsed ? "px-2" : "px-3")}>
        <div className="space-y-0.5">
          {bottomGroups.map((g) =>
            collapsed ? (
              <GroupCollapsed key={g.label} group={g} pathname={pathname} />
            ) : (
              <GroupExpanded
                key={g.label}
                group={g}
                open={openGroups.has(g.label)}
                onToggle={() => toggleGroup(g.label)}
                pathname={pathname}
                filterPerm={hasPermission}
              />
            )
          )}
        </div>
      </div>
    </aside>
  );
}
