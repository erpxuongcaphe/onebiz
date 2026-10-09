import type { BOM } from "@/lib/types";

/** Output recipes must belong to the selected branch or be shared recipes. */
export function filterProductionOutputBoms(
  boms: BOM[], branchId: string, cascadeMode?: "production" | "outlet",
): BOM[] {
  if (!branchId || !cascadeMode) return [];
  return boms.filter((bom) => bom.isActive !== false
    && (!bom.branchId || bom.branchId === branchId)
    && (cascadeMode !== "outlet" || bom.isFnbStockItem === true));
}
