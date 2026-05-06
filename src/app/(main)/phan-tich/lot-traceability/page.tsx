"use client";

/**
 * Báo cáo Lot Traceability + Hàng cận date — REP-3 (CEO 06/05/2026).
 *
 * Hiển thị:
 * - KPI: Tổng lô / Lô sắp hết hạn / Lô hết hàng / Tổng giá trị tồn lô
 * - Filter theo SP / status / source / threshold ngày
 * - Bảng chi tiết lot: lot_code / product / qty / received / expiry / source / status
 *
 * Dùng cho:
 * - Truy xuất ngược khi recall (tìm lô bán cho KH nào)
 * - Cảnh báo hết hạn (ưu tiên xả slow movers cận date)
 */

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatShortDate } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";
import { getAllProductLots, getExpiringLots } from "@/lib/services";
import { cn } from "@/lib/utils";
import { KpiCard } from "../_components";

interface LotRow {
  id: string;
  lotCode: string;
  productCode: string;
  productName: string;
  quantity: number;
  remainingQty: number;
  receivedDate: string;
  expiryDate: string | null;
  daysToExpiry: number | null;
  sourceType: string;
  status: string;
}

const SOURCE_LABEL: Record<string, string> = {
  purchase: "Nhập NCC",
  production: "Sản xuất",
  transfer: "Chuyển kho",
  other: "Khác",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Còn hàng",
  depleted: "Hết hàng",
  expired: "Hết hạn",
  recalled: "Thu hồi",
};

