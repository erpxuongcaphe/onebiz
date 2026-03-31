"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  Edit3,
  Printer,
  Copy,
  Trash2,
  Package,
  Barcode,
  ImageIcon,
  TrendingUp,
  TrendingDown,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/shared/data-table";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/format";
import {
  getProductById,
  getStockMovements,
  getSalesHistory,
} from "@/lib/mock/products";
import type { ProductDetail, StockMovement, SalesHistory } from "@/lib/types";

// === Stock Movement Columns ===
const stockColumns: ColumnDef<StockMovement, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "typeName",
    header: "Loại",
    size: 120,
    cell: ({ row }) => {
      const t = row.original.type;
      const variant =
        t === "import"
          ? "default"
          : t === "export"
          ? "destructive"
          : "secondary";
      return <Badge variant={variant}>{row.original.typeName}</Badge>;
    },
  },
  {
    accessorKey: "quantity",
    header: "Số lượng",
    size: 100,
    cell: ({ row }) => {
      const qty = row.original.quantity;
      return (
        <span
          className={
            qty > 0
              ? "text-green-600 font-medium"
              : "text-destructive font-medium"
          }
        >
          {qty > 0 ? `+${qty}` : qty}
        </span>
      );
    },
  },
  {
    accessorKey: "costPrice",
    header: "Đơn giá",
    cell: ({ row }) => formatCurrency(row.original.costPrice),
  },
  {
    accessorKey: "totalAmount",
    header: "Thành tiền",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "supplierName",
    header: "NCC",
    size: 180,
    cell: ({ row }) => row.original.supplierName || "—",
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 130,
  },
  {
    accessorKey: "date",
    header: "Ngày",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
  },
];

