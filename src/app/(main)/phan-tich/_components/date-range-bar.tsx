"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export type DatePreset = "today" | "yesterday" | "thisWeek" | "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "custom";

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Hôm nay" },
  { key: "yesterday", label: "Hôm qua" },
  { key: "thisWeek", label: "Tuần này" },
  { key: "thisMonth", label: "Tháng này" },
  { key: "lastMonth", label: "Tháng trước" },
  { key: "thisQuarter", label: "Quý này" },
  { key: "thisYear", label: "Năm nay" },
];

interface DateRangeBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function DateRangeBar({ title, subtitle, actions }: DateRangeBarProps) {
  const [preset, setPreset] = useState<DatePreset>("thisMonth");

  return (
    <div className="bg-surface-container-lowest border-b border-border px-4 lg:px-6 py-3 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 rounded-full">
            <Icon name="calendar_today" className="size-3.5" />
            Xuất báo cáo
          </Button>
        </div>
      </div>
      {/* Stitch date preset pills — rounded-full + press-scale-sm, active dùng primary/primary-foreground */}
      <div className="flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <button className="p-1 rounded-full press-scale-sm hover:bg-surface-container text-muted-foreground shrink-0">
          <Icon name="chevron_left" className="size-4" />
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors press-scale-sm shrink-0",
              preset === p.key
                ? "bg-primary text-primary-foreground ambient-shadow"
                : "text-muted-foreground hover:bg-surface-container"
            )}
          >
            {p.label}
          </button>
        ))}
        <button className="p-1 rounded-full press-scale-sm hover:bg-surface-container text-muted-foreground shrink-0">
          <Icon name="chevron_right" className="size-4" />
        </button>
      </div>
    </div>
  );
}
