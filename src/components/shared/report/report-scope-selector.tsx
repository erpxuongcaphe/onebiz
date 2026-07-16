"use client";

import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useReportScope } from "@/lib/hooks/use-report-scope";

export function ReportScopeSelector() {
  const {
    activeBranchId,
    branches,
    canViewAll,
    isReady,
    selectBranch,
  } = useReportScope();

  if (!isReady || branches.length === 0) return null;

  return (
    <div
      className="flex h-8 items-center overflow-hidden rounded-lg border border-border bg-surface-container-lowest"
      aria-label="Phạm vi báo cáo"
    >
      {canViewAll && (
        <button
          type="button"
          aria-pressed={!activeBranchId}
          onClick={() => selectBranch(null)}
          className={cn(
            "flex h-full items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
            !activeBranchId
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-surface-container-low",
          )}
        >
          <Icon name="apartment" size={14} />
          <span className="hidden xl:inline">Toàn công ty</span>
        </button>
      )}
      <Select
        value={activeBranchId ?? ""}
        onValueChange={(value) => value && selectBranch(value)}
      >
        <SelectTrigger
          size="sm"
          className={cn(
            "h-full min-w-36 max-w-56 rounded-none border-0 px-2.5 shadow-none focus-visible:ring-0",
            activeBranchId && canViewAll && "bg-primary-fixed/40 text-primary",
          )}
          aria-label="Chọn chi nhánh báo cáo"
        >
          <Icon name="storefront" size={14} />
          <SelectValue placeholder="Chọn chi nhánh" />
        </SelectTrigger>
        <SelectContent align="end">
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
