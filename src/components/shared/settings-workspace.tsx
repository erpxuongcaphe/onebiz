"use client";

import { useAuth } from "@/lib/contexts";
import { ModuleSidebarLayout } from "./module-sidebar-layout";
import { visibleSettingsNav } from "./settings-nav";

export function SettingsWorkspace({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { hasPermission } = useAuth();
  return (
    <ModuleSidebarLayout title="Cài đặt" nav={visibleSettingsNav(hasPermission)} enableSearch contentClassName={wide ? "max-w-none" : "max-w-6xl"}>
      {children}
    </ModuleSidebarLayout>
  );
}
