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
import { ReportPageHeader } from "@/components/shared/report";
import { cn } from "@/lib/utils";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useReportState } from "@/lib/hooks/use-report-state";
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

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const REPORT_MODES: Array<{
  id: ReportMode;
  label: string;
  icon: string;
}> = [
  { id: "customers", label: "Theo khách hàng", icon: "groups" },
  { id: "products", label: "Mặt hàng từng khách", icon: "inventory_2" },
  { id: "categories", label: "Theo nhóm hàng", icon: "table_view" },
];

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

function buildMatrix(cells: CustomerProductMatrixCell[]) {
  const customerNames = new Map<string, string>();
  const categoryNames = new Map<string, string>();
  const values = new Map<string, Map<string, number>>();
  const customerTotals = new Map<string, number>();
  const categoryTotals = new Map<string, number>();
  let grandTotal = 0;
  let maximum = 0;

  for (const cell of cells) {
    customerNames.set(cell.customerId, cell.customerName);
    categoryNames.set(cell.categoryId, cell.categoryName);
    const row = values.get(cell.customerId) ?? new Map<string, number>();
    row.set(cell.categoryId, cell.revenue);
    values.set(cell.customerId, row);
    customerTotals.set(
      cell.customerId,
      (customerTotals.get(cell.customerId) ?? 0) + cell.revenue,
    );
    categoryTotals.set(
      cell.categoryId,
      (categoryTotals.get(cell.categoryId) ?? 0) + cell.revenue,
    );
    grandTotal += cell.revenue;
    maximum = Math.max(maximum, cell.revenue);
  }

  const customers = Array.from(customerNames, ([id, name]) => ({
    id,
    name,
    total: customerTotals.get(id) ?? 0,
  })).sort((a, b) => b.total - a.total);
  const categories = Array.from(categoryNames, ([id, name]) => ({
    id,
    name,
    total: categoryTotals.get(id) ?? 0,
  })).sort((a, b) => b.total - a.total);

  return {
    customers,
    categories,
    values,
    customerTotals,
    categoryTotals,
    grandTotal,
    maximum,
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
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Số dòng</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
            aria-label="Số dòng mỗi trang"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
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
  const [mode, setMode] = useState<ReportMode>(() => {
    if (typeof window === "undefined") return "customers";
    const requested = new URLSearchParams(window.location.search).get(
      "reportMode",
    );
    return requested === "products" || requested === "categories"
      ? requested
      : "customers";
  });
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
    const url = new URL(window.location.href);
    url.searchParams.set("reportMode", mode);
    window.history.replaceState(window.history.state, "", url);
  }, [mode]);

  useEffect(() => {
    setPage(0);
  }, [activeBranchId, deferredSearch, range.from, range.to, sort]);

  useEffect(() => {
    if (!isReady) return;
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
    if (!selectedCustomerId || mode !== "products" || !isReady) return;
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
  const matrix = useMemo(() => buildMatrix(report?.matrix ?? []), [report?.matrix]);
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
            { label: "Mã hàng", key: "productCode", width: 16 },
            { label: "Tên hàng", key: "productName", width: 34 },
            { label: "Nhóm hàng", key: "categoryName", width: 22 },
            { label: "Đơn vị tính", key: "unit", width: 12 },
            { label: "Số đơn", key: "orderCount", width: 12, format: "number" },
            { label: "Số lượng", key: "quantity", width: 14, format: "number" },
            { label: "Doanh thu mặt hàng", key: "revenue", width: 20, format: "currency" },
            { label: "Tỷ trọng", key: "revenueShare", width: 12, format: "percent" },
            { label: "Lần mua gần nhất", key: "lastPurchaseAt", width: 18, format: "date" },
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
          { label: "Tổng cộng", key: "total", width: 20, format: "currency" as const },
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
  }, [branchLabel, detail?.rows, matrix, mode, range, report, toast]);

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
            <div
              className="inline-flex w-full overflow-x-auto rounded-lg border border-border bg-background p-1 xl:w-auto"
              role="tablist"
              aria-label="Góc nhìn báo cáo"
            >
              {REPORT_MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.id}
                  onClick={() => setMode(item.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                    mode === item.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-surface-container hover:text-foreground",
                  )}
                >
                  <Icon name={item.icon} size={15} />
                  {item.label}
                </button>
              ))}
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
                  className="h-9 pl-9"
                  aria-label="Tìm khách hàng"
                />
              </div>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as CustomerProductSort)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                aria-label="Sắp xếp khách hàng"
              >
                <option value="revenue_desc">Doanh thu cao nhất</option>
                <option value="orders_desc">Nhiều đơn nhất</option>
                <option value="quantity_desc">Số lượng cao nhất</option>
                <option value="name_asc">Tên khách A–Z</option>
              </select>
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

              {mode === "customers" && (
                <div className="space-y-4">
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
                      <table className="min-w-[1240px] w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-20 bg-surface-container">
                          <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="sticky left-0 z-30 min-w-60 bg-surface-container px-3 py-2.5 text-left font-semibold">Khách hàng</th>
                            <th className="px-3 py-2.5 text-left font-semibold">Mã khách</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Doanh thu</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Tỷ trọng</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Số đơn</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Số mã hàng</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Số lượng</th>
                            <th className="min-w-56 px-3 py-2.5 text-left font-semibold">Mặt hàng mua nhiều nhất</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Lần mua gần nhất</th>
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
                              <td className="px-3 py-2.5 text-muted-foreground">{row.customerCode}</td>
                              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-primary">{formatCurrency(row.revenue)} ₫</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{row.revenueShare.toFixed(1)}%</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.orderCount)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.productCount)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.quantity)}</td>
                              <td className="max-w-72 truncate px-3 py-2.5 text-muted-foreground" title={row.topProduct ?? undefined}>{row.topProduct ?? "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatShortDate(row.lastPurchaseAt)}</td>
                              <td className="px-2 py-2 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  title="Xem mặt hàng của khách"
                                  onClick={() => {
                                    setDetail(null);
                                    setSelectedCustomerId(row.customerId);
                                    setMode("products");
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
                </div>
              )}

              {mode === "products" && (
                <section className="overflow-hidden rounded-lg border border-border bg-background" aria-labelledby="product-table-title">
                  <div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="min-w-0">
                      <label htmlFor="customer-select" className="mb-1 block text-xs font-medium text-muted-foreground">Khách hàng</label>
                      <select
                        id="customer-select"
                        value={selectedCustomerId ?? ""}
                        onChange={(event) => {
                          setDetail(null);
                          setSelectedCustomerId(event.target.value);
                        }}
                        className="h-9 max-w-full rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-ring sm:min-w-80"
                      >
                        {report.customers.map((row) => (
                          <option key={row.customerId} value={row.customerId}>
                            {row.customerCode} · {row.customerName}
                          </option>
                        ))}
                      </select>
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
                      <select
                        value={productSort}
                        onChange={(event) => setProductSort(event.target.value as ProductSort)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                        aria-label="Sắp xếp mặt hàng"
                      >
                        <option value="revenue_desc">Doanh thu cao nhất</option>
                        <option value="quantity_desc">Số lượng cao nhất</option>
                        <option value="name_asc">Tên hàng A–Z</option>
                      </select>
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
                    <table className="min-w-[1180px] w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-20 bg-surface-container">
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="sticky left-0 z-30 min-w-72 bg-surface-container px-3 py-2.5 text-left font-semibold">Mặt hàng</th>
                          <th className="px-3 py-2.5 text-left font-semibold">Mã hàng</th>
                          <th className="min-w-48 px-3 py-2.5 text-left font-semibold">Nhóm hàng</th>
                          <th className="px-3 py-2.5 text-left font-semibold">Đơn vị tính</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Số đơn</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Số lượng</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Doanh thu</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Tỷ trọng</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Lần mua gần nhất</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail?.rows ?? []).map((row, index) => (
                          <tr key={row.productId} className={cn("border-b border-border/60 hover:bg-surface-container-low", index % 2 === 1 && "bg-surface-container-low/30")}>
                            <td className="sticky left-0 z-10 bg-inherit px-3 py-2.5 font-medium text-foreground">{row.productName}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{row.productCode}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{row.categoryName}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{row.unit}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.orderCount)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.quantity)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-primary">{formatCurrency(row.revenue)} ₫</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{row.revenueShare.toFixed(1)}%</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatShortDate(row.lastPurchaseAt)}</td>
                          </tr>
                        ))}
                        {!detailLoading && (detail?.rows.length ?? 0) === 0 && (
                          <tr>
                            <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">Không tìm thấy mặt hàng phù hợp.</td>
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
                      <p className="mt-0.5 text-xs text-muted-foreground">20 khách và 10 nhóm có doanh thu cao nhất</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Mức doanh thu">
                      <span>Thấp</span>
                      <span className="h-3 w-6 rounded-sm bg-primary/5" />
                      <span className="h-3 w-6 rounded-sm bg-primary/12" />
                      <span className="h-3 w-6 rounded-sm bg-primary/18" />
                      <span>Cao</span>
                    </div>
                  </div>
                  <div className="max-h-[680px] overflow-auto">
                    <table className="min-w-max w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-30 bg-surface-container">
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="sticky left-0 z-40 min-w-64 bg-surface-container px-3 py-2.5 text-left font-semibold">Khách hàng</th>
                          {matrix.categories.map((category) => (
                            <th key={category.id} className="min-w-36 px-3 py-2.5 text-right font-semibold">{category.name}</th>
                          ))}
                          <th className="sticky right-0 z-40 min-w-40 border-l border-border bg-surface-container px-3 py-2.5 text-right font-semibold text-primary">Tổng cộng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.customers.map((customer, index) => (
                          <tr key={customer.id} className={cn("border-b border-border/60", index % 2 === 1 && "bg-surface-container-low/30")}>
                            <td className="sticky left-0 z-20 bg-inherit px-3 py-2.5 font-medium text-foreground">{customer.name}</td>
                            {matrix.categories.map((category) => {
                              const value = matrix.values.get(customer.id)?.get(category.id) ?? 0;
                              return (
                                <td key={category.id} className={cn("px-3 py-2.5 text-right tabular-nums", heatClass(value, matrix.maximum))}>
                                  {value === 0 ? "—" : formatCurrency(value)}
                                </td>
                              );
                            })}
                            <td className="sticky right-0 z-20 border-l border-border bg-background px-3 py-2.5 text-right font-semibold tabular-nums text-primary">{formatCurrency(customer.total)} ₫</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 z-30 bg-surface-container font-semibold">
                        <tr className="border-t-2 border-border">
                          <td className="sticky left-0 z-40 bg-surface-container px-3 py-2.5">Tổng cộng</td>
                          {matrix.categories.map((category) => (
                            <td key={category.id} className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(matrix.categoryTotals.get(category.id) ?? 0)}</td>
                          ))}
                          <td className="sticky right-0 z-40 border-l border-border bg-surface-container px-3 py-2.5 text-right tabular-nums text-primary">{formatCurrency(matrix.grandTotal)} ₫</td>
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
