"use client";

import { useState } from "react";
import {
  Eye,
  ShoppingBag,
  DollarSign,
  TrendingUp
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const GREEN_ACCENT = "#16a34a";

const stats = [
  {
    label: "Lượt truy cập hôm nay",
    value: "234",
    icon: Eye,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    label: "Đơn từ website",
    value: "8",
    icon: ShoppingBag,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    label: "Doanh thu",
    value: "15.800.000",
    icon: DollarSign,
    color: "text-green-600",
    bg: "bg-green-50",
    suffix: "đ",
  },
  {
    label: "Tỷ lệ chuyển đổi",
    value: "3,4",
    icon: TrendingUp,
    color: "text-green-600",
    bg: "bg-green-50",
    suffix: "%",
  },
];

interface WebProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  visible: boolean;
}

const webProducts: WebProduct[] = [
  { id: "wp1", name: "Cà phê Robusta Đắk Lắk - Hạt rang", price: 185000, stock: 124, visible: true },
  { id: "wp2", name: "Arabica Cầu Đất - Hạt rang", price: 320000, stock: 56, visible: true },
  { id: "wp3", name: "Blend House Phin - Bột pha phin", price: 165000, stock: 89, visible: true },
  { id: "wp4", name: "Cà phê sữa đá hòa tan (hộp 20 gói)", price: 120000, stock: 200, visible: true },
  { id: "wp5", name: "Arabica Sơn La - Honey Process", price: 350000, stock: 32, visible: false },
  { id: "wp6", name: "Drip bag cà phê đặc sản (hộp 10)", price: 195000, stock: 67, visible: true },
];

interface WebOrder {
  id: string;
  code: string;
  customer: string;
  total: number;
  status: "pending" | "confirmed" | "shipping" | "completed";
  statusName: string;
  date: string;
}

const recentOrders: WebOrder[] = [
  { id: "wo1", code: "WEB00234", customer: "Lê Thị Ngọc Mai", total: 640000, status: "pending", statusName: "Chờ xử lý", date: "02/04/2026" },
  { id: "wo2", code: "WEB00233", customer: "Đỗ Hoàng Nam", total: 370000, status: "confirmed", statusName: "Đã xác nhận", date: "02/04/2026" },
  { id: "wo3", code: "WEB00232", customer: "Trương Thị Hạnh", total: 520000, status: "shipping", statusName: "Đang giao", date: "01/04/2026" },
  { id: "wo4", code: "WEB00231", customer: "Bùi Quang Huy", total: 185000, status: "completed", statusName: "Hoàn thành", date: "01/04/2026" },
  { id: "wo5", code: "WEB00230", customer: "Ngô Thị Yến Nhi", total: 960000, status: "completed", statusName: "Hoàn thành", date: "31/03/2026" },
];

const statusColor: Record<WebOrder["status"], string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  shipping: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function WebsitePage() {
  const [products, setProducts] = useState(webProducts);

  const toggleVisibility = (id: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p))
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      {/* Header */}
      <div className="border-b bg-white px-4 md:px-6 py-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="size-8 rounded-lg bg-green-600 flex items-center justify-center text-white">
            <Icon name="public" className="size-4" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">
            Quản lý Website bán hàng
          </h1>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={cn("flex items-center gap-2 rounded-lg px-3 py-2", s.bg)}
              >
                <Icon className={cn("size-4 shrink-0", s.color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={cn("text-sm font-bold", s.color)}>
                    {s.value}
                    {s.suffix ?? ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* Section 1: Thông tin website */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Thông tin website</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">
                  Tên cửa hàng
                </p>
                <p className="text-sm font-medium">Xưởng Cà Phê OneBiz</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">URL</p>
                <p className="text-sm font-medium text-green-600 flex items-center gap-1">
                  onebiz.com.vn
                  <Icon name="open_in_new" className="size-3" />
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">
                  Trạng thái
                </p>
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                  Đang hoạt động
                </Badge>
              </div>
              <div>
                <Button variant="outline" size="sm">
                  <Icon name="edit" className="size-3.5 mr-1.5" />
                  Chỉnh sửa website
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Sản phẩm đang bán online */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Sản phẩm đang bán online</CardTitle>
              <Button variant="outline" size="sm">
                Quản lý sản phẩm
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {products.map((product) => (
                <div
                  key={product.id}
                  className={cn(
                    "border rounded-lg p-3 transition-opacity",
                    !product.visible && "opacity-50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="size-12 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                      <Icon name="inventory_2" className="size-5 text-orange-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">
                        {product.name}
                      </p>
                      <p className="text-sm font-bold text-green-600 mt-0.5">
                        {formatCurrency(product.price)}đ
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Tồn kho: {product.stock}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {product.visible ? "Hiển thị" : "Ẩn"}
                    </span>
                    <button
                      onClick={() => toggleVisibility(product.id)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        product.visible ? "bg-green-500" : "bg-gray-300"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-3.5 rounded-full bg-white transition-transform",
                          product.visible ? "translate-x-[18px]" : "translate-x-1"
                        )}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Đơn hàng gần đây từ website */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Đơn hàng gần đây từ website
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Mã đơn
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
                      Ngày
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-green-600">
                        {order.code}
                      </td>
                      <td className="px-4 py-2.5">{order.customer}</td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {formatCurrency(order.total)}đ
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            statusColor[order.status]
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
            <div className="px-4 py-3 border-t">
              <button className="text-sm text-green-600 font-medium hover:underline">
                Xem tất cả đơn hàng &rarr;
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
