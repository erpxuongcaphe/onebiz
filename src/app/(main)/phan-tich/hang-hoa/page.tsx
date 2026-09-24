"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useToast } from "@/lib/contexts";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
  formatNumber,
} from "@/lib/format";
import {
  getInventoryKpis,
  getTopProductsByRevenue,
  getCategoryDistribution,
  getStockMovements,
  getAnalyticsLowStock,
  getSalesReturnReport,
} from "@/lib/services";
import type {
  TopProductRevenue,
  StockMovementPoint,
  LowStockItem,
} from "@/lib/services/supabase/analytics";
import { reconcileProductSales } from "@/lib/reports/product-sales-reconciliation";
import type { SalesReturnRow } from "@/lib/services/supabase/sales-reports";
import { Icon } from "@/components/ui/icon";
import { formatSelectedPeriodLabel } from "@/lib/utils/date-presets";

const PIE_COLORS = [
  "#004AC6",
  "#9CB9FF",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
];

// === Custom Tooltips ===

function ProductRevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { name: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">
        {payload[0].payload.name}
      </p>
      <p className="text-sm font-bold text-primary">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
    </div>
  );
}

function PieCategoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{payload[0].name}</p>
      <p className="text-sm font-bold">{formatNumber(payload[0].value)} sản phẩm</p>
    </div>
  );
}

function StockMovementTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">Ngày {label}</p>
      {payload.map((p) => (
        <p
          key={p.dataKey}
          className="text-sm font-bold"
          style={{ color: p.color }}
        >
          {p.dataKey === "nhap" ? "Nhập" : "Xuất"}: {formatNumber(p.value)} sản phẩm
        </p>
      ))}
    </div>
  );
}

// Pie chart custom label
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPieLabel(props: any) {
  const cx = props.cx as number;
  const cy = props.cy as number;
  const midAngle = (props.midAngle as number) ?? 0;
  const innerRadius = props.innerRadius as number;
  const outerRadius = props.outerRadius as number;
  const percent = (props.percent as number) ?? 0;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.06) return null;
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// === Page ===

interface InventoryKpis {
  totalProducts: number;
  bestSeller: { name: string; qty: number };
  lowStockCount: number;
  stockValue: number;
}

