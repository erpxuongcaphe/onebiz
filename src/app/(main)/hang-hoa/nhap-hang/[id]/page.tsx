"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  Edit3,
  MoreHorizontal,
  Package,
  Clock,
  CheckCircle2,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";
import type { POLineItem, ImportHistory, PurchaseOrderDetail } from "@/lib/types";

// === Mock Data ===
function getMockPO(id: string): PurchaseOrderDetail {
  return {
    id,
    code: "PN00456",
    orderCode: "DDH00123",
    date: "2026-03-25T09:00:00Z",
    status: "imported",
    statusName: "Đã nhập hàng",
    supplierId: "sup_1",
    supplierCode: "NCC001",
    supplierName: "Công ty TNHH Thực phẩm Hoàng Gia",
    supplierPhone: "0912345678",
    items: [
      {
        id: "poi_1",
        productCode: "SP001",
        productName: "Nước ngọt Coca Cola 330ml (thùng 24 lon)",
        quantity: 50,
        costPrice: 165000,
        total: 8250000,
        unit: "thùng",
      },
      {
        id: "poi_2",
        productCode: "SP002",
        productName: "Mì tôm Hảo Hảo thùng 30 gói",
        quantity: 100,
        costPrice: 95000,
        total: 9500000,
        unit: "thùng",
      },
      {
        id: "poi_3",
        productCode: "SP003",
        productName: "Dầu ăn Tường An 5L",
        quantity: 30,
        costPrice: 120000,
        total: 3600000,
        unit: "chai",
      },
      {
        id: "poi_4",
        productCode: "SP004",
        productName: "Gạo ST25 túi 5kg",
        quantity: 80,
        costPrice: 95000,
        total: 7600000,
        unit: "túi",
      },
      {
        id: "poi_5",
        productCode: "SP005",
        productName: "Sữa tươi TH True Milk 1L",
        quantity: 200,
        costPrice: 25000,
        total: 5000000,
        unit: "hộp",
      },
    ],
    totalAmount: 33950000,
    paidAmount: 20000000,
    remaining: 13950000,
    note: "Nhập hàng đợt tháng 3/2026",
    createdBy: "Trần Thị B",
    importedBy: "Nguyễn Văn A",
    createdAt: "2026-03-25T09:00:00Z",
    timeline: [
      {
        id: "th_1",
        date: "2026-03-25T09:00:00Z",
        status: "Tạo phiếu nhập",
        createdBy: "Trần Thị B",
      },
      {
        id: "th_2",
        date: "2026-03-25T14:00:00Z",
        status: "Kiểm hàng",
        note: "Đã kiểm đủ số lượng",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "th_3",
        date: "2026-03-25T15:30:00Z",
        status: "Đã nhập kho",
        note: "Nhập kho chính",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "th_4",
        date: "2026-03-26T08:00:00Z",
        status: "Thanh toán đợt 1",
        note: "Chuyển khoản 20,000,000đ",
        createdBy: "Trần Thị B",
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

function getStatusBadge(status: PurchaseOrderDetail["status"], statusName: string) {
  const variant =
    status === "imported"
      ? "default"
      : status === "cancelled"
      ? "destructive"
      : "secondary";
  return <Badge variant={variant}>{statusName}</Badge>;
}

function TimelineIcon({ status }: { status: string }) {
  if (status.includes("nhập") || status.includes("Nhập"))
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status.includes("hủy") || status.includes("Hủy"))
    return <Ban className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// === Main Component ===
export default function ChiTietPhieuNhapPage() {
  const params = useParams();
  const router = useRouter();
  const poId = params.id as string;

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPo(getMockPO(poId));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [poId]);

  if (loading) return <DetailSkeleton />;

  if (!po) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <Package className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy phiếu nhập hàng</p>
        <Button
          variant="outline"
          onClick={() => router.push("/hang-hoa/nhap-hang")}
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
              onClick={() => router.push("/hang-hoa/nhap-hang")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">{po.code}</h1>
                {getStatusBadge(po.status, po.statusName)}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                {po.supplierName} · {formatDate(po.date)} · {po.createdBy}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In phiếu
            </Button>
            {po.status === "draft" && (
              <Button size="sm">
                <Edit3 className="h-4 w-4 mr-1.5" />
                Cập nhật
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
          {/* Card 1: Thông tin phiếu nhập */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4 text-primary" />
                Thông tin phiếu nhập
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã phiếu nhập" value={po.code} />
              <Separator />
              {po.orderCode && (
                <>
                  <InfoRow
                    label="Mã đặt hàng"
                    value={
                      <span className="text-primary">{po.orderCode}</span>
                    }
                  />
                  <Separator />
                </>
              )}
              <InfoRow label="Ngày nhập" value={formatDate(po.date)} />
              <Separator />
              <InfoRow
                label="Trạng thái"
                value={getStatusBadge(po.status, po.statusName)}
              />
              <Separator />
              <InfoRow label="Người tạo" value={po.createdBy} />
              {po.importedBy && (
                <>
                  <Separator />
                  <InfoRow label="Người nhập" value={po.importedBy} />
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Nhà cung cấp */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Nhà cung cấp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Tên NCC" value={po.supplierName} />
              <Separator />
              <InfoRow label="Mã NCC" value={po.supplierCode} />
              <Separator />
              <InfoRow label="SĐT" value={po.supplierPhone} />
              {po.note && (
                <>
                  <Separator />
                  <InfoRow label="Ghi chú" value={po.note} />
                </>
              )}
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
                label="Tổng tiền hàng"
                value={
                  <span className="text-base font-bold text-primary">
                    {formatCurrency(po.totalAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Đã thanh toán"
                value={
                  <span className="text-green-600 font-bold">
                    {formatCurrency(po.paidAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Còn nợ NCC"
                value={
                  <span
                    className={`font-bold ${
                      po.remaining > 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatCurrency(po.remaining)}
                  </span>
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Tổng tiền hàng</p>
            <p className="text-lg font-bold text-blue-700">
              {formatCurrency(po.totalAmount)}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Đã trả</p>
            <p className="text-lg font-bold text-green-700">
              {formatCurrency(po.paidAmount)}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Còn nợ</p>
            <p className="text-lg font-bold text-red-700">
              {formatCurrency(po.remaining)}
            </p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Số mặt hàng</p>
            <p className="text-lg font-bold text-purple-700">
              {po.items.length}
            </p>
          </div>
        </div>

        {/* Item List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Danh sách hàng hóa ({po.items.length} sản phẩm)
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
                  {po.items.map((item, idx) => (
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
                        {formatCurrency(item.costPrice)}
                      </td>
                      <td className="py-2.5 text-right font-medium">
                        {formatCurrency(item.total)}
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
                      Tổng cộng:
                    </td>
                    <td className="py-2.5 text-right font-bold text-base text-primary">
                      {formatCurrency(po.totalAmount)}
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
            <CardTitle className="text-sm">Lịch sử nhập hàng</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {po.timeline.map((item, idx) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineIcon status={item.status} />
                    {idx < po.timeline.length - 1 && (
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
