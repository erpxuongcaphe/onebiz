"use client";

/**
 * Trang Thông báo — wire DB thật (Sprint NB-1).
 *
 * Trước đây hardcode 20 mock notifications + setState mark-read không
 * persist. Page này load `getNotifications()` thật từ Supabase, scope
 * theo user + tenant. Mark read / delete gọi service thật.
 *
 * Notification rules engine (cron sinh notification từ low-stock,
 * expiring lot, overdue debt) sẽ làm ở sprint NB-2 (cần Edge Function/
 * trigger). Hiện DB rỗng → page hiển thị empty state đúng đắn.
 */

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/lib/contexts";
import { formatShortDate } from "@/lib/format";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  type NotificationKind,
  type NotificationRow,
} from "@/lib/services";
import { Icon } from "@/components/ui/icon";

const typeConfig: Record<
  string,
  { iconName: string; color: string; bgColor: string; label: string }
> = {
  order_new: {
    iconName: "shopping_cart",
    color: "text-status-success",
    bgColor: "bg-status-success/10",
    label: "Đơn hàng mới",
  },
  order_completed: {
    iconName: "package_2",
    color: "text-primary",
    bgColor: "bg-primary-fixed",
    label: "Đơn hoàn thành",
  },
  stock_low: {
    iconName: "warning",
    color: "text-status-warning",
    bgColor: "bg-status-warning/10",
    label: "Tồn kho thấp",
  },
  customer_new: {
    iconName: "person_add",
    color: "text-status-info",
    bgColor: "bg-status-info/10",
    label: "Khách hàng mới",
  },
  payment_received: {
    iconName: "payments",
    color: "text-status-success",
    bgColor: "bg-status-success/10",
    label: "Nhận thanh toán",
  },
  expiring_lot: {
    iconName: "schedule",
    color: "text-status-warning",
    bgColor: "bg-status-warning/10",
    label: "Lô sắp hết hạn",
  },
  po_overdue: {
    iconName: "schedule_send",
    color: "text-status-error",
    bgColor: "bg-status-error/10",
    label: "PO quá hạn",
  },
  cash_drawer_diff: {
    iconName: "account_balance_wallet",
    color: "text-status-error",
    bgColor: "bg-status-error/10",
    label: "Lệch quỹ ca",
  },
};

const tabFilterMap: Record<string, NotificationKind[] | null> = {
  all: null,
  unread: null, // dùng onlyUnread param thay vì types filter
  orders: ["order_new", "order_completed"],
  stock: ["stock_low", "expiring_lot"],
  finance: ["payment_received", "po_overdue", "cash_drawer_diff"],
};

/** Format relative time (vi) — đơn giản, không cần dayjs. */
function timeAgo(iso: string): string {
  const now = Date.now();
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "—";
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} ngày trước`;
  return formatShortDate(iso);
}

export default function ThongBaoPage() {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const types = tabFilterMap[activeTab] ?? undefined;
      const rows = await getNotifications({
        onlyUnread: activeTab === "unread",
        types: types ?? undefined,
      });
      setNotifications(rows);
    } catch (err) {
      toast({
        title: "Lỗi tải thông báo",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [activeTab, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsAsRead();
      toast({ title: "Đã đánh dấu tất cả là đã đọc", variant: "success" });
      load();
    } catch (err) {
      toast({
        title: "Lỗi",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  const handleClickNotification = async (n: NotificationRow) => {
    if (!n.isRead) {
      // Optimistic update + persist
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
      );
      try {
        await markNotificationAsRead(n.id);
      } catch {
        // revert on error
        load();
      }
    }
    // TODO: deep-link tới reference_type/id (vd order_new → /don-hang/dat-hang?id=X)
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Thông báo"
        actions={[
          {
            label: "Đánh dấu đã đọc",
            icon: <Icon name="check" size={16} />,
            variant: "outline",
            onClick: handleMarkAllRead,
          },
        ]}
      />

      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">Tất cả</TabsTrigger>
            <TabsTrigger value="unread">
              Chưa đọc
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-1.5 h-4 min-w-4 px-1 text-[10px]"
                >
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders">Đơn hàng</TabsTrigger>
            <TabsTrigger value="stock">Kho hàng</TabsTrigger>
            <TabsTrigger value="finance">Tài chính</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab}>
            <Card>
              {loading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <Icon
                    name="progress_activity"
                    size={20}
                    className="animate-spin mr-2 inline-block align-middle"
                  />
                  Đang tải...
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <Icon
                    name="notifications_off"
                    size={48}
                    className="mx-auto mb-3 opacity-30"
                  />
                  <p className="text-sm font-medium">Không có thông báo</p>
                  <p className="text-xs mt-1">
                    Thông báo về đơn hàng, tồn kho thấp, công nợ quá hạn sẽ
                    hiện ở đây.
                  </p>
                </div>
              ) : (
                notifications.map((notification, index) => {
                  const config = typeConfig[notification.type] ?? {
                    iconName: "notifications",
                    color: "text-muted-foreground",
                    bgColor: "bg-muted",
                    label: notification.type,
                  };
                  return (
                    <div key={notification.id}>
                      <div
                        className={`group w-full flex items-start gap-3 p-4 transition-colors hover:bg-surface-container-low ${
                          !notification.isRead ? "bg-primary-fixed/40" : ""
                        }`}
                      >
                        <button
                          onClick={() => handleClickNotification(notification)}
                          className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center cursor-pointer"
                          style={{}}
                          aria-label="Đánh dấu đã đọc"
                        >
                          <span
                            className={`h-10 w-10 rounded-full flex items-center justify-center ${config.bgColor}`}
                          >
                            <Icon
                              name={config.iconName}
                              size={20}
                              className={config.color}
                            />
                          </span>
                        </button>
                        <button
                          onClick={() => handleClickNotification(notification)}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={`text-sm leading-tight ${
                                !notification.isRead
                                  ? "font-semibold text-foreground"
                                  : "text-foreground"
                              }`}
                            >
                              {notification.title}
                            </p>
                            {!notification.isRead && (
                              <span className="shrink-0 mt-1 h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                          {notification.description && (
                            <p className="text-sm text-muted-foreground mt-0.5 truncate">
                              {notification.description}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {timeAgo(notification.createdAt)}
                          </p>
                        </button>
                        <button
                          onClick={() => handleDelete(notification.id)}
                          className="shrink-0 h-8 w-8 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 flex items-center justify-center"
                          aria-label="Xóa"
                          title="Xóa thông báo"
                        >
                          <Icon
                            name="close"
                            size={16}
                            className="text-muted-foreground"
                          />
                        </button>
                      </div>
                      {index < notifications.length - 1 && <Separator />}
                    </div>
                  );
                })
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
