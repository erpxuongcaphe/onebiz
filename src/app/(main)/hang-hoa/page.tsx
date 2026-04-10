"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  Plus,
  Pencil,
  Copy,
  Printer,
  Trash2,
  Package,
  Tags,
  DollarSign,
  Sparkles,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DatePresetFilter,
  PersonFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import { CreateProductDialog } from "@/components/shared/dialogs";
import { ImportDataDialog } from "@/components/shared/import-data-dialog";
import { ProductLotsTab } from "@/components/shared/product-lots-tab";
import { ProductUomConversionsTab } from "@/components/shared/product-uom-conversions-tab";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getProducts,
  getProductCategoriesAsync,
  bulkUpdateCategory,
  bulkUpdatePrice,
  bulkDeleteProducts,
  deleteProduct,
} from "@/lib/services";
import { useToast } from "@/lib/contexts";
import type { Product } from "@/lib/types";

type ProductScope = "nvl" | "sku";

// ---------------------------------------------------------------------------
// Inline detail panel for a product row
// ---------------------------------------------------------------------------
function ProductDetail({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const { toast } = useToast();
  return (
    <InlineDetailPanel open onClose={onClose}>
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={product.name}
                  code={product.code}
                  subtitle={product.categoryName}
                  avatar={
                    product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-8 w-8 text-muted-foreground/40" />
                    )
                  }
                  tags={["Combo - đóng gói", "Bán trực tiếp", "Tích điểm"]}
                  actionLink={{
                    label: "Xem phân tích",
                    onClick: () => { window.location.href = "/phan-tich/hang-hoa"; },
                  }}
                />

                <DetailInfoGrid
                  columns={4}
                  fields={[
                    { label: "Mã hàng", value: product.code },
                    { label: "Mã vạch", value: null },
                    {
                      label: "Giá vốn",
                      value: formatCurrency(product.costPrice),
                    },
                    {
                      label: "Giá bán",
                      value: formatCurrency(product.sellPrice),
                    },
                    { label: "Thương hiệu", value: null },
                    { label: "Vị trí", value: null },
                    { label: "Trọng lượng", value: null },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "description",
            label: "Mô tả ghi chú",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có mô tả
              </div>
            ),
          },
          {
            id: "stock_card",
            label: "Thẻ kho",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có dữ liệu thẻ kho
              </div>
            ),
          },
          {
            id: "lots",
            label: "Lô & HSD",
            content: <ProductLotsTab productId={product.id} />,
          },
          {
            id: "uom",
            label: "ĐVT quy đổi",
            content: <ProductUomConversionsTab product={product} />,
          },
          {
            id: "channels",
            label: "Liên kết kênh bán",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa liên kết kênh bán nào
              </div>
            ),
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function HangHoaPage() {
  const [scope, setScope] = useState<ProductScope>("nvl");
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [aiBannerDismissed, setAiBannerDismissed] = useState(false);

  // Single-row delete confirm
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Bulk action state — phase 2: wire backend mutations
  const { toast } = useToast();
  const [bulkChangeCategoryOpen, setBulkChangeCategoryOpen] = useState(false);
  const [bulkChangePriceOpen, setBulkChangePriceOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [selectedRowsForBulk, setSelectedRowsForBulk] = useState<Product[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [clearSelectionToken, setClearSelectionToken] = useState(0);

  // Dialog form state
  const [bulkCategoryValue, setBulkCategoryValue] = useState<string>("");
  const [bulkSellPriceValue, setBulkSellPriceValue] = useState<string>("");
  const [bulkCostPriceValue, setBulkCostPriceValue] = useState<string>("");

  // Reset form khi mở/đóng dialog
  useEffect(() => {
    if (!bulkChangeCategoryOpen) setBulkCategoryValue("");
  }, [bulkChangeCategoryOpen]);
  useEffect(() => {
    if (!bulkChangePriceOpen) {
      setBulkSellPriceValue("");
      setBulkCostPriceValue("");
    }
  }, [bulkChangePriceOpen]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expectedOutDate, setExpectedOutDate] =
    useState<DatePresetValue>("all");
  const [createdDatePreset, setCreatedDatePreset] =
    useState<DatePresetValue>("all");
  const [supplierFilter, setSupplierFilter] = useState("");

  const [categories, setCategories] = useState<
    { label: string; value: string; count: number }[]
  >([]);

  // Reload categories when scope changes
  useEffect(() => {
    let cancelled = false;
    getProductCategoriesAsync(scope).then((cats) => {
      if (!cancelled) setCategories(cats);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getProducts({
      page,
      pageSize,
      search,
      filters: {
        productType: scope,
        ...(categoryFilter !== "all" && { category: [categoryFilter] }),
        ...(stockFilter !== "all" && { stock: stockFilter }),
        ...(statusFilter !== "all" && { status: statusFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, scope, categoryFilter, stockFilter, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ============================================================
  // Bulk action handlers — gọi mutation, toast, refetch, clear
  // ============================================================
  const finishBulkSuccess = useCallback(
    async (title: string, description?: string) => {
      toast({ variant: "success", title, description });
      await fetchData();
      setSelectedRowsForBulk([]);
      setClearSelectionToken((n) => n + 1);
    },
    [toast, fetchData]
  );

  const finishBulkError = useCallback(
    (title: string, err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Vui lòng thử lại sau.";
      toast({ variant: "error", title, description: message });
    },
    [toast]
  );

  const handleConfirmBulkChangeCategory = useCallback(async () => {
    if (!bulkCategoryValue) {
      toast({
        variant: "warning",
        title: "Chưa chọn nhóm hàng",
        description: "Vui lòng chọn nhóm hàng mới trước khi áp dụng.",
      });
      return;
    }
    const ids = selectedRowsForBulk.map((p) => p.id);
    setBulkLoading(true);
    try {
      const { count } = await bulkUpdateCategory(ids, bulkCategoryValue);
      setBulkChangeCategoryOpen(false);
      await finishBulkSuccess(
        "Đã đổi nhóm hàng",
        `Cập nhật thành công ${count}/${ids.length} sản phẩm.`
      );
    } catch (err) {
      finishBulkError("Đổi nhóm thất bại", err);
    } finally {
      setBulkLoading(false);
    }
  }, [bulkCategoryValue, selectedRowsForBulk, toast, finishBulkSuccess, finishBulkError]);

  const handleConfirmBulkChangePrice = useCallback(async () => {
    const sell = bulkSellPriceValue.trim();
    const cost = bulkCostPriceValue.trim();
    if (!sell && !cost) {
      toast({
        variant: "warning",
        title: "Chưa nhập giá",
        description: "Vui lòng nhập giá bán hoặc giá vốn cần cập nhật.",
      });
      return;
    }
    const updates: { sellPrice?: number; costPrice?: number } = {};
    if (sell) {
      const n = Number(sell);
      if (Number.isNaN(n) || n < 0) {
        toast({ variant: "error", title: "Giá bán không hợp lệ" });
        return;
      }
      updates.sellPrice = n;
    }
    if (cost) {
      const n = Number(cost);
      if (Number.isNaN(n) || n < 0) {
        toast({ variant: "error", title: "Giá vốn không hợp lệ" });
        return;
      }
      updates.costPrice = n;
    }

    const ids = selectedRowsForBulk.map((p) => p.id);
    setBulkLoading(true);
    try {
      const { count } = await bulkUpdatePrice(ids, updates);
      setBulkChangePriceOpen(false);
      await finishBulkSuccess(
        "Đã cập nhật giá",
        `Cập nhật thành công ${count}/${ids.length} sản phẩm.`
      );
    } catch (err) {
      finishBulkError("Cập nhật giá thất bại", err);
    } finally {
      setBulkLoading(false);
    }
  }, [bulkSellPriceValue, bulkCostPriceValue, selectedRowsForBulk, toast, finishBulkSuccess, finishBulkError]);

  const handleConfirmSingleDelete = useCallback(async () => {
    if (!deletingProduct) return;
    setDeleteLoading(true);
    try {
      await deleteProduct(deletingProduct.id);
      setDeleteConfirmOpen(false);
      setDeletingProduct(null);
      toast({ variant: "success", title: "Đã xoá sản phẩm", description: `${deletingProduct.code} — ${deletingProduct.name}` });
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vui lòng thử lại sau.";
      toast({ variant: "error", title: "Xoá sản phẩm thất bại", description: message });
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingProduct, toast, fetchData]);

  const handleConfirmBulkDelete = useCallback(async () => {
    const ids = selectedRowsForBulk.map((p) => p.id);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      const { count } = await bulkDeleteProducts(ids);
      setBulkDeleteConfirmOpen(false);
      await finishBulkSuccess(
        "Đã xoá sản phẩm",
        `Xoá thành công ${count}/${ids.length} sản phẩm.`
      );
    } catch (err) {
      finishBulkError("Xoá sản phẩm thất bại", err);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedRowsForBulk, finishBulkSuccess, finishBulkError]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, scope, categoryFilter, stockFilter, statusFilter, expectedOutDate, createdDatePreset, supplierFilter]);

  // Reset category filter when scope changes
  useEffect(() => {
    setCategoryFilter("all");
  }, [scope]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalStock = data.reduce((sum, p) => sum + p.stock, 0);
  const totalOrdered = data.reduce((sum, p) => sum + p.ordered, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã hàng", key: "code", width: 12 },
      { header: "Tên hàng", key: "name", width: 30 },
      {
        header: "Giá bán",
        key: "sellPrice",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Giá vốn",
        key: "costPrice",
        width: 15,
        format: (v: number) => v,
      },
      { header: "Tồn kho", key: "stock", width: 10 },
      { header: "Nhóm", key: "categoryName", width: 20 },
    ];
    if (type === "excel")
      exportToExcel(data, exportColumns, "danh-sach-hang-hoa");
    else exportToCsv(data, exportColumns, "danh-sach-hang-hoa");
  };

  const baseColumns: ColumnDef<Product, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 36,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <StarCell
          starred={starred.has(row.original.id)}
          onToggle={() => toggleStar(row.original.id)}
        />
      ),
    },
    {
      id: "image",
      header: "",
      size: 48,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="h-9 w-9 rounded border bg-muted/40 flex items-center justify-center overflow-hidden">
          {row.original.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.original.image}
              alt={row.original.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <Package className="h-4 w-4 text-muted-foreground/40" />
          )}
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "Mã hàng",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên hàng",
      size: 280,
    },
    {
      accessorKey: "categoryName",
      header: "Nhóm",
      size: 140,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.categoryName}</span>
      ),
    },
  ];

  const nvlColumns: ColumnDef<Product, unknown>[] = [
    ...baseColumns,
    {
      id: "purchaseUnit",
      header: "ĐVT mua",
      size: 90,
      cell: ({ row }) => row.original.purchaseUnit ?? row.original.unit ?? "—",
    },
    {
      id: "stockUnit",
      header: "ĐVT kho",
      size: 90,
      cell: ({ row }) => row.original.stockUnit ?? row.original.unit ?? "—",
    },
    {
      accessorKey: "costPrice",
      header: "Giá vốn",
      cell: ({ row }) => (
        <span className="text-right block">{formatCurrency(row.original.costPrice)}</span>
      ),
    },
    {
      accessorKey: "stock",
      header: "Tồn kho",
      cell: ({ row }) => {
        const stock = row.original.stock;
        return (
          <span className={stock === 0 ? "text-destructive" : stock <= 5 ? "text-yellow-600" : ""}>
            {formatCurrency(stock)}
          </span>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Thời gian tạo",
      size: 150,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ];

  const skuColumns: ColumnDef<Product, unknown>[] = [
    ...baseColumns,
    {
      id: "hasBom",
      header: "BOM",
      size: 70,
      cell: ({ row }) =>
        row.original.hasBom ? (
          <span className="inline-flex items-center rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">
            Có
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">Mua bán</span>
        ),
    },
    {
      accessorKey: "sellPrice",
      header: "Giá bán",
      cell: ({ row }) => (
        <span className="text-right block">{formatCurrency(row.original.sellPrice)}</span>
      ),
    },
    {
      accessorKey: "costPrice",
      header: "Giá vốn",
      cell: ({ row }) => (
        <span className="text-right block">{formatCurrency(row.original.costPrice)}</span>
      ),
    },
    {
      accessorKey: "stock",
      header: "Tồn kho",
      cell: ({ row }) => {
        const stock = row.original.stock;
        return (
          <span className={stock === 0 ? "text-destructive" : stock <= 5 ? "text-yellow-600" : ""}>
            {formatCurrency(stock)}
          </span>
        );
      },
    },
    {
      accessorKey: "ordered",
      header: "Khách đặt",
      cell: ({ row }) => {
        const val = row.original.ordered;
        return val > 0 ? (
          <span className="text-primary font-medium">{val}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Thời gian tạo",
      size: 150,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ];

  const columns = scope === "nvl" ? nvlColumns : skuColumns;

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup
              label="Nhóm hàng"
              action={
                <span className="text-primary text-xs cursor-pointer">
                  Tạo mới
                </span>
              }
            >
              <SelectFilter
                options={categories}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder="Tất cả"
              />
            </FilterGroup>

            <FilterGroup label="Tồn kho">
              <SelectFilter
                options={[
                  { label: "Còn hàng", value: "in_stock" },
                  { label: "Hết hàng", value: "out_of_stock" },
                ]}
                value={stockFilter}
                onChange={setStockFilter}
                placeholder="Tất cả"
              />
            </FilterGroup>

            <FilterGroup label="Trạng thái">
              <SelectFilter
                options={[
                  { label: "Đang bán", value: "active" },
                  { label: "Ngừng bán", value: "inactive" },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Tất cả"
              />
            </FilterGroup>

            <FilterGroup label="Dự kiến hết hàng">
              <DatePresetFilter
                value={expectedOutDate}
                onChange={setExpectedOutDate}
                presets={[
                  { label: "Tháng này", value: "this_month" },
                  { label: "Tuần này", value: "this_week" },
                  { label: "Tùy chỉnh", value: "custom" },
                ]}
              />
            </FilterGroup>

            <FilterGroup label="Thời gian tạo">
              <DatePresetFilter
                value={createdDatePreset}
                onChange={setCreatedDatePreset}
                presets={[
                  { label: "Tháng này", value: "this_month" },
                  { label: "Tuần này", value: "this_week" },
                  { label: "Tùy chỉnh", value: "custom" },
                ]}
              />
            </FilterGroup>

            <FilterGroup label="Nhà cung cấp">
              <PersonFilter
                value={supplierFilter}
                onChange={setSupplierFilter}
                placeholder="Chọn nhà cung cấp"
                suggestions={[]}
              />
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Hàng hóa"
          tabs={
            <Tabs value={scope} onValueChange={(v) => setScope(v as ProductScope)}>
              <TabsList>
                <TabsTrigger value="nvl">Nguyên vật liệu</TabsTrigger>
                <TabsTrigger value="sku">Hàng bán</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          searchPlaceholder={scope === "nvl" ? "Theo mã, tên NVL" : "Theo mã, tên SKU"}
          searchValue={search}
          onSearchChange={setSearch}
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          actions={[
            {
              label: "Tạo mới",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
            {
              label: "Import bằng AI",
              icon: <Sparkles className="h-4 w-4" />,
              onClick: () => setImportOpen(true),
            },
          ]}
        />

        {/* ============================================================ */}
        {/* AI Import invitation banner — chỉ hiện trên tab NVL           */}
        {/* ============================================================ */}
        {scope === "nvl" && !aiBannerDismissed && (
          <div className="mb-3 shrink-0 relative overflow-hidden rounded-lg border border-violet-200 bg-gradient-to-r from-violet-50 via-fuchsia-50 to-amber-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-violet-900 leading-tight">
                  Có file Excel danh sách nguyên vật liệu? Để AI tự đọc & cập nhật giúp bạn
                </div>
                <div className="text-xs text-violet-700/80 mt-0.5">
                  Hỗ trợ .xlsx / .csv — AI tự nhận diện cột mã, tên, giá vốn, ĐVT, nhóm hàng và đề xuất ánh xạ
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-xs font-semibold shadow-sm hover:from-violet-700 hover:to-fuchsia-700 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Tải file lên
              </button>
              <button
                type="button"
                onClick={() => setAiBannerDismissed(true)}
                className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-violet-700/60 hover:text-violet-900 hover:bg-violet-100 transition-colors"
                aria-label="Đóng banner"
                title="Ẩn banner"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          pageIndex={page}
          pageSize={pageSize}
          pageCount={Math.ceil(total / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          selectable
          getRowId={(row) => row.id}
          clearSelectionTrigger={clearSelectionToken}
          bulkActions={[
            {
              label: "Đổi nhóm",
              icon: <Tags className="h-4 w-4" />,
              onClick: (rows) => {
                setSelectedRowsForBulk(rows);
                setBulkChangeCategoryOpen(true);
              },
            },
            {
              label: "Đổi giá",
              icon: <DollarSign className="h-4 w-4" />,
              onClick: (rows) => {
                setSelectedRowsForBulk(rows);
                setBulkChangePriceOpen(true);
              },
            },
            {
              label: "Xóa",
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: (rows) => {
                setSelectedRowsForBulk(rows);
                setBulkDeleteConfirmOpen(true);
              },
            },
          ]}
          summaryRow={{
            stock: formatCurrency(totalStock),
            ordered: formatCurrency(totalOrdered),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(product, onClose) => (
            <ProductDetail product={product} onClose={onClose} />
          )}
          rowActions={(row) => [
            {
              label: "Sửa",
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => {
                setEditingProduct(row);
                setCreateOpen(true);
              },
            },
            {
              label: "Nhân bản",
              icon: <Copy className="h-4 w-4" />,
              onClick: () => {
                toast({ variant: "info", title: "Đang phát triển", description: "Tính năng nhân bản đang được phát triển" });
              },
            },
            {
              label: "In mã vạch",
              icon: <Printer className="h-4 w-4" />,
              onClick: () => {
                toast({ variant: "info", title: "Đang phát triển", description: "Đang phát triển tính năng in mã vạch" });
              },
            },
            {
              label: "Xóa",
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => {
                setDeletingProduct(row);
                setDeleteConfirmOpen(true);
              },
              variant: "destructive",
              separator: true,
            },
          ]}
        />
      </ListPageLayout>

      <CreateProductDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditingProduct(null);
        }}
        onSuccess={fetchData}
      />

      {/* --- Single-row delete confirm --- */}
      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(o) => {
          if (deleteLoading) return;
          setDeleteConfirmOpen(o);
          if (!o) setDeletingProduct(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xoá sản phẩm?</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xoá sản phẩm{" "}
              <strong>{deletingProduct?.code}</strong> —{" "}
              <strong>{deletingProduct?.name}</strong>? Hành động này không thể
              hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteLoading}
              onClick={() => {
                setDeleteConfirmOpen(false);
                setDeletingProduct(null);
              }}
            >
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={deleteLoading}
              onClick={handleConfirmSingleDelete}
            >
              {deleteLoading ? "Đang xoá..." : "Xoá"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* AI Import Dialog — mở từ nút "Import bằng AI" hoặc banner     */}
      {/* ============================================================ */}
      <ImportDataDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* ============================================================ */}
      {/* Bulk action placeholder dialogs (Phase 1: UI only)             */}
      {/* ============================================================ */}

      {/* — Đổi nhóm — */}
      <Dialog
        open={bulkChangeCategoryOpen}
        onOpenChange={(o) => {
          if (bulkLoading) return;
          setBulkChangeCategoryOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi nhóm hàng</DialogTitle>
            <DialogDescription>
              Bạn đang chọn{" "}
              <strong>{selectedRowsForBulk.length}</strong> sản phẩm. Chọn
              nhóm hàng mới để gán cho tất cả các sản phẩm này.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              value={bulkCategoryValue}
              disabled={bulkLoading}
              onChange={(e) => setBulkCategoryValue(e.target.value)}
            >
              <option value="" disabled>
                — Chọn nhóm hàng mới —
              </option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkLoading}
              onClick={() => setBulkChangeCategoryOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              disabled={bulkLoading || !bulkCategoryValue}
              onClick={handleConfirmBulkChangeCategory}
            >
              {bulkLoading ? "Đang áp dụng..." : "Áp dụng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* — Đổi giá — */}
      <Dialog
        open={bulkChangePriceOpen}
        onOpenChange={(o) => {
          if (bulkLoading) return;
          setBulkChangePriceOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi giá hàng loạt</DialogTitle>
            <DialogDescription>
              Áp dụng cho <strong>{selectedRowsForBulk.length}</strong> sản
              phẩm đã chọn. Để trống ô nào thì giữ nguyên giá trị cũ.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Giá bán mới (đ)
              </label>
              <input
                type="number"
                min={0}
                placeholder="Để trống nếu không đổi"
                value={bulkSellPriceValue}
                disabled={bulkLoading}
                onChange={(e) => setBulkSellPriceValue(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Giá vốn mới (đ)
              </label>
              <input
                type="number"
                min={0}
                placeholder="Để trống nếu không đổi"
                value={bulkCostPriceValue}
                disabled={bulkLoading}
                onChange={(e) => setBulkCostPriceValue(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkLoading}
              onClick={() => setBulkChangePriceOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              disabled={
                bulkLoading ||
                (!bulkSellPriceValue.trim() && !bulkCostPriceValue.trim())
              }
              onClick={handleConfirmBulkChangePrice}
            >
              {bulkLoading ? "Đang cập nhật..." : "Áp dụng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* — Xác nhận xoá — */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(o) => {
          if (bulkLoading) return;
          setBulkDeleteConfirmOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xoá sản phẩm hàng loạt?</DialogTitle>
            <DialogDescription>
              Bạn sắp xoá{" "}
              <strong>{selectedRowsForBulk.length}</strong> sản phẩm khỏi
              danh sách. Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-40 overflow-y-auto">
            <ul className="text-sm text-muted-foreground space-y-1">
              {selectedRowsForBulk.slice(0, 8).map((p) => (
                <li key={p.id} className="truncate">
                  • {p.code} — {p.name}
                </li>
              ))}
              {selectedRowsForBulk.length > 8 && (
                <li className="text-xs italic">
                  …và {selectedRowsForBulk.length - 8} sản phẩm khác
                </li>
              )}
            </ul>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkLoading}
              onClick={() => setBulkDeleteConfirmOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={bulkLoading}
              onClick={handleConfirmBulkDelete}
            >
              {bulkLoading
                ? "Đang xoá..."
                : `Xoá ${selectedRowsForBulk.length} sản phẩm`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
