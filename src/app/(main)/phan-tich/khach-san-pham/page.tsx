"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportPageHeader } from "@/components/shared/report";
import { cn } from "@/lib/utils";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  clearReportViewPreferences,
  readReportViewPreferences,
  writeReportViewPreferences,
} from "@/lib/reports/preferences";
import { useDebounce } from "@/lib/utils/use-debounce";
import {
  getCustomerProductDetailPage,
  getCustomerProductExportRows,
  getCustomerProductReport,
} from "@/lib/services";
import type {
  CustomerProductCustomerRow,
  CustomerProductDetailPage,
  CustomerProductMatrixCell,
  CustomerProductReport,
  CustomerProductSort,
} from "@/lib/services";
import {
  buildReportTitleRows,
  exportReportToExcel,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  formatCurrency,
  formatNumber,
  formatShortDate,
} from "@/lib/format";
import { ChartCard, KpiCard } from "../_components";
import { ClientChartContainer } from "../_components/client-chart-container";

type ReportMode = "customers" | "products" | "categories";
type ProductSort = "revenue_desc" | "quantity_desc" | "name_asc";
type MatrixLimit = 10 | 20 | 50 | "all";

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const MATRIX_LIMIT_OPTIONS: MatrixLimit[] = [10, 20, 50, "all"];

const REPORT_MODES: Array<{
  id: ReportMode;
  label: string;
  icon: string;
}> = [
  { id: "customers", label: "Theo khách hàng", icon: "groups" },
  { id: "products", label: "Mặt hàng từng khách", icon: "inventory_2" },
  { id: "categories", label: "Theo nhóm hàng", icon: "table_view" },
];

type ReportDisplayMode = "complete" | "table" | "visual";
type TableDensity = "standard" | "compact";
type CustomerColumn =
  | "code"
  | "revenue"
  | "share"
  | "orders"
  | "products"
  | "quantity"
  | "topProduct"
  | "lastPurchase";
type ProductColumn =
  | "code"
  | "category"
  | "unit"
  | "orders"
  | "quantity"
  | "revenue"
  | "share"
  | "lastPurchase";

const REPORT_PATH = "/phan-tich/khach-san-pham";
const DISPLAY_MODES: Array<{
  id: ReportDisplayMode;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    id: "complete",
    label: "Đầy đủ",
    icon: "dashboard",
    description: "Chỉ số, biểu đồ và bảng số liệu",
  },
  {
    id: "table",
    label: "Bảng số liệu",
    icon: "table_rows",
    description: "Tập trung đối chiếu số liệu",
  },
  {
    id: "visual",
    label: "Phân tích trực quan",
    icon: "insert_chart",
    description: "Chỉ số và biểu đồ",
  },
];
const DENSITY_OPTIONS: Array<{
  id: TableDensity;
  label: string;
  icon: string;
}> = [
  { id: "standard", label: "Tiêu chuẩn", icon: "density_medium" },
  { id: "compact", label: "Gọn", icon: "density_small" },
];
const CUSTOMER_COLUMN_OPTIONS: Array<{
  id: CustomerColumn;
  label: string;
}> = [
  { id: "code", label: "Mã khách" },
  { id: "revenue", label: "Doanh thu" },
  { id: "share", label: "Tỷ trọng" },
  { id: "orders", label: "Số đơn" },
  { id: "products", label: "Số mã hàng" },
  { id: "quantity", label: "Số lượng" },
  { id: "topProduct", label: "Mặt hàng mua nhiều nhất" },
  { id: "lastPurchase", label: "Lần mua gần nhất" },
];
const PRODUCT_COLUMN_OPTIONS: Array<{
  id: ProductColumn;
  label: string;
}> = [
  { id: "code", label: "Mã hàng" },
  { id: "category", label: "Nhóm hàng" },
  { id: "unit", label: "Đơn vị tính" },
  { id: "orders", label: "Số đơn" },
  { id: "quantity", label: "Số lượng" },
  { id: "revenue", label: "Doanh thu" },
  { id: "share", label: "Tỷ trọng" },
  { id: "lastPurchase", label: "Lần mua gần nhất" },
];
const DEFAULT_CUSTOMER_COLUMNS = CUSTOMER_COLUMN_OPTIONS.map(
  (column) => column.id,
);
const DEFAULT_PRODUCT_COLUMNS = PRODUCT_COLUMN_OPTIONS.map(
  (column) => column.id,
);

interface InitialViewPreferences {
  mode: ReportMode;
  displayMode: ReportDisplayMode;
  density: TableDensity;
  customerColumns: CustomerColumn[];
  productColumns: ProductColumn[];
  matrixCustomerLimit: MatrixLimit;
  matrixCategoryLimit: MatrixLimit;
  highlightValues: boolean;
  pageSize: number;
  productPageSize: number;
}

function isReportMode(value: unknown): value is ReportMode {
  return value === "customers" || value === "products" || value === "categories";
}

function isDisplayMode(value: unknown): value is ReportDisplayMode {
  return value === "complete" || value === "table" || value === "visual";
}

function isTableDensity(value: unknown): value is TableDensity {
  return value === "standard" || value === "compact";
}

function normalizeColumns<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const selected = value.filter(
    (column): column is T =>
      typeof column === "string" && allowed.includes(column as T),
  );
  if (value.length === 0) return [];
  return selected.length > 0 ? Array.from(new Set(selected)) : [...fallback];
}

function normalizePageSize(value: unknown): number {
  const size = Number(value);
  return PAGE_SIZE_OPTIONS.includes(size) ? size : 50;
}

function normalizeMatrixLimit(value: unknown, fallback: MatrixLimit): MatrixLimit {
  if (value === "all") return "all";
  const size = Number(value);
  return MATRIX_LIMIT_OPTIONS.includes(size as MatrixLimit)
    ? (size as MatrixLimit)
    : fallback;
}

function formatMatrixLimit(value: MatrixLimit, label: string): string {
  return value === "all" ? `Tất cả ${label}` : `Top ${value} ${label}`;
}

