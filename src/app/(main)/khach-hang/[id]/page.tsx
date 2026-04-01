"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Phone,
  Mail,
  MapPin,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/shared/data-table";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";
import { getCustomerById } from "@/lib/services";
import type { Customer, PurchaseHistory } from "@/lib/types";

// === Generate mock purchase history ===
function generatePurchaseHistory(): PurchaseHistory[] {
  const creators = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"];
  const statuses: {
    status: PurchaseHistory["status"];
    name: string;
  }[] = [
    { status: "completed", name: "Hoàn thành" },
    { status: "completed", name: "Hoàn thành" },
    { status: "completed", name: "Hoàn thành" },
    { status: "cancelled", name: "Đã hủy" },
    { status: "returned", name: "Đã trả hàng" },
  ];

  return Array.from({ length: 15 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 90) + 1;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const s = statuses[Math.floor(Math.random() * statuses.length)];
    return {
      id: `ph_${i + 1}`,
      invoiceCode: `HD${String(1000 + i).padStart(5, "0")}`,
      date: date.toISOString(),
      totalAmount: Math.floor(Math.random() * 5000000) + 200000,
      status: s.status,
      statusName: s.name,
      createdBy: creators[Math.floor(Math.random() * creators.length)],
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const purchaseHistory = generatePurchaseHistory();

// === Purchase History Columns ===
const purchaseColumns: ColumnDef<PurchaseHistory, unknown>[] = [
  {
    accessorKey: "invoiceCode",
    header: "Mã hóa đơn",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">
        {row.original.invoiceCode}
      </span>
    ),
  },
  {
    accessorKey: "date",
    header: "Ngày",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
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
        s === "completed"
          ? "default"
          : s === "cancelled"
          ? "destructive"
          : "secondary";
      return <Badge variant={variant}>{row.original.statusName}</Badge>;
    },
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

// === Info Row Component ===
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

// === Loading Skeleton ===
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

export default function ChiTietKhachHangPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("history");

  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      const data = await getCustomerById(customerId);
      setCustomer(data);
      setLoading(false);
    }
    fetch();
  }, [customerId]);

  if (loading) return <DetailSkeleton />;

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <Phone className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy khách hàng</p>
        <Button variant="outline" onClick={() => router.push("/khach-hang")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  const mockOrderCount = Math.floor(Math.random() * 50) + 5;
  const totalPurchases = purchaseHistory
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + p.totalAmount, 0);

  const paginatedHistory = purchaseHistory.slice(
    page * pageSize,
    page * pageSize + pageSize
  );

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      {/* === Header === */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => router.push("/khach-hang")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">
                  {customer.name}
                </h1>
                <Badge variant="outline" className="shrink-0">
                  {customer.code}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                {customer.type === "company" ? "Doanh nghiệp" : "Cá nhân"} ·{" "}
                {customer.phone} · Tạo {formatShortDate(customer.createdAt)}
              </p>
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-2">
            <Button size="sm">
              <Edit3 className="h-4 w-4 mr-1.5" />
              Cập nhật
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Mobile Actions */}
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

      {/* === Content === */}
      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* Info Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Card 1: Thông tin chung */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Thông tin chung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã KH" value={customer.code} />
              <Separator />
              <InfoRow
                label="Loại KH"
                value={
                  <Badge variant="secondary">
                    {customer.type === "company" ? "Doanh nghiệp" : "Cá nhân"}
                  </Badge>
                }
              />
              <Separator />
              <InfoRow
                label="Giới tính"
                value={
                  customer.gender === "male"
                    ? "Nam"
                    : customer.gender === "female"
                    ? "Nữ"
                    : "—"
                }
              />
              <Separator />
              <InfoRow
                label="Nhóm KH"
                value={customer.groupName || "—"}
              />
              <Separator />
              <InfoRow
                label="SĐT"
                value={
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {customer.phone}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Email"
                value={
                  customer.email ? (
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {customer.email}
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
                  customer.address ? (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-right">{customer.address}</span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
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
                      customer.currentDebt > 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatCurrency(customer.currentDebt)}
                  </span>
                }
              />
              <Separator />
              <InfoRow label="Hạn mức nợ" value="—" />
            </CardContent>
          </Card>

          {/* Card 3: Doanh số */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Doanh số
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Tổng bán hàng"
                value={
                  <span className="font-bold text-primary">
                    {formatCurrency(customer.totalSales)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Tổng bán trừ trả hàng"
                value={formatCurrency(customer.totalSalesMinusReturns)}
              />
              <Separator />
              <InfoRow label="Số đơn hàng" value={mockOrderCount} />
            </CardContent>
          </Card>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Tổng mua</p>
            <p className="text-lg font-bold text-blue-700">
              {formatCurrency(customer.totalSales)}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Nợ hiện tại</p>
            <p className="text-lg font-bold text-red-700">
              {formatCurrency(customer.currentDebt)}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Số đơn</p>
            <p className="text-lg font-bold text-green-700">{mockOrderCount}</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Ngày tạo</p>
            <p className="text-lg font-bold text-purple-700">
              {formatShortDate(customer.createdAt)}
            </p>
          </div>
        </div>

        {/* Tabs: Lịch sử mua hàng */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v ?? activeTab)}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="history" className="gap-1.5">
              Lịch sử mua hàng
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {purchaseHistory.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="mt-4">
            <DataTable
              columns={purchaseColumns}
              data={paginatedHistory}
              loading={false}
              total={purchaseHistory.length}
              pageIndex={page}
              pageSize={pageSize}
              pageCount={Math.ceil(purchaseHistory.length / pageSize)}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
