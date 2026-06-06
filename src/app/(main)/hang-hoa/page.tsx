"use client";

import { useEffect, useState, useCallback } from "react";
import { useDebounce } from "@/lib/utils/use-debounce";
import dynamic from "next/dynamic";
import { ColumnDef } from "@tanstack/react-table";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
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
import { STANDARD_LIST_PRESETS } from "@/lib/utils/list-date-preset-range";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";

// PERF (CEO 23/05/2026): Lazy-load CreateProductDialog (1970 dòng + 1 đống
// service deps) — chỉ load khi user click "Tạo mới". Save ~300KB initial.
// (ImportExcelDialog không lazy-load được vì generic <T> bị mất khi qua
//  next/dynamic; giữ direct import.)
const CreateProductDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-product-dialog").then(
      (m) => m.CreateProductDialog,
    ),
  { ssr: false },
);
import { downloadTemplate } from "@/lib/excel";
import { productExcelSchema } from "@/lib/excel/schemas";
import { bulkImportProducts } from "@/lib/services/supabase/excel-import";
import { ProductLotsTab } from "@/components/shared/product-lots-tab";
import { ProductUomConversionsTab } from "@/components/shared/product-uom-conversions-tab";
import { ProductStockMovementsTab } from "@/components/shared/product-stock-movements-tab";
import { ProductBranchStockTab } from "@/components/shared/product-branch-stock-tab";
import { ProductPlatformPricesTab } from "@/components/shared/product-platform-prices-tab";
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
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { ProductImportRow } from "@/lib/excel/schemas";
import {
  getProducts,
  getAllMatchingProductIds,
  getProductStats,
  getProductCategoriesAsync,
  getProductBrands,
  bulkUpdateCategory,
  bulkUpdatePrice,
  bulkDeleteProducts,
  deleteProduct,
  duplicateProduct,
  restoreProduct,
  bulkRestoreProducts,
  cleanupTestProduct,
  bulkCleanupTestProducts,
  verifyCurrentUserPassword,
  getProductIdsWithActiveBom,
  getUOMConversionsByProductIds,
} from "@/lib/services";
import { StockWithConversion } from "@/components/shared/stock-with-conversion";
import { SummaryCard } from "@/components/shared/summary-card";
import { useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { isOwnerRole } from "@/lib/types/auth";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { OtpApprovalDialog } from "@/components/shared/dialogs/otp-approval-dialog";
import { OTP_ACTION_CODES } from "@/lib/services/supabase/manager-otp";
import type { Product, UOMConversion } from "@/lib/types";
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
  canViewCost,
}: {
  product: Product;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Sprint A.2: ẩn "Giá vốn" / "Lợi nhuận" khi user không có quyền products.view_cost */
  canViewCost: boolean;
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
                    // Sprint A.2: ẩn "Giá vốn" khỏi user thiếu products.view_cost
                    ...(canViewCost
                      ? [{ label: "Giá vốn", value: formatCurrency(product.costPrice) }]
                      : []),
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
            id: "branch_stock",
            label: "Tồn chi nhánh",
            content: (
              <ProductBranchStockTab
                productId={product.id}
                unit={product.stockUnit ?? product.unit}
              />
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
          // CEO 13/05 (Fabi/iPos pattern): SP FnB có thể có giá khác cho
          // mỗi nền tảng đơn (Shopee Food / Grab / Gojek / Be). Tab này
          // chỉ relevant cho SP channel='fnb' — SP retail ẩn tab.
          ...(product.channel === "fnb"
            ? [
                {
                  id: "platform_prices",
                  label: "Giá theo nền tảng",
                  content: (
                    <ProductPlatformPricesTab
                      productId={product.id}
                      basePrice={product.sellPrice}
                    />
                  ),
                },
              ]
            : []),
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
  // Day 19/05/2026 (CEO Smart Hybrid Phase 2): batch load UOM conversions
  // cho list view → cell "Tồn kho" hiện "24 hộp · 2 thùng".
  const [conversionsMap, setConversionsMap] = useState<
    Map<string, UOMConversion[]>
  >(new Map());
  const [stats, setStats] = useState<{
    totalCount: number;
    stockValue: number;
    outOfStock: number;
    lowStock: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  // CEO 28/05/2026: debounce search 300ms — tránh gọi getProducts mỗi keystroke.
  const debouncedSearch = useDebounce(search, 300);
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

  // Day 18/05/2026 (CEO): Set product_ids có BOM active — populated sau fetchData
  // dùng để hiển thị badge "Chưa có BOM" cho SKU có has_bom=true nhưng thiếu setup.
  const [productsWithActiveBom, setProductsWithActiveBom] = useState<Set<string>>(new Set());

  // Day 17/05/2026 (00094): "Xoá vĩnh viễn" — gộp logic cleanup_test_product
  // (bypass stock + active check, vẫn check 15 bảng FK giao dịch thực).
  // Bỏ "Xoá hẳn" (00092) vì duplicate UX — gộp 1 nút "Xoá vĩnh viễn".
  const [bulkCleanupConfirmOpen, setBulkCleanupConfirmOpen] = useState(false);
  // Bulk "Khôi phục" trong tab "Đã ngừng KD" (thay "Xoá idempotent" vô nghĩa)
  const [bulkRestoreConfirmOpen, setBulkRestoreConfirmOpen] = useState(false);
  // Password re-prompt — AWS/Stripe pattern cho destructive action
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");

  // Bulk action state — phase 2: wire backend mutations
  const { toast } = useToast();

  // Sprint S2 Phase 1 + 3a (CEO 12/05): defense-in-depth permission cho xoá SP.
  //   - canDeleteProduct = true  → bấm Xoá → ConfirmDialog → service trực tiếp
  //   - canDeleteProduct = false → bấm Xoá → ConfirmDialog → mở OTP dialog
  //     → manager cấp OTP từ /manager/otp → cashier nhập → service với otpId
  // Server (migration 00060/00062) enforce permission của OTP issuer thay actor.
  const { hasPermission } = usePermissions();
  const canDeleteProduct = hasPermission(PERMISSIONS.PRODUCTS_DELETE);
  // Sprint A.2 (CEO 12/05): cashier KHÔNG được thấy giá vốn / lợi nhuận
  // → leak business KPI. Gate cả column trong DataTable + detail panel.
  const canViewCost = hasPermission(PERMISSIONS.PRODUCTS_VIEW_COST);

  // Day 17/05/2026 (00092): chỉ owner mới được xoá hẳn SP (hard delete)
  const { user } = useAuth();
  const isOwner = isOwnerRole(user?.role);

  // OTP delegation state — khi cashier không có quyền nhưng vẫn muốn xoá
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpTargetProduct, setOtpTargetProduct] = useState<Product | null>(null);
  const [bulkChangeCategoryOpen, setBulkChangeCategoryOpen] = useState(false);
  const [bulkChangePriceOpen, setBulkChangePriceOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [selectedRowsForBulk, setSelectedRowsForBulk] = useState<Product[]>([]);
  // Day 17/05/2026: IDs riêng — có thể nhiều hơn selectedRowsForBulk khi user
  // dùng "Chọn tất cả X SP khớp bộ lọc" (cross-page).
  const [selectedIdsForBulk, setSelectedIdsForBulk] = useState<string[]>([]);
  // Derived: số SP thực sự sẽ áp dụng bulk action — ưu tiên ids (cross-page)
  const bulkSelectedCount = selectedIdsForBulk.length > 0
    ? selectedIdsForBulk.length
    : selectedRowsForBulk.length;
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
  // Day 17/05/2026 (00091 soft delete): default chỉ hiện SP active. User
  // chọn "Đã ngừng KD" để xem SP đã soft-delete + khôi phục.
  const [statusFilter, setStatusFilter] = useState("active");
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
      search: debouncedSearch,
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

    // Day 18/05/2026 (CEO): query BOM status cho SKU có has_bom=true
    // → set state để badge "Chưa có BOM" hiển thị warning.
    if (scope === "sku") {
      const skuIdsWithBomFlag = result.data
        .filter((p) => p.hasBom)
        .map((p) => p.id);
      if (skuIdsWithBomFlag.length > 0) {
        try {
          const idsWithActiveBom = await getProductIdsWithActiveBom(skuIdsWithBomFlag);
          setProductsWithActiveBom(idsWithActiveBom);
        } catch {
          // silent — không block list nếu query BOM fail
        }
      } else {
        setProductsWithActiveBom(new Set());
      }
    } else {
      setProductsWithActiveBom(new Set());
    }

    // Day 19/05/2026 (CEO Smart Hybrid Phase 2): batch UOM conversions cho
    // các SP hiện ra. Cell "Tồn kho" sẽ show "24 hộp · 2 thùng".
    const productIds = Array.from(new Set(result.data.map((p) => p.id)));
    if (productIds.length > 0) {
      try {
        const map = await getUOMConversionsByProductIds(productIds);
        setConversionsMap(map);
      } catch {
        setConversionsMap(new Map());
      }
    } else {
      setConversionsMap(new Map());
    }
  }, [page, pageSize, debouncedSearch, scope, categoryFilter, stockFilter, statusFilter, brandFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CEO 23/05/2026: Fix bug F5 không hiện data mới — refetch khi tab
  // quay lại visible hoặc bfcache restore. Pattern React Query / SWR.
  useRevalidateOnFocus(fetchData);

  // Fetch stats KPI (totalCount, stockValue, outOfStock, lowStock) theo scope
  const fetchStats = useCallback(async () => {
    try {
      const s = await getProductStats(scope);
      setStats(s);
    } catch {
      // silent fail — KPI không critical cho page
    }
  }, [scope]);

  // PERF F10: Bỏ dep `data` — trước đây mỗi lần fetchData xong (đổi page/
  // search/filter) → data đổi → fetchStats re-run lại. Stats CHỈ phụ thuộc
  // scope (NVL/SKU) — không cần refetch khi user filter trong cùng scope.
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ============================================================
  // Bulk action handlers — gọi mutation, toast, refetch, clear
  // ============================================================
  const finishBulkSuccess = useCallback(
    async (title: string, description?: string) => {
      // Day 17/05/2026: duration 8s — CEO báo toast "ngừng KD" đọc không kịp.
      // Empty title/description skip toast (caller dùng để chỉ trigger refetch).
      if (title || description) {
        toast({ variant: "success", title, description, duration: 8000 });
      }
      await fetchData();
      setSelectedRowsForBulk([]);
      setSelectedIdsForBulk([]);
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
    // Day 17/05/2026: dùng selectedIdsForBulk (có thể cross-page) thay vì
    // chỉ rows trong trang hiện tại.
    const ids = selectedIdsForBulk.length > 0
      ? selectedIdsForBulk
      : selectedRowsForBulk.map((p) => p.id);
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
  }, [bulkCategoryValue, selectedRowsForBulk, selectedIdsForBulk, toast, finishBulkSuccess, finishBulkError]);

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

    const ids = selectedIdsForBulk.length > 0
      ? selectedIdsForBulk
      : selectedRowsForBulk.map((p) => p.id);
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
  }, [bulkSellPriceValue, bulkCostPriceValue, selectedRowsForBulk, selectedIdsForBulk, toast, finishBulkSuccess, finishBulkError]);

  const handleConfirmSingleDelete = useCallback(async () => {
    if (!deletingProduct) return;

    // Phase 3a: cashier không có quyền → chuyển sang flow OTP delegation.
    // Đóng ConfirmDialog, mở OtpApprovalDialog. Cashier xin OTP từ quản lý.
    if (!canDeleteProduct) {
      setOtpTargetProduct(deletingProduct);
      setDeleteConfirmOpen(false);
      setDeletingProduct(null);
      setOtpDialogOpen(true);
      return;
    }

    setDeleteLoading(true);
    try {
      await deleteProduct(deletingProduct.id);
      setDeleteConfirmOpen(false);
      setDeletingProduct(null);
      // Day 17/05/2026 (00091): soft delete — text rõ là "ngừng kinh doanh".
      // Description rút gọn để đọc kịp, duration 8s.
      toast({
        variant: "success",
        title: `Đã ngừng kinh doanh: ${deletingProduct.code}`,
        description: `Lịch sử kế toán giữ nguyên. Mở tab "Đã ngừng KD" để khôi phục.`,
        duration: 8000,
      });
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vui lòng thử lại sau.";
      toast({ variant: "error", title: "Ngừng kinh doanh thất bại", description: message });
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingProduct, canDeleteProduct, toast, fetchData]);

  const handleOtpApproved = useCallback(async (otpId: string) => {
    if (!otpTargetProduct) return;
    try {
      await deleteProduct(otpTargetProduct.id, otpId);
      toast({
        variant: "success",
        title: `Đã ngừng kinh doanh: ${otpTargetProduct.code}`,
        description: `Duyệt từ xa qua OTP. Lịch sử kế toán giữ nguyên.`,
        duration: 8000,
      });
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vui lòng thử lại sau.";
      toast({ variant: "error", title: "Ngừng kinh doanh thất bại", description: message });
    } finally {
      setOtpTargetProduct(null);
    }
  }, [otpTargetProduct, toast, fetchData]);

  const handleConfirmBulkDelete = useCallback(async () => {
    // Day 17/05/2026: ưu tiên selectedIdsForBulk (cross-page) — nếu user dùng
    // "Chọn tất cả X SP khớp bộ lọc" thì ids có thể >> rows trong trang.
    const ids = selectedIdsForBulk.length > 0
      ? selectedIdsForBulk
      : selectedRowsForBulk.map((p) => p.id);
    if (ids.length === 0) return;
    // Bulk delete giữ permission gate cứng — không support OTP flow vì OTP
    // chỉ approve 1 thao tác, không phải N thao tác. Cashier cần xoá nhiều
    // SP phải xin manager tự làm hoặc cấp quyền tạm thời.
    if (!canDeleteProduct) {
      toast({
        variant: "warning",
        title: "Không có quyền xoá nhiều sản phẩm",
        description: "Bulk delete cần quyền 'products.delete'. OTP chỉ duyệt 1 SP/lần — nhờ quản lý tự thực hiện.",
      });
      setBulkDeleteConfirmOpen(false);
      return;
    }
    setBulkLoading(true);
    try {
      // Day 17/05/2026 (00091): SOFT DELETE — set is_active=false thay vì xoá
      // hẳn. SP biến mất khỏi danh sách + POS + dropdown nhưng lịch sử kế toán
      // giữ nguyên. Tuân thủ TT200/133. Chỉ chặn nếu còn tồn kho > 0.
      const result = await bulkDeleteProducts(ids);
      setBulkDeleteConfirmOpen(false);

      const verb = "Đã ngừng kinh doanh";
      if (result.failed.length === 0) {
        // Day 17/05/2026: rút gọn description (CEO báo toast đọc không kịp)
        await finishBulkSuccess(
          `${verb} ${result.count} SP`,
          `Lịch sử kế toán giữ nguyên. Mở tab "Đã ngừng KD" để khôi phục.`,
        );
      } else if (result.count > 0) {
        const failedSummary = result.failed
          .slice(0, 5)
          .map((f) => `• ${f.productCode ?? "—"} ${f.productName ?? ""}: ${f.reason}`)
          .join("\n");
        const moreNote =
          result.failed.length > 5
            ? `\n…và ${result.failed.length - 5} SP khác`
            : "";
        toast({
          variant: "warning",
          title: `${verb} ${result.count}/${result.total} SP — ${result.failed.length} SP chưa ngừng được`,
          description: failedSummary + moreNote,
          duration: 10000,
        });
        await finishBulkSuccess("", "");
      } else {
        const failedSummary = result.failed
          .slice(0, 5)
          .map((f) => `• ${f.productCode ?? "—"} ${f.productName ?? ""}: ${f.reason}`)
          .join("\n");
        const moreNote =
          result.failed.length > 5
            ? `\n…và ${result.failed.length - 5} SP khác`
            : "";
        toast({
          variant: "error",
          title: "Chưa ngừng kinh doanh được SP nào",
          description: failedSummary + moreNote,
          duration: 10000,
        });
      }
    } catch (err) {
      finishBulkError("Ngừng kinh doanh sản phẩm thất bại", err);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedRowsForBulk, selectedIdsForBulk, canDeleteProduct, toast, finishBulkSuccess, finishBulkError]);

  // Day 17/05/2026: Bulk KHÔI PHỤC nhiều SP đã ngừng KD.
  // Thay bulk "Xoá (idempotent)" vô nghĩa trong tab "Đã ngừng KD".
  const handleConfirmBulkRestore = useCallback(async () => {
    const ids = selectedIdsForBulk.length > 0
      ? selectedIdsForBulk
      : selectedRowsForBulk.map((p) => p.id);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      const result = await bulkRestoreProducts(ids);
      setBulkRestoreConfirmOpen(false);
      if (result.failed.length === 0) {
        await finishBulkSuccess(
          "Đã khôi phục",
          `${result.count}/${result.total} SP đang kinh doanh trở lại.`,
        );
      } else if (result.count > 0) {
        toast({
          variant: "warning",
          title: `Khôi phục ${result.count}/${result.total} SP — ${result.failed.length} SP fail`,
          description: result.failed.slice(0, 5).map((f) => `• ${f.reason}`).join("\n"),
          duration: 10000,
        });
        await finishBulkSuccess("", "");
      } else {
        toast({
          variant: "error",
          title: "Không khôi phục được SP nào",
          description: result.failed.slice(0, 5).map((f) => `• ${f.reason}`).join("\n"),
          duration: 10000,
        });
      }
    } catch (err) {
      finishBulkError("Khôi phục sản phẩm thất bại", err);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedRowsForBulk, selectedIdsForBulk, toast, finishBulkSuccess, finishBulkError]);

  // Day 17/05/2026 (00093): Bulk CLEANUP TEST DATA — bypass stock + active check.
  // SP có giao dịch thực (invoice_items, stock_movements, ...) vẫn bị skip.
  // Yêu cầu nhập mật khẩu (AWS pattern) trước khi gọi RPC.
  const handleConfirmBulkCleanup = useCallback(async () => {
    const ids = selectedIdsForBulk.length > 0
      ? selectedIdsForBulk
      : selectedRowsForBulk.map((p) => p.id);
    if (ids.length === 0) return;
    setConfirmPasswordError("");

    // Verify password trước khi RPC — chống click nhầm + chống lạm dụng quyền
    if (!confirmPassword) {
      setConfirmPasswordError("Vui lòng nhập mật khẩu để xác nhận.");
      return;
    }
    if (!user?.email) {
      setConfirmPasswordError("Không lấy được email tài khoản. Vui lòng đăng nhập lại.");
      return;
    }
    setBulkLoading(true);
    try {
      const ok = await verifyCurrentUserPassword(user.email, confirmPassword);
      if (!ok) {
        setConfirmPasswordError("Sai mật khẩu — không xoá. Vui lòng nhập lại.");
        setBulkLoading(false);
        return;
      }
      const result = await bulkCleanupTestProducts(ids);
      setConfirmPassword("");
      setBulkCleanupConfirmOpen(false);

      if (result.failed.length === 0) {
        await finishBulkSuccess(
          "Đã cleanup test data",
          `${result.count}/${result.total} SP test bị xoá vĩnh viễn + reset tồn kho.`,
        );
      } else if (result.count > 0) {
        const failedSummary = result.failed
          .slice(0, 5)
          .map((f) => `• ${f.reason}`)
          .join("\n");
        const moreNote =
          result.failed.length > 5
            ? `\n…và ${result.failed.length - 5} SP khác`
            : "";
        toast({
          variant: "warning",
          title: `Cleanup ${result.count}/${result.total} SP — ${result.failed.length} SP có giao dịch thực, không cleanup`,
          description: failedSummary + moreNote,
          duration: 12000,
        });
        await finishBulkSuccess("", "");
      } else {
        const failedSummary = result.failed
          .slice(0, 5)
          .map((f) => `• ${f.reason}`)
          .join("\n");
        const moreNote =
          result.failed.length > 5
            ? `\n…và ${result.failed.length - 5} SP khác`
            : "";
        toast({
          variant: "error",
          title: "Không cleanup được SP nào — tất cả có giao dịch thực",
          description: failedSummary + moreNote,
          duration: 12000,
        });
      }
    } catch (err) {
      finishBulkError("Xoá triệt để thất bại", err);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedRowsForBulk, selectedIdsForBulk, confirmPassword, user, toast, finishBulkSuccess, finishBulkError]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [debouncedSearch, scope, categoryFilter, stockFilter, statusFilter, brandFilter, expectedOutDate, createdDatePreset, supplierFilter]);

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
        minStock: p.minStock,
        maxStock: p.maxStock,
        vatRate: p.vatRate,
        barcode: p.barcode,
        groupCode: p.groupCode,
        purchaseUnit: p.purchaseUnit,
        stockUnit: p.stockUnit,
        sellUnit: p.sellUnit,
        description: p.description,
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

  // Day 20/05/2026 (CEO): bỏ tính năng arrow up/down move sort_order SP
  // → bỏ luôn handler + state. Thay bằng column toggle dropdown.

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
    // Day 20/05/2026 (CEO): bỏ cột "sort" (arrow up/down chuyển vị trí SP)
    // — chiếm 70px ngang nhưng ít dùng. Thay bằng column toggle dropdown
    // để user chọn cột muốn hiển thị (icon "tune" góc trên phải).
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
      enableHiding: false,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên hàng",
      size: 280,
      enableHiding: false,
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
    // Day 20/05/2026 (CEO): Phương án D đã ship 1 ô "Đơn vị tính" duy nhất.
    // 2 cột "ĐVT mua / ĐVT kho" trùng nhau (đều = unit chính) → bỏ.
    // Thay bằng 1 cột "Đơn vị" + cột "Quy đổi" hiện khi SP có conversion.
    {
      id: "unit",
      header: "Đơn vị",
      size: 90,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.unit ?? row.original.stockUnit ?? "—"}
        </span>
      ),
    },
    {
      id: "uom_conversion",
      header: "Quy đổi",
      size: 160,
      cell: ({ row }) => {
        const convs = conversionsMap.get(row.original.id);
        if (!convs || convs.length === 0) {
          return <span className="text-muted-foreground/40 text-xs">—</span>;
        }
        // Hiện conversion đầu tiên match toUnit === unit chính của SP
        const unit = row.original.unit ?? row.original.stockUnit ?? "";
        const match = convs.find((c) => c.toUnit === unit) ?? convs[0];
        return (
          <span className="text-xs text-muted-foreground tabular-nums">
            1 <b className="text-foreground">{match.fromUnit}</b> = {match.factor}{" "}
            {match.toUnit}
          </span>
        );
      },
    },
    // Sprint A.2: column "Giá vốn" chỉ hiện khi user có products.view_cost
    ...(canViewCost
      ? [
          {
            accessorKey: "costPrice",
            header: "Giá vốn",
            cell: ({ row }: { row: { original: Product } }) => (
              <span className="text-right block">{formatCurrency(row.original.costPrice)}</span>
            ),
          } as ColumnDef<Product, unknown>,
        ]
      : []),
    {
      accessorKey: "stock",
      header: "Tồn kho",
      size: 150,
      cell: ({ row }) => {
        const stock = row.original.stock;
        return (
          <span
            className={
              stock === 0
                ? "text-destructive"
                : stock <= 5
                  ? "text-status-warning"
                  : ""
            }
          >
            <StockWithConversion
              quantity={stock}
              unit={row.original.unit ?? ""}
              conversions={conversionsMap.get(row.original.id) ?? null}
              variant="inline"
            />
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
    // Day 20/05/2026 (CEO): 7 cột optional ẩn mặc định — user tick qua
    // dropdown "Hiển thị cột" để hiện khi cần.
    {
      id: "brand",
      header: "Thương hiệu",
      size: 130,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.brand ?? "—"}</span>
      ),
    },
    {
      id: "supplier",
      header: "Nhà cung cấp",
      size: 160,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.supplierName ?? "—"}
        </span>
      ),
    },
    {
      id: "barcode",
      header: "Mã vạch",
      size: 140,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.barcode ?? "—"}
        </span>
      ),
    },
    {
      id: "shelfLife",
      header: "HSD",
      size: 100,
      cell: ({ row }) => {
        const d = row.original.shelfLifeDays;
        const u = row.original.shelfLifeUnit;
        if (!d) return <span className="text-muted-foreground">—</span>;
        const label = u === "year" ? "năm" : u === "month" ? "tháng" : "ngày";
        return (
          <span className="text-muted-foreground tabular-nums">
            {d} {label}
          </span>
        );
      },
    },
    {
      id: "minStock",
      header: "Tồn min",
      size: 90,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.minStock ?? "—"}
        </span>
      ),
    },
    {
      id: "vatRate",
      header: "VAT",
      size: 70,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.vatRate}%
        </span>
      ),
    },
  ];

  const skuColumns: ColumnDef<Product, unknown>[] = [
    ...baseColumns,
    {
      id: "hasBom",
      header: "BOM",
      size: 130,
      cell: ({ row }) => {
        if (!row.original.hasBom) {
          return <span className="text-muted-foreground text-xs">Mua bán</span>;
        }
        // Day 18/05/2026 (CEO): SKU đánh dấu "có BOM" nhưng thực tế chưa setup
        // → warning vàng để CEO biết bổ sung. Bán không trừ NVL đúng.
        const hasActiveBom = productsWithActiveBom.has(row.original.id);
        return hasActiveBom ? (
          <span className="inline-flex items-center rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">
            <Icon name="check_circle" size={12} className="mr-1" />
            Có BOM
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded-full bg-status-warning/10 text-status-warning border border-status-warning/30 text-xs px-2 py-0.5"
            title="SKU đã đánh dấu 'có BOM' nhưng chưa setup công thức. Vào /hang-hoa/cong-thuc để tạo BOM, nếu không POS sẽ không tự trừ NVL."
          >
            <Icon name="warning" size={12} className="mr-1" />
            Chưa setup
          </span>
        );
      },
    },
    {
      accessorKey: "sellPrice",
      header: "Giá bán",
      cell: ({ row }) => (
        <span className="text-right block">{formatCurrency(row.original.sellPrice)}</span>
      ),
    },
    // Sprint A.2: column "Giá vốn" chỉ hiện khi user có products.view_cost
    ...(canViewCost
      ? [
          {
            accessorKey: "costPrice",
            header: "Giá vốn",
            cell: ({ row }: { row: { original: Product } }) => (
              <span className="text-right block">{formatCurrency(row.original.costPrice)}</span>
            ),
          } as ColumnDef<Product, unknown>,
        ]
      : []),
    {
      accessorKey: "stock",
      header: "Tồn kho",
      size: 150,
      cell: ({ row }) => {
        const stock = row.original.stock;
        return (
          <span
            className={
              stock === 0
                ? "text-destructive"
                : stock <= 5
                  ? "text-status-warning"
                  : ""
            }
          >
            <StockWithConversion
              quantity={stock}
              unit={row.original.unit ?? ""}
              conversions={conversionsMap.get(row.original.id) ?? null}
              variant="inline"
            />
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
    // Day 20/05/2026 (CEO): cột optional cho SKU (ẩn mặc định)
    {
      id: "channel",
      header: "Kênh bán",
      size: 100,
      cell: ({ row }) => {
        const c = row.original.channel;
        if (!c) return <span className="text-muted-foreground">—</span>;
        const label = c === "fnb" ? "FnB" : "Bán lẻ/sỉ";
        return (
          <span className="inline-flex items-center rounded bg-muted text-xs px-1.5 py-0.5">
            {label}
          </span>
        );
      },
    },
    {
      id: "brand",
      header: "Thương hiệu",
      size: 130,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.brand ?? "—"}</span>
      ),
    },
    {
      id: "supplier",
      header: "Nhà cung cấp",
      size: 160,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.supplierName ?? "—"}
        </span>
      ),
    },
    {
      id: "barcode",
      header: "Mã vạch",
      size: 140,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.barcode ?? "—"}
        </span>
      ),
    },
    {
      id: "shelfLife",
      header: "HSD",
      size: 100,
      cell: ({ row }) => {
        const d = row.original.shelfLifeDays;
        const u = row.original.shelfLifeUnit;
        if (!d) return <span className="text-muted-foreground">—</span>;
        const label = u === "year" ? "năm" : u === "month" ? "tháng" : "ngày";
        return (
          <span className="text-muted-foreground tabular-nums">
            {d} {label}
          </span>
        );
      },
    },
    {
      id: "minStock",
      header: "Tồn min",
      size: 90,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.minStock ?? "—"}
        </span>
      ),
    },
    {
      id: "vatRate",
      header: "VAT",
      size: 70,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.vatRate}%
        </span>
      ),
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

            {/* Day 17/05/2026: default "active" — chỉ hiện SP đang KD. User
                chọn "Đã ngừng KD" để xem + khôi phục SP đã soft delete. */}
            <FilterGroup label="Trạng thái kinh doanh">
              <SelectFilter
                options={[
                  { label: "Đang kinh doanh", value: "active" },
                  { label: "Đã ngừng KD (có thể khôi phục)", value: "inactive" },
                  { label: "Tất cả", value: "all" },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Đang kinh doanh"
              />
            </FilterGroup>

            <FilterGroup label="Dự kiến hết hàng">
              <DatePresetFilter
                value={expectedOutDate}
                onChange={setExpectedOutDate}
                presets={STANDARD_LIST_PRESETS}
              />
            </FilterGroup>

            <FilterGroup label="Thời gian tạo">
              <DatePresetFilter
                value={createdDatePreset}
                onChange={setCreatedDatePreset}
                presets={STANDARD_LIST_PRESETS}
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
          {/* CEO 22/05/2026 (UX P0 #2): pass loading=true khi stats null →
              skeleton shimmer thay vì "—" gây user nghi ngờ "lỗi à?" */}
          <SummaryCard
            icon={<Icon name="inventory_2" size={16} />}
            label={scope === "nvl" ? "Tổng NVL" : "Tổng hàng bán"}
            value={stats ? formatNumber(stats.totalCount) : ""}
            loading={!stats}
          />
          <SummaryCard
            icon={<Icon name="savings" size={16} />}
            label="Giá trị tồn kho"
            value={stats ? formatCurrency(stats.stockValue) : ""}
            loading={!stats}
            highlight
          />
          <SummaryCard
            icon={<Icon name="remove_shopping_cart" size={16} />}
            label="Hết hàng"
            value={stats ? formatNumber(stats.outOfStock) : ""}
            loading={!stats}
            danger={(stats?.outOfStock ?? 0) > 0}
          />
          <SummaryCard
            icon={<Icon name="warning" size={16} />}
            label="Sắp hết (≤ 5)"
            value={stats ? formatNumber(stats.lowStock) : ""}
            loading={!stats}
            danger={(stats?.lowStock ?? 0) > 0}
          />
        </div>

        {/* Day 17/05/2026: Tab chip filter status — visible ngay, không cần
            mở FilterSidebar. CEO báo không tìm thấy filter "Ngừng KD" ở sidebar. */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
          <span className="text-xs text-on-surface-variant mr-1">Trạng thái:</span>
          {[
            { label: "Đang kinh doanh", value: "active", icon: "check_circle" },
            { label: "Đã ngừng KD", value: "inactive", icon: "block" },
            { label: "Tất cả", value: "all", icon: "list" },
          ].map((tab) => {
            const isActive = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusFilter(tab.value)}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border " +
                  (isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-surface-variant text-on-surface-variant border-border hover:bg-surface-container")
                }
              >
                <Icon name={tab.icon} size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          // CEO 22/05/2026 (UX P0 #1): empty state context-aware
          emptyIcon={scope === "nvl" ? "inventory_2" : "shopping_bag"}
          emptyTitle={
            scope === "nvl"
              ? "Chưa có nguyên vật liệu nào"
              : "Chưa có sản phẩm bán nào"
          }
          emptyDescription={
            scope === "nvl"
              ? 'Bấm "Tạo mới" để thêm NVL hoặc "Nhập Excel" để import batch.'
              : 'Bấm "Tạo mới" để thêm SKU hoặc "Nhập Excel" để import batch.'
          }
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
          columnToggle
          // Day 20/05/2026 (CEO): các cột optional ẩn mặc định —
          // user tick qua dropdown "Hiển thị cột" để hiện khi cần.
          // Tránh bảng quá rộng + giữ view sạch cho 80% use case.
          defaultColumnVisibility={{
            brand: false,
            supplier: false,
            barcode: false,
            shelfLife: false,
            minStock: false,
            vatRate: false,
            channel: false,
            uom_conversion: false,
          }}
          getRowId={(row) => row.id}
          clearSelectionTrigger={clearSelectionToken}
          onSelectAllMatching={async () => {
            // Day 17/05/2026: fetch tất cả product IDs khớp filter hiện tại
            // (kể cả các trang chưa load). Reuse filter logic của getProducts.
            return getAllMatchingProductIds({
              search,
              page: 0,
              pageSize: 5000,
              filters: {
                productType: scope,
                ...(categoryFilter !== "all" && { category: [categoryFilter] }),
                ...(stockFilter !== "all" && { stock: stockFilter }),
                ...(statusFilter !== "all" && { status: statusFilter }),
                ...(brandFilter !== "all" && { brand: brandFilter }),
              },
            });
          }}
          bulkActions={[
            {
              label: "Đổi nhóm",
              icon: <Icon name="label" size={16} />,
              onClick: (rows, ids) => {
                setSelectedRowsForBulk(rows);
                setSelectedIdsForBulk(ids);
                setBulkChangeCategoryOpen(true);
              },
            },
            {
              label: "Đổi giá",
              icon: <Icon name="attach_money" size={16} />,
              onClick: (rows, ids) => {
                setSelectedRowsForBulk(rows);
                setSelectedIdsForBulk(ids);
                setBulkChangePriceOpen(true);
              },
            },
            // Day 17/05/2026 (CEO bảo gộp): tab "Đang KD" → "Ngừng KD";
            // tab "Đã ngừng KD" → "Khôi phục" (bulk restore, thay "Xoá idempotent").
            ...(canDeleteProduct && statusFilter !== "inactive"
              ? [
                  {
                    label: "Ngừng KD",
                    icon: <Icon name="block" size={16} />,
                    variant: "destructive" as const,
                    onClick: (rows: Product[], ids: string[]) => {
                      setSelectedRowsForBulk(rows);
                      setSelectedIdsForBulk(ids);
                      setBulkDeleteConfirmOpen(true);
                    },
                  },
                ]
              : []),
            ...(statusFilter === "inactive"
              ? [
                  {
                    label: "Khôi phục",
                    icon: <Icon name="restore" size={16} />,
                    onClick: (rows: Product[], ids: string[]) => {
                      setSelectedRowsForBulk(rows);
                      setSelectedIdsForBulk(ids);
                      setBulkRestoreConfirmOpen(true);
                    },
                  },
                ]
              : []),
            // Day 17/05/2026 (CEO): gộp "Xoá hẳn" + "Xoá triệt để" thành 1 nút
            // "Xoá vĩnh viễn". Logic dùng cleanup_test_product (bypass stock +
            // active, vẫn check 15 bảng FK giao dịch thực). Password verify.
            ...(isOwner
              ? [
                  {
                    label: "Xoá vĩnh viễn",
                    icon: <Icon name="delete_forever" size={16} />,
                    variant: "destructive" as const,
                    onClick: (rows: Product[], ids: string[]) => {
                      setSelectedRowsForBulk(rows);
                      setSelectedIdsForBulk(ids);
                      setBulkCleanupConfirmOpen(true);
                    },
                  },
                ]
              : []),
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
              // Phase 3a: button "Xoá" luôn hiện. Cashier không có quyền sẽ
              // được chuyển sang OTP flow ở handleConfirmSingleDelete.
              onDelete={() => {
                setDeletingProduct(product);
                setDeleteConfirmOpen(true);
              }}
              canViewCost={canViewCost}
            />
          )}
          rowActions={(row) => {
            const isInactive = row.status === "inactive";
            // Day 17/05/2026 (00091): SP inactive → menu "Khôi phục" thay vì
            // "Ngừng KD". UX khác biệt rõ ràng cho user biết trạng thái.
            const actions: Array<{
              label: string;
              icon: React.ReactNode;
              onClick: () => void;
              variant?: "destructive";
              separator?: boolean;
            }> = [
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
                onClick: async () => {
                  try {
                    const copy = await duplicateProduct(row.id);
                    toast({
                      variant: "success",
                      title: "Đã sao chép",
                      description: `Bản sao mới: ${copy.code} — ${copy.name}`,
                    });
                    fetchData();
                  } catch (err) {
                    toast({
                      variant: "error",
                      title: "Không sao chép được",
                      description: err instanceof Error ? err.message : "Lỗi không xác định",
                    });
                  }
                },
              },
            ];

            if (isInactive) {
              actions.push({
                label: "Khôi phục",
                icon: <Icon name="restore" size={16} />,
                onClick: async () => {
                  try {
                    await restoreProduct(row.id);
                    toast({
                      variant: "success",
                      title: "Đã khôi phục SP",
                      description: `${row.code} — ${row.name} đang kinh doanh trở lại`,
                    });
                    fetchData();
                  } catch (err) {
                    toast({
                      variant: "error",
                      title: "Không khôi phục được",
                      description: err instanceof Error ? err.message : "Lỗi không xác định",
                    });
                  }
                },
                separator: true,
              });
              // Day 17/05/2026 (CEO gộp): row action "Xoá vĩnh viễn" — chỉ owner.
              // Dùng cùng dialog bulkCleanup với 1 SP (đỡ duplicate code).
              if (isOwner) {
                actions.push({
                  label: "Xoá vĩnh viễn",
                  icon: <Icon name="delete_forever" size={16} />,
                  onClick: () => {
                    setSelectedRowsForBulk([row]);
                    setSelectedIdsForBulk([row.id]);
                    setBulkCleanupConfirmOpen(true);
                  },
                  variant: "destructive" as const,
                });
              }
            } else {
              actions.push({
                label: "Ngừng kinh doanh",
                icon: <Icon name="block" size={16} />,
                onClick: () => {
                  setDeletingProduct(row);
                  setDeleteConfirmOpen(true);
                },
                variant: "destructive" as const,
                separator: true,
              });
            }

            return actions;
          }}
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
            <DialogTitle>Ngừng kinh doanh sản phẩm?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Sản phẩm <strong>{deletingProduct?.code}</strong> —{" "}
                <strong>{deletingProduct?.name}</strong> sẽ bị ẩn khỏi danh
                sách + POS + dropdown đặt hàng. <b>Lịch sử kế toán giữ nguyên</b>
                {" "}(hoá đơn, đơn nhập, lịch sử kho vẫn xem được). Có thể
                khôi phục bất kỳ lúc nào.
              </span>
              {!canDeleteProduct && (
                <span className="block rounded-md bg-status-warning/10 border border-status-warning/30 p-2.5 text-xs text-foreground">
                  <Icon name="pin" size={14} className="inline-block mr-1 text-status-warning" />
                  Bạn không có quyền. Sau khi xác nhận, hệ thống sẽ yêu cầu OTP từ quản lý.
                </span>
              )}
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
              {deleteLoading
                ? "Đang xử lý..."
                : canDeleteProduct
                  ? "Ngừng kinh doanh"
                  : "Xin OTP duyệt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Day 17/05/2026 (CEO): Bulk Khôi phục dialog --- */}
      <Dialog
        open={bulkRestoreConfirmOpen}
        onOpenChange={(o) => {
          if (bulkLoading) return;
          setBulkRestoreConfirmOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Icon name="restore" size={20} className="inline-block mr-2 align-text-bottom" />
              Khôi phục {bulkSelectedCount} sản phẩm?
            </DialogTitle>
            <DialogDescription>
              <b>{bulkSelectedCount}</b> SP sẽ chuyển trạng thái về
              <b> đang kinh doanh</b> (hiện lại trong POS + danh sách).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-24 overflow-y-auto">
            <ul className="text-xs text-muted-foreground space-y-1">
              {selectedRowsForBulk.slice(0, 5).map((p) => (
                <li key={p.id} className="truncate">
                  • {p.code} — {p.name}
                </li>
              ))}
              {bulkSelectedCount > 5 && (
                <li className="italic">…và {bulkSelectedCount - 5} sản phẩm khác</li>
              )}
            </ul>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkLoading}
              onClick={() => setBulkRestoreConfirmOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              disabled={bulkLoading}
              onClick={handleConfirmBulkRestore}
            >
              {bulkLoading ? "Đang khôi phục..." : `Khôi phục ${bulkSelectedCount} SP`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Day 17/05/2026 (CEO gộp): "Xoá vĩnh viễn" dialog + password verify --- */}
      <Dialog
        open={bulkCleanupConfirmOpen}
        onOpenChange={(o) => {
          if (bulkLoading) return;
          setBulkCleanupConfirmOpen(o);
          if (!o) {
            setConfirmPassword("");
            setConfirmPasswordError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-status-danger">
              <Icon name="delete_forever" size={20} className="inline-block mr-2 align-text-bottom" />
              Xoá vĩnh viễn {bulkSelectedCount} sản phẩm?
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                <b>{bulkSelectedCount}</b> SP sẽ bị
                <b className="text-status-danger"> xoá vĩnh viễn </b>
                cùng toàn bộ tồn kho. <b>Không thể khôi phục.</b>
              </span>
              <span className="block rounded-md bg-status-warning/10 border border-status-warning/30 p-2.5 text-xs text-foreground">
                <Icon name="warning" size={14} className="inline-block mr-1 text-status-warning" />
                Hành động này <b>BỎ QUA</b> kiểm tra tồn kho. Tồn ở các chi nhánh
                tự động reset về 0 (có audit log).
              </span>
              <span className="block rounded-md bg-primary/10 border border-primary/30 p-2.5 text-xs text-foreground">
                <Icon name="shield" size={14} className="inline-block mr-1 text-primary" />
                Server check 15 bảng giao dịch thực (hoá đơn, đặt hàng, SX,...).
                SP có giao dịch thực <b>tự skip</b> — KHÔNG xoá data thật.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-24 overflow-y-auto">
            <ul className="text-xs text-muted-foreground space-y-1">
              {selectedRowsForBulk.slice(0, 5).map((p) => (
                <li key={p.id} className="truncate">
                  • {p.code} — {p.name}
                </li>
              ))}
              {bulkSelectedCount > 5 && (
                <li className="italic">
                  …và {bulkSelectedCount - 5} sản phẩm khác
                </li>
              )}
            </ul>
          </div>
          {/* Password re-prompt (AWS/Stripe pattern) */}
          <div className="space-y-1.5 border-t border-border pt-3">
            <label htmlFor="cleanup-password" className="text-sm font-medium text-foreground">
              Nhập mật khẩu để xác nhận
            </label>
            <input
              id="cleanup-password"
              type="password"
              autoComplete="current-password"
              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Mật khẩu tài khoản của bạn"
              value={confirmPassword}
              disabled={bulkLoading}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmPasswordError) setConfirmPasswordError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && confirmPassword && !bulkLoading) {
                  handleConfirmBulkCleanup();
                }
              }}
            />
            {confirmPasswordError && (
              <p className="text-xs text-status-danger">
                <Icon name="error" size={12} className="inline-block mr-1 align-text-bottom" />
                {confirmPasswordError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkLoading}
              onClick={() => {
                setBulkCleanupConfirmOpen(false);
                setConfirmPassword("");
                setConfirmPasswordError("");
              }}
            >
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={bulkLoading || !confirmPassword}
              onClick={handleConfirmBulkCleanup}
            >
              {bulkLoading
                ? "Đang xoá..."
                : `Xoá vĩnh viễn ${bulkSelectedCount} SP`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- OTP delegation dialog (Phase 3a, CEO 12/05) --- */}
      <OtpApprovalDialog
        open={otpDialogOpen}
        onOpenChange={(o) => {
          setOtpDialogOpen(o);
          if (!o) setOtpTargetProduct(null);
        }}
        actionCode={OTP_ACTION_CODES.PRODUCTS_DELETE}
        targetMeta={
          otpTargetProduct
            ? { entity_type: "product", entity_id: otpTargetProduct.id, code: otpTargetProduct.code }
            : undefined
        }
        contextLabel={
          otpTargetProduct
            ? `Xoá sản phẩm ${otpTargetProduct.code} — ${otpTargetProduct.name}`
            : undefined
        }
        onApproved={(verified) => handleOtpApproved(verified.otpId)}
      />

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
              <strong>{bulkSelectedCount}</strong> sản phẩm. Chọn
              nhóm hàng mới để gán cho tất cả các sản phẩm này.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <select
              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
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
              Áp dụng cho <strong>{bulkSelectedCount}</strong> sản
              phẩm đã chọn. Để trống ô nào thì giữ nguyên giá trị cũ.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div className="space-y-2">
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
                className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
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
                className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
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

      {/* — Xác nhận ngừng kinh doanh (soft delete) — */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(o) => {
          if (bulkLoading) return;
          setBulkDeleteConfirmOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ngừng kinh doanh sản phẩm?</DialogTitle>
            <DialogDescription>
              <strong>{bulkSelectedCount}</strong> sản phẩm sẽ bị
              ẩn khỏi danh sách + POS + dropdown đặt hàng. <b>Lịch sử kế toán
              giữ nguyên</b> (HĐ, đơn nhập, lịch sử kho vẫn xem được). Có thể
              khôi phục lại bất kỳ lúc nào trong tab &quot;Đã ngừng KD&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-40 overflow-y-auto">
            <ul className="text-sm text-muted-foreground space-y-1">
              {selectedRowsForBulk.slice(0, 8).map((p) => (
                <li key={p.id} className="truncate">
                  • {p.code} — {p.name}
                </li>
              ))}
              {bulkSelectedCount > 8 && (
                <li className="text-xs italic">
                  …và {bulkSelectedCount - 8} sản phẩm khác
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
                ? "Đang xử lý..."
                : `Ngừng kinh doanh ${bulkSelectedCount} sản phẩm`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
