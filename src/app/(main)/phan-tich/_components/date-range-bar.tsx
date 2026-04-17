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
    <div className="bg-white border-b px-4 lg:px-6 py-3 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Icon name="calendar_today" className="size-3.5" />
            Xuất báo cáo
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <button className="p-1 rounded hover:bg-gray-100 text-gray-400 shrink-0">
          <Icon name="chevron_left" className="size-4" />
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors shrink-0",
              preset === p.key
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {p.label}
          </button>
        ))}
        <button className="p-1 rounded hover:bg-gray-100 text-gray-400 shrink-0">
          <Icon name="chevron_right" className="size-4" />
        </button>
      </div>
    </div>
  );
}
