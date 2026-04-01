"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  MoreHorizontal,
  Truck,
  Phone,
  MapPin,
  Clock,
  CheckCircle2,
  Package,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { StatusChange, ShippingOrderDetail } from "@/lib/types";

// === Mock Data ===
function getMockShippingOrder(id: string): ShippingOrderDetail {
  return {
    id,
    code: "VD00234",
    trackingCode: "GHN2026032900123",
    date: "2026-03-29T08:00:00Z",
    status: "in_transit",
    statusName: "Đang vận chuyển",
    deliveryPartner: "Giao Hàng Nhanh",
    deliveryPartnerPhone: "1900636677",
    receiverName: "Trần Văn Hùng",
    receiverPhone: "0987654321",
    receiverAddress: "789 Lê Văn Sỹ, Quận 3, TP. Hồ Chí Minh",
    senderName: "Cửa hàng OneBiz",
    senderPhone: "0901234567",
    senderAddress: "123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
    linkedInvoiceCode: "HD00123",
    codAmount: 1700000,
    shippingFee: 35000,
    weight: 8500,
    note: "Giao giờ hành chính, gọi trước 30 phút",
    estimatedDelivery: "2026-03-31T18:00:00Z",
    createdBy: "Nguyễn Văn A",
    createdAt: "2026-03-29T08:00:00Z",
    timeline: [
      {
        id: "stl_1",
        date: "2026-03-29T08:00:00Z",
        status: "Tạo vận đơn",
        location: "Kho Quận 1, TP. HCM",
      },
      {
        id: "stl_2",
        date: "2026-03-29T10:30:00Z",
        status: "Đã lấy hàng",
        location: "Kho Quận 1, TP. HCM",
        note: "Shipper đã lấy hàng thành công",
      },
      {
        id: "stl_3",
        date: "2026-03-29T14:00:00Z",
        status: "Đến bưu cục trung chuyển",
        location: "Bưu cục Quận Tân Bình, TP. HCM",
      },
      {
        id: "stl_4",
        date: "2026-03-30T07:00:00Z",
        status: "Đang giao hàng",
        location: "Quận 3, TP. HCM",
        note: "Shipper đang trên đường giao",
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

function getStatusBadge(status: ShippingOrderDetail["status"], statusName: string) {
  const variant =
    status === "delivered"
      ? "default"
      : status === "failed"
      ? "destructive"
      : status === "in_transit"
      ? "secondary"
      : "outline";
  return <Badge variant={variant}>{statusName}</Badge>;
}

function getShippingStatusStep(status: ShippingOrderDetail["status"]) {
  const steps = [
    { key: "pending", label: "Chờ lấy hàng" },
    { key: "picked_up", label: "Đã lấy hàng" },
    { key: "in_transit", label: "Đang vận chuyển" },
    { key: "delivered", label: "Đã giao hàng" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === status);

  return (
    <div className="flex items-center justify-between w-full gap-1 mt-2">
      {steps.map((step, idx) => {
        const isCompleted = idx <= currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={step.key} className="flex flex-col items-center flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                isCompleted
                  ? isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "bg-green-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isCompleted && !isCurrent ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                idx + 1
              )}
            </div>
            <p
              className={`text-xs mt-1 text-center ${
                isCompleted ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function TimelineIcon({ status }: { status: string }) {
  if (status.includes("giao") && status.includes("Đã"))
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status.includes("lấy") || status.includes("Lấy"))
    return <Package className="h-4 w-4 text-blue-600" />;
  if (status.includes("giao") || status.includes("vận chuyển"))
    return <Truck className="h-4 w-4 text-orange-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// === Main Component ===
export default function ChiTietVanDonPage() {
  const params = useParams();
  const router = useRouter();
  const shippingId = params.id as string;

  const [shipping, setShipping] = useState<ShippingOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShipping(getMockShippingOrder(shippingId));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [shippingId]);

  if (loading) return <DetailSkeleton />;

  if (!shipping) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <Truck className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy vận đơn</p>
        <Button
          variant="outline"
          onClick={() => router.push("/don-hang/van-don")}
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
              onClick={() => router.push("/don-hang/van-don")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">
                  {shipping.code}
                </h1>
                {getStatusBadge(shipping.status, shipping.statusName)}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                {shipping.deliveryPartner} · {shipping.trackingCode} ·{" "}
                {formatDate(shipping.date)}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In vận đơn
            </Button>
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 mr-1.5" />
              Xem hóa đơn
            </Button>
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
        {/* Shipping Progress */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tiến trình giao hàng</CardTitle>
          </CardHeader>
          <CardContent>
            {getShippingStatusStep(shipping.status)}
          </CardContent>
        </Card>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Card 1: Thông tin vận đơn */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Truck className="h-4 w-4 text-primary" />
                Thông tin vận đơn
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã vận đơn" value={shipping.code} />
              <Separator />
              <InfoRow
                label="Mã tracking"
                value={
                  <span className="text-primary font-mono text-xs">
                    {shipping.trackingCode}
                  </span>
                }
              />
              <Separator />
              <InfoRow label="Đối tác giao" value={shipping.deliveryPartner} />
              <Separator />
              <InfoRow label="Ngày tạo" value={formatDate(shipping.date)} />
              <Separator />
              <InfoRow
                label="Trạng thái"
                value={getStatusBadge(shipping.status, shipping.statusName)}
              />
              <Separator />
              <InfoRow
                label="Hóa đơn liên kết"
                value={
                  <span className="text-primary">
                    {shipping.linkedInvoiceCode}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Dự kiến giao"
                value={formatDate(shipping.estimatedDelivery)}
              />
            </CardContent>
          </Card>

          {/* Card 2: Người nhận */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Người nhận
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Họ tên" value={shipping.receiverName} />
              <Separator />
              <InfoRow
                label="SĐT"
                value={
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {shipping.receiverPhone}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Địa chỉ"
                value={
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-right">{shipping.receiverAddress}</span>
                  </span>
                }
              />
              {shipping.note && (
                <>
                  <Separator />
                  <InfoRow label="Ghi chú" value={shipping.note} />
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Phí & COD */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Phí & COD
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Tiền thu hộ (COD)"
                value={
                  <span className="text-base font-bold text-primary">
                    {formatCurrency(shipping.codAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Phí vận chuyển"
                value={
                  <span className="font-bold">
                    {formatCurrency(shipping.shippingFee)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Trọng lượng"
                value={`${(shipping.weight / 1000).toFixed(1)} kg`}
              />
              <Separator />
              <InfoRow label="Người tạo" value={shipping.createdBy} />
            </CardContent>
          </Card>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Tiền thu hộ</p>
            <p className="text-lg font-bold text-blue-700">
              {formatCurrency(shipping.codAmount)}
            </p>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Phí ship</p>
            <p className="text-lg font-bold text-orange-700">
              {formatCurrency(shipping.shippingFee)}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Trọng lượng</p>
            <p className="text-lg font-bold text-green-700">
              {(shipping.weight / 1000).toFixed(1)} kg
            </p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Đối tác</p>
            <p className="text-sm font-bold text-purple-700">
              {shipping.deliveryPartner}
            </p>
          </div>
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Lịch sử vận chuyển</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {shipping.timeline.map((item, idx) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineIcon status={item.status} />
                    {idx < shipping.timeline.length - 1 && (
                      <div className="w-px h-full bg-border mt-1" />
                    )}
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-medium">{item.status}</p>
                    {item.location && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {item.location}
                      </p>
                    )}
                    {item.note && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.note}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(item.date)}
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