function readInitialViewPreferences(): InitialViewPreferences {
  const stored = readReportViewPreferences<Record<string, unknown>>(REPORT_PATH);
  const params =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search);
  const requestedMode = params?.get("reportMode");
  const requestedDisplay = params?.get("display");
  const requestedDensity = params?.get("density");
  const requestedMatrixCustomers = params?.get("matrixCustomers");
  const requestedMatrixCategories = params?.get("matrixCategories");
  const mode = isReportMode(requestedMode)
    ? requestedMode
    : isReportMode(stored.mode)
      ? stored.mode
      : "customers";
  const displayMode = isDisplayMode(requestedDisplay)
    ? requestedDisplay
    : isDisplayMode(stored.displayMode)
      ? stored.displayMode
      : "complete";

  return {
    mode,
    displayMode:
      mode !== "customers" && displayMode === "visual"
        ? "complete"
        : displayMode,
    density: isTableDensity(requestedDensity)
      ? requestedDensity
      : isTableDensity(stored.density)
        ? stored.density
        : "standard",
    customerColumns: normalizeColumns(
      stored.customerColumns,
      DEFAULT_CUSTOMER_COLUMNS,
      DEFAULT_CUSTOMER_COLUMNS,
    ),
    productColumns: normalizeColumns(
      stored.productColumns,
      DEFAULT_PRODUCT_COLUMNS,
      DEFAULT_PRODUCT_COLUMNS,
    ),
    matrixCustomerLimit: normalizeMatrixLimit(
      requestedMatrixCustomers ?? stored.matrixCustomerLimit,
      20,
    ),
    matrixCategoryLimit: normalizeMatrixLimit(
      requestedMatrixCategories ?? stored.matrixCategoryLimit,
      10,
    ),
    highlightValues: stored.highlightValues !== false,
    pageSize: normalizePageSize(stored.pageSize),
    productPageSize: normalizePageSize(stored.productPageSize),
  };
}
function compactCurrency(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function heatClass(value: number, maximum: number): string {
  if (value <= 0 || maximum <= 0) return "text-muted-foreground/50";
  const ratio = value / maximum;
  if (ratio >= 0.75) return "bg-primary/18 font-semibold text-primary";
  if (ratio >= 0.5) return "bg-primary/12 font-medium";
  if (ratio >= 0.25) return "bg-primary/7";
  return "bg-primary/3";
}

function limitMatrixItems<T>(items: T[], limit: MatrixLimit): T[] {
  return limit === "all" ? items : items.slice(0, limit);
}

function buildMatrix(
  cells: CustomerProductMatrixCell[],
  customerLimit: MatrixLimit,
  categoryLimit: MatrixLimit,
) {
  const customerNames = new Map<string, string>();
  const categoryNames = new Map<string, string>();
  const sourceValues = new Map<string, Map<string, number>>();
  const sourceCustomerTotals = new Map<string, number>();
  const sourceCategoryTotals = new Map<string, number>();

  for (const cell of cells) {
    customerNames.set(cell.customerId, cell.customerName);
    categoryNames.set(cell.categoryId, cell.categoryName);
    const row = sourceValues.get(cell.customerId) ?? new Map<string, number>();
    row.set(cell.categoryId, cell.revenue);
    sourceValues.set(cell.customerId, row);
    sourceCustomerTotals.set(
      cell.customerId,
      (sourceCustomerTotals.get(cell.customerId) ?? 0) + cell.revenue,
    );
    sourceCategoryTotals.set(
      cell.categoryId,
      (sourceCategoryTotals.get(cell.categoryId) ?? 0) + cell.revenue,
    );
  }

  const sourceCustomers = Array.from(customerNames, ([id, name]) => ({
    id,
    name,
    total: sourceCustomerTotals.get(id) ?? 0,
  })).sort((a, b) => b.total - a.total);
  const sourceCategories = Array.from(categoryNames, ([id, name]) => ({
    id,
    name,
    total: sourceCategoryTotals.get(id) ?? 0,
  })).sort((a, b) => b.total - a.total);

  const customers = limitMatrixItems(sourceCustomers, customerLimit);
  const categories = limitMatrixItems(sourceCategories, categoryLimit);
  const values = new Map<string, Map<string, number>>();
  const customerTotals = new Map<string, number>();
  const categoryTotals = new Map<string, number>();
  let grandTotal = 0;
  let maximum = 0;

  for (const customer of customers) {
    const sourceRow = sourceValues.get(customer.id);
    const displayRow = new Map<string, number>();

    for (const category of categories) {
      const value = sourceRow?.get(category.id) ?? 0;
      displayRow.set(category.id, value);
      customerTotals.set(
        customer.id,
        (customerTotals.get(customer.id) ?? 0) + value,
      );
      categoryTotals.set(
        category.id,
        (categoryTotals.get(category.id) ?? 0) + value,
      );
      grandTotal += value;
      maximum = Math.max(maximum, value);
    }

    values.set(customer.id, displayRow);
  }

  return {
    customers: customers.map((customer) => ({
      ...customer,
      total: customerTotals.get(customer.id) ?? 0,
    })),
    categories: categories.map((category) => ({
      ...category,
      total: categoryTotals.get(category.id) ?? 0,
    })),
    values,
    customerTotals,
    categoryTotals,
    grandTotal,
    maximum,
    sourceCustomerCount: sourceCustomers.length,
    sourceCategoryCount: sourceCategories.length,
  };
}

function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
      <span>
        Hiển thị {formatNumber(start)}–{formatNumber(end)} trên {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Số dòng</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) =>
              value && onPageSizeChange(Number(value))
            }
          >
            <SelectTrigger
              size="sm"
              className="min-w-18 bg-background text-xs"
              aria-label="Số dòng mỗi trang"
            >
              <SelectValue>{pageSize}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} dòng
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          title="Trang trước"
        >
          <Icon name="chevron_left" size={18} />
        </Button>
        <span className="min-w-16 text-center text-foreground">
          {page + 1}/{pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page + 1 >= pageCount}
          onClick={() => onPageChange(page + 1)}
          title="Trang sau"
        >
          <Icon name="chevron_right" size={18} />
        </Button>
      </div>
    </div>
  );
}

