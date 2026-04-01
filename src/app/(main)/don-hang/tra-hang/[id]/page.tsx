"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  MoreHorizontal,
  RotateCcw,
  FileText,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ReturnLineItem, StatusChange, ReturnDetail } from "@/lib/types";

// === Mock Data ===
function getMockReturn(id: string): ReturnDetail {
  return {
    id,
    code: "TH00045",
    date: "2026-03-29T15:00:00Z",
    originalInvoiceCode: "HD00123",
    status: "completed",
    statusName: "Hoàn thành",
    customerId: "cus_1",
    customerCode: "KH001",
    customerName: "Nguyễn Thị Mai",
    customerPhone: "0912345678",
    items: [
      {
        id: "ri_1",
        productCode: "SP002",
        productName: "Mì tôm Hảo Hảo thùng 30 gói",
        quantity: 2,
        unitPrice: 120000,
        total: 240000,
        unit: "thùng",
        reason: "Hàng bị ẩm, hết hạn sử dụng",
      },
      {
        id: "ri_2",
        productCode: "SP004",
        productName: "Sữa tươi TH True Milk 1L",
        quantity: 3,
        unitPrice: 32000,
        total: 96000,
        unit: "hộp",
        reason: "Hộp bị móp, rỉ nước",
      },
      {
        id: "ri_3",
        productCode: "SP001",
        productName: "Nước ngọt Coca Cola 330ml",
        quantity: 6,
        unitPrice: 8000,
        total: 48000,
        unit: "lon",
        reason: "Lon bị méo, không bán được",
      },
      {
        id: "ri_4",
        productCode: "SP005",
        productName: "Gạo ST25 túi 5kg",
        quantity: 1,
        unitPrice: 125000,
        total: 125000,
        unit: "túi",
        reason: "Bao bì rách, bị mối mọt",
      },
    ],
    totalReturnAmount: 509000,
    refundAmount: 509000,
    refundMethod: "Tiền mặt",
    note: "Khách trả hàng do lỗi sản phẩm, đã kiểm tra và xác nhận",
    createdBy: "Nguyễn Văn A",
    createdAt: "2026-03-29T15:00:00Z",
    timeline: [
      {
        id: "rtl_1",
        date: "2026-03-29T15:00:00Z",
        status: "Tạo phiếu trả hàng",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "rtl_2",
        date: "2026-03-29T15:10:00Z",
        status: "Kiểm tra hàng trả",
        note: "Đã xác nhận tình trạng hàng lỗi",
        createdBy: "Trần Thị B",
      },
      {
        id: "rtl_3",
        date: "2026-03-29T15:20:00Z",
        status: "Đã hoàn tiền",
        note: "Hoàn tiền mặt 509,000đ",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "rtl_4",
        date: "2026-03-29T15:22:00Z",
        status: "Hoàn thành",
        createdBy: "Nguyễn Văn A",
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

function getStatusBadge(status: ReturnDetail["status"], statusName: string) {
  const variant =
    status === "completed"
      ? "default"
      : status === "cancelled"
      ? "destructive"
      : "secondary";
  return <Badge variant={variant}>{statusName}</Badge>;
}

function TimelineIcon({ status }: { status: string }) {
  if (status.includes("Hoàn thành") || status.includes("hoàn tiền"))
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// === Main Component ===
export default function ChiTietTraHangPage() {
  const params = useParams();
  const router = useRouter();
  const returnId = params.id as string;

  const [returnOrder, setReturnOrder] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setReturnOrder(getMockReturn(returnId));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [returnId]);

  if (loading) return <DetailSkeleton />;

  if (!returnOrder) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <RotateCcw className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy phiếu trả hàng</p>
        <Button
          variant="outline"
          onClick={() => router.push("/don-hang/tra-hang")}
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
              onClick={() => router.push("/don-hang/tra-hang")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">
                  {returnOrder.code}
                </h1>
                {getStatusBadge(returnOrder.status, returnOrder.statusName)}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                Trả từ {returnOrder.originalInvoiceCode} · {returnOrder.customerName} ·{" "}
                {formatDate(returnOrder.date)}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In phiếu
            </Button>
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 mr-1.5" />
              Xem hóa đơn gốc
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
        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Card 1: Thông tin trả hàng */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <RotateCcw className="h-4 w-4 text-primary" />
                Thông tin trả hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã phiếu trả" value={returnOrder.code} />
              <Separator />
              <InfoRow
                label="Hóa đơn gốc"
                value={
                  <span className="text-primary">
                    {returnOrder.originalInvoiceCode}
                  </span>
                }
              />
              <Separator />
              <InfoRow label="Ngày trả" value={formatDate(returnOrder.date)} />
              <Separator />
              <InfoRow
                label="Trạng thái"
                value={getStatusBadge(returnOrder.status, returnOrder.statusName)}
              />
              <Separator />
              <InfoRow label="Người tạo" value={returnOrder.createdBy} />
            </CardContent>
          </Card>

          {/* Card 2: Khách hàng */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Khách hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Tên KH" value={returnOrder.customerName} />
              <Separator />
              <InfoRow label="Mã KH" value={returnOrder.customerCode} />
              <Separator />
              <InfoRow label="SĐT" value={returnOrder.customerPhone} />
              {returnOrder.note && (
                <>
                  <Separator />
                  <InfoRow label="Ghi chú" value={returnOrder.note} />
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Hoàn tiền */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Hoàn tiền
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Tổng tiền trả"
                value={
                  <span className="text-base font-bold text-primary">
                    {formatCurrency(returnOrder.totalReturnAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Đã hoàn"
                value={
                  <span className="text-green-600 font-bold">
                    {formatCurrency(returnOrder.refundAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Phương thức"
                value={
                  <Badge variant="outline">{returnOrder.refundMethod}</Badge>
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Returned Items */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Hàng trả lại ({returnOrder.items.length} sản phẩm)
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
                    <th className="text-right py-2 pr-2 font-medium">Thành tiền</th>
                    <th className="text-left py-2 font-medium">Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {returnOrder.items.map((item, idx) => (
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
                      <td className="py-2.5 pr-2 text-right font-medium">
                        {formatCurrency(item.total)}
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground max-w-[200px]">
                        {item.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td
                      colSpan={5}
                      className="py-2.5 text-right font-bold text-base"
                    >
                      Tổng hoàn tiền:
                    </td>
                    <td className="py-2.5 text-right font-bold text-base text-primary">
                      {formatCurrency(returnOrder.totalReturnAmount)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Lịch sử xử lý</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {returnOrder.timeline.map((item, idx) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineIcon status={item.status} />
                    {idx < returnOrder.timeline.length - 1 && (
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
