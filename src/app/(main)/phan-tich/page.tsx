"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  formatCurrency,
  formatNumber,
  formatChartCurrency,
  formatChartTooltipCurrency,
} from "@/lib/format";
import { KpiCard, ChartCard } from "./_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts";
import {
  getOverviewKpis,
  getDailyRevenue,
  getRevenueByCategory,
  getTopProductsByRevenue,
} from "@/lib/services";
import type {
  MonthlyRevenuePoint,
  CategoryRevenue,
  TopProductRevenue,
} from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";

// === Helpers ===

function calcChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% so với tháng trước`;
}

// === Custom tooltip ===
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-border rounded-lg ambient-shadow p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function TongQuanPage() {
  const { activeBranchId } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<{
    revenue: number; prevRevenue: number;
    orders: number; prevOrders: number;
    newCustomers: number; prevNewCustomers: number;
    profit: number; prevProfit: number;
  } | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [categoryRevenue, setCategoryRevenue] = useState<CategoryRevenue[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRevenue[]>([]);

  // CEO 13/05: helper resolve tên branch để in title row Excel
  const branchLabel =
    activeBranchId
      ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
      : "Tất cả chi nhánh";

  // ── Export Excel — 2 mode ──
  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TỔNG QUAN",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });

      // Sheet duy nhất gom KPI + top products (mirror view)
      const kpiRows = [
        { metric: "Doanh thu", value: kpis?.revenue ?? 0, prev: kpis?.prevRevenue ?? 0 },
        { metric: "Đơn hàng", value: kpis?.orders ?? 0, prev: kpis?.prevOrders ?? 0 },
        { metric: "Khách mới", value: kpis?.newCustomers ?? 0, prev: kpis?.prevNewCustomers ?? 0 },
        { metric: "Lợi nhuận", value: kpis?.profit ?? 0, prev: kpis?.prevProfit ?? 0 },
      ];

      const sheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: title,
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 24 },
          { label: "Kỳ hiện tại", key: "value", width: 18, format: "currency" },
          { label: "Kỳ trước", key: "prev", width: 18, format: "currency" },
        ],
        rows: kpiRows,
      };
      exportReportToExcel({
        kind: "tai-chinh",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({
        title: "Đã xuất Excel (view)",
        description: "File đã được tải về máy.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [kpis, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TỔNG QUAN — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });

      const sheets: ExcelSheet[] = [
        // Sheet 1: KPI overview
        {
          name: "Tổng quan KPI",
          titleRows: title,
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 24 },
            { label: "Kỳ hiện tại", key: "value", width: 18, format: "currency" },
            { label: "Kỳ trước", key: "prev", width: 18, format: "currency" },
            { label: "% thay đổi", key: "change", width: 14 },
          ],
          rows: [
            {
              metric: "Doanh thu",
              value: kpis?.revenue ?? 0,
              prev: kpis?.prevRevenue ?? 0,
              change: calcChange(kpis?.revenue ?? 0, kpis?.prevRevenue ?? 0),
            },
            {
              metric: "Đơn hàng",
              value: kpis?.orders ?? 0,
              prev: kpis?.prevOrders ?? 0,
              change: calcChange(kpis?.orders ?? 0, kpis?.prevOrders ?? 0),
            },
            {
              metric: "Khách mới",
              value: kpis?.newCustomers ?? 0,
              prev: kpis?.prevNewCustomers ?? 0,
              change: calcChange(kpis?.newCustomers ?? 0, kpis?.prevNewCustomers ?? 0),
            },
            {
              metric: "Lợi nhuận",
              value: kpis?.profit ?? 0,
              prev: kpis?.prevProfit ?? 0,
              change: calcChange(kpis?.profit ?? 0, kpis?.prevProfit ?? 0),
            },
          ],
        },
        // Sheet 2: Doanh thu theo ngày
        {
          name: "Doanh thu theo ngày",
          titleRows: [
            "DOANH THU 30 NGÀY GẦN NHẤT",
            ...title.slice(1),
          ],
          columns: [
            { label: "Ngày", key: "date", width: 14 },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: dailyRevenue.map((d) => ({
            date: d.date,
            revenue: d.revenue,
          })),
          footer: {
            date: "TỔNG",
            revenue: dailyRevenue.reduce((s, d) => s + d.revenue, 0),
          },
        },
        // Sheet 3: Doanh thu theo danh mục
        {
          name: "Theo danh mục",
          titleRows: [
            "DOANH THU THEO DANH MỤC",
            ...title.slice(1),
          ],
          columns: [
            { label: "Danh mục", key: "category", width: 24 },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: categoryRevenue.map((c) => ({
            category: c.category,
            revenue: c.revenue,
          })),
          footer: {
            category: "TỔNG",
            revenue: categoryRevenue.reduce((s, c) => s + c.revenue, 0),
          },
        },
        // Sheet 4: Top 10 sản phẩm
        {
          name: "Top SP bán chạy",
          titleRows: [
            "TOP 10 SẢN PHẨM BÁN CHẠY",
            ...title.slice(1),
          ],
          columns: [
            { label: "STT", key: "rank", width: 6 },
            { label: "Sản phẩm", key: "name", width: 32 },
            { label: "SL bán", key: "qty", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: topProducts.map((p, i) => ({
            rank: i + 1,
            name: p.name,
            qty: p.qty,
            revenue: p.revenue,
          })),
        },
      ];

      exportReportToExcel({
        kind: "tai-chinh",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({
        title: "Đã xuất Excel (đầy đủ)",
        description: "File có 4 sheet — KPI + theo ngày + theo danh mục + top SP.",
        variant: "success",
        duration: 5000,
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [kpis, dailyRevenue, categoryRevenue, topProducts, range, branchLabel, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Tổng quan"
      subtitle="Phân tích kinh doanh tổng hợp"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportFull}
      exportDisabled={loading || !kpis}
    />
  );

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [kpiData, daily, category, products] = await Promise.all([
          getOverviewKpis(activeBranchId, range),
          getDailyRevenue(30, activeBranchId, range),
          getRevenueByCategory(activeBranchId, range),
          getTopProductsByRevenue(10, activeBranchId, range),
        ]);
        setKpis(kpiData);
        setDailyRevenue(daily);
        setCategoryRevenue(category);
        setTopProducts(products);
      } catch (err) {
        console.error("Failed to fetch analytics data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeBranchId, range]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {reportHeader}

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Doanh thu"
            value={formatCurrency(kpis?.revenue ?? 0) + "đ"}
            change={calcChange(kpis?.revenue ?? 0, kpis?.prevRevenue ?? 0)}
            positive={(kpis?.revenue ?? 0) >= (kpis?.prevRevenue ?? 0)}
            icon="attach_money"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Đơn hàng"
            value={formatNumber(kpis?.orders ?? 0)}
            change={calcChange(kpis?.orders ?? 0, kpis?.prevOrders ?? 0)}
            positive={(kpis?.orders ?? 0) >= (kpis?.prevOrders ?? 0)}
            icon="shopping_cart"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Khách mới"
            value={formatNumber(kpis?.newCustomers ?? 0)}
            change={calcChange(kpis?.newCustomers ?? 0, kpis?.prevNewCustomers ?? 0)}
            positive={(kpis?.newCustomers ?? 0) >= (kpis?.prevNewCustomers ?? 0)}
            icon="group"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Lợi nhuận"
            value={formatCurrency(kpis?.profit ?? 0) + "đ"}
            change={calcChange(kpis?.profit ?? 0, kpis?.prevProfit ?? 0)}
            positive={(kpis?.profit ?? 0) >= (kpis?.prevProfit ?? 0)}
            icon="trending_up"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
        </div>

        {/* CEO 13/05: 2 mode — Biểu đồ (chart) vs Bảng số liệu kế toán (table) */}
        {viewMode === "chart" ? (
          /* Charts row */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue line chart */}
            <ChartCard title="Doanh thu theo ngày" subtitle="30 ngày gần nhất">
              {dailyRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo ngày
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={dailyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval={4}
                    />
                    <YAxis
                      tickFormatter={formatChartCurrency}
                      tick={{ fontSize: 11 }}
                      width={48}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name="Doanh thu"
                      stroke="#004AC6"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Revenue by category bar chart */}
            <ChartCard title="Doanh thu theo danh mục" subtitle="Tháng hiện tại">
              {categoryRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo danh mục
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryRevenue} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      type="number"
                      tickFormatter={formatChartCurrency}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      width={120}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Bar
                      dataKey="revenue"
                      name="Doanh thu"
                      fill="#004AC6"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        ) : (
          /* Table view — 2 bảng số liệu kế toán: theo ngày + theo danh mục */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Doanh thu theo ngày" subtitle="30 ngày gần nhất">
              {dailyRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo ngày
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-container-low">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Ngày</th>
                        <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRevenue.map((d, i) => (
                        <tr
                          key={i}
                          className="border-b last:border-0 hover:bg-surface-container-low"
                        >
                          <td className="py-1.5 px-3 text-foreground tabular-nums">
                            {d.date}
                          </td>
                          <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                            {formatCurrency(d.revenue)}đ
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-foreground/20 font-bold">
                        <td className="py-2 px-3">TỔNG</td>
                        <td className="py-2 px-3 text-right text-primary tabular-nums">
                          {formatCurrency(
                            dailyRevenue.reduce((s, d) => s + d.revenue, 0),
                          )}đ
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Doanh thu theo danh mục" subtitle="Tháng hiện tại">
              {categoryRevenue.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  Chưa có dữ liệu doanh thu theo danh mục
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Danh mục</th>
                        <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                        <th className="py-2 px-3 font-medium text-right">% tổng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = categoryRevenue.reduce(
                          (s, c) => s + c.revenue,
                          0,
                        );
                        return categoryRevenue.map((c, i) => (
                          <tr
                            key={i}
                            className="border-b last:border-0 hover:bg-surface-container-low"
                          >
                            <td className="py-1.5 px-3 font-medium text-foreground">
                              {c.category}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums">
                              {formatCurrency(c.revenue)}đ
                            </td>
                            <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums">
                              {total > 0
                                ? ((c.revenue / total) * 100).toFixed(1) + "%"
                                : "—"}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-foreground/20 font-bold">
                        <td className="py-2 px-3">TỔNG</td>
                        <td className="py-2 px-3 text-right text-primary tabular-nums">
                          {formatCurrency(
                            categoryRevenue.reduce((s, c) => s + c.revenue, 0),
                          )}đ
                        </td>
                        <td className="py-2 px-3 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>
        )}

        {/* Top 10 products table */}
        <ChartCard title="Top 10 sản phẩm bán chạy" subtitle="Theo doanh thu tháng này">
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Chưa có dữ liệu sản phẩm bán chạy
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium w-8">#</th>
                    <th className="pb-2 pr-4 font-medium">Sản phẩm</th>
                    <th className="pb-2 pr-4 font-medium text-right">SL bán</th>
                    <th className="pb-2 font-medium text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-surface-container-low">
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="py-2 pr-4 font-medium text-foreground">{p.name}</td>
                      <td className="py-2 pr-4 text-right text-foreground">{p.qty}</td>
                      <td className="py-2 text-right font-semibold text-primary">
                        {formatCurrency(p.revenue)}đ
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
