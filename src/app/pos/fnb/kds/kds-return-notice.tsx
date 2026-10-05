import type { KitchenReturnSummary } from "@/lib/services/supabase/kitchen-return-summary";
import { formatNumber } from "@/lib/format";

export function KdsReturnNotice({ summary }: {
  summary: KitchenReturnSummary | null;
}) {
  if (summary === null) {
    return <p role="status" className="border-b border-status-warning/30 bg-status-warning/10 px-2.5 py-2 text-xs text-status-warning">
      Chưa kiểm tra được hoàn trả — xác nhận với thu ngân trước khi pha.
    </p>;
  }
  if (summary.returnedQuantity <= 0) return null;
  return <div role="status" className="border-b border-status-warning/30 bg-status-warning/10 px-2.5 py-2 text-xs text-status-warning">
    <p className="font-semibold">Đã trả {formatNumber(summary.returnedQuantity)}/{formatNumber(summary.soldQuantity)} phần</p>
    <p>Số lượng bên dưới là lúc gọi món. Xác nhận món còn làm với thu ngân.</p>
  </div>;
}
