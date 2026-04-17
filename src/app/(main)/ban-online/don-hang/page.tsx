"use client";

import { useState } from "react";
import {
  ShoppingBag,
  Clock,
  Truck,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Types & Mock data                                                  */
/* ------------------------------------------------------------------ */

type OrderStatus = "all" | "pending" | "shipping" | "completed" | "cancelled";

interface OnlineOrderRow {
  id: string;
  code: string;
  channel: "Facebook" | "Zalo" | "Website";
  channelColor: string;
  customer: string;
  phone: string;
  total: number;
  status: Exclude<OrderStatus, "all">;
  statusName: string;
  date: string;
}

const filterTabs: { key: OrderStatus; label: string; count: number }[] = [
  { key: "all", label: "Tất cả", count: 156 },
  { key: "pending", label: "Chờ xử lý", count: 8 },
  { key: "shipping", label: "Đang giao", count: 23 },
  { key: "completed", label: "Hoàn thành", count: 118 },
  { key: "cancelled", label: "Đã hủy", count: 7 },
];

const summaryCards = [
  { label: "Tổng đơn", value: 156, icon: ShoppingBag, color: "text-gray-700", bg: "bg-gray-50" },
  { label: "Chờ xử lý", value: 8, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50" },
  { label: "Đang giao", value: 23, icon: Truck, color: "text-purple-600", bg: "bg-purple-50" },
  { label: "Hoàn thành", value: 118, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
  { label: "Đã hủy", value: 7, icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
];

const statusBadge: Record<
  Exclude<OrderStatus, "all">,
  { className: string }
> = {
  pending: { className: "bg-yellow-100 text-yellow-800" },
  shipping: { className: "bg-purple-100 text-purple-800" },
  completed: { className: "bg-green-100 text-green-800" },
  cancelled: { className: "bg-red-100 text-red-800" },
};

const channelDot: Record<string, string> = {
  Facebook: "bg-blue-500",
  Zalo: "bg-[#0068FF]",
  Website: "bg-green-500",
};

const orders: OnlineOrderRow[] = [
  { id: "o01", code: "OL02015", channel: "Zalo", channelColor: "bg-[#0068FF]", customer: "Nguyễn Thị Hương", phone: "0901234567", total: 555000, status: "pending", statusName: "Chờ xử lý", date: "02/04/2026 09:15" },
  { id: "o02", code: "OL02014", channel: "Facebook", channelColor: "bg-blue-500", customer: "Trần Minh Đức", phone: "0912345678", total: 370000, status: "pending", statusName: "Chờ xử lý", date: "02/04/2026 08:50" },
  { id: "o03", code: "OL02013", channel: "Website", channelColor: "bg-green-500", customer: "Lê Thị Ngọc Mai", phone: "0923456789", total: 640000, status: "shipping", statusName: "Đang giao", date: "02/04/2026 08:30" },
  { id: "o04", code: "OL02012", channel: "Zalo", channelColor: "bg-[#0068FF]", customer: "Phạm Văn Hùng", phone: "0934567890", total: 185000, status: "shipping", statusName: "Đang giao", date: "01/04/2026 16:20" },
  { id: "o05", code: "OL02011", channel: "Facebook", channelColor: "bg-blue-500", customer: "Hoàng Thị Lan Anh", phone: "0945678901", total: 960000, status: "completed", statusName: "Hoàn thành", date: "01/04/2026 14:45" },
  { id: "o06", code: "OL02010", channel: "Website", channelColor: "bg-green-500", customer: "Đỗ Hoàng Nam", phone: "0956789012", total: 320000, status: "completed", statusName: "Hoàn thành", date: "01/04/2026 11:30" },
  { id: "o07", code: "OL02009", channel: "Zalo", channelColor: "bg-[#0068FF]", customer: "Võ Quốc Thắng", phone: "0967890123", total: 480000, status: "completed", statusName: "Hoàn thành", date: "01/04/2026 09:10" },
  { id: "o08", code: "OL02008", channel: "Facebook", channelColor: "bg-blue-500", customer: "Bùi Quang Huy", phone: "0978901234", total: 1250000, status: "shipping", statusName: "Đang giao", date: "31/03/2026 17:00" },
  { id: "o09", code: "OL02007", channel: "Website", channelColor: "bg-green-500", customer: "Trương Thị Hạnh", phone: "0989012345", total: 520000, status: "completed", statusName: "Hoàn thành", date: "31/03/2026 15:20" },
  { id: "o10", code: "OL02006", channel: "Zalo", channelColor: "bg-[#0068FF]", customer: "Ngô Thị Yến Nhi", phone: "0390123456", total: 195000, status: "cancelled", statusName: "Đã hủy", date: "31/03/2026 13:40" },
  { id: "o11", code: "OL02005", channel: "Facebook", channelColor: "bg-blue-500", customer: "Đinh Công Sơn", phone: "0381234567", total: 740000, status: "completed", statusName: "Hoàn thành", date: "31/03/2026 10:15" },
  { id: "o12", code: "OL02004", channel: "Zalo", channelColor: "bg-[#0068FF]", customer: "Lý Thị Bích Ngọc", phone: "0372345678", total: 350000, status: "completed", statusName: "Hoàn thành", date: "30/03/2026 16:30" },
  { id: "o13", code: "OL02003", channel: "Website", channelColor: "bg-green-500", customer: "Phan Thanh Tùng", phone: "0363456789", total: 890000, status: "pending", statusName: "Chờ xử lý", date: "30/03/2026 14:00" },
  { id: "o14", code: "OL02002", channel: "Facebook", channelColor: "bg-blue-500", customer: "Mai Thị Thu Hà", phone: "0354567890", total: 165000, status: "cancelled", statusName: "Đã hủy", date: "30/03/2026 11:45" },
  { id: "o15", code: "OL02001", channel: "Zalo", channelColor: "bg-[#0068FF]", customer: "Dương Văn Phú", phone: "0345678901", total: 1100000, status: "completed", statusName: "Hoàn thành", date: "30/03/2026 09:00" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DonHangOnlinePage() {
  const [activeFilter, setActiveFilter] = useState<OrderStatus>("all");
  const [searchText, setSearchText] = useState("");

  const filteredOrders = orders.filter((o) => {
    const matchStatus = activeFilter === "all" || o.status === activeFilter;
    const matchSearch =
      searchText === "" ||
      o.code.toLowerCase().includes(searchText.toLowerCase()) ||
      o.customer.toLowerCase().includes(searchText.toLowerCase()) ||
      o.phone.includes(searchText);
    return matchStatus && matchSearch;
  });

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      {/* Header */}
      <div className="border-b bg-white px-4 md:px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900">Đơn hàng online</h1>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterTabs.map((tab) => (
            <Button
              key={tab.key}
              variant={activeFilter === tab.key ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setActiveFilter(tab.key)}
            >
              {tab.label}
              <span
                className={cn(
                  "ml-1.5 text-[10px] rounded-full px-1.5 py-0.5",
                  activeFilter === tab.key
                    ? "bg-white/20 text-white"
                    : "bg-gray-100 text-gray-600"
                )}
              >
                {tab.count}
              </span>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {summaryCards.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2.5",
                  s.bg
                )}
              >
                <Icon className={cn("size-5 shrink-0", s.color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={cn("text-lg font-bold", s.color)}>{s.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Tìm mã đơn, khách hàng, SĐT..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Orders table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Mã đơn
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Kênh
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Khách hàng
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      SĐT
                    </th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                      Tổng tiền
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Trạng thái
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Ngày tạo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-primary">
                        {order.code}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-2.5 rounded-full shrink-0",
                              channelDot[order.channel]
                            )}
                          />
                          <span>{order.channel}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">{order.customer}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {order.phone}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {formatCurrency(order.total)}đ
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            statusBadge[order.status].className
                          )}
                        >
                          {order.statusName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {order.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination text */}
            <div className="px-4 py-3 border-t text-sm text-muted-foreground">
              Hiển thị {filteredOrders.length} / 156 đơn hàng
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
