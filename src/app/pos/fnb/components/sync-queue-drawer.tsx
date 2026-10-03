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

import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatTime as formatTimeHelper } from "@/lib/format";
import {
  deleteQueueEntry,
  getQueueEntries,
  retryFailedEntries,
  retryQueueEntry,
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
  return formatTimeHelper(iso);
}

export function SyncQueueDrawer({ open, onOpenChange, status }: SyncQueueDrawerProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SyncQueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const actionInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getQueueEntries();
      setEntries(data);
      setLoadError(false);
      return data;
    } catch (err) {
      setLoadError(true);
      console.error("getQueueEntries failed:", err);
      return null;
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

  const performSync = async (prepare?: () => Promise<boolean>) => {
    if (actionInFlight.current || status.isSyncing) return;
    if (!status.isOnline) {
      toast({
        title: "Đang ngoại tuyến",
        description: "Hãy kết nối mạng rồi thử lại.",
        variant: "warning",
      });
      return;
    }
    actionInFlight.current = true;
    setRetrying(true);
    try {
      if (prepare && !(await prepare())) {
        await load();
        toast({ title: "Không có mục cần thử lại", variant: "default" });
        return;
      }
      await status.syncNow();
      const refreshed = await load();
      if (!refreshed) {
        toast({ title: "Chưa xác nhận được kết quả đồng bộ", variant: "warning" });
        return;
      }
      const waiting = refreshed.filter((entry) => entry.status === "pending" || entry.status === "syncing").length;
      const failedCount = refreshed.filter((entry) => entry.status === "failed").length;
      if (waiting || failedCount) {
        toast({ title: "Đồng bộ chưa hoàn tất",
          description: `${waiting} mục đang chờ · ${failedCount} mục cần kiểm tra`, variant: "warning" });
      } else {
        toast({ title: "Đồng bộ hoàn tất", variant: "success" });
      }
    } catch (err) {
      toast({
        title: "Thử lại thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      actionInFlight.current = false;
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

  const handleRetryOne = async (id?: number) => {
    if (!id) return;
    await performSync(() => retryQueueEntry(id));
  };

  const pending = entries.filter((e) => e.status === "pending" || e.status === "syncing");
  const failed = entries.filter((e) => e.status === "failed");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-md flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b pl-4 pr-12 py-3">
          <SheetTitle>Hàng đợi đồng bộ</SheetTitle>
          <SheetDescription>
            Dữ liệu đồng bộ trên thiết bị này.
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
              disabled={!status.isOnline || status.isSyncing || retrying || loading || loadError || pending.length === 0}
              onClick={() => performSync()}
            >
              <Icon
                name={status.isSyncing || retrying ? "progress_activity" : "sync"}
                size={14}
                className={status.isSyncing || retrying ? "animate-spin" : ""}
              />
              <span className="ml-1">
                {status.isSyncing || retrying ? "Đang đồng bộ..." : "Đồng bộ ngay"}
              </span>
            </Button>
            {failed.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={!status.isOnline || retrying || status.isSyncing || loading || loadError}
                onClick={() => performSync(async () => (await retryFailedEntries()) > 0)}
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
          ) : loadError ? (
            <div role="alert" className="py-8 px-4 space-y-3">
              <p className="text-sm text-status-error">Chưa tải được hàng đợi trên thiết bị này.</p>
              <Button variant="outline" size="sm" onClick={load}>
                <Icon name="refresh" size={14} />
                <span className="ml-1">Tải lại danh sách</span>
              </Button>
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
                          <div className={`text-xs mt-1 break-words ${entry.status === "failed" ? "text-status-error" : "text-muted-foreground"}`}>
                            {entry.error}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {entry.status === "failed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRetryOne(entry.id)}
                            disabled={!status.isOnline || status.isSyncing || retrying}
                            className="text-muted-foreground hover:text-status-info"
                            title="Thử lại mục này"
                            aria-label="Thử lại mục này"
                          >
                            <Icon name="refresh" size={14} />
                          </Button>
                        )}
                        {entry.status === "completed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(entry.id)}
                            className="text-muted-foreground hover:text-status-error"
                            title="Bỏ qua mục này"
                            aria-label="Bỏ mục đã đồng bộ"
                            disabled={status.isSyncing || retrying}
                          >
                            <Icon name="close" size={14} />
                          </Button>
                        )}
                      </div>
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
