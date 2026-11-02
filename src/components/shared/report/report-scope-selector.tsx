"use client";

import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useReportScope } from "@/lib/hooks/use-report-scope";

const ALL_BRANCHES_VALUE = "__all_branches__";

export function ReportScopeSelector() {
  const {
    activeBranchId,
    branches,
    canViewAll,
    isReady,
    selectBranch,
  } = useReportScope({ synchronizeUrl: false });
  const branchItems = useMemo(
    () =>
      branches.map((branch) => ({
        value: branch.id,
        label: branch.name,
        icon: "storefront",
      })),
    [branches],
  );
  const scopeItems = useMemo(
    () =>
      [
        ...(canViewAll
          ? [
              {
                value: ALL_BRANCHES_VALUE,
                label: "Toàn công ty",
                icon: "apartment",
              },
            ]
          : []),
        ...branchItems,
      ],
    [branchItems, canViewAll],
  );
  const selectedValue = activeBranchId ?? (canViewAll ? ALL_BRANCHES_VALUE : "");

  return (
    <div role="group" aria-label="Phạm vi báo cáo" className="grid w-full min-w-0 gap-1 sm:w-72 sm:shrink-0">
      <span className="text-xs font-medium text-muted-foreground">Chi nhánh báo cáo</span>
      <SearchableSelect
        aria-label="Chi nhánh báo cáo" value={isReady ? selectedValue : ""} options={isReady ? scopeItems : []}
        disabled={!isReady || branches.length === 0}
        placeholder={!isReady ? "Đang tải chi nhánh..." : branches.length === 0 ? "Không có chi nhánh" : "Chọn chi nhánh"}
        preserveOrder className="h-11 w-full min-w-0 max-w-none bg-background text-sm"
        onValueChange={value=>{if(isReady && value && (value === ALL_BRANCHES_VALUE ? canViewAll : branches.some(branch => branch.id === value)))selectBranch(value === ALL_BRANCHES_VALUE ? null : value);}}
      />
    </div>
  );
}
