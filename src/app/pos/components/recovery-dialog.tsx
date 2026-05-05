"use client";

/**
 * RecoveryDialog — list các đơn POS Retail chưa hoàn tất, cho cashier
 * chọn tiếp tục hoặc xoá.
 *
 * Sprint POS-RECOVERY-1 (CEO 04/05/2026).
 *
 * Khi cashier mở POS Retail, page tự gọi `listDraftOrders(branchId)`. Nếu
 * có ≥1 nháp → mở dialog này. Hiển thị card list với:
 *   - Mã (HD-XXX)
 *   - Người tạo (cashier nào — quan trọng cho giao ca)
 *   - Khách hàng
 *   - 3 tên SP đầu (preview ngắn)
 *   - Tổng tạm
 *   - Thời gian update (relative: "5 phút trước")
 *   - Badge phân biệt: "Đã lưu" (F9 manual) vs "Tự động" (auto-save)
 *
 * Action:
 *   - Click card → onSelect(draft) → page load detail + restore state
 *   - Click X → onDelete(draft.id) → page deleteDraftOrder + refresh list
 *   - "Tạo đơn mới" → onClose() đóng dialog, bắt đầu mới
 */

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { DraftOrderSummary } from "@/lib/services/supabase";

interface RecoveryDialogProps {
  open: boolean;
  drafts: DraftOrderSummary[];
  onSelect: (draft: DraftOrderSummary) => void;
  onDelete: (draftId: string) => void;
  onCreateNew: () => void;
}

export function RecoveryDialog({
  open,
  drafts,
  onSelect,
  onDelete,
  onCreateNew,
}: RecoveryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCreateNew()}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon name="restore" size={20} className="text-primary" />
            Đơn chưa hoàn tất ({drafts.length})
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Bấm vào đơn để tiếp tục, hoặc xoá nếu không cần.
          </p>
        </DialogHeader>

        {/* List drafts — scroll khi nhiều */}
        <div className="px-3 py-3 space-y-2 max-h-[60vh] overflow-y-auto">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Không có đơn nào chưa hoàn tất.
            </p>
          ) : (
            drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                onSelect={() => onSelect(d)}
                onDelete={() => onDelete(d.id)}
              />
            ))
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={onCreateNew}
            className="w-full"
          >
            <Icon name="add" size={16} className="mr-1" />
            Tạo đơn mới
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// DraftCard — 1 row trong list
// ─────────────────────────────────────────────────────────
function DraftCard({
  draft,
  onSelect,
  onDelete,
}: {
  draft: DraftOrderSummary;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const relativeTime = useMemo(
    () => formatRelativeTime(draft.updatedAt ?? draft.createdAt),
    [draft.updatedAt, draft.createdAt],
  );

  return (
    <div
      className={cn(
        "group relative bg-white border border-border rounded-lg p-3 transition-all",
        "hover:border-primary hover:shadow-sm cursor-pointer",
      )}
      onClick={onSelect}
    >
      {/* Header: code + auto/manual badge + delete X */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-mono font-semibold text-foreground">
          {draft.code}
        </span>
        {draft.autoSaved ? (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-status-warning/15 text-status-warning"
            title="Tự động lưu (recovery — TTL 30 ngày)"
          >
            Tự động
          </span>
        ) : (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-status-success/15 text-status-success"
            title="Đã lưu nháp F9 (sticky)"
          >
            Đã lưu
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {relativeTime}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-status-error hover:bg-status-error/10 transition-all"
          title="Xoá đơn nháp"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* Người tạo + khách */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-1">
        {draft.createdByName && (
          <span className="flex items-center gap-1">
            <Icon name="badge" size={11} />
            {draft.createdByName}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Icon name="person" size={11} />
          {draft.customerName}
        </span>
      </div>

      {/* Items summary (3 tên đầu) */}
      {draft.itemsSummary && draft.itemsSummary.length > 0 && (
        <p className="text-[11px] text-muted-foreground mb-2 line-clamp-1">
          {draft.itemsSummary.join(", ")}
          {draft.itemCount > 3 && ` · +${draft.itemCount - 3}`}
        </p>
      )}

      {/* Tổng + nút Tiếp tục */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">
            {draft.itemCount}
          </span>{" "}
          SP · Tổng:{" "}
          <span className="font-bold text-primary tabular-nums">
            {formatNumber(draft.total)}đ
          </span>
        </span>
        <span className="text-[11px] font-semibold text-primary inline-flex items-center gap-0.5">
          Tiếp tục
          <Icon name="arrow_forward" size={12} />
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helper — format thời gian relative ("5 phút trước")
// ─────────────────────────────────────────────────────────
function formatRelativeTime(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}
