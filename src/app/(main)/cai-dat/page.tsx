"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts";
import { visibleSettingsNav } from "@/components/shared/settings-nav";

export default function CaiDatHubPage() {
  const { hasPermission } = useAuth();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cài đặt</h1>
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        {visibleSettingsNav(hasPermission).map((group) => (
          <section key={group.label}>
            <h2 className="border-b pb-2 text-sm font-semibold">{group.label}</h2>
            {group.items.filter((item) => item.href !== "/cai-dat").map((item) => (
              <Link key={item.href} href={item.href} className="flex min-h-12 items-center gap-3 border-b px-2 py-3 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <Icon name={item.icon} size={20} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.badge && <span className="text-xs text-muted-foreground">{item.badge}</span>}
                <Icon name="chevron_right" size={18} className="shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
