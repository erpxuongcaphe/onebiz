import { formatCurrency } from "@/lib/format";
import type { FnbMenuEstimate } from "@/lib/services/supabase/fnb-menu-estimates";
import { MenuCostDiagnostics } from "./menu-cost-diagnostics";

export function MenuRecipeCost({ estimate, loading }: { estimate?: FnbMenuEstimate; loading: boolean }) {
  return <div className="block text-right" title="Dự toán từ công thức hiện tại và giá nguyên liệu tại chi nhánh; không phải giá vốn hóa đơn đã bán">
    {loading ? "Đang tính..." : estimate?.value != null ? formatCurrency(estimate.value) : estimate?.reason ?? "Chưa có dự toán"}
    <span className="block text-xs font-normal text-muted-foreground">Dự toán BOM{estimate?.variantName ? ` · ${estimate.variantName}` : ""}</span>
    {!loading && <MenuCostDiagnostics issues={estimate?.issues} />}
  </div>;
}
