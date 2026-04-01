"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  CheckCircle,
  FileText,
  XCircle,
  MoreHorizontal,
  ShoppingCart,
  Clock,
  CheckCircle2,
  Ban,
  Truck,
  MapPin,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";
import type { OrderLineItem, StatusChange, SalesOrderDetail } from "@/lib/types";

// === Mock Data ===
function getMockOrder(id: string): SalesOrderDetail {
  return {
    id,
    code: "DH00789",
    date: "2026-03-27T10:15:00Z",
    status: "confirmed",
    statusName: "Đã xác nhận",
    customerId: "cus_2",
    customerCode: "KH002",
    customerName: "Trần Văn Hùng",
    customerPhone: "0987654321",
    deliveryAddress: "789 Lê Văn Sỹ, Quận 3, TP. Hồ Chí Minh",
    deliveryPhone: "0987654321",
    deliveryMethod: "Giao hàng tận nơi",
    items: [
      {
        id: "oi_1",
        productCode: "SP001",
        productName: "Nước ngọt Coca Cola 330ml",
        quantity: 48,
        unitPrice: 8000,
        total: 384000,
        unit: "lon",
      },
      {
        id: "oi_2",
        productCode: "SP006",
        productName: "Bia Tiger lon 330ml (thùng 24)",
        quantity: 10,
        unitPrice: 320000,
        total: 3200000,
        unit: "thùng",
      },
      {
        id: "oi_3",
        productCode: "SP007",
        productName: "Nước mắm Nam Ngư 500ml",
        quantity: 12,
        unitPrice: 28000,
        total: 336000,
        unit: "chai",
      },
      {
        id: "oi_4",
        productCode: "SP003",
        productName: "Dầu ăn Tường An 5L",
        quantity: 5,
        unitPrice: 145000,
        total: 725000,
        unit: "chai",
      },
      {
        id: "oi_5",
        productCode: "SP008",
        productName: "Bột giặt OMO 6kg",
        quantity: 8,
        unitPrice: 165000,
        total: 1320000,
        unit: "túi",
      },
    ],
    totalAmount: 5965000,
    discount: 165000,
    finalAmount: 5800000,
    note: "Giao trước 17h chiều",
    createdBy: "Nguyễn Văn A",
    createdAt: "2026-03-27T10:15:00Z",
    timeline: [
      {
        id: "st_1",
        date: "2026-03-27T10:15:00Z",
        status: "Tạo đơn hàng",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "st_2",
        date: "2026-03-27T10:30:00Z",
        status: "Đã xác nhận",
        note: "Xác nhận qua điện thoại",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "st_3",
        date: "2026-03-27T11:00:00Z",
        status: "Đang chuẩn bị hàng",
        note: "Đã chuyển kho soạn hàng",
        createdBy: "Lê Văn C",
      },
    ],
  };
}