// === Sales History Columns ===
const salesColumns: ColumnDef<SalesHistory, unknown>[] = [
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
    accessorKey: "customerName",
    header: "Khách hàng",
    size: 160,
  },
  {
    accessorKey: "quantity",
    header: "SL",
    size: 60,
  },
  {
    accessorKey: "sellPrice",
    header: "Đơn giá",
    cell: ({ row }) => formatCurrency(row.original.sellPrice),
  },
  {
    accessorKey: "discount",
    header: "Giảm giá",
    cell: ({ row }) => {
      const d = row.original.discount;
      return d > 0 ? (
        <span className="text-orange-600">{formatCurrency(d)}</span>
      ) : (
        "—"
      );
    },
  },
  {
    accessorKey: "totalAmount",
    header: "Thành tiền",
    cell: ({ row }) => (
      <span className="font-medium">{formatCurrency(row.original.totalAmount)}</span>
    ),
  },
  {
    accessorKey: "statusName",
    header: "Trạng thái",
    size: 110,
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
    header: "Người bán",
    size: 130,
  },
  {
    accessorKey: "date",
    header: "Ngày",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
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

export default function ChiTietHangHoaPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("stock");

  // Stock movements state
  const [stockData, setStockData] = useState<StockMovement[]>([]);
  const [stockTotal, setStockTotal] = useState(0);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockPage, setStockPage] = useState(0);
  const [stockPageSize, setStockPageSize] = useState(20);

  // Sales history state
  const [salesData, setSalesData] = useState<SalesHistory[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesPage, setSalesPage] = useState(0);
  const [salesPageSize, setSalesPageSize] = useState(20);

  // Fetch product
  useEffect(() => {
    async function fetch() {
      setLoading(true);
      const data = await getProductById(productId);
      setProduct(data);
      setLoading(false);
    }
    fetch();
  }, [productId]);

  // Fetch stock movements
  const fetchStockMovements = useCallback(async () => {
    setStockLoading(true);
    const result = await getStockMovements(productId, {
      page: stockPage,
      pageSize: stockPageSize,
    });
    setStockData(result.data);
    setStockTotal(result.total);
    setStockLoading(false);
  }, [productId, stockPage, stockPageSize]);

  // Fetch sales history
  const fetchSalesHistory = useCallback(async () => {
    setSalesLoading(true);
    const result = await getSalesHistory(productId, {
      page: salesPage,
      pageSize: salesPageSize,
    });
    setSalesData(result.data);
    setSalesTotal(result.total);
    setSalesLoading(false);
  }, [productId, salesPage, salesPageSize]);

  useEffect(() => {
    fetchStockMovements();
  }, [fetchStockMovements]);

  useEffect(() => {
    fetchSalesHistory();
  }, [fetchSalesHistory]);

  if (loading) return <DetailSkeleton />;

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <Package className="h-16 w-16 text-muted-foreground" />
        <p className="text-lg font-medium">Không tìm thấy sản phẩm</p>
        <Button variant="outline" onClick={() => router.push("/hang-hoa")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  const profit = product.sellPrice - product.costPrice;
  const profitMargin =
    product.sellPrice > 0
      ? ((profit / product.sellPrice) * 100).toFixed(1)
      : "0";
  const inventoryValue = product.stock * product.costPrice;

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
              onClick={() => router.push("/hang-hoa")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold truncate">
                  {product.name}
                </h1>
                <Badge variant="outline" className="shrink-0">
                  {product.code}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                {product.categoryName} · {product.unit} · Tạo{" "}
                {formatShortDate(product.createdAt)}
              </p>
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              In mã vạch
            </Button>
            <Button variant="outline" size="sm">
              <Copy className="h-4 w-4 mr-1.5" />
              Sao chép
            </Button>
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
          {/* Card 1: Thông tin cơ bản */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4 text-primary" />
                Thông tin chung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow label="Mã hàng" value={product.code} />
              <Separator />
              <InfoRow label="Mã vạch" value={
                <span className="flex items-center gap-1.5">
                  <Barcode className="h-3.5 w-3.5 text-muted-foreground" />
                  {product.barcode || "—"}
                </span>
              } />
              <Separator />
              <InfoRow label="Nhóm hàng" value={product.categoryName} />
              <Separator />
              <InfoRow label="Đơn vị tính" value={product.unit} />
              <Separator />
              <InfoRow label="Trọng lượng" value={product.weight ? `${product.weight}g` : "—"} />
              <Separator />
              <InfoRow label="Vị trí" value={product.position || "—"} />
              <Separator />
              <InfoRow
                label="Cho phép bán"
                value={
                  <Badge variant={product.allowSale ? "default" : "destructive"}>
                    {product.allowSale ? "Có" : "Không"}
                  </Badge>
                }
              />
              {product.properties && product.properties.length > 0 && (
                <>
                  <Separator />
                  <div className="pt-2.5">
                    <p className="text-xs text-muted-foreground mb-2">Thuộc tính</p>
                    <div className="space-y-1">
                      {product.properties.map((prop) => (
                        <div key={prop.name} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{prop.name}</span>
                          <span className="font-medium">{prop.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Giá */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" />
                Thông tin giá
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Giá bán"
                value={
                  <span className="text-base font-bold text-primary">
                    {formatCurrency(product.sellPrice)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Giá vốn"
                value={formatCurrency(product.costPrice)}
              />
              <Separator />
              <InfoRow
                label="Lợi nhuận"
                value={
                  <span className={profit >= 0 ? "text-green-600" : "text-destructive"}>
                    {formatCurrency(profit)} ({profitMargin}%)
                  </span>
                }
              />

              {product.priceBooks && product.priceBooks.length > 0 && (
                <>
                  <Separator />
                  <div className="pt-2.5">
                    <p className="text-xs text-muted-foreground mb-2">Bảng giá</p>
                    <div className="space-y-1">
                      {product.priceBooks.map((pb) => (
                        <div key={pb.name} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{pb.name}</span>
                          <span className="font-medium">
                            {formatCurrency(pb.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Tồn kho */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4 text-primary" />
                Tồn kho
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <InfoRow
                label="Tồn kho"
                value={
                  <span className={`text-base font-bold ${
                    product.stock === 0
                      ? "text-destructive"
                      : product.stock <= (product.minStock ?? 5)
                      ? "text-yellow-600"
                      : "text-green-600"
                  }`}>
                    {product.stock}
                  </span>
                }
              />
              <Separator />
              <InfoRow label="Khách đặt" value={
                product.ordered > 0 ? (
                  <span className="text-primary font-medium">{product.ordered}</span>
                ) : "0"
              } />
              <Separator />
              <InfoRow label="Tồn kho tối thiểu" value={product.minStock ?? "—"} />
              <Separator />
              <InfoRow label="Tồn kho tối đa" value={product.maxStock ?? "—"} />
              <Separator />
              <InfoRow
                label="Giá trị tồn kho"
                value={
                  <span className="font-bold">
                    {formatCurrency(inventoryValue)}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="Trạng thái"
                value={
                  product.stock === 0 ? (
                    <Badge variant="destructive">Hết hàng</Badge>
                  ) : product.stock <= (product.minStock ?? 5) ? (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                      Sắp hết
                    </Badge>
                  ) : (
                    <Badge variant="default">Còn hàng</Badge>
                  )
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Description */}
        {product.description && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Mô tả sản phẩm</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{product.description}</p>
            </CardContent>
          </Card>
        )}

        {/* KPI Summary Cards (Mobile-friendly) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Tồn kho</p>
            <p className="text-lg font-bold text-blue-700">{product.stock}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Giá trị tồn</p>
            <p className="text-lg font-bold text-green-700">
              {formatCurrency(inventoryValue)}
            </p>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Đã bán (30 ngày)</p>
            <p className="text-lg font-bold text-orange-700">{salesTotal}</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Lợi nhuận</p>
            <p className="text-lg font-bold text-purple-700">{profitMargin}%</p>
          </div>
        </div>

        {/* Tabs: Lịch sử nhập/xuất kho + Lịch sử bán hàng */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v ?? activeTab)}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="stock" className="gap-1.5">
              <TrendingDown className="h-4 w-4" />
              <span className="hidden sm:inline">Lịch sử</span> Nhập/Xuất kho
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {stockTotal}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="sales" className="gap-1.5">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Lịch sử</span> Bán hàng
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {salesTotal}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stock" className="mt-4">
            <DataTable
              columns={stockColumns}
              data={stockData}
              loading={stockLoading}
              total={stockTotal}
              pageIndex={stockPage}
              pageSize={stockPageSize}
              pageCount={Math.ceil(stockTotal / stockPageSize)}
              onPageChange={setStockPage}
              onPageSizeChange={(size) => {
                setStockPageSize(size);
                setStockPage(0);
              }}
            />
          </TabsContent>

          <TabsContent value="sales" className="mt-4">
            <DataTable
              columns={salesColumns}
              data={salesData}
              loading={salesLoading}
              total={salesTotal}
              pageIndex={salesPage}
              pageSize={salesPageSize}
              pageCount={Math.ceil(salesTotal / salesPageSize)}
              onPageChange={setSalesPage}
              onPageSizeChange={(size) => {
                setSalesPageSize(size);
                setSalesPage(0);
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
