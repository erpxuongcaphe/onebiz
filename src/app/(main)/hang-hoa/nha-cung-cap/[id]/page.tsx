"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  Edit3,
  Printer,
  Trash2,
  Phone,
  Mail,
  MapPin,
  MoreHorizontal,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/shared/data-table";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";
import type { SupplierDetail, PurchaseHistoryItem, PaymentHistoryItem, ReturnHistoryItem } from "@/lib/types";

// === Mock Data ===
const mockSuppliers: Record<string, SupplierDetail> = {
  sup_1: {
    id: "sup_1",
    code: "NCC001",
    name: "Công ty TNHH Thực phẩm Hoàng Gia",
    phone: "0912345678",
    email: "contact@hoanggia.vn",
    address: "123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
    taxCode: "0301234567",
    currentDebt: 15200000,
    totalPurchases: 245600000,
    totalPaid: 230400000,
    createdAt: "2024-03-15T08:00:00Z",
  },
  sup_2: {
    id: "sup_2",
    code: "NCC002",
    name: "Công ty CP Đồ uống Minh Tâm",
    phone: "0987654321",
    email: "info@minhtam.com",
    address: "456 Lê Lợi, Quận 3, TP. Hồ Chí Minh",
    taxCode: "0309876543",
    currentDebt: 8500000,
    totalPurchases: 189300000,
    totalPaid: 180800000,
    createdAt: "2024-05-20T10:30:00Z",
  },
};

