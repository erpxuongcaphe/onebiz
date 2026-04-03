"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
  icon: LucideIcon;
  bg: string;
  iconColor: string;
  valueColor: string;
}

export function KpiCard({
  label,
  value,
  change,
  positive,
  icon: Icon,
  bg,
  iconColor,
  valueColor,
}: KpiCardProps) {
  return (
    <div className={cn("rounded-lg p-3 lg:p-4", bg)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <p className={cn("text-lg lg:text-xl font-bold mt-1 truncate", valueColor)}>
            {value}
          </p>
          {change && (
            <p
              className={cn(
                "text-[11px] mt-1",
                positive ? "text-green-600" : "text-red-500"
              )}
            >
              {change}
            </p>
          )}
        </div>
        <div className={cn("size-9 rounded-lg flex items-center justify-center shrink-0", bg)}>
          <Icon className={cn("size-5", iconColor)} />
        </div>
      </div>
    </div>
  );
}
