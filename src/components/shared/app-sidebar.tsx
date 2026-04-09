"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  sidebarNavGroups,
  isHrefActive,
  isGroupActive,
  type SidebarGroup,
  type SidebarLeaf,
  type SidebarSubGroup,
} from "./nav-config";

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
  const Icon = leaf.icon;
  const disabled = !!leaf.disabled;

  const inner = (
    <>
      {Icon && <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />}
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

  const baseClass = cn(
    "group flex items-center gap-2 rounded-md text-sm transition-colors",
    "h-8 px-2",
    active
      ? "bg-primary/10 text-primary font-medium"
      : "text-foreground/80 hover:bg-muted hover:text-foreground",
    disabled && "opacity-50 pointer-events-none"
  );

  if (disabled) {
    return (
      <div
        className={baseClass}
        style={{ paddingLeft: `${indent * 12 + 8}px` }}
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
      style={{ paddingLeft: `${indent * 12 + 8}px` }}
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
}: {
  subGroup: SidebarSubGroup;
  pathname: string;
}) {
  const SubIcon = subGroup.icon;
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {SubIcon && <SubIcon className="h-3 w-3" />}
        {subGroup.label}
      </div>
      <div className="space-y-0.5">
        {subGroup.items.map((leaf) => (
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
}: {
  group: SidebarGroup;
  open: boolean;
  onToggle: () => void;
  pathname: string;
}) {
  const Icon = group.icon;
  const active = isGroupActive(pathname, group);

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-2 h-9 px-2 rounded-md text-sm font-medium transition-colors",
          active
            ? "text-primary"
            : "text-foreground/90 hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
        <span className="flex-1 text-left truncate">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open ? "rotate-0" : "-rotate-90"
          )}
        />
      </button>

      {open && (
        <div className="mt-0.5 mb-1 space-y-0.5 pl-1">
          {group.items?.map((leaf) => (
            <LeafLink key={leaf.href} leaf={leaf} pathname={pathname} indent={1} />
          ))}
          {group.subGroups?.map((sg) => (
            <SubGroupSection key={sg.label} subGroup={sg} pathname={pathname} />
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
  const Icon = group.icon;
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
          "w-10 h-10 mx-auto flex items-center justify-center rounded-md transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-foreground/80 hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className="h-5 w-5" />
      </button>

      {open && pos && (
        <div
          className="fixed z-[100]"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="bg-white rounded-lg shadow-xl border min-w-[240px] max-w-[280px] py-2">
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
        "hidden lg:flex flex-col bg-white border-r border-border shrink-0 transition-[width] duration-200",
        collapsed ? "w-14" : "w-60"
      )}
    >
      {/* Header / collapse toggle */}
      <div className="flex items-center justify-between h-12 px-2 border-b">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2 px-1.5">
            <span className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              1B
            </span>
            <span className="font-bold tracking-tight text-sm">OneBiz ERP</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
            collapsed && "mx-auto"
          )}
          aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          title={collapsed ? "Mở rộng (Ctrl+B)" : "Thu gọn (Ctrl+B)"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Top groups */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-visible py-2",
          collapsed ? "px-1.5" : "px-2"
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
              />
            )
          )}
        </div>
      </nav>

      {/* Bottom-pinned groups (Hệ thống) */}
      <div className={cn("border-t py-2", collapsed ? "px-1.5" : "px-2")}>
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
              />
            )
          )}
        </div>
      </div>
    </aside>
  );
}
