"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { formatCurrency, formatChartCurrency, formatChartTooltipCurrency } from "@/lib/format";
import {
  getFnbKpis,
  getRevenueByMenuItem,
  getRevenueByTable,
  getRevenueByHourFnb,
  getCashierPerformance,
} from "@/lib/services";
import type {
  FnbKpis,
  MenuItemRevenue,
  TableRevenue,
  HourlyRevenue,
  CashierPerformance,
} from "@/lib/services/supabase/fnb-analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";

// === Tooltips ===

function HourTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm font-bold text-primary">
          {p.dataKey === "revenue"
            ? formatChartTooltipCurrency(p.value)
            : `${p.value} đơn`}
        </p>
      ))}
    </div>
  );
}

const COLORS = [
  "#004AC6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#e11d48", "#a855f7", "#22c55e", "#eab308",
];

export default function FnbAnalyticsPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "chart" });
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<FnbKpis | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemRevenue[]>([]);
  const [tables, setTables] = useState<TableRevenue[]>([]);
  const [hourly, setHourly] = useState<HourlyRevenue[]>([]);
  const [cashiers, setCashiers] = useState<CashierPerformance[]>([]);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  useEffect(() => {
    if (!isReady) return;
    (async () => {
      setLoading(true);
      try {
        const [k, m, t, h, c] = await Promise.all([
          getFnbKpis(activeBranchId, range),
          getRevenueByMenuItem(activeBranchId),
          getRevenueByTable(activeBranchId),
          getRevenueByHourFnb(activeBranchId),
          getCashierPerformance(activeBranchId),
        ]);
        setKpis(k);
        setMenuItems(m);
        setTables(t);
        setHourly(h);
        setCashiers(c);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [activeBranchId, range, isReady]);

  // CEO 13/05: Export Excel — 2 mode (view: 1 sheet, full: 4 sheet)
  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO F&B",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const kpiRows = [
        { metric: "Tổng doanh thu", value: kpis?.totalRevenue ?? 0 },
        { metric: "Số đơn", value: kpis?.totalOrders ?? 0 },
        { metric: "TB / đơn", value: kpis?.avgTicket ?? 0 },
        { metric: "Turnover TB (phút)", value: kpis?.avgTurnoverMinutes ?? 0 },
      ];
      const sheet: ExcelSheet = {
        name: "KPI F&B",
        titleRows: title,
        columns: [
          { label: "Chỉ tiêu", key: "metric", width: 24 },
          { label: "Giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: kpiRows,
      };
      exportReportToExcel({
        kind: "fnb",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
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
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO F&B — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        {
          name: "KPI F&B",
          titleRows: title,
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 24 },
            { label: "Giá trị", key: "value", width: 18, format: "currency" },
          ],
          rows: [
            { metric: "Tổng doanh thu", value: kpis?.totalRevenue ?? 0 },
            { metric: "Số đơn", value: kpis?.totalOrders ?? 0 },
            { metric: "TB / đơn", value: kpis?.avgTicket ?? 0 },
            { metric: "Turnover TB (phút)", value: kpis?.avgTurnoverMinutes ?? 0 },
          ],
        },
        {
          name: "Theo món",
          titleRows: ["TOP MÓN BÁN CHẠY", ...title.slice(1)],
          columns: [
            { label: "STT", key: "rank", width: 6 },
            { label: "Tên món", key: "name", width: 32 },
            { label: "SL bán", key: "qty", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: menuItems.map((m, i) => ({
            rank: i + 1,
            name: m.productName,
            qty: m.quantity,
            revenue: m.revenue,
          })),
          footer: {
            rank: "",
            name: "TỔNG",
            qty: menuItems.reduce((s, m) => s + m.quantity, 0),
            revenue: menuItems.reduce((s, m) => s + m.revenue, 0),
          },
        },
        {
          name: "Theo bàn",
          titleRows: ["DOANH THU THEO BÀN", ...title.slice(1)],
          columns: [
            { label: "Bàn", key: "name", width: 16 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: tables.map((t) => ({
            name: t.tableName,
            orders: t.orders,
            revenue: t.revenue,
          })),
          footer: {
            name: "TỔNG",
            orders: tables.reduce((s, t) => s + t.orders, 0),
            revenue: tables.reduce((s, t) => s + t.revenue, 0),
          },
        },
        {
          name: "Theo giờ",
          titleRows: ["DOANH THU THEO GIỜ", ...title.slice(1)],
          columns: [
            { label: "Khung giờ", key: "label", width: 14 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: hourly.map((h) => ({
            label: h.label,
            orders: h.orders,
            revenue: h.revenue,
          })),
        },
        {
          name: "Theo nhân viên",
          titleRows: ["HIỆU SUẤT NHÂN VIÊN", ...title.slice(1)],
          columns: [
            { label: "Nhân viên", key: "name", width: 24 },
            { label: "Số đơn", key: "orders", width: 12, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
            { label: "TB / đơn (VND)", key: "avgTicket", width: 18, format: "currency" },
          ],
          rows: cashiers.map((c) => ({
            name: c.cashierName,
            orders: c.orders,
            revenue: c.revenue,
            avgTicket: c.avgTicket,
          })),
        },
      ];
      exportReportToExcel({
        kind: "fnb",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({
        title: "Đã xuất Excel (đầy đủ)",
        description: "File có 5 sheet — KPI + theo món + theo bàn + theo giờ + theo NV.",
        variant: "success",
        duration: 5000,
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [kpis, menuItems, tables, hourly, cashiers, range, branchLabel, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <ReportPageHeader
        title="Báo cáo F&B"
        subtitle="Doanh thu theo món, bàn, giờ, nhân viên"
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        <KpiCard
          label="Tổng doanh thu F&B"
          value={formatCurrency(kpis?.totalRevenue ?? 0)}
          icon="attach_money"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Số đơn"
          value={String(kpis?.totalOrders ?? 0)}
          icon="shopping_cart"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Trung bình/đơn"
          value={formatCurrency(kpis?.avgTicket ?? 0)}
          icon="receipt"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Turnover trung bình"
          value={`${kpis?.avgTurnoverMinutes ?? 0} phút`}
          icon="schedule"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-foreground"
        />
      </div>

      {/* CEO 13/05: 2 mode — Biểu đồ vs Bảng số liệu kế toán */}
      {viewMode === "chart" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
          {/* Revenue by Hour */}
          <ChartCard title="Doanh thu theo giờ" subtitle="Phân bổ doanh thu trong ngày">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly.filter((h) => h.revenue > 0 || h.orders > 0)}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} />
                  <Tooltip content={<HourTooltip />} />
                  <Bar dataKey="revenue" fill="#004AC6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Top Menu Items */}
          <ChartCard title="Top món bán chạy" subtitle="Theo doanh thu">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={menuItems.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatChartCurrency} tick={{ fontSize: 11 }} />
                  <YAxis
                    dataKey="productName"
                    type="category"
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => formatChartTooltipCurrency(Number(value))}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {menuItems.slice(0, 10).map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Revenue by Table */}
          <ChartCard title="Doanh thu theo bàn" subtitle="Bàn nào bán nhiều nhất">
            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tables.map((t, idx) => {
                  const maxRevenue = tables[0]?.revenue || 1;
                  const pct = (t.revenue / maxRevenue) * 100;
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs text-foreground w-20 shrink-0 truncate">
                        {t.tableName}
                      </span>
                      <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-foreground shrink-0 w-24 text-right">
                        {formatCurrency(t.revenue)}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t.orders} đơn
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </ChartCard>

          {/* Cashier Performance */}
          <ChartCard title="Hiệu suất nhân viên" subtitle="Doanh thu và số đơn theo nhân viên">
            {cashiers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 text-xs font-medium text-muted-foreground">Nhân viên</th>
                      <th className="py-2 text-xs font-medium text-muted-foreground text-right">Doanh thu</th>
                      <th className="py-2 text-xs font-medium text-muted-foreground text-right">Số đơn</th>
                      <th className="py-2 text-xs font-medium text-muted-foreground text-right">TB/đơn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashiers.map((c, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-2 font-medium">{c.cashierName}</td>
                        <td className="py-2 text-right">{formatCurrency(c.revenue)}</td>
                        <td className="py-2 text-right">{c.orders}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatCurrency(c.avgTicket)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      ) : (
        /* TABLE VIEW — 4 bảng số liệu kế toán đầy đủ */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
          {/* Doanh thu theo giờ */}
          <ChartCard title="Doanh thu theo giờ" subtitle="Phân bổ trong ngày">
            {hourly.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Khung giờ</th>
                      <th className="py-2 px-3 font-medium text-right">Số đơn</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourly
                      .filter((h) => h.revenue > 0 || h.orders > 0)
                      .map((h, idx) => (
                        <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                          <td className="py-1.5 px-3 text-foreground tabular-nums">{h.label}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{h.orders}</td>
                          <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                            {formatCurrency(h.revenue)}đ
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {hourly.reduce((s, h) => s + h.orders, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(hourly.reduce((s, h) => s + h.revenue, 0))}đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </ChartCard>

          {/* Top món */}
          <ChartCard title="Top món bán chạy" subtitle="Theo doanh thu">
            {menuItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium w-8">#</th>
                      <th className="py-2 px-3 font-medium">Tên món</th>
                      <th className="py-2 px-3 font-medium text-right">SL</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuItems.map((m, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                        <td className="py-1.5 px-3 text-muted-foreground text-xs tabular-nums">{idx + 1}</td>
                        <td className="py-1.5 px-3 font-medium">{m.productName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{m.quantity}</td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                          {formatCurrency(m.revenue)}đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td colSpan={2} className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {menuItems.reduce((s, m) => s + m.quantity, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(menuItems.reduce((s, m) => s + m.revenue, 0))}đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </ChartCard>

          {/* Doanh thu theo bàn */}
          <ChartCard title="Doanh thu theo bàn" subtitle="Bàn nào bán nhiều nhất">
            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Bàn</th>
                      <th className="py-2 px-3 font-medium text-right">Số đơn</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                        <td className="py-1.5 px-3 font-medium">{t.tableName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{t.orders}</td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                          {formatCurrency(t.revenue)}đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {tables.reduce((s, t) => s + t.orders, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(tables.reduce((s, t) => s + t.revenue, 0))}đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </ChartCard>

          {/* Cashier */}
          <ChartCard title="Hiệu suất nhân viên" subtitle="Doanh thu + số đơn theo NV">
            {cashiers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Nhân viên</th>
                      <th className="py-2 px-3 font-medium text-right">Số đơn</th>
                      <th className="py-2 px-3 font-medium text-right">Doanh thu</th>
                      <th className="py-2 px-3 font-medium text-right">TB/đơn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashiers.map((c, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-surface-container-low">
                        <td className="py-1.5 px-3 font-medium">{c.cashierName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{c.orders}</td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                          {formatCurrency(c.revenue)}đ
                        </td>
                        <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums">
                          {formatCurrency(c.avgTicket)}đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-container-low">
                    <tr className="border-t-2 border-foreground/20 font-bold">
                      <td className="py-2 px-3">TỔNG</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {cashiers.reduce((s, c) => s + c.orders, 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-primary tabular-nums">
                        {formatCurrency(cashiers.reduce((s, c) => s + c.revenue, 0))}đ
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}
