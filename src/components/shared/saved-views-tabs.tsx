"use client";

/**
 * SavedViewsTabs — tab strip lưu bộ lọc cho /khach-hang.
 *
 * CEO 06/06/2026 Phase 4 — pattern Sapo "Lưu bộ lọc" + HubSpot "Saved Views".
 *
 * UX:
 *   - Tab strip phía trên DataTable
 *   - "Tất cả" tab default (reset filters)
 *   - Mỗi saved view = 1 tab có thể click để apply filters
 *   - Active state khi current filters match 1 view (JSON.stringify compare)
 *   - Nút "💾 Lưu bộ lọc" mở dialog save (chỉ enable khi có filter active)
 *   - Right-click hoặc icon X trên tab → xóa view
 */

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getSavedViews,
  createSavedView,
  deleteSavedView,
  type SavedView,
  type CustomerFilters,
} from "@/lib/services/supabase/customer-saved-views";
import { cn } from "@/lib/utils";

interface SavedViewsTabsProps {
  currentFilters: CustomerFilters;
  onApply: (filters: CustomerFilters) => void;
}

export function SavedViewsTabs({ currentFilters, onApply }: SavedViewsTabsProps) {
  const { toast } = useToast();
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchViews = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getSavedViews();
      setViews(list);
    } catch (err) {
      console.warn("[SavedViewsTabs] load lỗi:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchViews();
  }, [fetchViews]);

  // Check xem currentFilters có matches view nào không
  // Normalize: bỏ undefined/empty fields trước khi compare
  const normalizeFilters = (f: CustomerFilters): string => {
    const cleaned: Record<string, unknown> = {};
    Object.entries(f).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "all" || v === "") return;
      if (Array.isArray(v) && v.length === 0) return;
      cleaned[k] = v;
    });
    // Sort keys to make compare deterministic
    return JSON.stringify(cleaned, Object.keys(cleaned).sort());
  };

  const currentKey = normalizeFilters(currentFilters);
  const isAllActive = currentKey === "{}";
  const activeViewId = views.find(
    (v) => normalizeFilters(v.filters) === currentKey,
  )?.id;

  const hasActiveFilters = !isAllActive;

  const handleSave = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      toast({
        title: "Tên bộ lọc quá ngắn",
        description: "Ít nhất 2 ký tự.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      await createSavedView({ name, filters: currentFilters });
      toast({
        title: "Đã lưu bộ lọc",
        description: `"${name}" đã được lưu vào tab.`,
        variant: "success",
      });
      setShowSaveDialog(false);
      setNewName("");
      await fetchViews();
    } catch (err) {
      toast({
        title: "Lưu bộ lọc thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (view: SavedView) => {
    if (!confirm(`Xóa bộ lọc "${view.name}"?`)) return;
    try {
      await deleteSavedView(view.id);
      toast({ title: `Đã xóa "${view.name}"`, variant: "success" });
      await fetchViews();
    } catch (err) {
      toast({
        title: "Xóa thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap py-2 px-1 border-b border-border">
      {/* Tab "Tất cả" — reset filters */}
      <button
        type="button"
        onClick={() => onApply({})}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors",
          isAllActive
            ? "bg-primary text-white"
            : "bg-muted text-muted-foreground hover:bg-muted/70",
        )}
      >
        <Icon name="select_all" size={14} />
        Tất cả
      </button>

      {/* Saved views */}
      {loading ? (
        <span className="text-xs text-muted-foreground px-2">
          <Icon name="progress_activity" size={12} className="animate-spin inline mr-1" />
          Đang tải...
        </span>
      ) : (
        views.map((v) => {
          const isActive = v.id === activeViewId;
          return (
            <div
              key={v.id}
              className={cn(
                "group inline-flex items-center gap-1 rounded-md text-xs font-medium transition-colors overflow-hidden",
                isActive
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              <button
                type="button"
                onClick={() => onApply(v.filters)}
                className="px-3 h-8 inline-flex items-center gap-1.5"
                title={`Áp dụng bộ lọc "${v.name}"`}
              >
                <Icon name={v.icon || "bookmark"} size={14} />
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(v)}
                className={cn(
                  "h-8 px-1.5 opacity-0 group-hover:opacity-100 transition-opacity",
                  isActive
                    ? "hover:bg-white/20"
                    : "hover:bg-status-error/20 hover:text-status-error",
                )}
                title={`Xóa "${v.name}"`}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })
      )}

      {/* Save button — chỉ enable khi có filter active */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setShowSaveDialog(true)}
        disabled={!hasActiveFilters}
        className="h-8 px-2.5 text-xs gap-1 ml-1"
        title={
          hasActiveFilters
            ? "Lưu bộ lọc hiện tại làm tab nhanh"
            : "Chọn ít nhất 1 filter để lưu"
        }
      >
        <Icon name="bookmark_add" size={14} />
        Lưu bộ lọc
      </Button>

      {/* Save dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="bookmark_add" className="text-primary" />
              Lưu bộ lọc
            </DialogTitle>
            <DialogDescription>
              Đặt tên cho bộ lọc hiện tại để dùng nhanh lần sau.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="view-name" className="text-sm font-medium">
                Tên bộ lọc *
              </label>
              <input
                id="view-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim().length >= 2) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                placeholder="VD: VIP còn nợ, Khách Shopee, Sinh nhật tháng 6..."
                autoFocus
                maxLength={50}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-[11px] text-muted-foreground">
                Ngắn gọn 2–4 từ. Đặt tên dễ nhớ.
              </p>
            </div>

            {/* Preview filter đang lưu */}
            <div className="rounded-md bg-muted/30 border border-border p-2.5 space-y-1">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                Bộ lọc sẽ lưu
              </p>
              <div className="flex flex-wrap gap-1">
                {(() => {
                  const labels: string[] = [];
                  if (currentFilters.debt === "has_debt") labels.push("Còn nợ");
                  if (currentFilters.debt === "no_debt") labels.push("Đã trả đủ");
                  if (currentFilters.salesRange === "tier_vip") labels.push("VIP ≥50M");
                  if (currentFilters.salesRange === "tier_loyal")
                    labels.push("Thân thiết 10-50M");
                  if (currentFilters.salesRange === "tier_regular")
                    labels.push("Thường 1-10M");
                  if (currentFilters.salesRange === "tier_new") labels.push("Mới <1M");
                  if (currentFilters.ordersRange === "frequent")
                    labels.push("≥6 lần mua");
                  if (currentFilters.ordersRange === "occasional")
                    labels.push("2-5 lần");
                  if (currentFilters.ordersRange === "first_time")
                    labels.push("Mua 1 lần");
                  if (currentFilters.ordersRange === "no_purchase")
                    labels.push("Chưa mua");
                  if (currentFilters.lastPurchase === "today") labels.push("Hôm nay");
                  if (currentFilters.lastPurchase === "week") labels.push("7 ngày");
                  if (currentFilters.lastPurchase === "month") labels.push("30 ngày");
                  if (currentFilters.lastPurchase === "3months") labels.push("90 ngày");
                  if (currentFilters.lastPurchase === "churned")
                    labels.push("KH rời >90d");
                  if (currentFilters.lastPurchase === "never")
                    labels.push("Chưa mua bao giờ");
                  if (currentFilters.birthdayMonth) {
                    labels.push(`Sinh nhật T${currentFilters.birthdayMonth}`);
                  }
                  if (currentFilters.tags && currentFilters.tags.length > 0) {
                    labels.push(`Tags: ${currentFilters.tags.join(", ")}`);
                  }
                  if (currentFilters.gender === "male") labels.push("Nam");
                  if (currentFilters.gender === "female") labels.push("Nữ");
                  if (currentFilters.type === "individual") labels.push("Cá nhân");
                  if (currentFilters.type === "company") labels.push("Công ty");
                  if (currentFilters.province) labels.push(currentFilters.province);

                  if (labels.length === 0) {
                    return (
                      <span className="text-xs italic text-muted-foreground">
                        Chưa có filter nào
                      </span>
                    );
                  }
                  return labels.map((l) => (
                    <span
                      key={l}
                      className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium"
                    >
                      {l}
                    </span>
                  ));
                })()}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveDialog(false)}
              disabled={saving}
            >
              Huỷ
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || newName.trim().length < 2}
            >
              {saving && (
                <Icon name="progress_activity" size={14} className="mr-1 animate-spin" />
              )}
              Lưu bộ lọc
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
