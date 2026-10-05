import type { DSOResult } from "@/lib/services/supabase/reports";

export function getDsoDisplay(result: DSOResult | null | undefined) {
  const valid = Boolean(
    result &&
      Number.isFinite(result.avgDailyRevenue) && result.avgDailyRevenue > 0 &&
      Number.isFinite(result.totalReceivables) && result.totalReceivables >= 0 &&
      Number.isFinite(result.dso) && result.dso >= 0,
  );
  const days = valid ? result!.dso : null;
  return {
    days,
    rating: days === null ? "Chưa đủ dữ liệu" : days <= 15 ? "Tốt" : days <= 30 ? "Trung bình" : "Cần cải thiện",
    tone: days === null ? "text-muted-foreground" : days <= 15 ? "text-status-success" : days <= 30 ? "text-status-warning" : "text-status-error",
  };
}