function generatePurchaseHistory(): PurchaseHistoryItem[] {
  const creators = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C"];
  const statuses: { status: PurchaseHistoryItem["status"]; name: string }[] = [
    { status: "imported", name: "Đã nhập" },
    { status: "imported", name: "Đã nhập" },
    { status: "imported", name: "Đã nhập" },
    { status: "draft", name: "Phiếu tạm" },
    { status: "cancelled", name: "Đã hủy" },
  ];
  return Array.from({ length: 10 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 90) + 1;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const s = statuses[Math.floor(Math.random() * statuses.length)];
    return {
      id: `ph_${i + 1}`,
      code: `PN${String(2000 + i).padStart(5, "0")}`,
      date: date.toISOString(),
      totalAmount: Math.floor(Math.random() * 30000000) + 1000000,
      status: s.status,
      statusName: s.name,
      itemCount: Math.floor(Math.random() * 15) + 1,
      createdBy: creators[Math.floor(Math.random() * creators.length)],
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function generatePaymentHistory(): PaymentHistoryItem[] {
  const creators = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C"];
  const methods = ["Tiền mặt", "Chuyển khoản", "Tiền mặt", "Chuyển khoản"];
  return Array.from({ length: 8 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 90) + 1;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
      id: `pay_${i + 1}`,
      code: `PT${String(3000 + i).padStart(5, "0")}`,
      date: date.toISOString(),
      amount: Math.floor(Math.random() * 20000000) + 500000,
      method: methods[Math.floor(Math.random() * methods.length)],
      note: i % 3 === 0 ? "Thanh toán đợt " + (i + 1) : undefined,
      createdBy: creators[Math.floor(Math.random() * creators.length)],
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function generateReturnHistory(): ReturnHistoryItem[] {
  const creators = ["Nguyễn Văn A", "Trần Thị B"];
  return Array.from({ length: 8 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 120) + 1;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const isCancelled = i === 5;
    return {
      id: `ret_${i + 1}`,
      code: `TN${String(4000 + i).padStart(5, "0")}`,
      date: date.toISOString(),
      originalCode: `PN${String(2000 + i).padStart(5, "0")}`,
      totalAmount: Math.floor(Math.random() * 5000000) + 200000,
      status: (isCancelled ? "cancelled" : "completed") as ReturnHistoryItem["status"],
      statusName: isCancelled ? "Đã hủy" : "Hoàn thành",
      itemCount: Math.floor(Math.random() * 5) + 1,
      createdBy: creators[Math.floor(Math.random() * creators.length)],
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const purchaseHistory = generatePurchaseHistory();
const paymentHistory = generatePaymentHistory();
const returnHistory = generateReturnHistory();

// === Column Definitions ===
const purchaseColumns: ColumnDef<PurchaseHistoryItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu nhập",
    size: 140,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "date",
    header: "Ngày nhập",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    accessorKey: "itemCount",
    header: "Số mặt hàng",
    size: 100,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => (
      <span className="font-medium">{formatCurrency(row.original.totalAmount)}</span>
    ),
  },
  {
    accessorKey: "statusName",
    header: "Trạng thái",
    size: 120,
    cell: ({ row }) => {
      const s = row.original.status;
      const variant =
        s === "imported" ? "default" : s === "cancelled" ? "destructive" : "secondary";
      return <Badge variant={variant}>{row.original.statusName}</Badge>;
    },
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

const paymentColumns: ColumnDef<PaymentHistoryItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu chi",
    size: 140,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "date",
    header: "Ngày thanh toán",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    accessorKey: "amount",
    header: "Số tiền",
    cell: ({ row }) => (
      <span className="font-medium text-green-600">
        {formatCurrency(row.original.amount)}
      </span>
    ),
  },
  {
    accessorKey: "method",
    header: "Phương thức",
    size: 130,
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.method}</Badge>
    ),
  },
  {
    accessorKey: "note",
    header: "Ghi chú",
    size: 180,
    cell: ({ row }) => row.original.note || "—",
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

const returnColumns: ColumnDef<ReturnHistoryItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu trả",
    size: 140,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "originalCode",
    header: "Phiếu nhập gốc",
    size: 140,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.originalCode}</span>
    ),
  },
  {
    accessorKey: "date",
    header: "Ngày trả",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    accessorKey: "itemCount",
    header: "Số mặt hàng",
    size: 100,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => (
      <span className="font-medium">{formatCurrency(row.original.totalAmount)}</span>
    ),
  },
  {
    accessorKey: "statusName",
    header: "Trạng thái",
    size: 120,
    cell: ({ row }) => {
      const s = row.original.status;
      const variant = s === "completed" ? "default" : "destructive";
      return <Badge variant={variant}>{row.original.statusName}</Badge>;
    },
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

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

// === Main Component ===
export default function ChiTietNhaCungCapPage() {
  const params = useParams();
  const router = useRouter();
  const supplierId = params.id as string;

  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("purchases");

  const [purchasePage, setPurchasePage] = useState(0);
  const [purchasePageSize, setPurchasePageSize] = useState(20);
  const [paymentPage, setPaymentPage] = useState(0);
  const [paymentPageSize, setPaymentPageSize] = useState(20);
  const [returnPage, setReturnPage] = useState(0);
  const [returnPageSize, setReturnPageSize] = useState(20);

  useEffect(() => {
    const timer = setTimeout(() => {
      const data = mockSuppliers[supplierId] || mockSuppliers["sup_1"];
      if (mockSuppliers[supplierId]) {
        setSupplier(data);
      } else {
        // Simulate finding by any ID
        setSupplier({ ...mockSuppliers["sup_1"], id: supplierId });
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [supplierId]);

  if (loading) return <DetailSkeleton />;

  if (!supplier) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <Building2 className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy nhà cung cấp</p>
        <Button
          variant="outline"
          onClick={() => router.push("/hang-hoa/nha-cung-cap")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  const paginatedPurchases = purchaseHistory.slice(
    purchasePage * purchasePageSize,
    purchasePage * purchasePageSize + purchasePageSize
  );
  const paginatedPayments = paymentHistory.slice(
    paymentPage * paymentPageSize,
    paymentPage * paymentPageSize + paymentPageSize
  );
  const paginatedReturns = returnHistory.slice(
    returnPage * returnPageSize,
    returnPage * returnPageSize + returnPageSize
  );

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
              onClick={() => router.push("/hang-hoa/nha-cung-cap")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">
                  {supplier.name}
                </h1>
                <Badge variant="outline" className="shrink-0">
                  {supplier.code}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                Nhà cung cấp · {supplier.phone} · Tạo{" "}
                {formatShortDate(supplier.createdAt)}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In
            </Button>
            <Button size="sm">
              <Edit3 className="h-4 w-4 mr-1.5" />
              Cập nhật
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex md:hidden items-center gap-1">
            <Button size="sm">
              <Edit3 className="h-4 w-4" />
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
          {/* Card 1: Thông tin chung */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-primary" />
                Thông tin chung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã NCC" value={supplier.code} />
              <Separator />
              <InfoRow label="Tên NCC" value={supplier.name} />
              <Separator />
              <InfoRow
                label="SĐT"
                value={
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {supplier.phone}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Email"
                value={
                  supplier.email ? (
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {supplier.email}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <Separator />
              <InfoRow
                label="Địa chỉ"
                value={
                  supplier.address ? (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-right">{supplier.address}</span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <Separator />
              <InfoRow label="Mã số thuế" value={supplier.taxCode || "—"} />
            </CardContent>
          </Card>

          {/* Card 2: Công nợ */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Công nợ
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Nợ hiện tại"
                value={
                  <span
                    className={`text-base font-bold ${
                      supplier.currentDebt > 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatCurrency(supplier.currentDebt)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Tổng mua hàng"
                value={
                  <span className="font-bold text-primary">
                    {formatCurrency(supplier.totalPurchases)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Tổng đã trả"
                value={
                  <span className="text-green-600 font-bold">
                    {formatCurrency(supplier.totalPaid)}
                  </span>
                }
              />
            </CardContent>
          </Card>

          {/* Card 3: Thống kê */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Thống kê
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Số phiếu nhập"
                value={
                  <span className="font-bold">{purchaseHistory.length}</span>
                }
              />
              <Separator />
              <InfoRow
                label="Số phiếu trả"
                value={
                  <span className="font-bold">{returnHistory.length}</span>
                }
              />
              <Separator />
              <InfoRow
                label="Lần nhập cuối"
                value={
                  purchaseHistory.length > 0
                    ? formatShortDate(purchaseHistory[0].date)
                    : "—"
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Tổng mua</p>
            <p className="text-lg font-bold text-blue-700">
              {formatCurrency(supplier.totalPurchases)}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Nợ hiện tại</p>
            <p className="text-lg font-bold text-red-700">
              {formatCurrency(supplier.currentDebt)}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Đã trả</p>
            <p className="text-lg font-bold text-green-700">
              {formatCurrency(supplier.totalPaid)}
            </p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Phiếu nhập</p>
            <p className="text-lg font-bold text-purple-700">
              {purchaseHistory.length}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v ?? activeTab)}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="purchases" className="gap-1.5">
              Nhập hàng
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {purchaseHistory.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5">
              Thanh toán
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {paymentHistory.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="returns" className="gap-1.5">
              Trả hàng nhập
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {returnHistory.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="purchases" className="mt-4">
            <DataTable
              columns={purchaseColumns}
              data={paginatedPurchases}
              loading={false}
              total={purchaseHistory.length}
              pageIndex={purchasePage}
              pageSize={purchasePageSize}
              pageCount={Math.ceil(purchaseHistory.length / purchasePageSize)}
              onPageChange={setPurchasePage}
              onPageSizeChange={(size) => {
                setPurchasePageSize(size);
                setPurchasePage(0);
              }}
            />
          </TabsContent>

          <TabsContent value="payments" className="mt-4">
            <DataTable
              columns={paymentColumns}
              data={paginatedPayments}
              loading={false}
              total={paymentHistory.length}
              pageIndex={paymentPage}
              pageSize={paymentPageSize}
              pageCount={Math.ceil(paymentHistory.length / paymentPageSize)}
              onPageChange={setPaymentPage}
              onPageSizeChange={(size) => {
                setPaymentPageSize(size);
                setPaymentPage(0);
              }}
            />
          </TabsContent>

          <TabsContent value="returns" className="mt-4">
            <DataTable
              columns={returnColumns}
              data={paginatedReturns}
              loading={false}
              total={returnHistory.length}
              pageIndex={returnPage}
              pageSize={returnPageSize}
              pageCount={Math.ceil(returnHistory.length / returnPageSize)}
              onPageChange={setReturnPage}
              onPageSizeChange={(size) => {
                setReturnPageSize(size);
                setReturnPage(0);
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
