"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatDateInputValue, formatNumber } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  getPayableAgingReport,
  getReceivableAgingReport,
  type PayableAgingRow,
  type ReceivableAgingRow,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";

interface AgingDisplayRow {
  id: string;
  name: string;
  documentCount: number;
  outstanding: number;
  bucket0_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket91Plus: number;
  oldestDays: number;
}

type AgingMode = "receivable" | "payable";
type BucketFilter = "all" | "0-30" | "31-60" | "61-90" | "91+";

function toReceivableRow(row: ReceivableAgingRow): AgingDisplayRow {
  return {
    id: row.customerId,
    name: row.customerName,
    documentCount: row.invoiceCount,
    outstanding: row.outstanding,
    bucket0_30: row.bucket0_30,
    bucket31_60: row.bucket31_60,
    bucket61_90: row.bucket61_90,
    bucket91Plus: row.bucket91Plus,
    oldestDays: row.oldestDays,
  };
}

function toPayableRow(row: PayableAgingRow): AgingDisplayRow {
  return {
    id: row.supplierId,
    name: row.supplierName,
    documentCount: row.documentCount,
    outstanding: row.outstanding,
    bucket0_30: row.bucket0_30,
    bucket31_60: row.bucket31_60,
    bucket61_90: row.bucket61_90,
    bucket91Plus: row.bucket91Plus,
    oldestDays: row.oldestDays,
  };
}

function summarize(rows: AgingDisplayRow[]) {
  return {
    total: rows.reduce((sum, row) => sum + row.outstanding, 0),
    b0_30: rows.reduce((sum, row) => sum + row.bucket0_30, 0),
    b31_60: rows.reduce((sum, row) => sum + row.bucket31_60, 0),
    b61_90: rows.reduce((sum, row) => sum + row.bucket61_90, 0),
    b91Plus: rows.reduce((sum, row) => sum + row.bucket91Plus, 0),
  };
}

function buildSummarySheet(
  name: string,
  title: string,
  rows: AgingDisplayRow[],
): ExcelSheet {
  const totals = summarize(rows);
  return {
    name,
    titleRows: [title],
    columns: [
      { label: "Nhóm tuổi", key: "bucket", width: 24 },
      { label: "Số tiền", key: "amount", width: 18, format: "currency" },
      { label: "Tỷ lệ", key: "percent", width: 12 },
    ],
    rows: [
      { bucket: "0–30 ngày", amount: totals.b0_30 },
      { bucket: "31–60 ngày", amount: totals.b31_60 },
      { bucket: "61–90 ngày", amount: totals.b61_90 },
      { bucket: "Trên 90 ngày", amount: totals.b91Plus },
    ].map((row) => ({
      ...row,
      percent:
        totals.total > 0
          ? ((Number(row.amount) / totals.total) * 100).toFixed(1) + "%"
          : "0%",
    })),
    footer: { bucket: "TỔNG", amount: totals.total, percent: "100%" },
  };
}

function buildDetailSheet(
  name: string,
  title: string,
  entityLabel: string,
  documentLabel: string,
  rows: AgingDisplayRow[],
): ExcelSheet {
  const totals = summarize(rows);
  return {
    name,
    titleRows: [title],
    columns: [
      { label: entityLabel, key: "entity", width: 30 },
      { label: documentLabel, key: "documents", width: 12, format: "number" },
      { label: "Tổng nợ", key: "total", width: 18, format: "currency" },
      { label: "0–30 ngày", key: "b0_30", width: 16, format: "currency" },
      { label: "31–60 ngày", key: "b31_60", width: 16, format: "currency" },
      { label: "61–90 ngày", key: "b61_90", width: 16, format: "currency" },
      { label: "Trên 90 ngày", key: "b91Plus", width: 16, format: "currency" },
      { label: "Lâu nhất (ngày)", key: "oldest", width: 14, format: "number" },
    ],
    rows: rows.map((row) => ({
      entity: row.name,
      documents: row.documentCount,
      total: row.outstanding,
      b0_30: row.bucket0_30,
      b31_60: row.bucket31_60,
      b61_90: row.bucket61_90,
      b91Plus: row.bucket91Plus,
      oldest: row.oldestDays,
    })),
    footer: {
      entity: String(rows.length) + " đối tượng",
      documents: rows.reduce((sum, row) => sum + row.documentCount, 0),
      total: totals.total,
      b0_30: totals.b0_30,
      b31_60: totals.b31_60,
      b61_90: totals.b61_90,
      b91Plus: totals.b91Plus,
      oldest: "",
    },
    withSignature: true,
  };
}

