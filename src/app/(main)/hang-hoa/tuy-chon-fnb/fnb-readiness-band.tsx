import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { FnbReadiness } from "@/lib/services/supabase/fnb-readiness";

export function FnbReadinessBand({
  readiness,
  loading,
  error,
  branchName,
}: {
  readiness: FnbReadiness | null;
  loading: boolean;
  error: boolean;
  branchName?: string;
}) {
  if (loading) {
    return (
      <div className="flex min-h-12 items-center gap-2 border-y bg-muted/30 px-3 text-sm text-muted-foreground">
        <Icon name="progress_activity" size={18} className="animate-spin" />
        Đang kiểm tra cấu hình FnB...
      </div>
    );
  }
  if (error || !readiness) {
    return (
      <div className="flex min-h-12 items-center gap-2 border-y border-status-warning/30 bg-status-warning/5 px-3 text-sm">
        <Icon name="warning" size={18} className="text-status-warning" />
        Chưa đọc được trạng thái cấu hình. Dữ liệu hiện tại không bị thay đổi.
      </div>
    );
  }

  const risks =
    readiness.singleGroupsWithManyDefaults +
    readiness.conflictingStockOptions +
    readiness.legacyToppingGroups;
  const ready =
    readiness.toppingTotal > 0 &&
    readiness.toppingReady === readiness.toppingTotal &&
    risks === 0;

  return (
    <section
      aria-label="Mức sẵn sàng vận hành FnB"
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 border-y px-3 py-2 text-sm",
        ready
          ? "border-status-success/30 bg-status-success/5"
          : "border-status-warning/30 bg-status-warning/5",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <Icon
          name={ready ? "check_circle" : "warning"}
          size={18}
          className={ready ? "text-status-success" : "text-status-warning"}
        />
        {ready ? "Cấu hình FnB đã sẵn sàng" : "Cấu hình FnB chưa hoàn tất"}
        {branchName && (
          <span className="font-normal text-muted-foreground">
            · {branchName}
          </span>
        )}
      </div>
      <span>
        Topping dùng được:{" "}
        <strong>
          {readiness.toppingReady}/{readiness.toppingTotal}
        </strong>
      </span>
      {readiness.toppingMissingPrice > 0 && (
        <span className="text-status-error">
          Thiếu giá: <strong>{readiness.toppingMissingPrice}</strong>
        </span>
      )}
      {readiness.toppingMissingBom > 0 && (
        <span className="text-status-error">
          Thiếu công thức: <strong>{readiness.toppingMissingBom}</strong>
        </span>
      )}
      {readiness.singleGroupsWithManyDefaults > 0 && (
        <span className="text-status-error">
          Nhiều mặc định:{" "}
          <strong>{readiness.singleGroupsWithManyDefaults}</strong>
        </span>
      )}
      {readiness.conflictingStockOptions > 0 && (
        <span className="text-status-error">
          Trùng cách trừ kho:{" "}
          <strong>{readiness.conflictingStockOptions}</strong>
        </span>
      )}
      {readiness.legacyToppingGroups > 0 && (
        <span className="text-status-error">
          Nhóm topping cũ: <strong>{readiness.legacyToppingGroups}</strong>
        </span>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        Topping theo phần:{" "}
        {readiness.toppingSkuEnabled ? "đang bật" : "đang tắt an toàn"}
      </span>
    </section>
  );
}