export default function HangHoaPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<InventoryKpis | null>(null);
  const [topProducts, setTopProducts] = useState<TopProductRevenue[]>([]);
  const [salesReturns, setSalesReturns] = useState<SalesReturnRow[]>([]);
  const [returnReportStatus, setReturnReportStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [returnRetryToken, setReturnRetryToken] = useState(0);
  const [categories, setCategories] = useState<{ name: string; value: number }[]>([]);
  const [movements, setMovements] = useState<StockMovementPoint[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productSort, setProductSort] = useState<"netRevenue" | "revenue" | "quantity" | "returnedValue" | "name">("netRevenue");
  const [productPage, setProductPage] = useState(1);
  const requestIdRef = useRef(0);
  const selectedPeriodLabel = formatSelectedPeriodLabel(preset, range);
  const reconciledProducts = useMemo(
    () => reconcileProductSales(topProducts, salesReturns),
    [topProducts, salesReturns],
  );
  const visibleProducts = useMemo(() => {
    const needle = productSearch.trim().toLocaleLowerCase("vi");
    const filtered = reconciledProducts.filter((product) =>
      `${product.name} ${product.code ?? ""}`.toLocaleLowerCase("vi").includes(needle),
    );
    return [...filtered].sort((a, b) => {
      if (productSort === "name") return a.name.localeCompare(b.name, "vi");
      if (productSort === "quantity") return b.qty - a.qty;
      if (productSort === "returnedValue") return b.returnedValue - a.returnedValue;
      return productSort === "revenue" ? b.revenue - a.revenue : b.netRevenue - a.netRevenue;
    });
  }, [reconciledProducts, productSearch, productSort]);
  const visibleProductTotals = useMemo(
    () => visibleProducts.reduce((totals, product) => ({
      qty: totals.qty + product.qty,
      revenue: totals.revenue + product.revenue,
      returnedValue: totals.returnedValue + product.returnedValue,
      netRevenue: totals.netRevenue + product.netRevenue,
    }), { qty: 0, revenue: 0, returnedValue: 0, netRevenue: 0 }),
    [visibleProducts],
  );
  const productsPerPage = 50;
  const productPageCount = Math.max(1, Math.ceil(visibleProducts.length / productsPerPage));
  const currentProductPage = Math.min(productPage, productPageCount);
  const pagedProducts = visibleProducts.slice(
    (currentProductPage - 1) * productsPerPage,
    currentProductPage * productsPerPage,
  );
  const exportIncludesReturns = viewMode === "table" && returnReportStatus === "ready";
  const exportProducts = viewMode === "chart" ? topProducts.slice(0, 10) : visibleProducts;


  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: exportIncludesReturns
          ? "BÁO CÁO BÁN HÀNG THEO MẶT HÀNG (ĐÃ ĐỐI SOÁT TRẢ HÀNG)"
          : "BÁO CÁO BÁN HÀNG THEO MẶT HÀNG (TRƯỚC TRẢ HÀNG)",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = {
        name: "Mặt hàng đã bán",
        titleRows: title,
        columns: [
          { label: "STT", key: "rank", width: 6 },
          { label: "Mã hàng", key: "code", width: 18 },
          { label: "Sản phẩm", key: "name", width: 32 },
          { label: "SL bán", key: "qty", width: 12, format: "number" },
          { label: "Doanh số gộp (VND)", key: "revenue", width: 18, format: "currency" },
          ...(exportIncludesReturns ? [
            { label: "Tiền trả (VND)", key: "returnedValue", width: 18, format: "currency" as const },
            { label: "Doanh thu thuần (VND)", key: "netRevenue", width: 20, format: "currency" as const },
          ] : []),
        ],
        rows: exportProducts.map((p, i) => ({
          rank: i + 1,
          code: p.code ?? "",
          name: p.name,
          qty: p.qty,
          revenue: p.revenue,
          returnedValue: "returnedValue" in p ? p.returnedValue : undefined,
          netRevenue: "netRevenue" in p ? p.netRevenue : undefined,
        })),
        footer: {
          rank: "",
          name: "TỔNG",
          qty: exportProducts.reduce((s, p) => s + p.qty, 0),
          revenue: exportProducts.reduce((s, p) => s + p.revenue, 0),
          returnedValue: exportIncludesReturns ? visibleProductTotals.returnedValue : undefined,
          netRevenue: exportIncludesReturns ? visibleProductTotals.netRevenue : undefined,
        },
      };
      exportReportToExcel({
        kind: "hang-hoa",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({ title: "Lỗi xuất Excel", description: err instanceof Error ? err.message : "", variant: "error" });
    }
  }, [exportProducts, exportIncludesReturns, visibleProductTotals, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO HÀNG HÓA — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const fullSalesRows = exportIncludesReturns ? reconciledProducts : topProducts;
      const sheets: ExcelSheet[] = [
        {
          name: "KPI",
          titleRows: title,
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 28 },
            { label: "Giá trị", key: "value", width: 16, format: "number" },
          ],
          rows: [
            { metric: "Tổng SP", value: kpis?.totalProducts ?? 0 },
            { metric: "Giá trị tồn (VND)", value: kpis?.stockValue ?? 0 },
            { metric: "SP gần hết", value: kpis?.lowStockCount ?? 0 },
          ],
        },
        {
          name: "Mặt hàng đã bán",
          titleRows: [
            exportIncludesReturns
              ? "MẶT HÀNG ĐÃ BÁN · ĐÃ ĐỐI SOÁT TRẢ HÀNG"
              : "MẶT HÀNG ĐÃ BÁN · DOANH SỐ TRƯỚC TRẢ HÀNG",
            ...title.slice(1),
          ],
          columns: [
            { label: "STT", key: "rank", width: 6 },
            { label: "Mã hàng", key: "code", width: 18 },
            { label: "Sản phẩm", key: "name", width: 32 },
            { label: "SL bán", key: "qty", width: 12, format: "number" },
            { label: "Doanh số gộp (VND)", key: "revenue", width: 18, format: "currency" },
            ...(exportIncludesReturns ? [
              { label: "Tiền trả (VND)", key: "returnedValue", width: 18, format: "currency" as const },
              { label: "Doanh thu thuần (VND)", key: "netRevenue", width: 20, format: "currency" as const },
            ] : []),
          ],
          rows: fullSalesRows.map((p, i) => ({
            rank: i + 1,
            code: p.code ?? "",
            name: p.name,
            qty: p.qty,
            revenue: p.revenue,
            returnedValue: "returnedValue" in p ? p.returnedValue : undefined,
            netRevenue: "netRevenue" in p ? p.netRevenue : undefined,
          })),
        },
        {
          name: "Theo danh mục",
          titleRows: ["PHÂN BỔ THEO DANH MỤC", ...title.slice(1)],
          columns: [
            { label: "Danh mục", key: "name", width: 24 },
            { label: "Số SP", key: "value", width: 12, format: "number" },
          ],
          rows: categories.map((c) => ({ name: c.name, value: c.value })),
        },
        {
          name: "Xuất - Nhập trong kỳ",
          titleRows: ["XUẤT - NHẬP THEO NGÀY", ...title.slice(1)],
          columns: [
            { label: "Ngày", key: "date", width: 14 },
            { label: "Nhập", key: "imported", width: 12, format: "number" },
            { label: "Xuất", key: "exported", width: 12, format: "number" },
          ],
          rows: movements.map((m) => ({
            date: m.day, imported: m.nhap, exported: m.xuat,
          })),
        },
        {
          name: "SP sắp hết",
          titleRows: ["SẢN PHẨM SẮP HẾT", ...title.slice(1)],
          columns: [
            { label: "Sản phẩm", key: "name", width: 32 },
            { label: "Tồn", key: "stock", width: 12, format: "number" },
            { label: "Ngưỡng", key: "threshold", width: 12, format: "number" },
          ],
          rows: lowStock.map((l) => ({
            name: l.name, stock: l.stock, threshold: l.warning,
          })),
        },
      ];
      exportReportToExcel({
        kind: "hang-hoa",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({ title: "Đã xuất Excel (đầy đủ)", variant: "success" });
    } catch (err) {
      toast({ title: "Lỗi xuất Excel", description: err instanceof Error ? err.message : "", variant: "error" });
    }
  }, [kpis, topProducts, reconciledProducts, exportIncludesReturns, categories, movements, lowStock, range, branchLabel, toast]);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const [kpiData, topData, catData, moveData, lowData] = await Promise.all([
        getInventoryKpis(activeBranchId, range),
        getTopProductsByRevenue(0, activeBranchId, range),
        getCategoryDistribution(activeBranchId),
        getStockMovements(30, activeBranchId, range),
        getAnalyticsLowStock(10, activeBranchId),
      ]);
      if (requestId !== requestIdRef.current) return;
      setKpis(kpiData);
      setTopProducts(topData);
      setCategories(catData);
      setMovements(moveData);
      setLowStock(lowData);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Failed to fetch inventory analytics:", err);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  useEffect(() => {
    if (!isReady || viewMode !== "table") {
      setReturnReportStatus("idle");
      return;
    }

    let cancelled = false;
    setSalesReturns([]);
    setReturnReportStatus("loading");
    getSalesReturnReport({
      dateFrom: range.from,
      dateTo: range.to,
      branchId: activeBranchId ?? null,
    })
      .then((report) => {
        if (cancelled) return;
        setSalesReturns(report.rows);
        setReturnReportStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to fetch product sales returns:", error);
        setReturnReportStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [activeBranchId, isReady, range.from, range.to, returnRetryToken, viewMode]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)] items-center justify-center">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Đang tải dữ liệu...</p>
      </div>
    );
  }

  const totalProducts = kpis?.totalProducts ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-y-auto">
      <ReportPageHeader
        title="Hiệu quả bán và tồn kho hàng hóa"
        subtitle="Thống kê sản phẩm, tồn kho và xuất nhập"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || (viewMode === "table" && returnReportStatus !== "ready")}
      />

      <div className="flex-1 p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng mặt hàng"
            value={String(totalProducts)}
            icon="inventory_2"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Hàng bán chạy"
            value={kpis?.bestSeller.name ?? "—"}
            change={kpis?.bestSeller.qty ? `${formatNumber(kpis.bestSeller.qty)} sản phẩm trong kỳ` : undefined}
            positive
            icon="star"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Hàng tồn kho thấp"
            value={String(kpis?.lowStockCount ?? 0)}
            change={(kpis?.lowStockCount ?? 0) > 0 ? "Cần nhập thêm" : undefined}
            positive={(kpis?.lowStockCount ?? 0) === 0}
            icon="warning"
            bg="bg-status-error/10"
            iconColor="text-status-error"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Giá trị tồn kho"
            value={formatCurrency(kpis?.stockValue ?? 0) + "đ"}
            icon="warehouse"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
        </div>

        {viewMode === "chart" ? <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top 10 Products by Revenue - Horizontal Bar */}
          <ChartCard
            title="Top 10 mặt hàng theo doanh số gộp"
            subtitle={`${selectedPeriodLabel} · Trước trả hàng · ${topProducts.length} mặt hàng`}
          >
            <div className="h-72 md:h-96">
              {topProducts.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu sản phẩm
                </div>
              ) : (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart
                    data={topProducts.slice(0, 10).map((product) => ({
                      ...product,
                      name: product.code ? `${product.name} · ${product.code}` : product.name,
                    })).reverse()}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatChartCurrency(v)}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={140}
                    />
                    <Tooltip content={<ProductRevenueTooltip />} />
                    <Bar
                      dataKey="revenue"
                      fill="#004AC6"
                      radius={[0, 6, 6, 0]}
                    name="Doanh số gộp"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </ChartCard>

          {/* Product Category Distribution - Pie */}
          <ChartCard
            title="Phân bổ sản phẩm theo nhóm hàng"
            subtitle={`Tại thời điểm hiện tại · ${totalProducts} sản phẩm`}
          >
            <div className="h-72 md:h-96">
              {categories.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Chưa có dữ liệu nhóm hàng
                </div>
              ) : (
                <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={categories}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderPieLabel}
                      outerRadius="80%"
                      dataKey="value"
                      nameKey="name"
                      strokeWidth={2}
                      stroke="#fff"
                    >
                      {categories.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<PieCategoryTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      formatter={(value: string) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </ChartCard>
        </div>

        {/* Stock Movement Line Chart */}
        <ChartCard
          title="Biến động xuất nhập kho"
          subtitle={`${selectedPeriodLabel} · Nhập so với xuất`}
        >
          <div className="h-56 md:h-72">
            {movements.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Chưa có dữ liệu xuất nhập kho
              </div>
            ) : (
              <ResponsiveContainer initialDimension={{ width: 320, height: 224 }} width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart
                  data={movements}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={35}
                  />
                  <Tooltip content={<StockMovementTooltip />} />
                  <Legend
                    verticalAlign="top"
                    formatter={(value: string) => (
                      <span className="text-xs">
                        {value === "nhap" ? "Nhập kho" : "Xuất kho"}
                      </span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="nhap"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#16a34a" }}
                    name="nhap"
                  />
                  <Line
                    type="monotone"
                    dataKey="xuat"
                    stroke="#ea580c"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#ea580c" }}
                    name="xuat"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        </> : <div className="space-y-4">
          <ChartCard title="Bán hàng theo mặt hàng" subtitle={`${selectedPeriodLabel} · ${visibleProducts.length} mặt hàng có phát sinh bán hoặc trả`}>
            <div className="flex flex-wrap gap-2 pb-3">
              <input
                aria-label="Tìm mặt hàng đã bán"
                className="h-9 min-w-48 flex-1 rounded border border-input bg-background px-3 text-sm"
                placeholder="Tìm tên hoặc mã hàng"
                value={productSearch}
                onChange={(event) => { setProductSearch(event.target.value); setProductPage(1); }}
              />
              <select
                aria-label="Sắp xếp mặt hàng"
                className="h-9 rounded border border-input bg-background px-3 text-sm"
                value={productSort}
                onChange={(event) => { setProductSort(event.target.value as typeof productSort); setProductPage(1); }}
              >
                <option value="netRevenue">Doanh thu thuần cao nhất</option>
                <option value="revenue">Doanh số gộp cao nhất</option>
                <option value="quantity">Số lượng bán nhiều nhất</option>
                <option value="returnedValue">Tiền trả cao nhất</option>
                <option value="name">Tên A–Z</option>
              </select>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
              {returnReportStatus === "ready" ? (
                <p>Đối chiếu tiền theo mã hàng và biến thể. Tiền trả tính theo ngày lập phiếu; doanh thu thuần = doanh số gộp trừ tiền trả.</p>
              ) : returnReportStatus === "error" ? (
                <div className="flex flex-wrap items-center gap-2 text-status-error">
                  <p>Chưa tải được phiếu trả hàng; số thuần đang để trống.</p>
                  <button type="button" className="underline underline-offset-2" onClick={() => setReturnRetryToken((value) => value + 1)}>Thử lại</button>
                </div>
              ) : (
                <p>Đang đối soát phiếu trả hàng trong kỳ…</p>
              )}
              {returnReportStatus === "ready" && <p>Có thể âm nếu trả trong kỳ hàng bán từ kỳ trước.</p>}
            </div>
            <ReportTableFrame tablePreferenceKey="report.products.sales">
              <div className="overflow-x-auto">
                {visibleProducts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Không có mặt hàng phù hợp.</p>
                ) : (
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-left font-medium">Mã hàng</th>
                        <th className="py-2 text-left font-medium">Mặt hàng</th>
                        <th className="py-2 text-right font-medium">SL bán</th>
                        <th className="py-2 text-right font-medium">Doanh số gộp</th>
                        <th className="py-2 text-right font-medium">Tiền trả</th>
                        <th className="py-2 text-right font-medium">Doanh thu thuần</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedProducts.map((product) => (
                        <tr key={`${product.productId}-${product.name}`} className="border-b last:border-0">
                          <td className="py-2 pr-4 text-muted-foreground">{product.code ?? "—"}</td>
                          <td className="py-2 pr-4 font-medium">{product.name}</td>
                          <td className="py-2 text-right tabular-nums">{formatNumber(product.qty)}</td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(product.revenue)}đ</td>
                          <td className="py-2 text-right tabular-nums">{returnReportStatus === "ready" ? `${formatCurrency(product.returnedValue)}đ` : "—"}</td>
                          <td className="py-2 text-right font-medium tabular-nums">{returnReportStatus === "ready" ? `${formatCurrency(product.netRevenue)}đ` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    {returnReportStatus === "ready" && <tfoot>
                      <tr className="border-t-2 bg-muted/40 font-semibold">
                        <td className="py-2 pr-4" colSpan={2}>Tổng kết quả lọc</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(visibleProductTotals.qty)}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(visibleProductTotals.revenue)}đ</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(visibleProductTotals.returnedValue)}đ</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(visibleProductTotals.netRevenue)}đ</td>
                      </tr>
                    </tfoot>}
                  </table>
                )}
              </div>
            </ReportTableFrame>
            {productPageCount > 1 && <div className="flex items-center justify-end gap-3 pt-3 text-sm"><button type="button" disabled={currentProductPage === 1} onClick={() => setProductPage(currentProductPage - 1)} className="disabled:opacity-40">Trước</button><span>{currentProductPage}/{productPageCount}</span><button type="button" disabled={currentProductPage === productPageCount} onClick={() => setProductPage(currentProductPage + 1)} className="disabled:opacity-40">Sau</button></div>}
          </ChartCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Mặt hàng theo nhóm" subtitle="Tồn tại thời điểm hiện tại">
              <ReportTableFrame tablePreferenceKey="report.products.categories"><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="py-2 text-left font-medium">Nhóm hàng</th><th className="py-2 text-right font-medium">Số mặt hàng</th></tr></thead><tbody>{categories.map((category) => <tr key={category.name} className="border-b last:border-0"><td className="py-2">{category.name}</td><td className="py-2 text-right tabular-nums">{formatNumber(category.value)}</td></tr>)}</tbody></table></div></ReportTableFrame>
            </ChartCard>
            <ChartCard title="Nhập, xuất kho theo ngày" subtitle={selectedPeriodLabel}>
              <ReportTableFrame tablePreferenceKey="report.products.movements"><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="py-2 text-left font-medium">Ngày</th><th className="py-2 text-right font-medium">Nhập</th><th className="py-2 text-right font-medium">Xuất</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.day} className="border-b last:border-0"><td className="py-2">{movement.day}</td><td className="py-2 text-right tabular-nums">{formatNumber(movement.nhap)}</td><td className="py-2 text-right tabular-nums">{formatNumber(movement.xuat)}</td></tr>)}</tbody></table></div></ReportTableFrame>
            </ChartCard>
          </div>
        </div>}

        {/* Low Stock Products Table */}
        <ChartCard
          title="Sản phẩm tồn kho thấp"
          subtitle="Tồn kho tại thời điểm hiện tại · Cần nhập thêm hàng"
        >
          <ReportTableFrame tablePreferenceKey="report.products.low-stock">
            <div className="overflow-x-auto">
            {lowStock.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                Không có sản phẩm tồn kho thấp
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">
                      Sản phẩm
                    </th>
                    <th className="text-right py-2 pr-4 font-medium">Tồn kho</th>
                    <th className="text-right py-2 pr-4 font-medium">
                      Mức cảnh báo
                    </th>
                    <th className="text-right py-2 font-medium">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((item) => {
                    const ratio = item.stock / item.warning;
                    const isCritical = ratio <= 0.3;
                    return (
                      <tr key={item.name} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-medium">{item.name}</td>
                        <td className="py-3 pr-4 text-right">
                          <span
                            className={
                              isCritical
                                ? "text-status-error font-bold"
                                : "text-status-warning font-medium"
                            }
                          >
                            {formatNumber(item.stock)}
                          </span>{" "}
                          <span className="text-muted-foreground text-xs">
                            {item.unit}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right text-muted-foreground">
                          {item.warning} {item.unit}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              isCritical
                                ? "bg-status-error/10 text-status-error"
                                : "bg-status-warning/10 text-status-warning"
                            }`}
                          >
                            {isCritical ? "Sắp hết" : "Thấp"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            </div>
          </ReportTableFrame>
        </ChartCard>
      </div>
    </div>
  );
}
