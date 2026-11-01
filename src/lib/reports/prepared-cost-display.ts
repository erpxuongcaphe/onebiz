import type { FnbBranchComponentCost } from "@/lib/services/supabase/fnb-branch-cost";

export type PreparedCostDisplay = { value: number; source: "batch" | "recipe" } | { source: "error" };

export function preparedCostDisplay(balance: FnbBranchComponentCost | undefined, estimate: number | undefined): PreparedCostDisplay | undefined {
  if (balance && balance.costedQuantity > 0 && Math.abs(balance.costedQuantity - balance.physicalQuantity) <= 0.0001 && Number.isFinite(balance.unitCost) && balance.unitCost >= 0) {
    return { value: balance.unitCost, source: "batch" };
  }
  return estimate !== undefined && Number.isFinite(estimate) && estimate >= 0 ? { value: estimate, source: "recipe" } : undefined;
}

export function preparedCostExportFields(cost: PreparedCostDisplay | undefined) {
  return {
    costPrice: cost && cost.source !== "error" ? cost.value : null,
    costSource: cost?.source === "batch" ? "Giá vốn theo mẻ" : cost?.source === "recipe" ? "Dự toán BOM / ĐVT kho" : "",
    costStatus: cost?.source === "error" ? "Không tải được giá" : !cost ? "Chưa có giá phù hợp" : "",
    costIssues: "",
  };
}