// === Helper Components ===
function InfoRow({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex justify-between items-start py-2.5 ${className ?? ""}`}>
      <span className="text-muted-foreground text-sm shrink-0 mr-4">{label}</span>
      <span className="text-sm text-right font-medium">{value}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded" />
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

function getStatusBadge(status: SalesOrderDetail["status"], statusName: string) {
  const variant =
    status === "completed"
      ? "default"
      : status === "cancelled"
      ? "destructive"
      : status === "confirmed" || status === "processing"
      ? "secondary"
      : "outline";
  return <Badge variant={variant}>{statusName}</Badge>;
}

function TimelineIcon({ status }: { status: string }) {
  if (status.includes("Hoàn thành") || status.includes("xác nhận"))
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status.includes("Hủy") || status.includes("hủy"))
    return <Ban className="h-4 w-4 text-destructive" />;
  if (status.includes("giao") || status.includes("Giao"))
    return <Truck className="h-4 w-4 text-blue-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// === Main Component ===
export default function ChiTietDonDatHangPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<SalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOrder(getMockOrder(orderId));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [orderId]);

  if (loading) return <DetailSkeleton />;

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <ShoppingCart className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy đơn hàng</p>
        <Button
          variant="outline"
          onClick={() => router.push("/don-hang/dat-hang")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => router.push("/don-hang/dat-hang")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">{order.code}</h1>
                {getStatusBadge(order.status, order.statusName)}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                {order.customerName} · {formatDate(order.date)} · {order.createdBy}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In đơn
            </Button>
            {(order.status === "pending" || order.status === "confirmed") && (
              <>
                <Button variant="outline" size="sm">
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  Xác nhận
                </Button>
                <Button size="sm">
                  <FileText className="h-4 w-4 mr-1.5" />
                  Tạo hóa đơn
                </Button>
              </>
            )}
            {order.status !== "cancelled" && order.status !== "completed" && (
              <Button variant="ghost" size="sm" className="text-destructive">
                <XCircle className="h-4 w-4 mr-1.5" />
                Hủy
              </Button>
            )}
          </div>

          <div className="flex md:hidden items-center gap-1">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Card 1: Thông tin đơn hàng */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShoppingCart className="h-4 w-4 text-primary" />
                Thông tin đơn hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã đơn hàng" value={order.code} />
              <Separator />
              <InfoRow label="Ngày tạo" value={formatDate(order.date)} />
              <Separator />
              <InfoRow
                label="Trạng thái"
                value={getStatusBadge(order.status, order.statusName)}
              />
              <Separator />
              <InfoRow label="Người tạo" value={order.createdBy} />
              {order.note && (
                <>
                  <Separator />
                  <InfoRow label="Ghi chú" value={order.note} />
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Khách hàng & Giao hàng */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Khách hàng & Giao hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Tên KH" value={order.customerName} />
              <Separator />
              <InfoRow label="Mã KH" value={order.customerCode} />
              <Separator />
              <InfoRow
                label="SĐT"
                value={
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {order.customerPhone}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Địa chỉ giao"
                value={
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-right">{order.deliveryAddress}</span>
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="SĐT nhận hàng"
                value={order.deliveryPhone}
              />
              <Separator />
              <InfoRow
                label="Hình thức"
                value={
                  <Badge variant="outline">{order.deliveryMethod}</Badge>
                }
              />
            </CardContent>
          </Card>

          {/* Card 3: Thanh toán */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Thanh toán
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Tạm tính"
                value={formatCurrency(order.totalAmount)}
              />
              <Separator />
              <InfoRow
                label="Giảm giá"
                value={
                  order.discount > 0 ? (
                    <span className="text-orange-600">
                      -{formatCurrency(order.discount)}
                    </span>
                  ) : (
                    "0"
                  )
                }
              />
              <Separator />
              <InfoRow
                label="Tổng cộng"
                value={
                  <span className="text-base font-bold text-primary">
                    {formatCurrency(order.finalAmount)}
                  </span>
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Item List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Danh sách hàng hóa ({order.items.length} sản phẩm)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-2 font-medium">STT</th>
                    <th className="text-left py-2 pr-2 font-medium">Mã SP</th>
                    <th className="text-left py-2 pr-2 font-medium">Tên sản phẩm</th>
                    <th className="text-right py-2 pr-2 font-medium">SL</th>
                    <th className="text-right py-2 pr-2 font-medium">Đơn giá</th>
                    <th className="text-right py-2 font-medium">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, idx) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-2 text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 pr-2 text-primary font-medium">
                        {item.productCode}
                      </td>
                      <td className="py-2.5 pr-2">
                        {item.productName}
                        <span className="text-muted-foreground ml-1">
                          ({item.unit})
                        </span>
                      </td>
                      <td className="py-2.5 pr-2 text-right">{item.quantity}</td>
                      <td className="py-2.5 pr-2 text-right">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="py-2.5 text-right font-medium">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td colSpan={5} className="py-2.5 text-right font-medium">
                      Tạm tính:
                    </td>
                    <td className="py-2.5 text-right font-medium">
                      {formatCurrency(order.totalAmount)}
                    </td>
                  </tr>
                  {order.discount > 0 && (
                    <tr>
                      <td colSpan={5} className="py-1 text-right text-orange-600">
                        Giảm giá:
                      </td>
                      <td className="py-1 text-right text-orange-600">
                        -{formatCurrency(order.discount)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td
                      colSpan={5}
                      className="py-2.5 text-right font-bold text-base"
                    >
                      Tổng cộng:
                    </td>
                    <td className="py-2.5 text-right font-bold text-base text-primary">
                      {formatCurrency(order.finalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Trạng thái đơn hàng</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {order.timeline.map((item, idx) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineIcon status={item.status} />
                    {idx < order.timeline.length - 1 && (
                      <div className="w-px h-full bg-border mt-1" />
                    )}
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-medium">{item.status}</p>
                    {item.note && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.note}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(item.date)} · {item.createdBy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
