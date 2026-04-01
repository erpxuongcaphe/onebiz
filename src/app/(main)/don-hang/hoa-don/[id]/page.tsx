"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  XCircle,
  RotateCcw,
  MoreHorizontal,
  FileText,
  Clock,
  CheckCircle2,
  Ban,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";
import type { InvoiceLineItem, StatusChange, InvoiceDetail } from "@/lib/types";

// === Mock Data ===
function getMockInvoice(id: string): InvoiceDetail {
  return {
    id,
    code: "HD00123",
    date: "2026-03-28T14:30:00Z",
    status: "completed",
    statusName: "Hoàn thành",
    customerId: "cus_1",
    customerCode: "KH001",
    customerName: "Nguyễn Thị Mai",
    customerPhone: "0912345678",
    items: [
      {
        id: "li_1",
        productCode: "SP001",
        productName: "Nước ngọt Coca Cola 330ml",
        quantity: 24,
        unitPrice: 8000,
        discount: 0,
        total: 192000,
        unit: "lon",
      },
      {
        id: "li_2",
        productCode: "SP002",
        productName: "Mì tôm Hảo Hảo thùng 30 gói",
        quantity: 5,
        unitPrice: 120000,
        discount: 10000,
        total: 590000,
        unit: "thùng",
      },
      {
        id: "li_3",
        productCode: "SP003",
        productName: "Dầu ăn Tường An 5L",
        quantity: 2,
        unitPrice: 145000,
        discount: 0,
        total: 290000,
        unit: "chai",
      },
      {
        id: "li_4",
        productCode: "SP004",
        productName: "Sữa tươi TH True Milk 1L",
        quantity: 10,
        unitPrice: 32000,
        discount: 5000,
        total: 315000,
        unit: "hộp",
      },
      {
        id: "li_5",
        productCode: "SP005",
        productName: "Gạo ST25 túi 5kg",
        quantity: 3,
        unitPrice: 125000,
        discount: 0,
        total: 375000,
        unit: "túi",
      },
    ],
    subtotal: 1762000,
    discount: 62000,
    totalAmount: 1700000,
    paidAmount: 1700000,
    remaining: 0,
    paymentMethod: "Tiền mặt",
    deliveryType: "no_delivery",
    note: "Khách quen, giao hàng tại quầy",
    createdBy: "Nguyễn Văn A",
    createdAt: "2026-03-28T14:30:00Z",
    timeline: [
      {
        id: "tl_1",
        date: "2026-03-28T14:30:00Z",
        status: "Tạo hóa đơn",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "tl_2",
        date: "2026-03-28T14:32:00Z",
        status: "Đã thanh toán",
        note: "Thanh toán tiền mặt",
        createdBy: "Nguyễn Văn A",
      },
      {
        id: "tl_3",
        date: "2026-03-28T14:33:00Z",
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

function getStatusBadge(status: InvoiceDetail["status"], statusName: string) {
  const variant =
    status === "completed"
      ? "default"
      : status === "cancelled"
      ? "destructive"
      : status === "delivery_failed"
      ? "destructive"
      : "secondary";
  return <Badge variant={variant}>{statusName}</Badge>;
}

function TimelineIcon({ status }: { status: string }) {
  if (status.includes("Hoàn thành"))
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status.includes("hủy") || status.includes("Hủy"))
    return <Ban className="h-4 w-4 text-destructive" />;
  if (status.includes("giao") || status.includes("Giao"))
    return <Truck className="h-4 w-4 text-blue-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// === Main Component ===
export default function ChiTietHoaDonPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInvoice(getMockInvoice(invoiceId));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [invoiceId]);

  if (loading) return <DetailSkeleton />;

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy hóa đơn</p>
        <Button
          variant="outline"
          onClick={() => router.push("/don-hang/hoa-don")}
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
              onClick={() => router.push("/don-hang/hoa-don")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">
                  {invoice.code}
                </h1>
                {getStatusBadge(invoice.status, invoice.statusName)}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                {invoice.customerName} · {formatDate(invoice.date)} · {invoice.createdBy}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In hóa đơn
            </Button>
            <Button variant="outline" size="sm">
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Trả hàng
            </Button>
            {invoice.status !== "cancelled" && (
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
          {/* Card 1: Thông tin hóa đơn */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-primary" />
                Thông tin hóa đơn
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã hóa đơn" value={invoice.code} />
              <Separator />
              <InfoRow label="Ngày tạo" value={formatDate(invoice.date)} />
              <Separator />
              <InfoRow
                label="Trạng thái"
                value={getStatusBadge(invoice.status, invoice.statusName)}
              />
              <Separator />
              <InfoRow label="Người tạo" value={invoice.createdBy} />
              <Separator />
              <InfoRow
                label="Giao hàng"
                value={
                  <Badge variant="outline">
                    {invoice.deliveryType === "delivery"
                      ? "Có giao hàng"
                      : "Không giao hàng"}
                  </Badge>
                }
              />
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
              <InfoRow label="Tên KH" value={invoice.customerName} />
              <Separator />
              <InfoRow label="Mã KH" value={invoice.customerCode} />
              <Separator />
              <InfoRow label="SĐT" value={invoice.customerPhone} />
              {invoice.note && (
                <>
                  <Separator />
                  <InfoRow label="Ghi chú" value={invoice.note} />
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
                label="Tạm tính"
                value={formatCurrency(invoice.subtotal)}
              />
              <Separator />
              <InfoRow
                label="Giảm giá"
                value={
                  invoice.discount > 0 ? (
                    <span className="text-orange-600">
                      -{formatCurrency(invoice.discount)}
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
                    {formatCurrency(invoice.totalAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Đã thanh toán"
                value={
                  <span className="text-green-600 font-bold">
                    {formatCurrency(invoice.paidAmount)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Còn lại"
                value={
                  <span
                    className={`font-bold ${
                      invoice.remaining > 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatCurrency(invoice.remaining)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Phương thức"
                value={
                  <Badge variant="outline">{invoice.paymentMethod}</Badge>
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Item List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Danh sách hàng hóa ({invoice.items.length} sản phẩm)
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
                    <th className="text-right py-2 pr-2 font-medium">Giảm giá</th>
                    <th className="text-right py-2 font-medium">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, idx) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-2 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2.5 pr-2 text-primary font-medium">
                        {item.productCode}
                      </td>
                      <td className="py-2.5 pr-2">
                        {item.productName}
                        <span className="text-muted-foreground ml-1">({item.unit})</span>
                      </td>
                      <td className="py-2.5 pr-2 text-right">{item.quantity}</td>
                      <td className="py-2.5 pr-2 text-right">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="py-2.5 pr-2 text-right">
                        {item.discount > 0 ? (
                          <span className="text-orange-600">
                            {formatCurrency(item.discount)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 text-right font-medium">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td colSpan={6} className="py-2.5 text-right font-medium">
                      Tạm tính:
                    </td>
                    <td className="py-2.5 text-right font-medium">
                      {formatCurrency(invoice.subtotal)}
                    </td>
                  </tr>
                  {invoice.discount > 0 && (
                    <tr>
                      <td colSpan={6} className="py-1 text-right text-orange-600">
                        Giảm giá:
                      </td>
                      <td className="py-1 text-right text-orange-600">
                        -{formatCurrency(invoice.discount)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td
                      colSpan={6}
                      className="py-2.5 text-right font-bold text-base"
                    >
                      Tổng cộng:
                    </td>
                    <td className="py-2.5 text-right font-bold text-base text-primary">
                      {formatCurrency(invoice.totalAmount)}
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
            <CardTitle className="text-sm">Lịch sử thay đổi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {invoice.timeline.map((item, idx) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineIcon status={item.status} />
                    {idx < invoice.timeline.length - 1 && (
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
