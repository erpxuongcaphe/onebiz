import type { FnbMenuEstimate } from "@/lib/services/supabase/fnb-menu-estimates";
import { menuCostIssuesText } from "./menu-cost-diagnostics";

export function menuRecipeExportFields(estimate: FnbMenuEstimate | undefined) {
  return {
    costPrice: estimate?.value ?? null,
    costSource: `Dự toán BOM${estimate?.variantName ? ` · ${estimate.variantName}` : ""}`,
    costStatus: estimate?.reason ?? (estimate?.value == null ? "Chưa có dự toán" : ""),
    costIssues: menuCostIssuesText(estimate?.issues),
  };
}
