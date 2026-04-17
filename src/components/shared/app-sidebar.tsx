"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts";
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
          size={18}
          fill={active}
          weight={active ? 500 : 400}
          className={cn("shrink-0", active ? "text-primary" : "text-foreground/70")}
        />
      )}
      <span className="truncate flex-1">{leaf.label}</span>
      {leaf.comingSoon && (
        <span className="text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200">
          Soon
        </span>
      )}
      {leaf.badge && !leaf.comingSoon && (
        <span className="text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 bg-primary/10 text-primary">
          {leaf.badge}
        </span>
      )}
      {leaf.mode === "pos" && !leaf.comingSoon && (
        <span
          aria-hidden
          className="text-[9px] font-semibold uppercase tracking-wider rounded px-1 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200"
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
    "h-9 pr-3",
    active
      ? "bg-primary-fixed text-primary font-semibold border-r-4 border-primary"
      : "text-foreground/80 hover:bg-surface-container-low hover:text-primary",
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
// Sub-group section (level 2 — heading + items)
// ============================================================

function SubGroupSection({
  subGroup,
  pathname,
  filterPerm,
}: {
  subGroup: SidebarSubGroup;
  pathname: string;
  filterPerm?: (code: string) => boolean;
}) {
  const visibleItems = subGroup.items.filter((l) => !l.permission || !filterPerm || filterPerm(l.permission));
  if (visibleItems.length === 0) return null;
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {subGroup.icon && <Icon name={subGroup.icon} size={12} />}
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
          "w-full press-scale-sm flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium",
          active
            ? "text-primary font-semibold"
            : "text-foreground/90 hover:bg-surface-container-low hover:text-foreground"
        )}
      >
        <Icon
          name={group.icon}
          size={20}
          fill={active}
          weight={active ? 500 : 400}
          className={cn("shrink-0", active && "text-primary")}
        />
        <span className="flex-1 text-left truncate">{group.label}</span>
        <Icon
          name="expand_more"
          size={16}
          className={cn(
            "shrink-0 transition-transform duration-150",
            open ? "rotate-0" : "-rotate-90"
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
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
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const handleOpen = () => {
    cancelClose();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Position flyout to the right of the icon, vertically aligned with top of button.
      // Using viewport-fixed coordinates so the flyout escapes any clipping ancestor.
      setPos({ top: rect.top, left: rect.right + 6 });
    }
    setOpen(true);
  };

  // Close on scroll/resize so the flyout doesn't float in stale position.
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
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
            ? "bg-primary-fixed text-primary"
            : "text-foreground/80 hover:bg-surface-container-low hover:text-foreground"
        )}
      >
        <Icon name={group.icon} size={22} fill={active} weight={active ? 500 : 400} />
      </button>

      {open && pos && (
        <div
          className="fixed z-[100] stitch-fade-in"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow-lg min-w-[240px] max-w-[280px] py-2">
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b mb-1">
              {group.label}
            </div>
            <div className="px-1 space-y-0.5 max-h-[70vh] overflow-y-auto">
              {group.items?.map((leaf) => (
                <LeafLink
                  key={leaf.href}
                  leaf={leaf}
                  pathname={pathname}
                  indent={0}
                />
              ))}
              {group.subGroups?.map((sg) => (
                <SubGroupSection key={sg.label} subGroup={sg} pathname={pathname} />
              ))}
            </div>
          </div>
        </div>
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
  const [collapsed, setCollapsed] = usePersistedCollapsed(false);

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
        "hidden lg:flex flex-col bg-surface-container-lowest border-r border-border shrink-0 transition-[width] duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Stitch header — p-4 generous, bigger logo badge (rounded-xl O mark) */}
      <div className={cn("flex items-center justify-between h-16 border-b border-border", collapsed ? "px-2" : "px-4")}>
        {!collapsed && (
          <Link href="/" className="flex items-center gap-3 group press-scale-sm">
            <span className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold ambient-shadow">
              O
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-bold tracking-tight text-base text-foreground">OneBiz</span>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">ERP Suite</span>
            </div>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "h-9 w-9 press-scale-sm inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-container-low hover:text-foreground",
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
      </div>

      {/* Top groups */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-visible py-3",
          collapsed ? "px-1.5" : "px-3"
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
      <div className={cn("border-t border-border py-3", collapsed ? "px-1.5" : "px-3")}>
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
