"use client";

/**
 * Báo cáo Công nợ aging (Phase C.1 — CEO 16/05/2026).
 *
 * Phân bổ công nợ phải thu theo độ tuổi: 0-30 / 31-60 / 61-90 / >90 ngày.
 * CFO dùng để gọi đòi theo bucket — nợ càng cũ càng khó thu.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
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
  getReceivableAgingReport,
  type ReceivableAgingRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";

type BucketFilter = "all" | "0-30" | "31-60" | "61-90" | "91+";

export default function ReceivableAgingReportPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultViewMode: "table",
    forceTable: true,
  });
  const [rows, setRows] = useState<ReceivableAgingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<BucketFilter>("all");

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getReceivableAgingReport({ branchId: activeBranchId ?? null })
      .then((res) => setRows(res.rows))
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo công nợ",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [isReady, activeBranchId, toast]);

  const kpis = useMemo(() => {
    const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    const b0_30 = rows.reduce((s, r) => s + r.bucket0_30, 0);
    const b31_60 = rows.reduce((s, r) => s + r.bucket31_60, 0);
    const b61_90 = rows.reduce((s, r) => s + r.bucket61_90, 0);
    const b91Plus = rows.reduce((s, r) => s + r.bucket91Plus, 0);
    return {
      totalOutstanding,
      b0_30,
      b31_60,
      b61_90,
      b91Plus,
      customerCount: rows.length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => {
      if (filter === "0-30") return r.bucket0_30 > 0;
      if (filter === "31-60") return r.bucket31_60 > 0;
      if (filter === "61-90") return r.bucket61_90 > 0;
      return r.bucket91Plus > 0;
    });
  }, [rows, filter]);

  const columns: DataTableColumn<ReceivableAgingRow>[] = [
    { label: "Khách hàng", key: "customerName", width: "200px" },
    {
      label: "Số HĐ",
      key: "invoiceCount",
      align: "right",
      cell: (r) => formatNumber(r.invoiceCount),
    },
    {
      label: "Tổng nợ",
      key: "outstanding",
      align: "right",
      cell: (r) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatCurrency(r.outstanding)}
        </span>
      ),
    },
    {
      label: "0–30 ngày",
      key: "bucket0_30",
      align: "right",
      cell: (r) => (
        <span className="text-status-success tabular-nums">
          {r.bucket0_30 > 0 ? formatCurrency(r.bucket0_30) : "—"}
        </span>
      ),
    },
    {
      label: "31–60 ngày",
      key: "bucket31_60",
      align: "right",
      cell: (r) => (
        <span className="text-status-warning tabular-nums">
          {r.bucket31_60 > 0 ? formatCurrency(r.bucket31_60) : "—"}
        </span>
      ),
    },
    {
      label: "61–90 ngày",
      key: "bucket61_90",
      align: "right",
      cell: (r) => (
        <span className="text-status-warning tabular-nums">
          {r.bucket61_90 > 0 ? formatCurrency(r.bucket61_90) : "—"}
        </span>
      ),
    },
    {
      label: ">90 ngày",
      key: "bucket91Plus",
      align: "right",
      cell: (r) => (
        <span className="font-semibold text-status-error tabular-nums">
          {r.bucket91Plus > 0 ? formatCurrency(r.bucket91Plus) : "—"}
        </span>
      ),
    },
    {
      label: "Đơn cũ nhất",
      key: "oldestDays",
      align: "right",
      cell: (r) => `${r.oldestDays}d`,
    },
  ];

  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO CÔNG NỢ AGING",
        description: "Phân tích công nợ phải thu theo độ tuổi (snapshot hiện tại)",
        range: { from: today, to: today },
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "CFO dùng để gọi đòi. Nợ >90 ngày là red flag — xem xét impair hoặc khởi kiện.",
      });

      const summarySheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: ["TỔNG QUAN AGING CÔNG NỢ"],
        columns: [
          { label: "Nhóm tuổi", key: "bucket", width: 22 },
          { label: "Tổng tiền", key: "value", width: 18, format: "currency" },
          { label: "Tỷ lệ", key: "percent", width: 12 },
        ],
        rows: [
          {
            bucket: "0–30 ngày (an toàn)",
            value: kpis.b0_30,
            percent:
              kpis.totalOutstanding > 0
                ? `${((kpis.b0_30 / kpis.totalOutstanding) * 100).toFixed(1)}%`
                : "0%",
          },
          {
            bucket: "31–60 ngày (cần theo dõi)",
            value: kpis.b31_60,
            percent:
              kpis.totalOutstanding > 0
                ? `${((kpis.b31_60 / kpis.totalOutstanding) * 100).toFixed(1)}%`
                : "0%",
          },
          {
            bucket: "61–90 ngày (cần gọi đòi)",
            value: kpis.b61_90,
            percent:
              kpis.totalOutstanding > 0
                ? `${((kpis.b61_90 / kpis.totalOutstanding) * 100).toFixed(1)}%`
                : "0%",
          },
          {
            bucket: ">90 ngày (red flag)",
            value: kpis.b91Plus,
            percent:
              kpis.totalOutstanding > 0
                ? `${((kpis.b91Plus / kpis.totalOutstanding) * 100).toFixed(1)}%`
                : "0%",
          },
        ],
        footer: { bucket: "TỔNG", value: kpis.totalOutstanding, percent: "100%" },
      };

      const detailSheet: ExcelSheet = {
        name: "Chi tiết KH",
        titleRows: ["CHI TIẾT CÔNG NỢ TỪNG KHÁCH HÀNG"],
        columns: [
          { label: "Khách hàng", key: "name", width: 28 },
          { label: "Số HĐ", key: "count", width: 10, format: "number" },
          { label: "Tổng nợ", key: "total", width: 16, format: "currency" },
          { label: "0–30", key: "b0_30", width: 14, format: "currency" },
          { label: "31–60", key: "b31_60", width: 14, format: "currency" },
          { label: "61–90", key: "b61_90", width: 14, format: "currency" },
          { label: ">90", key: "b91Plus", width: 14, format: "currency" },
          { label: "Đơn cũ nhất", key: "oldest", width: 14 },
        ],
        rows: rows.map((r) => ({
          name: r.customerName,
          count: r.invoiceCount,
          total: r.outstanding,
          b0_30: r.bucket0_30,
          b31_60: r.bucket31_60,
          b61_90: r.bucket61_90,
          b91Plus: r.bucket91Plus,
          oldest: `${r.oldestDays}d`,
        })),
        footer: {
          name: `${rows.length} KH`,
          count: rows.reduce((s, r) => s + r.invoiceCount, 0),
          total: kpis.totalOutstanding,
          b0_30: kpis.b0_30,
          b31_60: kpis.b31_60,
          b61_90: kpis.b61_90,
          b91Plus: kpis.b91Plus,
          oldest: "",
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "tai-chinh",
        mode: "full",
        range: { from: today, to: today },
        tenantName: "OneBiz",
        sheets: [infoSheet, summarySheet, detailSheet],
      });

      toast({
        title: "Đã xuất báo cáo công nợ aging",
        description: `3 sheet: Info + Tổng quan + Chi tiết (${rows.length} KH)`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [rows, kpis, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Công nợ aging buckets"
        subtitle="Snapshot công nợ phải thu tại thời điểm hiện tại — không filter theo kỳ"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportFull={handleExport}
        exportDisabled={loading || rows.length === 0}
        hideDateRange
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Tổng công nợ"
          value={formatCurrency(kpis.totalOutstanding) + " đ"}
          change={`${kpis.customerCount} KH`}
          positive
          icon="credit_card"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard
          label="0–30 ngày"
          value={formatCurrency(kpis.b0_30) + " đ"}
          icon="check_circle"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="31–60 ngày"
          value={formatCurrency(kpis.b31_60) + " đ"}
          icon="schedule"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label="61–90 ngày"
          value={formatCurrency(kpis.b61_90) + " đ"}
          icon="warning"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label=">90 ngày (red flag)"
          value={formatCurrency(kpis.b91Plus) + " đ"}
          icon="error"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: `Tất cả (${rows.length})` },
            { key: "0-30", label: "0–30 ngày" },
            { key: "31-60", label: "31–60 ngày" },
            { key: "61-90", label: "61–90 ngày" },
            { key: "91+", label: ">90 ngày" },
          ] as { key: BucketFilter; label: string }[]
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium transition-colors",
              filter === chip.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-foreground hover:bg-surface-container",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <ReportDataTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(r) => r.customerId}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có công nợ"
              : `${filteredRows.length} KH — Tổng: ${formatCurrency(filteredRows.reduce((s, r) => s + r.outstanding, 0))}đ`
        }
        emptyState={
          <div className="text-center py-12 text-muted-foreground">
            <Icon name="check_circle" size={40} className="opacity-50 mb-2" />
            <p>Không có công nợ trong nhóm này</p>
          </div>
        }
      />
    </div>
  );
}
