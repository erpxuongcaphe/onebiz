"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const selectedItem = scopeItems.find((item) => item.value === selectedValue);

  if (!isReady || branches.length === 0) return null;

  return (
    <Select
      value={selectedValue}
      onValueChange={(value) => {
        if (!value) return;
        selectBranch(value === ALL_BRANCHES_VALUE ? null : value);
      }}
      items={scopeItems}
    >
      <SelectTrigger
        size="sm"
        className="h-8 min-w-44 max-w-64 bg-background text-xs"
        aria-label="Phạm vi báo cáo"
      >
        <SelectValue placeholder="Chọn chi nhánh">
          <Icon name={selectedItem?.icon ?? "storefront"} size={14} />
          <span className="truncate">
            {selectedItem?.label ?? "Chọn chi nhánh"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-64">
        {canViewAll && (
          <SelectItem value={ALL_BRANCHES_VALUE}>
            <Icon name="apartment" size={15} />
            Toàn công ty
          </SelectItem>
        )}
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.id}>
            <Icon name="storefront" size={15} />
            {branch.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
