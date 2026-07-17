"use client";

/**
 * BÃ¡o cÃ¡o Lot Traceability + HÃ ng cáº­n date â€” REP-3 (CEO 06/05/2026).
 *
 * Hiá»ƒn thá»‹:
 * - KPI: Tá»•ng lÃ´ / LÃ´ sáº¯p háº¿t háº¡n / LÃ´ háº¿t hÃ ng / Tá»•ng giÃ¡ trá»‹ tá»“n lÃ´
 * - Filter theo SP / status / source / threshold ngÃ y
 * - Báº£ng chi tiáº¿t lot: lot_code / product / qty / received / expiry / source / status
 *
 * DÃ¹ng cho:
 * - Truy xuáº¥t ngÆ°á»£c khi recall (tÃ¬m lÃ´ bÃ¡n cho KH nÃ o)
 * - Cáº£nh bÃ¡o háº¿t háº¡n (Æ°u tiÃªn xáº£ slow movers cáº­n date)
 */

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { getAllProductLots } from "@/lib/services";
import { useBranchFilter } from "@/lib/contexts";
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
  purchase: "Nháº­p NCC",
  production: "Sáº£n xuáº¥t",
  transfer: "Chuyá»ƒn kho",
  other: "KhÃ¡c",
};

const STATUS_LABEL: Record<string, string> = {
  active: "CÃ²n hÃ ng",
  depleted: "Háº¿t hÃ ng",
  expired: "Háº¿t háº¡n",
  recalled: "Thu há»“i",
  consumed: "ÄÃ£ dÃ¹ng háº¿t",
  disposed: "ÄÃ£ há»§y",
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Táº¥t cáº£ tráº¡ng thÃ¡i" },
  { value: "active", label: "CÃ²n hÃ ng" },
  { value: "depleted", label: "Háº¿t hÃ ng" },
  { value: "expired", label: "Háº¿t háº¡n" },
  { value: "recalled", label: "Thu há»“i" },
] as const;