export default function CustomerProductReportPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultPreset: "thisMonth",
    forceTable: true,
  });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [mode, setMode] = useState<ReportMode>("customers");
  const [displayMode, setDisplayMode] =
    useState<ReportDisplayMode>("complete");
  const [density, setDensity] = useState<TableDensity>("standard");
  const [customerColumns, setCustomerColumns] = useState<CustomerColumn[]>([
    ...DEFAULT_CUSTOMER_COLUMNS,
  ]);
  const [productColumns, setProductColumns] = useState<ProductColumn[]>([
    ...DEFAULT_PRODUCT_COLUMNS,
  ]);
  const [matrixCustomerLimit, setMatrixCustomerLimit] =
    useState<MatrixLimit>(20);
  const [matrixCategoryLimit, setMatrixCategoryLimit] =
    useState<MatrixLimit>(10);
  const [highlightValues, setHighlightValues] = useState(true);
  const [report, setReport] = useState<CustomerProductReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDebounce(search, 300);
  const [sort, setSort] = useState<CustomerProductSort>("revenue_desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [productSearch, setProductSearch] = useState("");
  const deferredProductSearch = useDebounce(productSearch, 300);
  const [productSort, setProductSort] = useState<ProductSort>("revenue_desc");
  const [productPage, setProductPage] = useState(0);
  const [productPageSize, setProductPageSize] = useState(50);
  const [detail, setDetail] = useState<CustomerProductDetailPage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const initial = readInitialViewPreferences();
    setMode(initial.mode);
    setDisplayMode(initial.displayMode);
    setDensity(initial.density);
    setCustomerColumns(initial.customerColumns);
    setProductColumns(initial.productColumns);
    setMatrixCustomerLimit(initial.matrixCustomerLimit);
    setMatrixCategoryLimit(initial.matrixCategoryLimit);
    setHighlightValues(initial.highlightValues);
    setPageSize(initial.pageSize);
    setProductPageSize(initial.productPageSize);
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;

    const url = new URL(window.location.href);
    url.searchParams.set("reportMode", mode);
    url.searchParams.set("display", displayMode);
    url.searchParams.set("density", density);
    url.searchParams.set("matrixCustomers", String(matrixCustomerLimit));
    url.searchParams.set("matrixCategories", String(matrixCategoryLimit));
    window.history.replaceState(window.history.state, "", url);

    writeReportViewPreferences(REPORT_PATH, {
      mode,
      displayMode,
      density,
      customerColumns,
      productColumns,
      matrixCustomerLimit,
      matrixCategoryLimit,
      highlightValues,
      pageSize,
      productPageSize,
    });
  }, [
    customerColumns,
    density,
    displayMode,
    highlightValues,
    matrixCategoryLimit,
    matrixCustomerLimit,
    mode,
    pageSize,
    preferencesReady,
    productColumns,
    productPageSize,
  ]);

  const changeMode = useCallback((next: ReportMode) => {
    setMode(next);
    if (next !== "customers") {
      setDisplayMode((current) =>
        current === "visual" ? "complete" : current,
      );
    }
  }, []);

  const toggleCustomerColumn = useCallback((column: CustomerColumn) => {
    setCustomerColumns((current) =>
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column],
    );
  }, []);

  const toggleProductColumn = useCallback((column: ProductColumn) => {
    setProductColumns((current) =>
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column],
    );
  }, []);

  const resetViewPreferences = useCallback(() => {
    clearReportViewPreferences(REPORT_PATH);
    setMode("customers");
    setDisplayMode("complete");
    setDensity("standard");
    setCustomerColumns([...DEFAULT_CUSTOMER_COLUMNS]);
    setProductColumns([...DEFAULT_PRODUCT_COLUMNS]);
    setMatrixCustomerLimit(20);
    setMatrixCategoryLimit(10);
    setHighlightValues(true);
    setPageSize(50);
    setProductPageSize(50);
    setPage(0);
    setProductPage(0);
    toast({
      title: "Đã khôi phục cách xem mặc định",
      variant: "success",
    });
  }, [toast]);

  useEffect(() => {
    setPage(0);
  }, [activeBranchId, deferredSearch, range.from, range.to, sort]);

  useEffect(() => {
    if (!isReady || !preferencesReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    getCustomerProductReport({
      branchId: activeBranchId ?? undefined,
      range,
      search: deferredSearch,
      sort,
      offset: page * pageSize,
      limit: pageSize,
    })
      .then((nextReport) => {
        if (!cancelled) setReport(nextReport);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message =
          reason instanceof Error ? reason.message : "Không thể tải báo cáo.";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeBranchId,
    deferredSearch,
    isReady,
    page,
    pageSize,
    preferencesReady,
    range,
    reloadKey,
    sort,
  ]);

  useEffect(() => {
    const rows = report?.customers ?? [];
    if (rows.length === 0) {
      setSelectedCustomerId(null);
      return;
    }
    if (!selectedCustomerId || !rows.some((row) => row.customerId === selectedCustomerId)) {
      setSelectedCustomerId(rows[0].customerId);
    }
  }, [report?.customers, selectedCustomerId]);

  useEffect(() => {
    setProductPage(0);
  }, [activeBranchId, deferredProductSearch, productSort, range.from, range.to]);

  useEffect(() => {
    if (
      !selectedCustomerId ||
      mode !== "products" ||
      !isReady ||
      !preferencesReady
    ) {
      return;
    }
    let cancelled = false;
    setDetailLoading(true);

    getCustomerProductDetailPage({
      branchId: activeBranchId ?? undefined,
      range,
      customerId: selectedCustomerId,
      search: deferredProductSearch,
      sort: productSort,
      offset: productPage * productPageSize,
      limit: productPageSize,
    })
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setDetail(null);
        toast({
          title: "Không tải được mặt hàng",
          description:
            reason instanceof Error ? reason.message : "Vui lòng thử lại.",
          variant: "error",
        });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeBranchId,
    deferredProductSearch,
    isReady,
    mode,
    productPage,
    preferencesReady,
    productPageSize,
    productSort,
    range,
    selectedCustomerId,
    toast,
  ]);

  const selectedCustomer = useMemo(
    () =>
      report?.customers.find((row) => row.customerId === selectedCustomerId) ??
      null,
    [report?.customers, selectedCustomerId],
  );
  const matrix = useMemo(
    () =>
      buildMatrix(
        report?.matrix ?? [],
        matrixCustomerLimit,
        matrixCategoryLimit,
      ),
    [matrixCategoryLimit, matrixCustomerLimit, report?.matrix],
  );
  const selectedModeOption =
    REPORT_MODES.find((option) => option.id === mode) ?? REPORT_MODES[0];
  const selectedDisplayOption =
    DISPLAY_MODES.find((option) => option.id === displayMode) ??
    DISPLAY_MODES[0];
  const selectedDensityOption =
    DENSITY_OPTIONS.find((option) => option.id === density) ??
    DENSITY_OPTIONS[0];
  const showKpis = displayMode !== "table";
  const showCharts = mode === "customers" && displayMode !== "table";
  const showCustomerTable = mode === "customers" && displayMode !== "visual";
  const topCustomers = useMemo(
    () =>
      (report?.customers ?? [])
        .slice()
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map((row) => ({ name: row.customerName, revenue: row.revenue })),
    [report?.customers],
  );
  const categoryChart = useMemo(
    () =>
      (report?.categories ?? []).map((row) => ({
        name: row.categoryName,
        revenue: row.revenue,
      })),
    [report?.categories],
  );

  const handleExportView = useCallback(async () => {
    if (!report) return;
    setExporting(true);
    try {
      const titleRows = buildReportTitleRows({
        title: "BÁO CÁO KHÁCH HÀNG MUA SẢN PHẨM NÀO",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      let sheet: ExcelSheet;

      if (mode === "products") {
        sheet = {
          name: "Mặt hàng từng khách",
          titleRows,
          columns: [
            { label: "Tên hàng", key: "productName", width: 34 },
            ...(productColumns.includes("code")
              ? [{ label: "Mã hàng", key: "productCode", width: 16 }]
              : []),
            ...(productColumns.includes("category")
              ? [{ label: "Nhóm hàng", key: "categoryName", width: 22 }]
              : []),
            ...(productColumns.includes("unit")
              ? [{ label: "Đơn vị tính", key: "unit", width: 12 }]
              : []),
            ...(productColumns.includes("orders")
              ? [
                  {
                    label: "Số đơn",
                    key: "orderCount",
                    width: 12,
                    format: "number" as const,
                  },
                ]
              : []),
            ...(productColumns.includes("quantity")
              ? [
                  {
                    label: "Số lượng",
                    key: "quantity",
                    width: 14,
                    format: "number" as const,
                  },
                ]
              : []),
            ...(productColumns.includes("revenue")
              ? [
                  {
                    label: "Doanh thu mặt hàng",
                    key: "revenue",
                    width: 20,
                    format: "currency" as const,
                  },
                ]
              : []),
            ...(productColumns.includes("share")
              ? [
                  {
                    label: "Tỷ trọng",
                    key: "revenueShare",
                    width: 12,
                    format: "percent" as const,
                  },
                ]
              : []),
            ...(productColumns.includes("lastPurchase")
              ? [
                  {
                    label: "Lần mua gần nhất",
                    key: "lastPurchaseAt",
                    width: 18,
                    format: "date" as const,
                  },
                ]
              : []),
          ],
          rows: (detail?.rows ?? []).map((row) => ({
            ...row,
            lastPurchaseAt: formatShortDate(row.lastPurchaseAt),
          })),
        };
      } else if (mode === "categories") {
        const columns = [
          { label: "Khách hàng", key: "customer", width: 32 },
          ...matrix.categories.map((category) => ({
            label: category.name,
            key: "category_" + category.id,
            width: 18,
            format: "currency" as const,
          })),
          {
            label: "Tổng hiển thị",
            key: "total",
            width: 20,
            format: "currency" as const,
          },
        ];
        sheet = {
          name: "Theo nhóm hàng",
          titleRows,
          columns,
          rows: matrix.customers.map((customer) => {
            const row: Record<string, unknown> = {
              customer: customer.name,
              total: customer.total,
            };
            for (const category of matrix.categories) {
              row["category_" + category.id] =
                matrix.values.get(customer.id)?.get(category.id) ?? 0;
            }
            return row;
          }),
        };
      } else {
        sheet = {
          name: "Theo khách hàng",
          titleRows,
          columns: [
            { label: "Khách hàng", key: "customerName", width: 32 },
            ...(customerColumns.includes("code")
              ? [{ label: "Mã khách", key: "customerCode", width: 16 }]
              : []),
            ...(customerColumns.includes("revenue")
              ? [
                  {
                    label: "Doanh thu mặt hàng",
                    key: "revenue",
                    width: 20,
                    format: "currency" as const,
                  },
                ]
              : []),
            ...(customerColumns.includes("share")
              ? [
                  {
                    label: "Tỷ trọng",
                    key: "revenueShare",
                    width: 12,
                    format: "percent" as const,
                  },
                ]
              : []),
            ...(customerColumns.includes("orders")
              ? [
                  {
                    label: "Số đơn",
                    key: "orderCount",
                    width: 12,
                    format: "number" as const,
                  },
                ]
              : []),
            ...(customerColumns.includes("products")
              ? [
                  {
                    label: "Số mã hàng",
                    key: "productCount",
                    width: 14,
                    format: "number" as const,
                  },
                ]
              : []),
            ...(customerColumns.includes("quantity")
              ? [
                  {
                    label: "Số lượng",
                    key: "quantity",
                    width: 14,
                    format: "number" as const,
                  },
                ]
              : []),
            ...(customerColumns.includes("topProduct")
              ? [
                  {
                    label: "Mặt hàng mua nhiều nhất",
                    key: "topProduct",
                    width: 32,
                  },
                ]
              : []),
            ...(customerColumns.includes("lastPurchase")
              ? [
                  {
                    label: "Lần mua gần nhất",
                    key: "lastPurchaseAt",
                    width: 18,
                    format: "date" as const,
                  },
                ]
              : []),
          ],
          rows: report.customers.map((row) => ({
            ...row,
            lastPurchaseAt: formatShortDate(row.lastPurchaseAt),
          })),
        };
      }
      await exportReportToExcel({
        kind: "khach-san-pham",
        mode: "view",
        range,
        branchName: branchLabel,
        reportTitle: "Khách hàng mua sản phẩm nào",
        sheets: [sheet],
      });
      toast({ title: "Đã xuất nội dung đang xem", variant: "success" });
    } catch (reason) {
      toast({
        title: "Không xuất được file",
        description: reason instanceof Error ? reason.message : "Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }, [
    branchLabel,
    customerColumns,
    detail?.rows,
    matrix,
    mode,
    productColumns,
    range,
    report,
    toast,
  ]);

  const handleExportFull = useCallback(async () => {
    if (!report) return;
    setExporting(true);
    try {
      const customerRows: CustomerProductCustomerRow[] = [];
      let customerOffset = 0;
      while (true) {
        const customerPage = await getCustomerProductReport({
          branchId: activeBranchId ?? undefined,
          range,
          sort: "revenue_desc",
          offset: customerOffset,
          limit: 100,
        });
        customerRows.push(...customerPage.customers);
        if (
          customerPage.customers.length === 0 ||
          customerRows.length >= customerPage.customerTotal
        ) {
          break;
        }
        customerOffset += customerPage.customers.length;
      }

      const productRows = await getCustomerProductExportRows({
        branchId: activeBranchId ?? undefined,
        range,
      });
      const categoryMap = new Map<
        string,
        { categoryName: string; quantity: number; revenue: number }
      >();
      for (const row of productRows) {
        const current = categoryMap.get(row.categoryName) ?? {
          categoryName: row.categoryName,
          quantity: 0,
          revenue: 0,
        };
        current.quantity += row.quantity;
        current.revenue += row.revenue;
        categoryMap.set(row.categoryName, current);
      }

      const summary = report.summary;
      const sheets: ExcelSheet[] = [
        {
          name: "Tổng quan",
          columns: [
            { label: "Chỉ số", key: "label", width: 32 },
            { label: "Giá trị", key: "value", width: 22, format: "number" },
            { label: "Đơn vị", key: "unit", width: 16 },
          ],
          rows: [
            { label: "Khách hàng có mua", value: summary.customerCount, unit: "Khách hàng" },
            { label: "Đơn hàng", value: summary.orderCount, unit: "Đơn" },
            { label: "Mã hàng đã bán", value: summary.productCount, unit: "Mã hàng" },
            { label: "Số lượng", value: summary.quantity, unit: "Sản phẩm" },
            { label: "Doanh thu mặt hàng", value: summary.revenue, unit: "VND" },
            { label: "Giá trị bình quân mỗi đơn", value: summary.averageOrderValue, unit: "VND" },
            { label: "Tỷ trọng 10 khách lớn nhất", value: summary.topTenShare, unit: "%" },
          ],
        },
        {
          name: "Khách hàng",
          columns: [
            { label: "Mã khách", key: "customerCode", width: 16 },
            { label: "Khách hàng", key: "customerName", width: 32 },
            { label: "Số đơn", key: "orderCount", width: 12, format: "number" },
            { label: "Số mã hàng", key: "productCount", width: 14, format: "number" },
            { label: "Số lượng", key: "quantity", width: 14, format: "number" },
            { label: "Doanh thu mặt hàng", key: "revenue", width: 20, format: "currency" },
            { label: "Tỷ trọng", key: "revenueShare", width: 12, format: "percent" },
            { label: "Mặt hàng mua nhiều nhất", key: "topProduct", width: 32 },
            { label: "Lần mua gần nhất", key: "lastPurchaseAt", width: 18, format: "date" },
          ],
          rows: customerRows.map((row) => ({
            ...row,
            lastPurchaseAt: formatShortDate(row.lastPurchaseAt),
          })),
        },
        {
          name: "Khách hàng - Mặt hàng",
          columns: [
            { label: "Mã khách", key: "customerCode", width: 16 },
            { label: "Khách hàng", key: "customerName", width: 32 },
            { label: "Mã hàng", key: "productCode", width: 16 },
            { label: "Tên hàng", key: "productName", width: 34 },
            { label: "Nhóm hàng", key: "categoryName", width: 22 },
            { label: "Đơn vị tính", key: "unit", width: 12 },
            { label: "Số đơn", key: "orderCount", width: 12, format: "number" },
            { label: "Số lượng", key: "quantity", width: 14, format: "number" },
            { label: "Doanh thu mặt hàng", key: "revenue", width: 20, format: "currency" },
            { label: "Lần mua gần nhất", key: "lastPurchaseAt", width: 18, format: "date" },
          ],
          rows: productRows.map((row) => ({
            ...row,
            lastPurchaseAt: formatShortDate(row.lastPurchaseAt),
          })),
        },
        {
          name: "Nhóm hàng",
          columns: [
            { label: "Nhóm hàng", key: "categoryName", width: 30 },
            { label: "Số lượng", key: "quantity", width: 16, format: "number" },
            { label: "Doanh thu mặt hàng", key: "revenue", width: 22, format: "currency" },
          ],
          rows: Array.from(categoryMap.values()).sort(
            (a, b) => b.revenue - a.revenue,
          ),
        },
      ];

      await exportReportToExcel({
        kind: "khach-san-pham",
        mode: "full",
        range,
        branchName: branchLabel,
        reportTitle: "Khách hàng mua sản phẩm nào",
        description:
          "Doanh thu mặt hàng theo khách hàng, mặt hàng và nhóm hàng trong phạm vi đã chọn.",
        guide: [
          "Doanh thu mặt hàng lấy từ dòng hàng của hóa đơn hoàn thành.",
          "File đầy đủ không giới hạn theo số dòng đang hiển thị trên màn hình.",
        ],
        sheets,
      });
      toast({ title: "Đã xuất báo cáo đầy đủ", variant: "success" });
    } catch (reason) {
      toast({
        title: "Không xuất được báo cáo đầy đủ",
        description: reason instanceof Error ? reason.message : "Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }, [activeBranchId, branchLabel, range, report, toast]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReportPageHeader
        title="Khách hàng mua sản phẩm nào"
        subtitle="Doanh thu mặt hàng theo khách hàng, mặt hàng và nhóm hàng"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={exporting || loading || !report || (mode === "products" && (detailLoading || !detail))}
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low/35 p-4 lg:p-6">
        <div className="mx-auto max-w-[1800px] space-y-4">
          <div className="flex flex-col gap-3 border-b border-border pb-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={mode}
                onValueChange={(value) =>
                  value && changeMode(value as ReportMode)
                }
              >
                <SelectTrigger
                  className="min-w-52 bg-background"
                  aria-label="Góc nhìn báo cáo"
                >
                  <SelectValue>
                    <Icon name={selectedModeOption.icon} size={15} />
                    <span>{selectedModeOption.label}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start" className="min-w-64">
                  {REPORT_MODES.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <Icon name={option.icon} size={15} />
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={displayMode}
                onValueChange={(value) =>
                  value && setDisplayMode(value as ReportDisplayMode)
                }
              >
                <SelectTrigger
                  className="min-w-48 bg-background"
                  aria-label="Nội dung hiển thị"
                >
                  <SelectValue>
                    <Icon name={selectedDisplayOption.icon} size={15} />
                    <span>{selectedDisplayOption.label}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start" className="min-w-72">
                  {DISPLAY_MODES.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      disabled={option.id === "visual" && mode !== "customers"}
                    >
                      <Icon name={option.icon} size={15} />
                      <span className="flex flex-col">
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={density}
                onValueChange={(value) =>
                  value && setDensity(value as TableDensity)
                }
              >
                <SelectTrigger
                  className="min-w-40 bg-background"
                  aria-label="Mật độ bảng"
                >
                  <SelectValue>
                    <Icon name={selectedDensityOption.icon} size={15} />
                    <span>{selectedDensityOption.label}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {DENSITY_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <Icon name={option.icon} size={15} />
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {mode === "categories" && (
                <>
                  <Select
                    value={String(matrixCustomerLimit)}
                    onValueChange={(value) =>
                      setMatrixCustomerLimit(normalizeMatrixLimit(value, 20))
                    }
                  >
                    <SelectTrigger
                      className="min-w-40 bg-background"
                      aria-label="Số khách trong bảng chéo"
                    >
                      <SelectValue>
                        <Icon name="groups" size={15} />
                        <span>
                          {formatMatrixLimit(matrixCustomerLimit, "khách")}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {MATRIX_LIMIT_OPTIONS.map((option) => (
                        <SelectItem key={String(option)} value={String(option)}>
                          {formatMatrixLimit(option, "khách")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={String(matrixCategoryLimit)}
                    onValueChange={(value) =>
                      setMatrixCategoryLimit(normalizeMatrixLimit(value, 10))
                    }
                  >
                    <SelectTrigger
                      className="min-w-40 bg-background"
                      aria-label="Số nhóm hàng trong bảng chéo"
                    >
                      <SelectValue>
                        <Icon name="category" size={15} />
                        <span>
                          {formatMatrixLimit(matrixCategoryLimit, "nhóm")}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {MATRIX_LIMIT_OPTIONS.map((option) => (
                        <SelectItem key={String(option)} value={String(option)}>
                          {formatMatrixLimit(option, "nhóm")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground outline-none hover:bg-surface-container-low">
                  <Icon name="view_column" size={16} />
                  Tùy chỉnh
                  <Icon name="expand_more" size={15} />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={6}
                  className="min-w-64 p-1"
                >
                  {mode === "customers" && (
                    <>
                      <DropdownMenuLabel>Cột khách hàng</DropdownMenuLabel>
                      {CUSTOMER_COLUMN_OPTIONS.map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.id}
                          checked={customerColumns.includes(column.id)}
                          onCheckedChange={() => toggleCustomerColumn(column.id)}
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {mode === "products" && (
                    <>
                      <DropdownMenuLabel>Cột mặt hàng</DropdownMenuLabel>
                      {PRODUCT_COLUMN_OPTIONS.map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.id}
                          checked={productColumns.includes(column.id)}
                          onCheckedChange={() => toggleProductColumn(column.id)}
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuCheckboxItem
                    checked={highlightValues}
                    onCheckedChange={(checked) =>
                      setHighlightValues(checked === true)
                    }
                  >
                    Tô màu số liệu nổi bật
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    onClick={resetViewPreferences}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-surface-container hover:text-foreground"
                  >
                    <Icon name="restart_alt" size={16} />
                    Khôi phục mặc định
                  </button>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 sm:w-72">
                <Icon
                  name="search"
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm mã hoặc tên khách hàng"
                  className="h-8 pl-9"
                  aria-label="Tìm khách hàng"
                />
              </div>
              <Select
                value={sort}
                onValueChange={(value) =>
                  value && setSort(value as CustomerProductSort)
                }
              >
                <SelectTrigger
                  className="min-w-48 bg-background"
                  aria-label="Sắp xếp khách hàng"
                >
                  <SelectValue>
                    {sort === "revenue_desc"
                      ? "Doanh thu cao nhất"
                      : sort === "orders_desc"
                        ? "Nhiều đơn nhất"
                        : sort === "quantity_desc"
                          ? "Số lượng cao nhất"
                          : "Tên khách A-Z"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="revenue_desc">Doanh thu cao nhất</SelectItem>
                  <SelectItem value="orders_desc">Nhiều đơn nhất</SelectItem>
                  <SelectItem value="quantity_desc">Số lượng cao nhất</SelectItem>
                  <SelectItem value="name_asc">Tên khách A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {loading && !report ? (
            <div className="flex min-h-80 items-center justify-center rounded-lg border border-border bg-background text-sm text-muted-foreground">
              <Icon name="progress_activity" size={24} className="mr-2 animate-spin" />
              Đang tổng hợp báo cáo...
            </div>
          ) : error ? (
            <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-status-error/30 bg-background px-6 text-center">
              <Icon name="error" size={34} className="mb-3 text-status-error" />
              <p className="font-medium text-foreground">Không tải được báo cáo</p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{error}</p>
              <Button className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>
                <Icon name="refresh" size={17} />
                Tải lại
              </Button>
            </div>
          ) : !report || report.summary.customerCount === 0 ? (
            <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 text-center">
              <Icon name="person_search" size={38} className="mb-3 text-muted-foreground" />
              <p className="font-medium text-foreground">Chưa có khách hàng mua hàng</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Hãy đổi thời gian hoặc phạm vi chi nhánh để kiểm tra.
              </p>
            </div>
          ) : (
            <>
              {showKpis && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <KpiCard
                  label="Khách có mua"
                  value={formatNumber(report.summary.customerCount)}
                  icon="groups"
                  bg="bg-primary/10"
                  iconColor="text-primary"
                  valueColor="text-foreground"
                />
                <KpiCard
                  label="Đơn hàng"
                  value={formatNumber(report.summary.orderCount)}
                  icon="receipt_long"
                  bg="bg-status-info/10"
                  iconColor="text-status-info"
                  valueColor="text-foreground"
                />
                <KpiCard
                  label="Mã hàng đã bán"
                  value={formatNumber(report.summary.productCount)}
                  icon="inventory_2"
                  bg="bg-status-success/10"
                  iconColor="text-status-success"
                  valueColor="text-foreground"
                />
                <KpiCard
                  label="Doanh thu mặt hàng"
                  value={formatCurrency(report.summary.revenue) + " ₫"}
                  icon="payments"
                  bg="bg-status-warning/10"
                  iconColor="text-status-warning"
                  valueColor="text-primary"
                />
                <KpiCard
                  label="Tỷ trọng Top 10 khách"
                  value={report.summary.topTenShare.toFixed(1) + "%"}
                  icon="leaderboard"
                  bg="bg-secondary/50"
                  iconColor="text-secondary-foreground"
                  valueColor="text-foreground"
                />
                </div>
              )}

              {mode === "customers" && (
                <div className="space-y-4">
                  {showCharts && (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <ChartCard title="Khách hàng có doanh thu cao nhất" subtitle="10 khách trong kết quả đang xem">
                      <div className="h-72">
                        <ClientChartContainer initialDimension={{ width: 320, height: 224 }}>
                          <BarChart
                            data={topCustomers}
                            layout="vertical"
                            margin={{ top: 4, right: 20, bottom: 4, left: 16 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis
                              type="number"
                              tickFormatter={(value: number) => compactCurrency(value)}
                              tick={{ fontSize: 11 }}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={150}
                              tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                              formatter={(value: unknown) =>
                                formatCurrency(Number(value) || 0) + " ₫"
                              }
                            />
                            <Bar dataKey="revenue" name="Doanh thu" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ClientChartContainer>
                      </div>
                    </ChartCard>
                    <ChartCard title="Cơ cấu doanh thu theo nhóm hàng" subtitle="10 nhóm có doanh thu cao nhất">
                      <div className="h-72">
                        <ClientChartContainer initialDimension={{ width: 320, height: 224 }}>
                          <BarChart data={categoryChart} margin={{ top: 8, right: 12, bottom: 50, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              dataKey="name"
                              angle={-30}
                              textAnchor="end"
                              interval={0}
                              height={74}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis
                              tickFormatter={(value: number) => compactCurrency(value)}
                              tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                              formatter={(value: unknown) =>
                                formatCurrency(Number(value) || 0) + " ₫"
                              }
                            />
                            <Bar dataKey="revenue" name="Doanh thu" fill="var(--status-info)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ClientChartContainer>
                      </div>
                    </ChartCard>
                    </div>
                  )}

                  {showCustomerTable && (
                    <section className="overflow-hidden rounded-lg border border-border bg-background" aria-labelledby="customer-table-title">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                      <div>
                        <h2 id="customer-table-title" className="text-sm font-semibold text-foreground">
                          Tổng hợp theo khách hàng
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatNumber(report.customerTotal)} khách phù hợp
                        </p>
                      </div>
                      {loading && <Icon name="progress_activity" size={18} className="animate-spin text-muted-foreground" />}
                    </div>
                    <div className="max-h-[620px] overflow-auto">
                      <table
                        className={cn(
                          "w-full border-collapse text-sm",
                          customerColumns.length > 5
                            ? "min-w-[1240px]"
                            : "min-w-[760px]",
                          density === "compact" &&
                            "[&_th]:!py-1.5 [&_td]:!py-1.5",
                        )}
                      >
                        <thead className="sticky top-0 z-20 bg-surface-container">
                          <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="sticky left-0 z-30 min-w-60 bg-surface-container px-3 py-2.5 text-left font-semibold">Khách hàng</th>
                            {customerColumns.includes("code") && (
                              <th className="px-3 py-2.5 text-left font-semibold">Mã khách</th>
                            )}
                            {customerColumns.includes("revenue") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Doanh thu</th>
                            )}
                            {customerColumns.includes("share") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Tỷ trọng</th>
                            )}
                            {customerColumns.includes("orders") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Số đơn</th>
                            )}
                            {customerColumns.includes("products") && (
                              <th className="px-3 py-2.5 text-right font-semibold">Số mã hàng</th>
                            )}
                            {customerColumns.includes("quantity") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Số lượng</th>
                            )}
                            {customerColumns.includes("topProduct") && (
                              <th className="min-w-56 px-3 py-2.5 text-left font-semibold">Mặt hàng mua nhiều nhất</th>
                            )}
                            {customerColumns.includes("lastPurchase") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Lần mua gần nhất</th>
                            )}
                            <th className="w-12 px-2 py-2.5"><span className="sr-only">Xem chi tiết</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.customers.map((row, index) => (
                            <tr
                              key={row.customerId}
                              className={cn(
                                "border-b border-border/60 hover:bg-surface-container-low",
                                index % 2 === 1 && "bg-surface-container-low/30",
                              )}
                            >
                              <td className="sticky left-0 z-10 bg-inherit px-3 py-2.5 font-medium text-foreground">{row.customerName}</td>
                              {customerColumns.includes("code") && (
                                <td className="px-3 py-2.5 text-muted-foreground">{row.customerCode}</td>
                              )}
                              {customerColumns.includes("revenue") && (
                                <td
                                  className={cn(
                                    "px-3 py-2.5 text-right font-semibold tabular-nums",
                                    highlightValues && "text-primary",
                                  )}
                                >
                                  {formatCurrency(row.revenue)} ₫
                                </td>
                              )}
                              {customerColumns.includes("share") && (
                              <td className="px-3 py-2.5 text-right tabular-nums">{row.revenueShare.toFixed(1)}%</td>
                              )}
                              {customerColumns.includes("orders") && (
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.orderCount)}</td>
                              )}
                              {customerColumns.includes("products") && (
                                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.productCount)}</td>
                              )}
                              {customerColumns.includes("quantity") && (
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.quantity)}</td>
                              )}
                              {customerColumns.includes("topProduct") && (
                                <td className="max-w-72 truncate px-3 py-2.5 text-muted-foreground" title={row.topProduct ?? undefined}>{row.topProduct ?? "—"}</td>
                              )}
                              {customerColumns.includes("lastPurchase") && (
                              <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatShortDate(row.lastPurchaseAt)}</td>
                              )}
                              <td className="px-2 py-2 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  title="Xem mặt hàng của khách"
                                  onClick={() => {
                                    setDetail(null);
                                    setSelectedCustomerId(row.customerId);
                                    changeMode("products");
                                  }}
                                >
                                  <Icon name="arrow_forward" size={17} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager
                      page={page}
                      pageSize={pageSize}
                      total={report.customerTotal}
                      onPageChange={setPage}
                      onPageSizeChange={(size) => {
                        setPageSize(size);
                        setPage(0);
                      }}
                    />
                    </section>
                  )}
                </div>
              )}

              {mode === "products" && (
                <section className="overflow-hidden rounded-lg border border-border bg-background" aria-labelledby="product-table-title">
                  <div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="min-w-0">
                      <label htmlFor="customer-select" className="mb-1 block text-xs font-medium text-muted-foreground">Khách hàng</label>
                      <Select
                        value={selectedCustomerId ?? ""}
                        onValueChange={(value) => {
                          if (!value) return;
                          setDetail(null);
                          setSelectedCustomerId(value);
                        }}
                      >
                        <SelectTrigger
                          id="customer-select"
                          className="max-w-full bg-background font-medium sm:min-w-80"
                          aria-label="Khách hàng"
                        >
                          <SelectValue>
                            {selectedCustomer
                              ? `${selectedCustomer.customerCode} · ${selectedCustomer.customerName}`
                              : "Chọn khách hàng"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start" className="min-w-96">
                          {report.customers.map((row) => (
                            <SelectItem key={row.customerId} value={row.customerId}>
                              {row.customerCode} · {row.customerName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative sm:w-72">
                        <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={productSearch}
                          onChange={(event) => setProductSearch(event.target.value)}
                          placeholder="Tìm mã, tên hoặc nhóm hàng"
                          className="h-9 pl-9"
                          aria-label="Tìm mặt hàng"
                        />
                      </div>
                      <Select
                        value={productSort}
                        onValueChange={(value) =>
                          value && setProductSort(value as ProductSort)
                        }
                      >
                        <SelectTrigger
                          className="min-w-48 bg-background"
                          aria-label="Sắp xếp mặt hàng"
                        >
                          <SelectValue>
                            {productSort === "revenue_desc"
                              ? "Doanh thu cao nhất"
                              : productSort === "quantity_desc"
                                ? "Số lượng cao nhất"
                                : "Tên hàng A-Z"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="revenue_desc">Doanh thu cao nhất</SelectItem>
                          <SelectItem value="quantity_desc">Số lượng cao nhất</SelectItem>
                          <SelectItem value="name_asc">Tên hàng A–Z</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-container-low/40 px-4 py-2.5">
                    <div>
                      <h2 id="product-table-title" className="text-sm font-semibold text-foreground">
                        {selectedCustomer?.customerName ?? "Mặt hàng đã mua"}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatNumber(detail?.total ?? 0)} mã hàng · {formatCurrency(detail?.revenue ?? 0)} ₫
                      </p>
                    </div>
                    {detailLoading && <Icon name="progress_activity" size={18} className="animate-spin text-muted-foreground" />}
                  </div>
                  <div className="max-h-[650px] overflow-auto">
                    <table
                      className={cn(
                        "w-full border-collapse text-sm",
                        productColumns.length > 5
                          ? "min-w-[1180px]"
                          : "min-w-[720px]",
                        density === "compact" &&
                          "[&_th]:!py-1.5 [&_td]:!py-1.5",
                      )}
                    >
                      <thead className="sticky top-0 z-20 bg-surface-container">
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="sticky left-0 z-30 min-w-72 bg-surface-container px-3 py-2.5 text-left font-semibold">Mặt hàng</th>
                          {productColumns.includes("code") && (
                            <th className="px-3 py-2.5 text-left font-semibold">Mã hàng</th>
                          )}
                          {productColumns.includes("category") && (
                            <th className="min-w-48 px-3 py-2.5 text-left font-semibold">Nhóm hàng</th>
                          )}
                          {productColumns.includes("unit") && (
                            <th className="px-3 py-2.5 text-left font-semibold">Đơn vị tính</th>
                          )}
                          {productColumns.includes("orders") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Số đơn</th>
                          )}
                          {productColumns.includes("quantity") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Số lượng</th>
                          )}
                          {productColumns.includes("revenue") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Doanh thu</th>
                          )}
                          {productColumns.includes("share") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Tỷ trọng</th>
                          )}
                          {productColumns.includes("lastPurchase") && (
                            <th className="px-3 py-2.5 text-right font-semibold">Lần mua gần nhất</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(detail?.rows ?? []).map((row, index) => (
                          <tr key={row.productId} className={cn("border-b border-border/60 hover:bg-surface-container-low", index % 2 === 1 && "bg-surface-container-low/30")}>
                            <td className="sticky left-0 z-10 bg-inherit px-3 py-2.5 font-medium text-foreground">{row.productName}</td>
                            {productColumns.includes("code") && (
                              <td className="px-3 py-2.5 text-muted-foreground">{row.productCode}</td>
                            )}
                            {productColumns.includes("category") && (
                              <td className="px-3 py-2.5 text-muted-foreground">{row.categoryName}</td>
                            )}
                            {productColumns.includes("unit") && (
                              <td className="px-3 py-2.5 text-muted-foreground">{row.unit}</td>
                            )}
                            {productColumns.includes("orders") && (
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.orderCount)}</td>
                            )}
                            {productColumns.includes("quantity") && (
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.quantity)}</td>
                            )}
                            {productColumns.includes("revenue") && (
                              <td
                                className={cn(
                                  "px-3 py-2.5 text-right font-semibold tabular-nums",
                                  highlightValues && "text-primary",
                                )}
                              >
                                {formatCurrency(row.revenue)} ₫
                              </td>
                            )}
                            {productColumns.includes("share") && (
                              <td className="px-3 py-2.5 text-right tabular-nums">{row.revenueShare.toFixed(1)}%</td>
                            )}
                            {productColumns.includes("lastPurchase") && (
                              <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatShortDate(row.lastPurchaseAt)}</td>
                            )}
                          </tr>
                        ))}
                        {!detailLoading && (detail?.rows.length ?? 0) === 0 && (
                          <tr>
                            <td colSpan={1 + productColumns.length} className="px-4 py-12 text-center text-sm text-muted-foreground">Không tìm thấy mặt hàng phù hợp.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Pager
                    page={productPage}
                    pageSize={productPageSize}
                    total={detail?.total ?? 0}
                    onPageChange={setProductPage}
                    onPageSizeChange={(size) => {
                      setProductPageSize(size);
                      setProductPage(0);
                    }}
                  />
                </section>
              )}

              {mode === "categories" && (
                <section className="overflow-hidden rounded-lg border border-border bg-background" aria-labelledby="category-table-title">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <h2 id="category-table-title" className="text-sm font-semibold text-foreground">Khách hàng theo nhóm hàng</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatNumber(matrix.customers.length)}/
                        {formatNumber(matrix.sourceCustomerCount)} khách ·{" "}
                        {formatNumber(matrix.categories.length)}/
                        {formatNumber(matrix.sourceCategoryCount)} nhóm đang hiển thị
                      </p>
                    </div>
                    {highlightValues && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Mức doanh thu">
                        <span>Thấp</span>
                        <span className="h-3 w-6 rounded-sm bg-primary/5" />
                        <span className="h-3 w-6 rounded-sm bg-primary/12" />
                        <span className="h-3 w-6 rounded-sm bg-primary/18" />
                        <span>Cao</span>
                      </div>
                    )}
                  </div>
                  <div className="max-h-[680px] overflow-auto">
                    <table
                      className={cn(
                        "min-w-max w-full border-collapse text-sm",
                        density === "compact" &&
                          "[&_th]:!py-1.5 [&_td]:!py-1.5",
                      )}
                    >
                      <thead className="sticky top-0 z-30 bg-surface-container">
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="sticky left-0 z-40 min-w-64 bg-surface-container px-3 py-2.5 text-left font-semibold">Khách hàng</th>
                          {matrix.categories.map((category) => (
                            <th key={category.id} className="min-w-36 px-3 py-2.5 text-right font-semibold">{category.name}</th>
                          ))}
                          <th className="sticky right-0 z-40 min-w-40 border-l border-border bg-surface-container px-3 py-2.5 text-right font-semibold text-primary">Tổng hiển thị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.customers.map((customer, index) => (
                          <tr key={customer.id} className={cn("border-b border-border/60", index % 2 === 1 && "bg-surface-container-low/30")}>
                            <td className="sticky left-0 z-20 bg-inherit px-3 py-2.5 font-medium text-foreground">{customer.name}</td>
                            {matrix.categories.map((category) => {
                              const value = matrix.values.get(customer.id)?.get(category.id) ?? 0;
                              return (
                                <td key={category.id} className={cn(
                                    "px-3 py-2.5 text-right tabular-nums",
                                    highlightValues && heatClass(value, matrix.maximum),
                                  )}>
                                  {value === 0 ? "—" : formatCurrency(value)}
                                </td>
                              );
                            })}
                            <td
                              className={cn(
                                "sticky right-0 z-20 border-l border-border bg-background px-3 py-2.5 text-right font-semibold tabular-nums",
                                highlightValues && "text-primary",
                              )}
                            >
                              {formatCurrency(customer.total)} ₫
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 z-30 bg-surface-container font-semibold">
                        <tr className="border-t-2 border-border">
                          <td className="sticky left-0 z-40 bg-surface-container px-3 py-2.5">Tổng hiển thị</td>
                          {matrix.categories.map((category) => (
                            <td key={category.id} className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(matrix.categoryTotals.get(category.id) ?? 0)}</td>
                          ))}
                          <td
                            className={cn(
                              "sticky right-0 z-40 border-l border-border bg-surface-container px-3 py-2.5 text-right tabular-nums",
                              highlightValues && "text-primary",
                            )}
                          >
                            {formatCurrency(matrix.grandTotal)} ₫
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