export default function DebtAgingReportPage() {
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultViewMode: "table",
    forceTable: true,
  });
  const [mode, setMode] = useState<AgingMode>("receivable");
  const [receivableRows, setReceivableRows] = useState<AgingDisplayRow[]>([]);
  const [payableRows, setPayableRows] = useState<AgingDisplayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<BucketFilter>("all");

  useEffect(() => {
    if (!isReady) return;
    let active = true;
    setLoading(true);
    Promise.all([
      getReceivableAgingReport({ branchId: activeBranchId ?? null }),
      getPayableAgingReport({ branchId: activeBranchId ?? null }),
    ])
      .then(([receivable, payable]) => {
        if (!active) return;
        setReceivableRows(receivable.rows.map(toReceivableRow));
        setPayableRows(payable.rows.map(toPayableRow));
      })
      .catch((error) => {
        if (!active) return;
        setReceivableRows([]);
        setPayableRows([]);
        toast({
          title: "Không tải được báo cáo tuổi nợ",
          description: error instanceof Error ? error.message : "Lỗi không xác định",
          variant: "error",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeBranchId, isReady, toast]);

  const rows = mode === "receivable" ? receivableRows : payableRows;
  const totals = useMemo(() => summarize(rows), [rows]);
  const receivableTotal = useMemo(() => summarize(receivableRows).total, [receivableRows]);
  const payableTotal = useMemo(() => summarize(payableRows).total, [payableRows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "0-30") return rows.filter((row) => row.bucket0_30 > 0);
    if (filter === "31-60") return rows.filter((row) => row.bucket31_60 > 0);
    if (filter === "61-90") return rows.filter((row) => row.bucket61_90 > 0);
    return rows.filter((row) => row.bucket91Plus > 0);
  }, [filter, rows]);

  const columns = useMemo<DataTableColumn<AgingDisplayRow>[]>(() => [
    {
      label: mode === "receivable" ? "Khách hàng" : "Nhà cung cấp",
      key: "name",
      width: "240px",
      sticky: true,
      hideable: false,
    },
    {
      label: mode === "receivable" ? "Số hóa đơn" : "Số phiếu nhập",
      key: "documentCount",
      align: "right",
      cell: (row) => formatNumber(row.documentCount),
    },
    {
      label: "Tổng nợ",
      key: "outstanding",
      align: "right",
      cell: (row) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatCurrency(row.outstanding)}
        </span>
      ),
    },
    {
      label: "0–30 ngày",
      key: "bucket0_30",
      align: "right",
      cell: (row) => row.bucket0_30 > 0 ? formatCurrency(row.bucket0_30) : "—",
    },
    {
      label: "31–60 ngày",
      key: "bucket31_60",
      align: "right",
      cell: (row) => row.bucket31_60 > 0 ? formatCurrency(row.bucket31_60) : "—",
    },
    {
      label: "61–90 ngày",
      key: "bucket61_90",
      align: "right",
      cell: (row) => row.bucket61_90 > 0 ? formatCurrency(row.bucket61_90) : "—",
    },
    {
      label: "Trên 90 ngày",
      key: "bucket91Plus",
      align: "right",
      cell: (row) => (
        <span className={row.bucket91Plus > 0 ? "font-semibold text-status-error" : ""}>
          {row.bucket91Plus > 0 ? formatCurrency(row.bucket91Plus) : "—"}
        </span>
      ),
    },
    {
      label: "Lâu nhất",
      key: "oldestDays",
      align: "right",
      cell: (row) => formatNumber(row.oldestDays) + " ngày",
    },
  ], [mode]);

  const handleExport = useCallback(() => {
    if (receivableRows.length === 0 && payableRows.length === 0) {
      toast({ title: "Không có dữ liệu để xuất", variant: "warning" });
      return;
    }
    const today = formatDateInputValue(new Date());
    const sheets: ExcelSheet[] = [
      buildInfoSheet({
        title: "BÁO CÁO TUỔI NỢ",
        description: "Tách riêng công nợ phải thu khách hàng và phải trả nhà cung cấp",
        range: { from: today, to: today },
        branchName: branchLabel,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer: "Số liệu được phân nhóm theo tuổi của từng chứng từ còn dư nợ.",
      }),
      buildSummarySheet("Tổng quan phải thu", "TUỔI NỢ PHẢI THU", receivableRows),
      buildDetailSheet(
        "Chi tiết phải thu",
        "CHI TIẾT PHẢI THU KHÁCH HÀNG",
        "Khách hàng",
        "Số hóa đơn",
        receivableRows,
      ),
      buildSummarySheet("Tổng quan phải trả", "TUỔI NỢ PHẢI TRẢ", payableRows),
      buildDetailSheet(
        "Chi tiết phải trả",
        "CHI TIẾT PHẢI TRẢ NHÀ CUNG CẤP",
        "Nhà cung cấp",
        "Số phiếu nhập",
        payableRows,
      ),
    ];
    exportReportToExcel({
      kind: "cong-no-aging",
      mode: "full",
      range: { from: today, to: today },
      tenantName: "OneBiz",
      sheets,
    });
    toast({
      title: "Đã xuất báo cáo tuổi nợ",
      description: "File gồm các trang riêng cho phải thu và phải trả.",
      variant: "success",
    });
  }, [branchLabel, payableRows, receivableRows, toast]);

  const modeLabel = mode === "receivable" ? "khách hàng" : "nhà cung cấp";

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="Tuổi nợ"
        subtitle="Theo dõi riêng phải thu khách hàng và phải trả nhà cung cấp theo từng chứng từ"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportFull={handleExport}
        exportDisabled={loading || (receivableRows.length === 0 && payableRows.length === 0)}
        hideDateRange
      />

      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as AgingMode);
          setFilter("all");
        }}
      >
        <TabsList className="h-auto w-full max-w-xl rounded-lg p-1">
          <TabsTrigger value="receivable" className="min-h-12 rounded-md px-4">
            <span className="text-left">
              <span className="block text-xs">Phải thu khách hàng</span>
              <span className="block font-semibold tabular-nums">
                {formatCurrency(receivableTotal)} đ
              </span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="payable" className="min-h-12 rounded-md px-4">
            <span className="text-left">
              <span className="block text-xs">Phải trả nhà cung cấp</span>
              <span className="block font-semibold tabular-nums">
                {formatCurrency(payableTotal)} đ
              </span>
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label={mode === "receivable" ? "Tổng phải thu" : "Tổng phải trả"}
          value={formatCurrency(totals.total) + " đ"}
          change={String(rows.length) + " " + modeLabel}
          positive={totals.b91Plus === 0}
          icon={mode === "receivable" ? "payments" : "receipt_long"}
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard label="0–30 ngày" value={formatCurrency(totals.b0_30) + " đ"} icon="check_circle" bg="bg-status-success/10" iconColor="text-status-success" valueColor="text-status-success" />
        <KpiCard label="31–60 ngày" value={formatCurrency(totals.b31_60) + " đ"} icon="schedule" bg="bg-status-warning/10" iconColor="text-status-warning" valueColor="text-status-warning" />
        <KpiCard label="61–90 ngày" value={formatCurrency(totals.b61_90) + " đ"} icon="warning" bg="bg-status-warning/10" iconColor="text-status-warning" valueColor="text-status-warning" />
        <KpiCard label="Trên 90 ngày" value={formatCurrency(totals.b91Plus) + " đ"} icon="error" bg="bg-status-error/10" iconColor="text-status-error" valueColor="text-status-error" />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo tuổi nợ">
        {([
          ["all", "Tất cả (" + rows.length + ")"],
          ["0-30", "0–30 ngày"],
          ["31-60", "31–60 ngày"],
          ["61-90", "61–90 ngày"],
          ["91+", "Trên 90 ngày"],
        ] as Array<[BucketFilter, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={
              "h-8 rounded-md px-3 text-xs font-medium transition-colors " +
              (filter === key
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-foreground hover:bg-surface-container")
            }
          >
            {label}
          </button>
        ))}
      </div>

      <ReportDataTable
        tablePreferenceKey={"report.debt-aging." + mode}
        columns={columns}
        rows={filteredRows}
        getRowKey={(row) => row.id}
        subtotalLabel={
          loading
            ? "Đang tải..."
            : filteredRows.length === 0
              ? "Không có công nợ"
              : String(filteredRows.length) + " " + modeLabel + " — Tổng: " +
                formatCurrency(filteredRows.reduce((sum, row) => sum + row.outstanding, 0)) + " đ"
        }
        emptyState={
          <div className="py-12 text-center text-muted-foreground">
            <Icon name="check_circle" size={40} className="mb-2 opacity-50" />
            <p>Không có công nợ trong nhóm này</p>
          </div>
        }
      />
    </div>
  );
}
