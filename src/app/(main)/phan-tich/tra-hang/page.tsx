"use client";

/**
 * Báo cáo Trả hàng chi tiết (Phase B.1 — CEO 16/05/2026).
 *
 * Drill-down trả hàng theo lý do / SP / NV xử lý / chi nhánh.
 *
 * Trả lời câu hỏi quản lý:
 *   - Lý do trả hàng nào nhiều nhất? (chất lượng / khách đổi ý / sai món)
 *   - SP nào bị trả nhiều? (review chất lượng / mô tả sai)
 *   - Chi nhánh nào tỷ lệ trả hàng cao? (review nghiệp vụ cashier)
 *   - NV nào xử lý nhiều trả hàng? (review training)
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
  getSalesReturnReport,
  getDailyRevenue,
  type SalesReturnRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";
import { ChartCard } from "../_components/chart-card";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

export default function SalesReturnReportPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { toast } = useToast();
  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({ defaultViewMode: "chart" });

  const [rows, setRows] = useState<SalesReturnRow[]>([]);
  // Tổng doanh thu cùng kỳ — dùng để tính return rate %
  const [periodRevenue, setPeriodRevenue] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<string | "all">("all");

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    // Fetch song song: báo cáo trả hàng + tổng doanh thu cùng kỳ
    Promise.all([
      getSalesReturnReport({
        branchId: activeBranchId ?? null,
        dateFrom: range.from,
        dateTo: range.to,
      }),
      getDailyRevenue(0, activeBranchId ?? undefined, {
        from: range.from,
        to: range.to,
      }).catch(() => []),
    ])
      .then(([returnRes, revenueDays]) => {
        setRows(returnRes.rows);
        setPeriodRevenue(
          revenueDays.reduce((s, d) => s + (Number(d.revenue) || 0), 0),
        );
      })
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo trả hàng",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
        setPeriodRevenue(0);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, range.from, range.to, toast]);

  // ── KPI ──
  const kpis = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + r.returnValue, 0);
    const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
    const returnCount = new Set(rows.map((r) => r.returnId)).size;
    const productCount = new Set(rows.map((r) => r.productId)).size;
    // Return rate = giá trị trả / doanh thu cùng kỳ * 100
    const returnRate =
      periodRevenue > 0 ? (totalValue / periodRevenue) * 100 : 0;
    return {
      totalValue,
      totalQty,
      returnCount,
      productCount,
      returnRate,
      periodRevenue,
    };
  }, [rows, periodRevenue]);

  // ── Aggregations ──
  const byReason = useMemo(() => {
    const map = new Map<string, { value: number; qty: number; count: number }>();
    for (const r of rows) {
      const ex = map.get(r.reason) ?? { value: 0, qty: 0, count: 0 };
      ex.value += r.returnValue;
      ex.qty += r.quantity;
      ex.count += 1;
      map.set(r.reason, ex);
    }
    return Array.from(map.entries())
      .map(([reason, d]) => ({ reason, ...d }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const byProduct = useMemo(() => {
    const map = new Map<string, { productName: string; value: number; qty: number }>();
    for (const r of rows) {
      const ex = map.get(r.productId) ?? {
        productName: r.productName,
        value: 0,
        qty: 0,
      };
      ex.value += r.returnValue;
      ex.qty += r.quantity;
      map.set(r.productId, ex);
    }
    return Array.from(map.entries())
      .map(([productId, d]) => ({ productId, ...d }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const byStaff = useMemo(() => {
    const map = new Map<string, { name: string; value: number; count: number }>();
    for (const r of rows) {
      const key = r.createdBy ?? "unknown";
      const ex = map.get(key) ?? {
        name: r.createdByName ?? "Không xác định",
        value: 0,
        count: 0,
      };
      ex.value += r.returnValue;
      ex.count += 1;
      map.set(key, ex);
    }
    return Array.from(map.entries())
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (reasonFilter === "all") return rows;
    return rows.filter((r) => r.reason === reasonFilter);
  }, [rows, reasonFilter]);

  // ── Columns ──
  const columns: DataTableColumn<SalesReturnRow>[] = [
    {
      label: "Ngày",
      key: "returnDate",
      width: "100px",
      cell: (r) => formatDate(r.returnDate),
    },
    { label: "Mã phiếu trả", key: "returnCode", width: "120px" },
    {
      label: "Hoá đơn gốc",
      key: "invoiceCode",
      width: "120px",
      cell: (r) => r.invoiceCode ?? "—",
    },
    { label: "Chi nhánh", key: "branchName", width: "140px" },
    { label: "Khách", key: "customerName", width: "160px" },
    { label: "Sản phẩm", key: "productName", width: "220px" },
    {
      label: "SL trả",
      key: "quantity",
      align: "right",
      cell: (r) => formatNumber(r.quantity),
    },
    {
      label: "Giá trị trả",
      key: "returnValue",
      align: "right",
      cell: (r) => (
        <span className="font-semibold tabular-nums text-status-warning">
          {formatCurrency(r.returnValue)}
        </span>
      ),
    },
    {
      label: "Lý do",
      key: "reason",
      width: "180px",
      cell: (r) => (
        <span className="text-xs px-2 py-0.5 rounded bg-status-warning/10 text-status-warning font-medium">
          {r.reason}
        </span>
      ),
    },
    {
      label: "NV xử lý",
      key: "createdByName",
      width: "140px",
      cell: (r) => r.createdByName ?? "—",
    },
  ];

  // ── Export ──
  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {
      const branchLabel = activeBranchId ? "Chi nhánh đang chọn" : "Tất cả chi nhánh";

      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO TRẢ HÀNG CHI TIẾT",
        description:
          "Drill-down theo lý do / SP / NV xử lý / chi nhánh",
        range,
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Chỉ tính phiếu trả hàng đã chốt (status=completed/confirmed). Phiếu draft/cancelled không tính.",
      });

      const reasonSheet: ExcelSheet = {
        name: "Theo lý do",
        titleRows: ["TRẢ HÀNG THEO LÝ DO"],
        columns: [
          { label: "Lý do", key: "reason", width: 28 },
          { label: "Số phiếu", key: "count", width: 14, format: "number" },
          { label: "SL trả", key: "qty", width: 14, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: byReason.map((r) => ({
          reason: r.reason,
          count: r.count,
          qty: r.qty,
          value: r.value,
        })),
        footer: {
          reason: "TỔNG",
          count: rows.length,
          qty: kpis.totalQty,
          value: kpis.totalValue,
        },
      };

      const productSheet: ExcelSheet = {
        name: "Theo sản phẩm",
        titleRows: ["TRẢ HÀNG THEO SẢN PHẨM"],
        columns: [
          { label: "Sản phẩm", key: "name", width: 32 },
          { label: "SL trả", key: "qty", width: 14, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: byProduct.map((r) => ({
          name: r.productName,
          qty: r.qty,
          value: r.value,
        })),
        footer: {
          name: "TỔNG",
          qty: kpis.totalQty,
          value: kpis.totalValue,
        },
      };

      const staffSheet: ExcelSheet = {
        name: "Theo NV",
        titleRows: ["TRẢ HÀNG THEO NHÂN VIÊN XỬ LÝ"],
        columns: [
          { label: "Nhân viên", key: "name", width: 24 },
          { label: "Số phiếu xử lý", key: "count", width: 16, format: "number" },
          { label: "Tổng giá trị", key: "value", width: 18, format: "currency" },
        ],
        rows: byStaff.map((s) => ({
          name: s.name,
          count: s.count,
          value: s.value,
        })),
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết",
        titleRows: ["CHI TIẾT TỪNG DÒNG TRẢ HÀNG"],
        columns: [
          { label: "Ngày", key: "date", width: 12, format: "text" },
          { label: "Mã phiếu trả", key: "code", width: 14 },
          { label: "HĐ gốc", key: "invoice", width: 14 },
          { label: "Chi nhánh", key: "branch", width: 20 },
          { label: "Khách", key: "customer", width: 22 },
          { label: "Sản phẩm", key: "product", width: 28 },
          { label: "SL", key: "qty", width: 10, format: "number" },
          { label: "Đơn giá", key: "price", width: 14, format: "currency" },
          { label: "Giá trị", key: "value", width: 14, format: "currency" },
          { label: "Lý do", key: "reason", width: 24 },
          { label: "NV", key: "staff", width: 20 },
        ],
        rows: rows.map((r) => ({
          date: formatDate(r.returnDate),
          code: r.returnCode,
          invoice: r.invoiceCode ?? "",
          branch: r.branchName ?? "",
          customer: r.customerName,
          product: r.productName,
          qty: r.quantity,
          price: r.unitPrice,
          value: r.returnValue,
          reason: r.reason,
          staff: r.createdByName ?? "",
        })),
        footer: {
          date: "",
          code: "",
          invoice: "",
          branch: "",
          customer: "",
          product: `${rows.length} dòng`,
          qty: kpis.totalQty,
          price: "",
          value: kpis.totalValue,
          reason: "",
          staff: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "ban-hang",
        mode: "full",
        range,
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, reasonSheet, productSheet, staffSheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo trả hàng",
        description: `5 sheet: Info + Lý do (${byReason.length}) + SP (${byProduct.length}) + NV (${byStaff.length}) + Chi tiết (${rows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, byReason, byProduct, byStaff, kpis, range, activeBranchId, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Trả hàng chi tiết"
        subtitle="Drill-down theo lý do / SP / NV xử lý / chi nhánh"
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
          label="Tỷ lệ trả hàng"
          value={`${kpis.returnRate.toFixed(2)}%`}
          change={`${formatCurrency(kpis.totalValue)}đ / ${formatCurrency(kpis.periodRevenue)}đ DT`}
          positive={kpis.returnRate < 2}
          icon="percent"
          bg={
            kpis.returnRate > 5
              ? "bg-status-error/10"
              : kpis.returnRate > 2
                ? "bg-status-warning/10"
                : "bg-status-success/10"
          }
          iconColor={
            kpis.returnRate > 5
              ? "text-status-error"
              : kpis.returnRate > 2
                ? "text-status-warning"
                : "text-status-success"
          }
          valueColor={
            kpis.returnRate > 5
              ? "text-status-error"
              : kpis.returnRate > 2
                ? "text-status-warning"
                : "text-status-success"
          }
        />
        <KpiCard
          label="Tổng giá trị trả"
          value={formatCurrency(kpis.totalValue) + " đ"}
          icon="undo"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label="Số phiếu trả"
          value={formatNumber(kpis.returnCount)}
          change={`${kpis.productCount} SP / ${formatNumber(kpis.totalQty)} SL`}
          positive
          icon="receipt_long"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Doanh thu cùng kỳ"
          value={formatCurrency(kpis.periodRevenue) + " đ"}
          icon="payments"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
      </div>

      {viewMode === "chart" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Trả hàng theo lý do"
            subtitle="Top lý do giá trị cao"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byReason.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 80, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={(v) => formatNumber(v / 1_000_000) + "tr"}
                  />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    fontSize={11}
                    width={80}
                  />
                  <Tooltip
                    formatter={(v: unknown) =>
                      formatCurrency(Number(v) || 0) + " đ"
                    }
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {byReason.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            title="Top sản phẩm bị trả"
            subtitle="Theo giá trị"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart
                  data={byProduct.slice(0, 8)}
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
                    dataKey="productName"
                    fontSize={10}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v: unknown) =>
                      formatCurrency(Number(v) || 0) + " đ"
                    }
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {byReason.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReasonFilter("all")}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              reasonFilter === "all"
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-foreground hover:bg-surface-container",
            )}
          >
            Tất cả ({rows.length})
          </button>
          {byReason.slice(0, 6).map((r) => (
            <button
              key={r.reason}
              type="button"
              onClick={() => setReasonFilter(r.reason)}
              className={cn(
                "h-8 px-3 rounded-full text-xs font-medium transition-colors",
                reasonFilter === r.reason
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-low text-foreground hover:bg-surface-container",
              )}
            >
              {r.reason} ({r.count})
            </button>
          ))}
        </div>
      )}

      <ReportDataTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(r, i) => `${r.returnId}-${r.productId}-${i}`}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có phiếu trả hàng trong kỳ"
              : `${filteredRows.length} dòng — Tổng: ${formatCurrency(filteredRows.reduce((s, r) => s + r.returnValue, 0))}đ`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="undo" size={40} className="opacity-50 mb-2" />
            <p>Chưa có phiếu trả hàng nào trong kỳ</p>
          </div>
        }
      />
    </div>
  );
}
