"use client";

import { useAuth } from "@/lib/contexts";
import { useMemo } from "react";
import { ModuleSidebarLayout } from "./module-sidebar-layout";
import { visibleSettingsNav } from "./settings-nav";

export function SettingsWorkspace({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { hasPermission } = useAuth();
  const nav = useMemo(() => visibleSettingsNav(hasPermission).map(group => ({
    ...group, collapsible: true, defaultOpen: false,
  })), [hasPermission]);
  return (
    <ModuleSidebarLayout title="Cài đặt" nav={nav} persistKey="settings-v2" enableSearch contentClassName={wide ? "max-w-none" : "max-w-6xl"}>
      {children}
    </ModuleSidebarLayout>
  );
}
