"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { CreateProductDialog } from "@/components/shared/dialogs";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { productExcelSchema } from "@/lib/excel/schemas";
import { bulkImportProducts } from "@/lib/services/supabase/excel-import";
import { ProductLotsTab } from "@/components/shared/product-lots-tab";
import { ProductUomConversionsTab } from "@/components/shared/product-uom-conversions-tab";
import { ProductStockMovementsTab } from "@/components/shared/product-stock-movements-tab";
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
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { ProductImportRow } from "@/lib/excel/schemas";
import {
  getProducts,
  getProductStats,
  getProductCategoriesAsync,
  getProductBrands,
  bulkUpdateCategory,
  bulkUpdatePrice,
  bulkDeleteProducts,
  deleteProduct,
} from "@/lib/services";
import { SummaryCard } from "@/components/shared/summary-card";
import { useToast } from "@/lib/contexts";
import type { Product } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

type ProductScope = "nvl" | "sku";

// ---------------------------------------------------------------------------
// Inline detail panel for a product row
// ---------------------------------------------------------------------------
// Build dynamic tags từ data thật thay vì hardcoded
// ["Combo - đóng gói", "Bán trực tiếp", "Tích điểm"] (trước đây gán cứng
// cho mọi sản phẩm, gây misleading khi NVL cũng hiện "Bán trực tiếp").
function buildProductTags(product: Product): string[] {
  const tags: string[] = [];
  if (product.productType === "nvl") {
    tags.push("Nguyên vật liệu");
  } else {
    if (product.channel === "fnb") tags.push("POS FnB");
    else if (product.channel === "retail") tags.push("Bán lẻ / Sỉ");
    else tags.push("Hàng bán");
  }
  if (product.hasBom) tags.push("Có BOM");
  if (product.status === "inactive") tags.push("Ngừng bán");
  return tags;
}

function formatShelfLife(
  days?: number,
  unit?: "day" | "month" | "year",
): string | null {
  if (!days) return null;
  const unitLabel =
    unit === "month" ? "tháng" : unit === "year" ? "năm" : "ngày";
  return `${days} ${unitLabel}`;
}

