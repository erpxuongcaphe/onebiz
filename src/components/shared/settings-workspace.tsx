"use client";

import { useAuth } from "@/lib/contexts";
import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { requestPageLeave } from "@/lib/hooks/use-unsaved-work";
import { ModuleSidebarLayout } from "./module-sidebar-layout";
import { visibleSettingsNav } from "./settings-nav";

export function SettingsWorkspace({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const nav = useMemo(() => visibleSettingsNav(hasPermission).map(group => ({
    ...group, collapsible: true, defaultOpen: false,
  })), [hasPermission]);
  // This register needs the main content width, rather than a second sidebar.
  // Keep the same permission-filtered settings destinations and leave guard.
  if (pathname === "/cai-dat/tai-khoan-tien") {
    return <section className="min-w-0">
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3 sm:px-6">
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:text-primary">Cài đặt</Link>
        <span aria-hidden className="text-muted-foreground">/</span>
        <select aria-label="Mục Cài đặt" value={pathname} onChange={event => { const href = event.target.value; requestPageLeave(() => router.push(href)); }}
          className="h-10 min-w-0 flex-1 max-w-sm rounded-md border bg-background px-3 text-sm font-medium">
          {nav.map((group, index) => <optgroup key={index} label={group.label || "Cài đặt"}>
            {group.items.map(item => <option key={item.href} value={item.href}>{item.label}</option>)}
          </optgroup>)}
        </select>
      </div>
      {children}
    </section>;
  }
  return (
    <ModuleSidebarLayout title="Cài đặt" nav={nav} persistKey="settings-v2" enableSearch contentClassName={wide ? "max-w-none" : "max-w-6xl"}>
      {children}
    </ModuleSidebarLayout>
  );
}
