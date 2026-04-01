"use client";

import { useState } from "react";
import {
  Package,
  ShoppingCart,
  AlertTriangle,
  Users,
  DollarSign,
  Check,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { NotificationType, Notification } from "@/lib/types";

const typeConfig: Record<
  NotificationType,
  { icon: typeof Package; color: string; bgColor: string }
> = {
  order_new: {
    icon: ShoppingCart,
    color: "text-green-600",
    bgColor: "bg-green-100",
  },
  order_completed: {
    icon: Package,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
  },
  stock_low: {
    icon: AlertTriangle,
    color: "text-orange-600",
    bgColor: "bg-orange-100",
  },
  customer_new: {
    icon: Users,
    color: "text-purple-600",
    bgColor: "bg-purple-100",
  },
  payment_received: {
    icon: DollarSign,
    color: "text-red-600",
    bgColor: "bg-red-100",
  },
};

const tabFilterMap: Record<string, NotificationType[] | null> = {
  all: null,
  unread: null,
  orders: ["order_new", "order_completed"],
  stock: ["stock_low"],
  finance: ["payment_received"],
};

const initialNotifications = [
  { id: 1, type: "order_new", title: "Don hang moi #DH-1042", description: "Nguyen Van An dat don hang tri gia 2.450.000d", timeAgo: "2 phut truoc", read: false },
  { id: 2, type: "payment_received", title: "Thanh toan thanh cong", description: "Nhan thanh toan 5.200.000d tu khach hang Tran Thi Bich", timeAgo: "5 phut truoc", read: false },
  { id: 3, type: "stock_low", title: "Ton kho thap: SP-0023", description: "San pham 'Ao thun nam co tron' chi con 3 san pham", timeAgo: "15 phut truoc", read: false },
  { id: 4, type: "customer_new", title: "Khach hang moi dang ky", description: "Le Van Cuong vua tao tai khoan moi", timeAgo: "30 phut truoc", read: false },
  { id: 5, type: "order_completed", title: "Don hang #DH-1038 hoan thanh", description: "Don hang da duoc giao thanh cong", timeAgo: "1 gio truoc", read: false },
  { id: 6, type: "order_new", title: "Don hang moi #DH-1041", description: "Pham Thi Dung dat don hang tri gia 890.000d", timeAgo: "1 gio truoc", read: true },
  { id: 7, type: "stock_low", title: "Ton kho thap: SP-0089", description: "San pham 'Quan jean nu slim' chi con 2 san pham", timeAgo: "2 gio truoc", read: true },
  { id: 8, type: "payment_received", title: "Thanh toan thanh cong", description: "Nhan thanh toan 1.800.000d tu khach hang Hoang Van Em", timeAgo: "2 gio truoc", read: false },
  { id: 9, type: "customer_new", title: "Khach hang moi dang ky", description: "Vo Thi Phuong vua tao tai khoan moi", timeAgo: "3 gio truoc", read: true },
  { id: 10, type: "order_completed", title: "Don hang #DH-1035 hoan thanh", description: "Don hang da duoc giao thanh cong", timeAgo: "3 gio truoc", read: true },
  { id: 11, type: "order_new", title: "Don hang moi #DH-1040", description: "Bui Van Giang dat don hang tri gia 3.100.000d", timeAgo: "4 gio truoc", read: true },
  { id: 12, type: "stock_low", title: "Ton kho thap: SP-0112", description: "San pham 'Giay the thao nam' chi con 1 san pham", timeAgo: "5 gio truoc", read: false },
  { id: 13, type: "payment_received", title: "Thanh toan thanh cong", description: "Nhan thanh toan 4.500.000d tu khach hang Dang Thi Huong", timeAgo: "6 gio truoc", read: true },
  { id: 14, type: "customer_new", title: "Khach hang moi dang ky", description: "Nguyen Van Ich vua tao tai khoan moi", timeAgo: "8 gio truoc", read: true },
  { id: 15, type: "order_completed", title: "Don hang #DH-1032 hoan thanh", description: "Don hang da duoc giao thanh cong", timeAgo: "1 ngay truoc", read: true },
  { id: 16, type: "order_new", title: "Don hang moi #DH-1039", description: "Tran Van Khanh dat don hang tri gia 1.250.000d", timeAgo: "1 ngay truoc", read: true },
  { id: 17, type: "stock_low", title: "Ton kho thap: SP-0045", description: "San pham 'Tui xach nu da' chi con 2 san pham", timeAgo: "1 ngay truoc", read: true },
  { id: 18, type: "payment_received", title: "Thanh toan thanh cong", description: "Nhan thanh toan 7.800.000d tu khach hang Le Thi Lan", timeAgo: "2 ngay truoc", read: true },
  { id: 19, type: "customer_new", title: "Khach hang moi dang ky", description: "Pham Van Minh vua tao tai khoan moi", timeAgo: "2 ngay truoc", read: true },
  { id: 20, type: "order_completed", title: "Don hang #DH-1028 hoan thanh", description: "Don hang da duoc giao thanh cong", timeAgo: "3 ngay truoc", read: true },
].map((n) => ({
  ...n,
  title: n.title
    .replace(/Don hang/g, "Đơn hàng")
    .replace(/Don/g, "Đơn")
    .replace(/moi/g, "mới")
    .replace(/hoan thanh/g, "hoàn thành"),
  description: n.description
    .replace(/dat don hang tri gia/g, "đặt đơn hàng trị giá")
    .replace(/Don hang da duoc giao thanh cong/g, "Đơn hàng đã được giao thành công")
    .replace(/Nhan thanh toan/g, "Nhận thanh toán")
    .replace(/tu khach hang/g, "từ khách hàng")
    .replace(/Thanh toan thanh cong/g, "Thanh toán thành công")
    .replace(/vua tao tai khoan moi/g, "vừa tạo tài khoản mới")
    .replace(/chi con/g, "chỉ còn")
    .replace(/san pham/g, "sản phẩm")
    .replace(/San pham/g, "Sản phẩm"),
  timeAgo: n.timeAgo
    .replace(/phut truoc/g, "phút trước")
    .replace(/gio truoc/g, "giờ trước")
    .replace(/ngay truoc/g, "ngày trước"),
}));

// Fix titles that use Vietnamese
const fixedNotifications = initialNotifications.map((n) => ({
  ...n,
  type: n.type as NotificationType,
  title: n.title
    .replace("Tồn kho thấp", "Tồn kho thấp")
    .replace("Ton kho thap", "Tồn kho thấp")
    .replace("Khach hang moi dang ky", "Khách hàng mới đăng ký")
    .replace("Thanh toan thanh cong", "Thanh toán thành công"),
}));

export default function ThongBaoPage() {
  const [notifications, setNotifications] = useState<Notification[]>(fixedNotifications);
  const [activeTab, setActiveTab] = useState("all");

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleToggleRead = (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === "unread") return !n.read;
    const allowedTypes = tabFilterMap[activeTab];
    if (allowedTypes) return allowedTypes.includes(n.type);
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Thông báo"
        actions={[
          {
            label: "Đánh dấu đã đọc",
            icon: <Check className="h-4 w-4" />,
            variant: "outline",
            onClick: handleMarkAllRead,
          },
        ]}
      />

      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">
              Tất cả
            </TabsTrigger>
            <TabsTrigger value="unread">
              Chưa đọc
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders">
              Đơn hàng
            </TabsTrigger>
            <TabsTrigger value="stock">
              Kho hàng
            </TabsTrigger>
            <TabsTrigger value="finance">
              Tài chính
            </TabsTrigger>
          </TabsList>

          {["all", "unread", "orders", "stock", "finance"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <Card>
                {filteredNotifications.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    Không có thông báo nào
                  </div>
                ) : (
                  filteredNotifications.map((notification, index) => {
                    const config = typeConfig[notification.type];
                    const Icon = config.icon;
                    return (
                      <div key={notification.id}>
                        <button
                          onClick={() => handleToggleRead(notification.id)}
                          className={`w-full flex items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50 ${
                            !notification.read ? "bg-blue-50/50" : ""
                          }`}
                        >
                          <div
                            className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${config.bgColor}`}
                          >
                            <Icon className={`h-5 w-5 ${config.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className={`text-sm leading-tight ${
                                  !notification.read
                                    ? "font-semibold text-foreground"
                                    : "text-foreground"
                                }`}
                              >
                                {notification.title}
                              </p>
                              {!notification.read && (
                                <span className="shrink-0 mt-1 h-2 w-2 rounded-full bg-blue-500" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5 truncate">
                              {notification.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {notification.timeAgo}
                            </p>
                          </div>
                        </button>
                        {index < filteredNotifications.length - 1 && (
                          <Separator />
                        )}
                      </div>
                    );
                  })
                )}
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
