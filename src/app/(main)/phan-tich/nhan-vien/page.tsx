"use client";

/**
 * Báo cáo Doanh thu Nhân viên cross-branch (Phase B.2 — CEO 16/05/2026).
 *
 * Xếp hạng nhân viên theo doanh thu toàn chuỗi 5 đơn vị + chi tiết per branch
 * + theo source (POS Retail / FnB).
 *
 * Trả lời câu hỏi quản lý:
 *   - NV nào doanh thu cao nhất chuỗi?
 *   - 1 NV (manager) phụ trách >1 chi nhánh thì hiệu suất từng chi nhánh?
 *   - POS Retail vs FnB ai mạnh hơn?
 *   - AOV (giá trị đơn TB) của NV nào cao?
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  getStaffRevenueReport,
  type StaffRevenueRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

type SourceFilter = "all" | "pos" | "fnb";

const SOURCE_LABEL: Record<string, string> = {
  pos: "POS Retail",
  fnb: "POS FnB",
};

export default function StaffRevenueReportPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady } = useBranchFilter();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultViewMode: "chart" });

  const [rows, setRows] = useState<StaffRevenueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getStaffRevenueReport({
      dateFrom: range.from,
      dateTo: range.to,
      source: sourceFilter === "all" ? null : sourceFilter,
      branchId: activeBranchId ?? null,
    })
      .then((res) => setRows(res.rows))
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo NV",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, range.from, range.to, sourceFilter, activeBranchId, toast]);

  // ── KPI ──
  const kpis = useMemo(() => {
    const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
    const totalInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);
    const totalCustomers = rows.reduce((s, r) => s + r.customerCount, 0);
    const staffCount = new Set(rows.map((r) => r.staffId)).size;
    const avgPerStaff = staffCount > 0 ? totalRevenue / staffCount : 0;
    return { totalRevenue, totalInvoices, totalCustomers, staffCount, avgPerStaff };
  }, [rows]);

  // ── Aggregation: tổng theo NV (gộp các chi nhánh + source) ──
  const byStaff = useMemo(() => {
    const map = new Map<
      string,
      {
        staffName: string;
        staffRole: string | null;
        revenue: number;
        invoices: number;
        customers: number;
        branches: Set<string>;
      }
    >();
    for (const r of rows) {
      const ex = map.get(r.staffId) ?? {
        staffName: r.staffName,
        staffRole: r.staffRole,
        revenue: 0,
        invoices: 0,
        customers: 0,
        branches: new Set<string>(),
      };
      ex.revenue += r.totalRevenue;
      ex.invoices += r.invoiceCount;
      ex.customers += r.customerCount;
      if (r.branchId) ex.branches.add(r.branchId);
      map.set(r.staffId, ex);
    }
    return Array.from(map.entries())
      .map(([staffId, d]) => ({
        staffId,
        staffName: d.staffName,
        staffRole: d.staffRole,
        revenue: d.revenue,
        invoices: d.invoices,
        customers: d.customers,
        branchCount: d.branches.size,
        aov: d.invoices > 0 ? d.revenue / d.invoices : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  // ── Columns (detail per branch × source) ──
  const columns: DataTableColumn<StaffRevenueRow>[] = [
    { label: "Nhân viên", key: "staffName", width: "180px" },
    {
      label: "Chức vụ",
      key: "staffRole",
      width: "120px",
      cell: (r) => r.staffRole ?? "—",
    },
    { label: "Chi nhánh", key: "branchName", width: "160px" },
    {
      label: "Kênh",
      key: "source",
      width: "100px",
      cell: (r) => (
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium",
            r.source === "pos"
              ? "bg-primary-fixed text-primary"
              : "bg-status-warning/10 text-status-warning",
          )}
        >
          {SOURCE_LABEL[r.source] ?? r.source}
        </span>
      ),
    },
    {
      label: "Số đơn",
      key: "invoiceCount",
      align: "right",
      cell: (r) => formatNumber(r.invoiceCount),
    },
    {
      label: "Doanh thu",
      key: "totalRevenue",
      align: "right",
      cell: (r) => (
        <span className="font-semibold tabular-nums text-primary">
          {formatCurrency(r.totalRevenue)}
        </span>
      ),
    },
    {
      label: "AOV",
      key: "avgOrderValue",
      align: "right",
      cell: (r) => formatCurrency(r.avgOrderValue),
    },
    {
      label: "Số khách",
      key: "customerCount",
      align: "right",
      cell: (r) => formatNumber(r.customerCount),
    },
    {
      label: "Đơn cuối",
      key: "lastOrderAt",
      align: "center",
      cell: (r) => (r.lastOrderAt ? formatDate(r.lastOrderAt) : "—"),
    },
  ];

  // ── Export ──
  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO DOANH THU NHÂN VIÊN",
        description:
          "Xếp hạng nhân viên cross-branch + chi tiết per chi nhánh × kênh bán",
        range,
        branchName: "Tất cả chi nhánh",
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Doanh thu = invoices.total (đã trừ commission delivery cho FnB platform). Chỉ tính đơn status=completed.",
      });

      const staffSheet: ExcelSheet = {
        name: "Xếp hạng NV",
        titleRows: ["XẾP HẠNG NHÂN VIÊN TOÀN CHUỖI"],
        columns: [
          { label: "Hạng", key: "rank", width: 8, format: "number" },
          { label: "Nhân viên", key: "name", width: 24 },
          { label: "Chức vụ", key: "role", width: 16 },
          { label: "Số chi nhánh", key: "branches", width: 14, format: "number" },
          { label: "Số đơn", key: "invoices", width: 12, format: "number" },
          { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
          { label: "AOV", key: "aov", width: 14, format: "currency" },
          { label: "Số khách", key: "customers", width: 12, format: "number" },
        ],
        rows: byStaff.map((s, i) => ({
          rank: i + 1,
          name: s.staffName,
          role: s.staffRole ?? "",
          branches: s.branchCount,
          invoices: s.invoices,
          revenue: s.revenue,
          aov: s.aov,
          customers: s.customers,
        })),
        footer: {
          rank: "",
          name: `${byStaff.length} NV`,
          role: "",
          branches: "",
          invoices: kpis.totalInvoices,
          revenue: kpis.totalRevenue,
          aov: "",
          customers: kpis.totalCustomers,
        },
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết NV × CN × Kênh",
        titleRows: ["CHI TIẾT TỪNG NV THEO CHI NHÁNH × KÊNH BÁN"],
        columns: [
          { label: "Nhân viên", key: "staff", width: 24 },
          { label: "Chức vụ", key: "role", width: 14 },
          { label: "Chi nhánh", key: "branch", width: 22 },
          { label: "Kênh", key: "source", width: 12 },
          { label: "Số đơn", key: "invoices", width: 10, format: "number" },
          { label: "Doanh thu", key: "revenue", width: 16, format: "currency" },
          { label: "AOV", key: "aov", width: 14, format: "currency" },
          { label: "Số khách", key: "customers", width: 12, format: "number" },
          { label: "Đơn đầu", key: "first", width: 14, format: "text" },
          { label: "Đơn cuối", key: "last", width: 14, format: "text" },
        ],
        rows: rows.map((r) => ({
          staff: r.staffName,
          role: r.staffRole ?? "",
          branch: r.branchName ?? "",
          source: SOURCE_LABEL[r.source] ?? r.source,
          invoices: r.invoiceCount,
          revenue: r.totalRevenue,
          aov: r.avgOrderValue,
          customers: r.customerCount,
          first: r.firstOrderAt ? formatDate(r.firstOrderAt) : "",
          last: r.lastOrderAt ? formatDate(r.lastOrderAt) : "",
        })),
        footer: {
          staff: "",
          role: "",
          branch: "",
          source: "TỔNG",
          invoices: kpis.totalInvoices,
          revenue: kpis.totalRevenue,
          aov: "",
          customers: kpis.totalCustomers,
          first: "",
          last: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "ban-hang",
        mode: "full",
        range,
        tenantName: "OneBiz",
        sheets: [infoSheet, staffSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo NV",
        description: `3 sheet: Info + Xếp hạng (${byStaff.length}) + Chi tiết (${rows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, byStaff, kpis, range, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Doanh thu nhân viên"
        subtitle="Xếp hạng NV cross-branch + chi tiết per chi nhánh × kênh"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || rows.length === 0}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Tổng doanh thu"
          value={formatCurrency(kpis.totalRevenue) + " đ"}
          icon="payments"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard
          label="Số nhân viên"
          value={formatNumber(kpis.staffCount)}
          icon="badge"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
        <KpiCard
          label="TB / NV"
          value={formatCurrency(kpis.avgPerStaff) + " đ"}
          icon="leaderboard"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="Tổng số đơn"
          value={formatNumber(kpis.totalInvoices)}
          icon="receipt_long"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-foreground"
        />
      </div>

      {/* Source filter */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: "Tất cả kênh" },
            { key: "pos", label: "POS Retail" },
            { key: "fnb", label: "POS FnB" },
          ] as { key: SourceFilter; label: string }[]
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setSourceFilter(chip.key)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              sourceFilter === chip.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-foreground hover:bg-surface-container",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {viewMode === "chart" && byStaff.length > 0 && (
        <ChartCard
          title="Top 10 nhân viên doanh thu cao nhất"
          subtitle="Tổng doanh thu trong kỳ"
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart
                data={byStaff.slice(0, 10)}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 100, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  fontSize={11}
                  tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                />
                <YAxis
                  type="category"
                  dataKey="staffName"
                  fontSize={11}
                  width={100}
                />
                <Tooltip
                  formatter={(v: unknown) =>
                    formatCurrency(Number(v) || 0) + " đ"
                  }
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {byStaff.slice(0, 10).map((_, i) => (
                    <Cell
                      key={i}
                      fill={
                        i === 0
                          ? "#10B981"
                          : i === 1
                            ? "#3B82F6"
                            : i === 2
                              ? "#F59E0B"
                              : "#9CA3AF"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      <ReportDataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => `${r.staffId}-${r.branchId ?? ""}-${r.source}`}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : rows.length === 0
              ? "Không có dữ liệu"
              : `${rows.length} dòng (${kpis.staffCount} NV × CN × kênh)`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="badge" size={40} className="opacity-50 mb-2" />
            <p>Không có dữ liệu doanh thu NV trong kỳ</p>
          </div>
        }
      />
    </div>
  );
}
