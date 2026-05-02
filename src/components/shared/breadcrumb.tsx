"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { sidebarNavGroups, type SidebarGroup } from "./nav-config";

interface BreadcrumbProps {
  /** Override segments thủ công thay vì derive từ pathname. */
  items?: { label: string; href?: string }[];
  className?: string;
}

/**
 * Breadcrumb — trail navigation cho trang nested.
 *
 * Sprint POLISH-5: trước đây `(main)/*` không có breadcrumb. Trang nested
 * (`/hang-hoa/lo-san-xuat`, `/phan-tich/bao-cao-tai-chinh`) không có back
 * navigation rõ ràng — user phải dựa vào sidebar/back button browser.
 *
 * Auto-derive từ pathname + nav-config:
 * - Tách path segments
 * - Match từng prefix với nav config để lấy label
 * - Fallback: convert slug-case → Title Case nếu không match
 *
 * Trang con dùng auto-derive; trang đặc biệt (vd detail page với code
 * đơn) override bằng prop `items`.
 *
 * ```tsx
 * // Auto: /hang-hoa/lo-san-xuat → Hàng hóa › Lô sản xuất
 * <Breadcrumb />
 *
 * // Override
 * <Breadcrumb items={[
 *   { label: "Hàng hóa", href: "/hang-hoa" },
 *   { label: "Lô sản xuất", href: "/hang-hoa/lo-san-xuat" },
 *   { label: "LSX-2026-001" },
 * ]} />
 * ```
 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  const pathname = usePathname();

  const derived = useMemo(() => {
    if (items) return items;
    return buildFromPathname(pathname);
  }, [items, pathname]);

  // Single root segment hoặc empty → no breadcrumb (sidebar/title đã đủ).
  if (derived.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <Link
        href="/"
        className="inline-flex items-center hover:text-foreground transition-colors"
        aria-label="Trang chủ"
      >
        <Icon name="home" size={12} />
      </Link>
      {derived.map((item, idx) => (
        <Fragment key={`${item.label}-${idx}`}>
          <Icon
            name="chevron_right"
            size={12}
            className="text-muted-foreground/50 shrink-0"
          />
          {item.href && idx < derived.length - 1 ? (
            <Link
              href={item.href}
              className="hover:text-foreground transition-colors truncate max-w-[180px]"
            >
              {item.label}
            </Link>
          ) : (
            <span
              className={cn(
                "truncate max-w-[220px]",
                idx === derived.length - 1 && "text-foreground font-medium",
              )}
            >
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * Build breadcrumb từ pathname + nav-config.
 *
 * Ví dụ pathname `/hang-hoa/lo-san-xuat`:
 * 1. Match `/hang-hoa` → group "Hàng hóa"
 * 2. Match `/hang-hoa/lo-san-xuat` → leaf "Lô sản xuất"
 * 3. Result: [Hàng hóa, Lô sản xuất]
 */
function buildFromPathname(
  pathname: string,
): { label: string; href?: string }[] {
  if (pathname === "/" || pathname === "") return [];

  const segments = pathname.split("/").filter(Boolean);
  const result: { label: string; href?: string }[] = [];
  let current = "";

  for (const seg of segments) {
    current += `/${seg}`;
    const label = findNavLabel(current) ?? slugToLabel(seg);
    result.push({ label, href: current });
  }

  return result;
}

/** Tìm label trong nav-config theo href chính xác. */
function findNavLabel(href: string): string | null {
  for (const group of sidebarNavGroups as SidebarGroup[]) {
    const fromGroup = matchInGroup(group, href);
    if (fromGroup) return fromGroup;
  }
  return null;
}

function matchInGroup(group: SidebarGroup, href: string): string | null {
  for (const leaf of group.items ?? []) {
    if (leaf.href === href) return leaf.label;
  }
  for (const sg of group.subGroups ?? []) {
    for (const leaf of sg.items) {
      if (leaf.href === href) return leaf.label;
    }
  }
  return null;
}

/** Convert "lo-san-xuat" → "Lô sản xuất" (best-effort, capitalize first). */
function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
