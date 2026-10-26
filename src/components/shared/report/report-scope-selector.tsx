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

  if (!isReady || branches.length === 0) return null;

  return (
    <SearchableSelect
      aria-label="Phạm vi báo cáo" value={selectedValue} options={scopeItems}
      placeholder="Chọn chi nhánh" preserveOrder className="h-8 min-w-44 max-w-64 bg-background text-xs"
      onValueChange={value=>{if(value)selectBranch(value === ALL_BRANCHES_VALUE ? null : value);}}
    />
  );
}