function ProductDetail({
  product,
  onClose,
  onEdit,
  onDelete,
}: {
  product: Product;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const isNvl = product.productType === "nvl";
  return (
    <InlineDetailPanel open onClose={onClose} onEdit={onEdit} onDelete={onDelete}>
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
                      <Icon name="inventory_2" size={32} className="text-muted-foreground/40" />
                    )
                  }
                  tags={buildProductTags(product)}
                  actionLink={{
                    label: "Xem phân tích",
                    onClick: () => { window.location.href = "/phan-tich/hang-hoa"; },
                  }}
                />

                <DetailInfoGrid
                  columns={4}
                  fields={[
                    { label: "Mã hàng", value: product.code },
                    { label: "Mã vạch", value: product.barcode ?? null },
                    { label: "Thương hiệu", value: product.brand ?? null },
                    { label: "Nhà cung cấp", value: product.supplierName ?? null },
                    { label: "Giá vốn", value: formatCurrency(product.costPrice) },
                    {
                      label: "Giá bán",
                      value: isNvl ? "—" : formatCurrency(product.sellPrice),
                    },
                    {
                      label: "Thuế VAT",
                      value: `${product.vatRate ?? 0}%`,
                    },
                    {
                      label: "Kênh bán",
                      value: isNvl
                        ? "Nội bộ"
                        : product.channel === "fnb"
                          ? "POS FnB"
                          : product.channel === "retail"
                            ? "POS Retail"
                            : null,
                    },
                    {
                      label: "Trọng lượng",
                      value: product.weight ? `${product.weight} kg` : null,
                    },
                    {
                      label: "Tồn tối thiểu",
                      value:
                        product.minStock !== undefined && product.minStock > 0
                          ? String(product.minStock)
                          : null,
                    },
                    {
                      label: "Tồn tối đa",
                      value:
                        product.maxStock !== undefined && product.maxStock > 0
                          ? String(product.maxStock)
                          : null,
                    },
                    {
                      label: "HSD mặc định",
                      value: formatShelfLife(
                        product.shelfLifeDays,
                        product.shelfLifeUnit,
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "description",
            label: "Mô tả ghi chú",
            content: product.description ? (
              <p className="text-sm whitespace-pre-wrap py-2 leading-relaxed">
                {product.description}
              </p>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có mô tả
              </div>
            ),
          },
          {
            id: "stock_card",
            label: "Thẻ kho",
            content: <ProductStockMovementsTab productId={product.id} />,
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
          // Bỏ tab "Liên kết kênh bán" — trước đây hardcoded "Chưa liên kết
          // kênh bán nào" cho mọi sản phẩm. Thông tin kênh bán đã có ở tab
          // Thông tin (field "Kênh bán") — không cần tab riêng.
          {
            id: "history",
            label: "Lịch sử",
            content: <AuditHistoryTab entityType="product" entityId={product.id} />,
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
  const [stats, setStats] = useState<{
    totalCount: number;
    stockValue: number;
    outOfStock: number;
    lowStock: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
  const [brandFilter, setBrandFilter] = useState("all");
  const [expectedOutDate, setExpectedOutDate] =
    useState<DatePresetValue>("all");
  const [createdDatePreset, setCreatedDatePreset] =
    useState<DatePresetValue>("all");
  const [supplierFilter, setSupplierFilter] = useState("");

  const [categories, setCategories] = useState<
    { label: string; value: string; count: number }[]
  >([]);
  // Brand list lấy từ DB. "__no_brand__" là value đặc biệt → service sẽ filter
  // những SP brand IS NULL. User hay hỏi "những NVL chưa gán thương hiệu" nên
  // cần option này ngay từ đầu thay vì bắt gõ manual.
  const [brands, setBrands] = useState<string[]>([]);

  // Reload categories + brands khi scope đổi (NVL vs SKU có brand pool khác nhau)
  useEffect(() => {
    let cancelled = false;
    getProductCategoriesAsync(scope).then((cats) => {
      if (!cancelled) setCategories(cats);
    });
    getProductBrands(scope)
      .then((list) => {
        if (!cancelled) setBrands(list);
      })
      .catch(() => {
        /* brand list optional — fail silent */
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
        ...(brandFilter !== "all" && { brand: brandFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, scope, categoryFilter, stockFilter, statusFilter, brandFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch stats KPI (totalCount, stockValue, outOfStock, lowStock) theo scope
  const fetchStats = useCallback(async () => {
    try {
      const s = await getProductStats(scope);
      setStats(s);
    } catch {
      // silent fail — KPI không critical cho page
    }
  }, [scope]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats, data]);

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
  }, [search, scope, categoryFilter, stockFilter, statusFilter, brandFilter, expectedOutDate, createdDatePreset, supplierFilter]);

  // Reset category + brand filter when scope changes (pool khác nhau giữa NVL/SKU)
  useEffect(() => {
    setCategoryFilter("all");
    setBrandFilter("all");
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
    if (type === "excel") {
      // Xuất theo schema import → user edit rồi upload lại không mất cột
      const rows: ProductImportRow[] = data.map((p) => ({
        code: p.code,
        name: p.name,
        productType: p.productType,
        channel: p.channel,
        categoryCode: p.categoryCode,
        unit: p.unit,
        sellPrice: p.sellPrice,
        costPrice: p.costPrice,
        stock: p.stock,
        vatRate: p.vatRate,
        groupCode: p.groupCode,
        purchaseUnit: p.purchaseUnit,
        stockUnit: p.stockUnit,
        sellUnit: p.sellUnit,
        isActive: p.status !== "inactive",
      }));
      exportToExcelFromSchema(rows, productExcelSchema);
      return;
    }
    // CSV giữ format ngắn gọn cho báo cáo
    const exportColumns = [
      { header: "Mã hàng", key: "code", width: 12 },
      { header: "Tên hàng", key: "name", width: 30 },
      { header: "Giá bán", key: "sellPrice", width: 15, format: (v: number) => v },
      { header: "Giá vốn", key: "costPrice", width: 15, format: (v: number) => v },
      { header: "Tồn kho", key: "stock", width: 10 },
      { header: "Nhóm", key: "categoryName", width: 20 },
    ];
    exportToCsv(data, exportColumns, "danh-sach-hang-hoa");
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
            <Icon name="inventory_2" size={16} className="text-muted-foreground/40" />
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
          <span className={stock === 0 ? "text-destructive" : stock <= 5 ? "text-status-warning" : ""}>
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
          <span className={stock === 0 ? "text-destructive" : stock <= 5 ? "text-status-warning" : ""}>
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

            <FilterGroup label="Thương hiệu">
              <SelectFilter
                options={[
                  { label: "Chưa có thương hiệu", value: "__no_brand__" },
                  ...brands.map((b) => ({ label: b, value: b })),
                ]}
                value={brandFilter}
                onChange={setBrandFilter}
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
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
            {
              label: "Tải mẫu",
              icon: <Icon name="description" size={16} />,
              variant: "ghost",
              onClick: () => downloadTemplate(productExcelSchema),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload" size={16} />,
              onClick: () => setImportOpen(true),
            },
          ]}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-3 pb-1">
          <SummaryCard
            icon={<Icon name="inventory_2" size={16} />}
            label={scope === "nvl" ? "Tổng NVL" : "Tổng hàng bán"}
            value={stats ? stats.totalCount.toLocaleString("vi-VN") : "—"}
          />
          <SummaryCard
            icon={<Icon name="savings" size={16} />}
            label="Giá trị tồn kho"
            value={stats ? formatCurrency(stats.stockValue) : "—"}
            highlight
          />
          <SummaryCard
            icon={<Icon name="remove_shopping_cart" size={16} />}
            label="Hết hàng"
            value={stats ? stats.outOfStock.toLocaleString("vi-VN") : "—"}
            danger={(stats?.outOfStock ?? 0) > 0}
          />
          <SummaryCard
            icon={<Icon name="warning" size={16} />}
            label="Sắp hết (≤ 5)"
            value={stats ? stats.lowStock.toLocaleString("vi-VN") : "—"}
            danger={(stats?.lowStock ?? 0) > 0}
          />
        </div>

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
              icon: <Icon name="label" size={16} />,
              onClick: (rows) => {
                setSelectedRowsForBulk(rows);
                setBulkChangeCategoryOpen(true);
              },
            },
            {
              label: "Đổi giá",
              icon: <Icon name="attach_money" size={16} />,
              onClick: (rows) => {
                setSelectedRowsForBulk(rows);
                setBulkChangePriceOpen(true);
              },
            },
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
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
            <ProductDetail
              product={product}
              onClose={onClose}
              onEdit={() => {
                setEditingProduct(product);
                setCreateOpen(true);
              }}
              onDelete={() => {
                setDeletingProduct(product);
                setDeleteConfirmOpen(true);
              }}
            />
          )}
          rowActions={(row) => [
            {
              label: "Sửa",
              icon: <Icon name="edit" size={16} />,
              onClick: () => {
                setEditingProduct(row);
                setCreateOpen(true);
              },
            },
            {
              label: "Nhân bản",
              icon: <Icon name="content_copy" size={16} />,
              onClick: () => {
                toast({ variant: "info", title: "Đang phát triển", description: "Tính năng nhân bản đang được phát triển" });
              },
            },
            {
              label: "In mã vạch",
              icon: <Icon name="print" size={16} />,
              onClick: () => {
                toast({ variant: "info", title: "Đang phát triển", description: "Đang phát triển tính năng in mã vạch" });
              },
            },
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
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
        initialData={editingProduct}
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
      {/* Excel Import — template-based, deterministic (thay AI cũ)     */}
      {/* ============================================================ */}
      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={productExcelSchema}
        onCommit={bulkImportProducts}
        onFinished={() => {
          // Refresh danh sách sau khi import xong
          setPage(0);
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách sản phẩm đã được cập nhật.",
          });
        }}
      />

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