export default function LotTraceabilityPage() {
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [lots, setLots] = useState<LotRow[]>([]);
  const [expiringCount, setExpiringCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [lotData, expiringData] = await Promise.all([
        getAllProductLots({
          search: search || undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
        }),
        getExpiringLots(30),
      ]);

      const now = Date.now();
      const rows: LotRow[] = lotData.map((l) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyLot = l as any;
        const expiryDate = anyLot.expiry_date as string | null;
        const daysToExpiry = expiryDate
          ? Math.floor(
              (new Date(expiryDate).getTime() - now) / (1000 * 60 * 60 * 24),
            )
          : null;
        return {
          id: anyLot.id,
          lotCode: anyLot.lot_code ?? "—",
          productCode: anyLot.productCode,
          productName: anyLot.productName,
          quantity: Number(anyLot.quantity ?? 0),
          remainingQty: Number(anyLot.remaining_qty ?? 0),
          receivedDate: anyLot.received_date ?? anyLot.created_at,
          expiryDate,
          daysToExpiry,
          sourceType: anyLot.source_type ?? "other",
          status: anyLot.status ?? "active",
        };
      });

      setLots(rows);
      setExpiringCount(expiringData.total);
    } catch (err) {
      console.error("Failed to fetch lot data:", err);
      setLots([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalLots = lots.length;
  const activeLots = lots.filter((l) => l.status === "active").length;
  const totalQty = lots.reduce((s, l) => s + l.remainingQty, 0);

  const handleExportView = useCallback(() => {
    const titleRows = buildReportTitleRows({
      title: "Báo cáo lot traceability",
      range,
      generatedAt: new Date(),
    });
    exportReportToExcel({
      kind: "hang-hoa",
      mode: "view",
      range,
      sheets: [
        {
          name: "Lot trace",
          titleRows,
          columns: [
            { label: "Mã lô", key: "lotCode", width: 14 },
            { label: "Mã hàng", key: "productCode", width: 12 },
            { label: "Tên hàng", key: "productName", width: 30 },
            { label: "SL nhập", key: "quantity", width: 10, format: "number" },
            { label: "Còn lại", key: "remainingQty", width: 10, format: "number" },
            { label: "Ngày nhập", key: "receivedDate", width: 14 },
            { label: "HSD", key: "expiryDate", width: 14 },
            { label: "Còn (ngày)", key: "daysToExpiry", width: 10, format: "number" },
            { label: "Nguồn", key: "sourceType", width: 12 },
            { label: "Trạng thái", key: "status", width: 12 },
          ],
          rows: lots.map((l) => ({
            lotCode: l.lotCode,
            productCode: l.productCode,
            productName: l.productName,
            quantity: l.quantity,
            remainingQty: l.remainingQty,
            receivedDate: formatShortDate(l.receivedDate),
            expiryDate: l.expiryDate ? formatShortDate(l.expiryDate) : "—",
            daysToExpiry: l.daysToExpiry ?? "",
            sourceType: SOURCE_LABEL[l.sourceType] ?? l.sourceType,
            status: STATUS_LABEL[l.status] ?? l.status,
          })),
          footerLabel: `SL lô: ${lots.length}`,
        },
      ],
    });
  }, [lots, range]);

  const columns: DataTableColumn<LotRow>[] = [
    { label: "Mã lô", key: "lotCode", align: "left", width: "120px" },
    { label: "Mã hàng", key: "productCode", align: "left", width: "100px" },
    { label: "Tên hàng", key: "productName", align: "left" },
    {
      label: "Số lượng nhập",
      key: "quantity",
      align: "right",
      cell: (r) => formatNumber(r.quantity),
    },
    {
      label: "Số lượng còn lại",
      key: "remainingQty",
      align: "right",
      cell: (r) => formatNumber(r.remainingQty),
    },
    {
      label: "Ngày nhập",
      key: "receivedDate",
      align: "center",
      cell: (r) => formatShortDate(r.receivedDate),
    },
    {
      label: "Hạn sử dụng",
      key: "expiryDate",
      align: "center",
      cell: (r) => (r.expiryDate ? formatShortDate(r.expiryDate) : "—"),
    },
    {
      label: "Còn lại đến hạn",
      key: "daysToExpiry",
      align: "right",
      cell: (r) => {
        if (r.daysToExpiry == null) return "—";
        const isExpired = r.daysToExpiry < 0;
        const isWarning = r.daysToExpiry >= 0 && r.daysToExpiry <= 30;
        return (
          <span
            className={cn(
              isExpired && "text-status-error font-medium",
              isWarning && "text-status-warning font-medium",
            )}
          >
            {isExpired
              ? `Quá hạn ${Math.abs(r.daysToExpiry)} ngày`
              : `Còn ${r.daysToExpiry} ngày`}
          </span>
        );
      },
    },
    {
      label: "Nguồn nhập",
      key: "sourceType",
      align: "center",
      cell: (r) => SOURCE_LABEL[r.sourceType] ?? r.sourceType,
    },
    {
      label: "Trạng thái",
      key: "status",
      align: "center",
      cell: (r) => (
        <span
          className={cn(
            "inline-block px-2 py-0.5 rounded text-xs font-medium",
            r.status === "active" && "bg-status-success/10 text-status-success",
            r.status === "depleted" && "bg-muted text-muted-foreground",
            r.status === "expired" && "bg-status-error/10 text-status-error",
            r.status === "recalled" &&
              "bg-status-warning/10 text-status-warning",
          )}
        >
          {STATUS_LABEL[r.status] ?? r.status}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <ReportPageHeader
        title="Truy xuất nguồn gốc theo lô"
        subtitle="Cảnh báo lô sắp hết hạn sử dụng"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        exportDisabled={loading}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng số lô"
            value={String(totalLots)}
            icon="inventory_2"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Lô đang còn hàng"
            value={String(activeLots)}
            icon="check_circle"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Sắp hết hạn (trong 30 ngày)"
            value={String(expiringCount)}
            change={expiringCount > 0 ? "Cần xả hàng gấp" : "An toàn"}
            positive={expiringCount === 0}
            icon="schedule"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tổng số lượng còn lại"
            value={formatNumber(totalQty)}
            icon="warehouse"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-foreground"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Icon
              name="search"
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo mã lô / mã hàng..."
              className="pl-8 pr-3 h-8 text-xs rounded-full border border-border bg-surface-container-lowest outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 px-3 text-xs rounded-full border border-border bg-surface-container-lowest outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Còn hàng</option>
            <option value="depleted">Hết hàng</option>
            <option value="expired">Hết hạn</option>
            <option value="recalled">Thu hồi</option>
          </select>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Đang tải dữ liệu lot...
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow">
            <ReportDataTable<LotRow>
              columns={columns}
              rows={lots}
              getRowKey={(r) => r.id}
              subtotalLabel={`SL lô: ${lots.length}`}
              emptyState="Chưa có lot nào"
            />
          </div>
        )}
      </div>
    </div>
  );
}