export default function LotTraceabilityPage() {
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });

  const { activeBranchId, branchLabel, branches, isReady } = useBranchFilter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [lots, setLots] = useState<LotRow[]>([]);
  const [expiringCount, setExpiringCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    setLoading(true);
    try {
      const lotData = await getAllProductLots({
        search: search || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        branchId: activeBranchId,
      });

      const now = Date.now();
      const rows: LotRow[] = lotData.map((lot) => {
        const expiryDate = lot.expiryDate ?? null;
        const daysToExpiry = expiryDate
          ? Math.floor(
              (new Date(expiryDate).getTime() - now) / (1000 * 60 * 60 * 24),
            )
          : null;

        return {
          id: lot.id,
          lotCode: lot.lotNumber,
          productCode: lot.productCode,
          productName: lot.productName,
          quantity: Number(lot.initialQty ?? 0),
          remainingQty: Number(lot.currentQty ?? 0),
          receivedDate: lot.receivedDate,
          expiryDate,
          daysToExpiry,
          sourceType: lot.sourceType,
          status: lot.status,
        };
      });

      setLots(rows);
      setExpiringCount(
        rows.filter(
          (lot) =>
            lot.status === "active" &&
            lot.daysToExpiry !== null &&
            lot.daysToExpiry >= 0 &&
            lot.daysToExpiry <= 30,
        ).length,
      );
    } catch (err) {
      console.error("Failed to fetch lot data:", err);
      setLots([]);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, isReady, search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalLots = lots.length;
  const activeLots = lots.filter((l) => l.status === "active").length;
  const totalQty = lots.reduce((s, l) => s + l.remainingQty, 0);

  const handleExport = useCallback((mode: "view" | "full") => {
    const titleRows = buildReportTitleRows({
      title: "BÃ¡o cÃ¡o lot traceability",
      range,
      branchName: activeBranchId
        ? branches.find((branch) => branch.id === activeBranchId)?.name
        : "ToÃ n cÃ´ng ty",
      generatedAt: new Date(),
    });
    exportReportToExcel({
      kind: "lot-traceability",
      mode,
      range,
      branchName: branchLabel,
      sheets: [
        {
          name: "Lot trace",
          titleRows,
          columns: [
            { label: "MÃ£ lÃ´", key: "lotCode", width: 14 },
            { label: "MÃ£ hÃ ng", key: "productCode", width: 12 },
            { label: "TÃªn hÃ ng", key: "productName", width: 30 },
            { label: "SL nháº­p", key: "quantity", width: 10, format: "number" },
            { label: "CÃ²n láº¡i", key: "remainingQty", width: 10, format: "number" },
            { label: "NgÃ y nháº­p", key: "receivedDate", width: 14 },
            { label: "HSD", key: "expiryDate", width: 14 },
            { label: "CÃ²n (ngÃ y)", key: "daysToExpiry", width: 10, format: "number" },
            { label: "Nguá»“n", key: "sourceType", width: 12 },
            { label: "Tráº¡ng thÃ¡i", key: "status", width: 12 },
          ],
          rows: lots.map((l) => ({
            lotCode: l.lotCode,
            productCode: l.productCode,
            productName: l.productName,
            quantity: l.quantity,
            remainingQty: l.remainingQty,
            receivedDate: formatShortDate(l.receivedDate),
            expiryDate: l.expiryDate ? formatShortDate(l.expiryDate) : "â€”",
            daysToExpiry: l.daysToExpiry ?? "",
            sourceType: SOURCE_LABEL[l.sourceType] ?? l.sourceType,
            status: STATUS_LABEL[l.status] ?? l.status,
          })),
          footerLabel: `SL lÃ´: ${lots.length}`,
        },
      ],
    });
  }, [activeBranchId, branchLabel, branches, lots, range]);

  const columns: DataTableColumn<LotRow>[] = [
    { label: "MÃ£ lÃ´", key: "lotCode", align: "left", width: "120px" },
    { label: "MÃ£ hÃ ng", key: "productCode", align: "left", width: "100px" },
    { label: "TÃªn hÃ ng", key: "productName", align: "left" },
    {
      label: "Sá»‘ lÆ°á»£ng nháº­p",
      key: "quantity",
      align: "right",
      cell: (r) => formatNumber(r.quantity),
    },
    {
      label: "Sá»‘ lÆ°á»£ng cÃ²n láº¡i",
      key: "remainingQty",
      align: "right",
      cell: (r) => formatNumber(r.remainingQty),
    },
    {
      label: "NgÃ y nháº­p",
      key: "receivedDate",
      align: "center",
      cell: (r) => formatShortDate(r.receivedDate),
    },
    {
      label: "Háº¡n sá»­ dá»¥ng",
      key: "expiryDate",
      align: "center",
      cell: (r) => (r.expiryDate ? formatShortDate(r.expiryDate) : "â€”"),
    },
    {
      label: "CÃ²n láº¡i Ä‘áº¿n háº¡n",
      key: "daysToExpiry",
      align: "right",
      cell: (r) => {
        if (r.daysToExpiry == null) return "â€”";
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
              ? `QuÃ¡ háº¡n ${Math.abs(r.daysToExpiry)} ngÃ y`
              : `CÃ²n ${r.daysToExpiry} ngÃ y`}
          </span>
        );
      },
    },
    {
      label: "Nguá»“n nháº­p",
      key: "sourceType",
      align: "center",
      cell: (r) => SOURCE_LABEL[r.sourceType] ?? r.sourceType,
    },
    {
      label: "Tráº¡ng thÃ¡i",
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
        title="Truy xuáº¥t nguá»“n gá»‘c theo lÃ´"
        subtitle="Cáº£nh bÃ¡o lÃ´ sáº¯p háº¿t háº¡n sá»­ dá»¥ng"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={() => handleExport("view")}
        onExportFull={() => handleExport("full")}
        exportDisabled={loading}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tá»•ng sá»‘ lÃ´"
            value={String(totalLots)}
            icon="inventory_2"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-foreground"
          />
          <KpiCard
            label="LÃ´ Ä‘ang cÃ²n hÃ ng"
            value={String(activeLots)}
            icon="check_circle"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Sáº¯p háº¿t háº¡n (trong 30 ngÃ y)"
            value={String(expiringCount)}
            change={expiringCount > 0 ? "Cáº§n xáº£ hÃ ng gáº¥p" : "An toÃ n"}
            positive={expiringCount === 0}
            icon="schedule"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-foreground"
          />
          <KpiCard
            label="Tá»•ng sá»‘ lÆ°á»£ng cÃ²n láº¡i"
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
              placeholder="TÃ¬m theo mÃ£ lÃ´ / mÃ£ hÃ ng..."
              className="pl-8 pr-3 h-8 text-xs rounded-full border border-border bg-surface-container-lowest outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => value && setStatusFilter(value)}
          >
            <SelectTrigger
              size="sm"
              className="min-w-40 bg-surface-container-lowest text-xs"
              aria-label="Tráº¡ng thÃ¡i lÃ´"
            >
              <SelectValue>
                {STATUS_FILTER_OPTIONS.find(
                  (option) => option.value === statusFilter,
                )?.label ?? "Táº¥t cáº£ tráº¡ng thÃ¡i"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Äang táº£i dá»¯ liá»‡u lot...
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow">
            <ReportDataTable<LotRow>
              columns={columns}
              rows={lots}
              getRowKey={(r) => r.id}
              subtotalLabel={`SL lÃ´: ${lots.length}`}
              emptyState="ChÆ°a cÃ³ lot nÃ o"
            />
          </div>
        )}
      </div>
    </div>
  );
}

