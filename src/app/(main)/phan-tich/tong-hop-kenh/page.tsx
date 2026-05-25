"use client";

/**
 * Tổng hợp kênh (Cross-Channel Roll-up) — /phan-tich/tong-hop-kenh
 *
 * CEO 21/05/2026: ERP có 2 mảng song song
 *   - Retail (bán lẻ cà phê đóng gói tại quầy + online)
 *   - FnB (quán phục vụ đồ uống/đồ ăn)
 * Trang này tổng hợp bức tranh chung cho CEO:
 *   - KPI cards 4 ô: Tổng / Retail / FnB / Tỷ lệ Retail/FnB
 *   - Pie chart % Retail vs FnB
 *   - Line chart trend 2 series theo ngày
 *   - Bảng so sánh head-to-head top SP từng kênh
 */

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { ClientChartContainer } from "../_components/client-chart-container";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import {
  formatCurrency,
  formatChartCurrency,
  formatChartTooltipCurrency,
  formatNumber,
} from "@/lib/format";
import {
  getCrossChannelKpis,
  getCrossChannelTrend,
  getCrossChannelTopProducts,
} from "@/lib/services";
import type {
  ChannelRevenueSplit,
  ChannelTrendPoint,
  ChannelTopProduct,
} from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// Stitch palette
const RETAIL_COLOR = "#0EA5E9"; // sky-500 — Retail = lẻ đóng gói
const FNB_COLOR = "#F59E0B"; // amber-500 — FnB = quán cà phê

function calcChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-border rounded-lg ambient-shadow p-3 text-xs space-y-0.5">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatChartTooltipCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({
  active,
  payload,
  totalRevenue,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  totalRevenue: number;
}) {
  if (!active || !payload?.length) return null;
  const pct = totalRevenue > 0 ? ((payload[0].value / totalRevenue) * 100).toFixed(1) : "0";
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{payload[0].name}</p>
      <p className="text-sm font-bold">
        {formatChartTooltipCurrency(payload[0].value)}
      </p>
      <p className="text-xs text-muted-foreground">{pct}% tổng doanh thu</p>
    </div>
  );
}

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
  if (percent < 0.04) return null;
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={13}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function TongHopKenhPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<
    (ChannelRevenueSplit & { prevRetailRevenue: number; prevFnbRevenue: number }) | null
  >(null);
  const [trend, setTrend] = useState<ChannelTrendPoint[]>([]);
  const [topProducts, setTopProducts] = useState<{
    retail: ChannelTopProduct[];
    fnb: ChannelTopProduct[];
  }>({ retail: [], fnb: [] });

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [k, t, top] = await Promise.all([
        getCrossChannelKpis(activeBranchId, range),
        getCrossChannelTrend(activeBranchId, range),
        getCrossChannelTopProducts(activeBranchId, range, 10),
      ]);
      setKpis(k);
      setTrend(t);
      setTopProducts(top);
    } catch (err) {
      console.error("Failed to fetch cross-channel data:", err);
      toast({
        title: "Lỗi tải báo cáo",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, range, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const handleExportView = useCallback(() => {
    if (!kpis) return;
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TỔNG HỢP KÊNH (RETAIL vs FNB)",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const summarySheet: ExcelSheet = {
        name: "Tổng hợp",
        titleRows: title,
        columns: [
          { label: "Chỉ số", key: "label", width: 28 },
          { label: "Retail", key: "retail", width: 18, format: "currency" },
          { label: "FnB", key: "fnb", width: 18, format: "currency" },
          { label: "Tổng", key: "total", width: 18, format: "currency" },
        ],
        rows: [
          {
            label: "Doanh thu",
            retail: kpis.retailRevenue,
            fnb: kpis.fnbRevenue,
            total: kpis.totalRevenue,
          },
          {
            label: "Số đơn",
            retail: kpis.retailOrders,
            fnb: kpis.fnbOrders,
            total: kpis.totalOrders,
          },
          {
            label: "Tỷ trọng (%)",
            retail: Math.round(kpis.retailPct * 10) / 10,
            fnb: Math.round(kpis.fnbPct * 10) / 10,
            total: 100,
          },
        ],
      };
      exportReportToExcel({
        kind: "tong-hop-kenh",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [summarySheet],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [kpis, range, branchLabel, toast]);

  const handleExportFull = useCallback(() => {
    if (!kpis) return;
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO TỔNG HỢP KÊNH — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        {
          name: "Tổng hợp",
          titleRows: title,
          columns: [
            { label: "Chỉ số", key: "label", width: 28 },
            { label: "Retail", key: "retail", width: 18, format: "currency" },
            { label: "FnB", key: "fnb", width: 18, format: "currency" },
            { label: "Tổng", key: "total", width: 18, format: "currency" },
          ],
          rows: [
            {
              label: "Doanh thu",
              retail: kpis.retailRevenue,
              fnb: kpis.fnbRevenue,
              total: kpis.totalRevenue,
            },
            {
              label: "Số đơn",
              retail: kpis.retailOrders,
              fnb: kpis.fnbOrders,
              total: kpis.totalOrders,
            },
            {
              label: "Tỷ trọng (%)",
              retail: Math.round(kpis.retailPct * 10) / 10,
              fnb: Math.round(kpis.fnbPct * 10) / 10,
              total: 100,
            },
          ],
        },
        {
          name: "Xu hướng theo ngày",
          titleRows: ["XU HƯỚNG DOANH THU THEO NGÀY", ...title.slice(1)],
          columns: [
            { label: "Ngày", key: "date", width: 14 },
            { label: "Retail (VND)", key: "retail", width: 18, format: "currency" },
            { label: "FnB (VND)", key: "fnb", width: 18, format: "currency" },
            { label: "Tổng (VND)", key: "total", width: 18, format: "currency" },
          ],
          rows: trend.map((r) => ({
            date: r.date,
            retail: r.retail,
            fnb: r.fnb,
            total: r.retail + r.fnb,
          })),
        },
        {
          name: "Top Retail",
          titleRows: ["TOP SẢN PHẨM RETAIL", ...title.slice(1)],
          columns: [
            { label: "Hạng", key: "rank", width: 6 },
            { label: "Sản phẩm", key: "name", width: 35 },
            { label: "Số lượng", key: "quantity", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: topProducts.retail.map((p, i) => ({
            rank: i + 1,
            name: p.name,
            quantity: p.quantity,
            revenue: p.revenue,
          })),
        },
        {
          name: "Top FnB",
          titleRows: ["TOP SẢN PHẨM FNB", ...title.slice(1)],
          columns: [
            { label: "Hạng", key: "rank", width: 6 },
            { label: "Sản phẩm", key: "name", width: 35 },
            { label: "Số lượng", key: "quantity", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: topProducts.fnb.map((p, i) => ({
            rank: i + 1,
            name: p.name,
            quantity: p.quantity,
            revenue: p.revenue,
          })),
        },
      ];
      exportReportToExcel({
        kind: "tong-hop-kenh",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({ title: "Đã xuất Excel (đầy đủ)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [kpis, trend, topProducts, range, branchLabel, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Tổng hợp kênh"
      subtitle="So sánh Retail vs F&B — bức tranh tổng thể"
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

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon
            name="progress_activity"
            className="size-8 animate-spin text-muted-foreground"
          />
        </div>
      </div>
    );
  }

  if (!kpis || kpis.totalRevenue === 0) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
        {reportHeader}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-6">
          <Icon name="insights" className="size-14 opacity-40" />
          <p className="text-sm text-center max-w-md">
            Chưa có dữ liệu doanh thu trong khoảng thời gian này. Kiểm tra lại
            kỳ báo cáo hoặc chi nhánh đang chọn.
          </p>
        </div>
      </div>
    );
  }

  const pieData = [
    { name: "Retail", value: kpis.retailRevenue, color: RETAIL_COLOR },
    { name: "F&B", value: kpis.fnbRevenue, color: FNB_COLOR },
  ].filter((p) => p.value > 0);

  // Compute leader badge
  const leader =
    kpis.retailRevenue > kpis.fnbRevenue
      ? { label: "Retail dẫn đầu", color: RETAIL_COLOR }
      : kpis.fnbRevenue > kpis.retailRevenue
        ? { label: "F&B dẫn đầu", color: FNB_COLOR }
        : null;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng doanh thu"
            value={formatCurrency(kpis.totalRevenue)}
            change={`${kpis.totalOrders} đơn`}
            positive
            icon="payments"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-primary"
          />
          <KpiCard
            label="Retail (bán lẻ)"
            value={formatCurrency(kpis.retailRevenue)}
            change={
              kpis.prevRetailRevenue > 0
                ? `${calcChange(kpis.retailRevenue, kpis.prevRetailRevenue)} so với kỳ trước`
                : `${kpis.retailOrders} đơn`
            }
            positive={kpis.retailRevenue >= kpis.prevRetailRevenue}
            icon="storefront"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-status-info"
          />
          <KpiCard
            label="F&B (quán)"
            value={formatCurrency(kpis.fnbRevenue)}
            change={
              kpis.prevFnbRevenue > 0
                ? `${calcChange(kpis.fnbRevenue, kpis.prevFnbRevenue)} so với kỳ trước`
                : `${kpis.fnbOrders} đơn`
            }
            positive={kpis.fnbRevenue >= kpis.prevFnbRevenue}
            icon="local_cafe"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-status-warning"
          />
          <KpiCard
            label="Tỷ trọng Retail / F&B"
            value={`${kpis.retailPct.toFixed(0)}% / ${kpis.fnbPct.toFixed(0)}%`}
            change={leader?.label ?? "Cân bằng"}
            positive
            icon="donut_large"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
        </div>

        {viewMode === "chart" ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Pie chart */}
              <ChartCard
                title="Tỷ trọng doanh thu theo kênh"
                subtitle="Retail vs F&B"
              >
                <div className="h-72">
                  <ClientChartContainer>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={renderPieLabel}
                        outerRadius="78%"
                        innerRadius="48%"
                        dataKey="value"
                        nameKey="name"
                        strokeWidth={2}
                        stroke="#fff"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={<PieTooltip totalRevenue={kpis.totalRevenue} />}
                      />
                      <Legend
                        verticalAlign="bottom"
                        formatter={(v: string) => (
                          <span className="text-xs">{v}</span>
                        )}
                      />
                    </PieChart>
                  </ClientChartContainer>
                </div>
              </ChartCard>

              {/* Trend line */}
              <ChartCard
                title="Xu hướng doanh thu theo ngày"
                subtitle="So sánh Retail và F&B"
              >
                <div className="h-72">
                  {trend.length > 0 ? (
                    <ClientChartContainer>
                      <LineChart data={trend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v: string) => v.slice(5)}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v: number) => formatChartCurrency(v)}
                        />
                        <Tooltip content={<TrendTooltip />} />
                        <Legend
                          verticalAlign="top"
                          formatter={(v: string) => (
                            <span className="text-xs">{v}</span>
                          )}
                        />
                        <Line
                          type="monotone"
                          dataKey="retail"
                          name="Retail"
                          stroke={RETAIL_COLOR}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="fnb"
                          name="F&B"
                          stroke={FNB_COLOR}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ClientChartContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      Chưa có dữ liệu trend.
                    </div>
                  )}
                </div>
              </ChartCard>
            </div>

            {/* Head-to-head top products */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard
                title="Top 10 sản phẩm Retail"
                subtitle="Theo doanh thu trong kỳ"
              >
                <TopProductTable
                  rows={topProducts.retail}
                  emptyText="Chưa có sản phẩm Retail nào bán được."
                  accentColor={RETAIL_COLOR}
                />
              </ChartCard>
              <ChartCard
                title="Top 10 sản phẩm F&B"
                subtitle="Theo doanh thu trong kỳ"
              >
                <TopProductTable
                  rows={topProducts.fnb}
                  emptyText="Chưa có sản phẩm F&B nào bán được."
                  accentColor={FNB_COLOR}
                />
              </ChartCard>
            </div>
          </>
        ) : (
          <ChartCard
            title="Bảng tổng hợp doanh thu theo ngày"
            subtitle="Retail vs F&B"
          >
            {trend.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4 font-medium">Ngày</th>
                      <th className="text-right py-2 pr-4 font-medium" style={{ color: RETAIL_COLOR }}>
                        Retail
                      </th>
                      <th className="text-right py-2 pr-4 font-medium" style={{ color: FNB_COLOR }}>
                        F&B
                      </th>
                      <th className="text-right py-2 font-medium">Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((row) => (
                      <tr key={row.date} className="border-b last:border-0">
                        <td className="py-2 pr-4">{row.date}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatCurrency(row.retail)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatCurrency(row.fnb)}
                        </td>
                        <td className="py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(row.retail + row.fnb)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold">
                      <td className="py-3 pr-4">Tổng cộng</td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {formatCurrency(kpis.retailRevenue)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {formatCurrency(kpis.fnbRevenue)}
                      </td>
                      <td className="py-3 text-right text-primary tabular-nums">
                        {formatCurrency(kpis.totalRevenue)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Chưa có dữ liệu trend.
              </div>
            )}
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function TopProductTable({
  rows,
  emptyText,
  accentColor,
}: {
  rows: ChannelTopProduct[];
  emptyText: string;
  accentColor: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left py-2 pr-3 font-medium w-10">#</th>
            <th className="text-left py-2 pr-3 font-medium">Sản phẩm</th>
            <th className="text-right py-2 pr-3 font-medium">SL</th>
            <th className="text-right py-2 font-medium">Doanh thu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.productId} className="border-b last:border-0">
              <td className="py-2 pr-3">
                <span
                  className={cn(
                    "inline-flex items-center justify-center size-6 rounded-full text-xs font-semibold",
                    i < 3 ? "text-white" : "bg-surface-container text-muted-foreground",
                  )}
                  style={i < 3 ? { backgroundColor: accentColor } : undefined}
                >
                  {i + 1}
                </span>
              </td>
              <td className="py-2 pr-3 font-medium truncate max-w-[240px]">
                {p.name}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatNumber(p.quantity)}
              </td>
              <td className="py-2 text-right font-medium tabular-nums">
                {formatCurrency(p.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
