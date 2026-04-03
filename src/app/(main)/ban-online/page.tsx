"use client";

import {
  ShoppingCart,
  TrendingUp,
  CheckCircle,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

// === KPI Data ===
const kpiCards = [
  {
    title: "Tổng đơn online",
    value: "156",
    change: "+12%",
    subtitle: "so với tháng trước",
    icon: ShoppingCart,
    color: "text-blue-600",
    bg: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    title: "Doanh thu online",
    value: formatCurrency(245000000) + "đ",
    change: "+8,5%",
    subtitle: "so với tháng trước",
    icon: TrendingUp,
    color: "text-green-600",
    bg: "bg-green-50",
    borderColor: "border-green-200",
  },
  {
    title: "Tỷ lệ hoàn thành",
    value: "92%",
    change: "+3%",
    subtitle: "so với tháng trước",
    icon: CheckCircle,
    color: "text-purple-600",
    bg: "bg-purple-50",
    borderColor: "border-purple-200",
  },
  {
    title: "Đơn chờ xử lý",
    value: "8",
    change: "",
    subtitle: "cần xử lý ngay",
    icon: Clock,
    color: "text-orange-600",
    bg: "bg-orange-50",
    borderColor: "border-orange-200",
  },
];

// === Channel Data ===
const channels = [
  {
    id: "fb",
    name: "Facebook",
    letter: "F",
    letterBg: "bg-blue-600",
    connected: true,
    ordersToday: 23,
    revenueToday: 45200000,
  },
  {
    id: "zalo",
    name: "Zalo",
    letter: "Z",
    letterBg: "bg-blue-500",
    connected: true,
    ordersToday: 15,
    revenueToday: 28500000,
  },
  {
    id: "web",
    name: "Website",
    letter: "W",
    letterBg: "bg-green-600",
    connected: true,
    ordersToday: 8,
    revenueToday: 15800000,
  },
];

// === Recent Orders ===
const recentOrders = [
  {
    code: "OL00156",
    channel: "Facebook",
    channelColor: "bg-blue-600",
    customer: "Nguyễn Thanh Tùng",
    total: 1850000,
    status: "Hoàn thành",
    statusColor: "bg-green-100 text-green-700",
    time: "14:32, 02/04/2026",
  },
  {
    code: "OL00155",
    channel: "Zalo",
    channelColor: "bg-blue-500",
    customer: "Trần Thị Hương",
    total: 2340000,
    status: "Đang giao",
    statusColor: "bg-blue-100 text-blue-700",
    time: "13:15, 02/04/2026",
  },
  {
    code: "OL00154",
    channel: "Website",
    channelColor: "bg-green-600",
    customer: "Phạm Quốc Đại",
    total: 985000,
    status: "Chờ xử lý",
    statusColor: "bg-yellow-100 text-yellow-700",
    time: "12:48, 02/04/2026",
  },
  {
    code: "OL00153",
    channel: "Facebook",
    channelColor: "bg-blue-600",
    customer: "Lê Minh Châu",
    total: 3200000,
    status: "Hoàn thành",
    statusColor: "bg-green-100 text-green-700",
    time: "11:20, 02/04/2026",
  },
  {
    code: "OL00152",
    channel: "Zalo",
    channelColor: "bg-blue-500",
    customer: "Hoàng Đức Anh",
    total: 1560000,
    status: "Đang giao",
    statusColor: "bg-blue-100 text-blue-700",
    time: "10:55, 02/04/2026",
  },
  {
    code: "OL00151",
    channel: "Facebook",
    channelColor: "bg-blue-600",
    customer: "Vũ Thị Lan",
    total: 4750000,
    status: "Hoàn thành",
    statusColor: "bg-green-100 text-green-700",
    time: "09:30, 02/04/2026",
  },
  {
    code: "OL00150",
    channel: "Website",
    channelColor: "bg-green-600",
    customer: "Đặng Văn Thắng",
    total: 890000,
    status: "Đã hủy",
    statusColor: "bg-red-100 text-red-700",
    time: "08:45, 02/04/2026",
  },
  {
    code: "OL00149",
    channel: "Zalo",
    channelColor: "bg-blue-500",
    customer: "Bùi Thị Mai",
    total: 2100000,
    status: "Chờ xử lý",
    statusColor: "bg-yellow-100 text-yellow-700",
    time: "08:10, 02/04/2026",
  },
];

export default function BanOnlinePage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-2">
        <h1 className="text-lg font-bold text-gray-900">
          Tổng quan bán online
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Theo dõi hoạt động bán hàng trên các kênh online
        </p>
      </div>

      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <Card key={kpi.title} className={cn("border", kpi.borderColor)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center",
                        kpi.bg
                      )}
                    >
                      <Icon className={cn("h-5 w-5", kpi.color)} />
                    </div>
                    {kpi.change && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
                        <ArrowUpRight className="h-3 w-3" />
                        {kpi.change}
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {kpi.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {kpi.title}
                    {kpi.subtitle && (
                      <span className="block">{kpi.subtitle}</span>
                    )}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Channel Cards */}
        <div>
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            Kênh bán hàng
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {channels.map((channel) => (
              <Card key={channel.id} className="relative">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-lg",
                          channel.letterBg
                        )}
                      >
                        {channel.letter}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          {channel.name}
                        </p>
                        <Badge
                          variant={channel.connected ? "default" : "secondary"}
                          className="mt-0.5"
                        >
                          {channel.connected ? "Đã kết nối" : "Chưa kết nối"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {channel.connected ? (
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-muted/50 rounded-md p-2 text-center">
                        <p className="text-xs text-muted-foreground">
                          Đơn hôm nay
                        </p>
                        <p className="text-lg font-bold">
                          {channel.ordersToday}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-2 text-center">
                        <p className="text-xs text-muted-foreground">
                          Doanh thu hôm nay
                        </p>
                        <p className="text-lg font-bold text-primary">
                          {formatCurrency(channel.revenueToday)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted/30 rounded-md p-4 mb-3 text-center">
                      <p className="text-sm text-muted-foreground">
                        Kết nối để bắt đầu bán hàng
                      </p>
                    </div>
                  )}

                  <Button
                    variant={channel.connected ? "outline" : "default"}
                    size="sm"
                    className="w-full"
                  >
                    {channel.connected ? "Quản lý" : "Kết nối"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Recent Orders Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Đơn hàng gần đây</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Mã đơn
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Kênh
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Khách hàng
                    </th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                      Tổng tiền
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Trạng thái
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Thời gian
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr
                      key={order.code}
                      className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-primary">
                          {order.code}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "h-2 w-2 rounded-full",
                              order.channelColor
                            )}
                          />
                          <span>{order.channel}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">{order.customer}</td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {formatCurrency(order.total)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                            order.statusColor
                          )}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {order.time}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
