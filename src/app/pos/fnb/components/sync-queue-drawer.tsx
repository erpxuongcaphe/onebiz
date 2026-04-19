"use client";

/**
 * SyncQueueDrawer — user-facing view of the offline sync queue.
 *
 * Shows:
 *  - Pending entries (còn đợi đồng bộ)
 *  - Failed entries (thất bại >= 10 lần, kèm nút "Thử lại")
 *  - Summary counts + manual "Đồng bộ lại" button
 *
 * Mở bằng cách click vào ConnectionStatusBar.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import {
  deleteQueueEntry,
  getQueueEntries,
  retryFailedEntries,
  type SyncQueueEntry,
  type NetworkStatus,
} from "@/lib/offline";

interface SyncQueueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: NetworkStatus;
}

const ACTION_LABELS: Record<string, string> = {
  sendToKitchen: "Gửi bếp",
  fnbPayment: "Thanh toán",
  addItems: "Thêm món",
  updateItemStatus: "Cập nhật món",
  updateOrderStatus: "Cập nhật đơn",
  posCheckout: "Thanh toán bán lẻ",
};

const STATUS_META: Record<SyncQueueEntry["status"], { label: string; tone: string; icon: string }> = {
  pending: { label: "Chờ", tone: "bg-status-warning/10 text-status-warning", icon: "schedule" },
  syncing: { label: "Đang đồng bộ", tone: "bg-status-info/10 text-status-info", icon: "progress_activity" },
  completed: { label: "Xong", tone: "bg-status-success/10 text-status-success", icon: "check_circle" },
  failed: { label: "Thất bại", tone: "bg-status-error/10 text-status-error", icon: "error" },
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SyncQueueDrawer({ open, onOpenChange, status }: SyncQueueDrawerProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SyncQueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getQueueEntries();
      setEntries(data);
    } catch (err) {
      console.error("getQueueEntries failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Auto-refresh khi queue thay đổi
  useEffect(() => {
    if (!open) return;
    const handler = () => load();
    window.addEventListener("fnb-sync-complete", handler);
    window.addEventListener("fnb-sync-queue-updated", handler);
    return () => {
      window.removeEventListener("fnb-sync-complete", handler);
      window.removeEventListener("fnb-sync-queue-updated", handler);
    };
  }, [open, load]);

  const handleSyncNow = async () => {
    if (!status.isOnline) {
      toast({
        title: "Đang ngoại tuyến",
        description: "Hãy kết nối mạng rồi thử lại.",
        variant: "warning",
      });
      return;
    }
    await status.syncNow();
    await load();
    toast({ title: "Đã kích hoạt đồng bộ", variant: "success" });
  };

  const handleRetryFailed = async () => {
    if (!status.isOnline) {
      toast({
        title: "Đang ngoại tuyến",
        description: "Không thể thử lại khi mất mạng.",
        variant: "warning",
      });
      return;
    }
    setRetrying(true);
    try {
      const count = await retryFailedEntries();
      if (count > 0) {
        await status.syncNow();
        await load();
        toast({ title: `Đã thử lại ${count} mục`, variant: "success" });
      } else {
        toast({ title: "Không có mục thất bại nào", variant: "default" });
      }
    } catch (err) {
      toast({
        title: "Thử lại thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setRetrying(false);
    }
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;
    try {
      await deleteQueueEntry(id);
      window.dispatchEvent(new CustomEvent("fnb-sync-queue-updated"));
      toast({ title: "Đã bỏ mục này", variant: "default" });
    } catch (err) {
      toast({
        title: "Xoá thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    }
  };

  const pending = entries.filter((e) => e.status === "pending" || e.status === "syncing");
  const failed = entries.filter((e) => e.status === "failed");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Hàng đợi đồng bộ</SheetTitle>
          <SheetDescription>
            Đơn offline đang chờ gửi lên máy chủ. Khi có mạng sẽ tự động đồng bộ FIFO.
          </SheetDescription>
        </SheetHeader>

        {/* Summary + actions */}
        <div className="px-4 py-3 border-b bg-surface-container-low/50 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-status-warning/10 text-status-warning px-3 py-2">
              <div className="font-semibold text-lg">{pending.length}</div>
              <div className="opacity-80">Đang chờ</div>
            </div>
            <div className="rounded-lg bg-status-error/10 text-status-error px-3 py-2">
              <div className="font-semibold text-lg">{failed.length}</div>
              <div className="opacity-80">Thất bại</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="flex-1"
              disabled={!status.isOnline || status.isSyncing || pending.length === 0}
              onClick={handleSyncNow}
            >
              <Icon
                name={status.isSyncing ? "progress_activity" : "sync"}
                size={14}
                className={status.isSyncing ? "animate-spin" : ""}
              />
              <span className="ml-1">
                {status.isSyncing ? "Đang đồng bộ..." : "Đồng bộ ngay"}
              </span>
            </Button>
            {failed.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={!status.isOnline || retrying}
                onClick={handleRetryFailed}
              >
                <Icon name="refresh" size={14} />
                <span className="ml-1">Thử lại</span>
              </Button>
            )}
          </div>
        </div>

        {/* Entries list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Icon name="progress_activity" size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Icon name="cloud_done" size={48} className="text-status-success mb-3" />
              <p className="font-semibold text-sm">Không có gì chờ đồng bộ</p>
              <p className="text-xs text-muted-foreground mt-1">
                Tất cả đơn đã được đồng bộ lên máy chủ.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => {
                const meta = STATUS_META[entry.status];
                return (
                  <li key={entry.id} className="px-4 py-3 hover:bg-surface-container-low/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div
                        className={`shrink-0 size-8 rounded-full flex items-center justify-center ${meta.tone}`}
                      >
                        <Icon
                          name={meta.icon}
                          size={16}
                          className={entry.status === "syncing" ? "animate-spin" : ""}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                          <span
                            className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${meta.tone}`}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          #{entry.localId.slice(-8)} · {formatTime(entry.createdAt)}
                        </div>
                        {entry.attempts > 0 && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Đã thử {entry.attempts} lần
                          </div>
                        )}
                        {entry.error && (
                          <div className="text-xs text-status-error mt-1 line-clamp-2">
                            {entry.error}
                          </div>
                        )}
                      </div>
                      {(entry.status === "failed" || entry.status === "pending") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(entry.id)}
                          className="text-muted-foreground hover:text-status-error"
                          title="Bỏ qua mục này"
                        >
                          <Icon name="close" size={14} />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
