"use client";

/**
 * Bottom-sheet / dialog tap bàn trên sơ đồ.
 *
 * Hiển thị khi cashier tap bàn ở view mode. Action thay đổi theo trạng thái:
 *   - Trống      → Mở đơn mới
 *   - Đang phục vụ / Đặt trước → Xem đơn, Chuyển bàn, Gộp bàn
 *
 * Tách riêng để mockup + POS FnB thật dùng chung component. Không gọi DB.
 */

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { CanvasTable } from "./floor-plan-canvas";

export type TableActionKind =
  | "open"      // Mở đơn (bàn trống → đơn mới · bàn có khách → xem đơn hiện tại)
  | "transfer"  // Chuyển khách sang bàn khác
  | "merge";    // Gộp đơn của bàn này vào một bàn đang phục vụ khác

interface TableActionSheetProps {
  table: CanvasTable | null;
  zoneName?: string;
  onAction: (kind: TableActionKind, table: CanvasTable) => void;
  onClose: () => void;
  canTransfer?: boolean;
  canMerge?: boolean;
}

export function TableActionSheet({
  table,
  zoneName,
  onAction,
  onClose,
  canTransfer = false,
  canMerge = false,
}: TableActionSheetProps) {
  if (!table) return null;

  const status = table.status ?? "available";
  const isAvailable = status === "available";
  const isCleaning = status === "cleaning";
  const hasActiveOrder = status === "occupied" && (table.unpaidOrders ?? 0) > 0;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in"
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed z-50 left-1/2 -translate-x-1/2 bg-card rounded-2xl shadow-2xl border",
          "w-[92vw] max-w-md p-4",
          // Mobile: trượt từ dưới lên (full bottom)
          "bottom-4 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <StatusDot status={status} />
            <div className="min-w-0">
              <p className="font-bold text-base truncate">
                {table.name || `Bàn ${table.tableNumber ?? ""}`}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {zoneName ? `${zoneName} · ` : ""}
                {STATUS_LABEL[status]}
                {table.capacity ? ` · ${table.capacity} ghế` : ""}
                {(table.unpaidOrders ?? 0) > 0
                  ? ` · ${table.unpaidOrders} phiếu chưa TT`
                  : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted shrink-0"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(isAvailable || isCleaning || hasActiveOrder) && (
            <ActionButton
              primary
              icon={
                isAvailable
                  ? "add_shopping_cart"
                  : isCleaning
                    ? "cleaning_services"
                    : "receipt_long"
              }
              label={
                isAvailable
                  ? "Mở đơn mới"
                  : isCleaning
                    ? "Xác nhận đã dọn"
                    : "Xem đơn"
              }
              onClick={() => onAction("open", table)}
            />
          )}
          {hasActiveOrder && canTransfer && (
            <ActionButton
              icon="swap_horiz"
              label="Chuyển bàn"
              onClick={() => onAction("transfer", table)}
            />
          )}
          {hasActiveOrder && canMerge && (
            <ActionButton
              icon="call_merge"
              label="Gộp đơn"
              onClick={() => onAction("merge", table)}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───

function ActionButton({
  primary,
  icon,
  label,
  onClick,
}: {
  primary?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-3 py-3 rounded-xl border transition-all",
        "min-h-[64px]",
        primary
          ? "bg-primary text-primary-foreground border-primary hover:opacity-90 shadow-sm"
          : "border-border hover:border-primary hover:bg-primary/5",
      )}
    >
      <Icon name={icon} size={22} />
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const config = {
    available: { fill: "#ffffff", stroke: "#10b981", dashed: false },
    occupied: { fill: "#f59e0b", stroke: "#d97706", dashed: false },
    reserved: { fill: "#dbeafe", stroke: "#3b82f6", dashed: true },
    cleaning: { fill: "#ffffff", stroke: "#10b981", dashed: false },
  }[status] ?? { fill: "#ffffff", stroke: "#10b981", dashed: false };
  return (
    <span
      className="h-3.5 w-3.5 rounded-full inline-block shrink-0"
      style={{
        backgroundColor: config.fill,
        border: config.dashed
          ? `2px dashed ${config.stroke}`
          : `2px solid ${config.stroke}`,
      }}
    />
  );
}

const STATUS_LABEL: Record<string, string> = {
  available: "Trống",
  occupied: "Đang phục vụ",
  reserved: "Đã đặt trước",
  cleaning: "Đang dọn",
};
