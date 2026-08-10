"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  PersonFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import { Button } from "@/components/ui/button";
import { computeListPresetRange, STANDARD_LIST_PRESETS_WITH_ALL } from "@/lib/utils/list-date-preset-range";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getInventoryChecks, getInventoryCheckStatuses, applyInventoryCheck, cancelInventoryCheck, getInventoryCheckItems } from "@/lib/services";
import type { InventoryCheckItemRow } from "@/lib/services";
import type { InventoryCheck } from "@/lib/types";
import { CreateInventoryCheckDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import { buildInventoryCheckPrintData } from "@/lib/print-templates";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const statusMap: Record<
  InventoryCheck["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  processing: { label: "Phiếu tạm", variant: "secondary" },
  balanced: { label: "Đã cân bằng kho", variant: "default" },
  unbalanced: { label: "Đã hủy", variant: "destructive" },
};

/* ------------------------------------------------------------------ */
/*  Starred set                                                        */
/* ------------------------------------------------------------------ */
function useStarredSet() {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { starred, toggle };
}

/* ------------------------------------------------------------------ */
/*  Inline detail                                                      */
/* ------------------------------------------------------------------ */
function VarianceTab({ checkId }: { checkId: string }) {
  const [rows, setRows] = useState<InventoryCheckItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInventoryCheckItems(checkId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Không tải được chi tiết");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [checkId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
        <Icon name="progress_activity" size={16} className="animate-spin" />
        Đang tải chi tiết kiểm kê...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-status-error gap-2">
        <Icon name="error" size={16} />
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Phiếu kiểm chưa có sản phẩm nào
      </div>
    );
  }

  const changed = rows.filter((r) => r.difference !== 0);
  const matched = rows.filter((r) => r.difference === 0);
  const totalIncrease = changed
    .filter((r) => r.difference > 0)
    .reduce((sum, r) => sum + r.valueImpact, 0);
  const totalDecrease = changed
    .filter((r) => r.difference < 0)
    .reduce((sum, r) => sum + r.valueImpact, 0);
  const netImpact = totalIncrease + totalDecrease;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl bg-surface-container p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tổng SP kiểm
          </div>
          <div className="text-lg font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-xl bg-surface-container p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Khớp kho
          </div>
          <div className="text-lg font-semibold">{matched.length}</div>
        </div>
        <div className="rounded-xl bg-status-success/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-status-success">
            Lệch tăng
          </div>
          <div className="text-lg font-semibold text-status-success">
            {formatCurrency(totalIncrease)}
          </div>
        </div>
        <div className="rounded-xl bg-status-error/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-status-error">
            Lệch giảm
          </div>
          <div className="text-lg font-semibold text-status-error">
            {formatCurrency(totalDecrease)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold">
          Chênh lệch ròng:
        </span>
        <span
          className={`text-sm font-bold font-mono ${
            netImpact >= 0 ? "text-status-success" : "text-status-error"
          }`}
        >
          {netImpact >= 0 ? "+" : ""}
          {formatCurrency(netImpact)}
        </span>
      </div>

      {/* Variance table */}
      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-container-low border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wider text-[10px]">
                Sản phẩm
              </th>
              <th className="text-right px-3 py-2 font-medium uppercase tracking-wider text-[10px] w-20">
                Hệ thống
              </th>
              <th className="text-right px-3 py-2 font-medium uppercase tracking-wider text-[10px] w-20">
                Thực tế
              </th>
              <th className="text-right px-3 py-2 font-medium uppercase tracking-wider text-[10px] w-20">
                Lệch
              </th>
              <th className="text-right px-3 py-2 font-medium uppercase tracking-wider text-[10px] w-28">
                Ảnh hưởng
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isZero = r.difference === 0;
              const sign = r.difference > 0 ? "+" : "";
              const diffColor =
                r.difference > 0
                  ? "text-status-success"
                  : r.difference < 0
                  ? "text-status-error"
                  : "text-muted-foreground";
              return (
                <tr
                  key={r.id}
                  className={`border-b last:border-0 ${
                    isZero ? "opacity-60" : ""
                  } hover:bg-surface-container-low/60`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.productName}</div>
                    {r.productCode && (
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {r.productCode}
                      </div>
                    )}
                  </td>
                  <td className="text-right px-3 py-2 font-mono text-muted-foreground">
                    {formatNumber(r.systemStock)}
                    {r.unit ? ` ${r.unit}` : ""}
                  </td>
                  <td className="text-right px-3 py-2 font-mono font-medium">
                    {formatNumber(r.actualStock)}
                    {r.unit ? ` ${r.unit}` : ""}
                  </td>
                  <td className={`text-right px-3 py-2 font-mono font-bold ${diffColor}`}>
                    {sign}
                    {formatNumber(r.difference)}
                  </td>
                  <td
                    className={`text-right px-3 py-2 font-mono ${
                      r.valueImpact > 0
                        ? "text-status-success"
                        : r.valueImpact < 0
                        ? "text-status-error"
                        : "text-muted-foreground"
                    }`}
                  >
                    {r.valueImpact === 0
                      ? "—"
                      : `${r.valueImpact > 0 ? "+" : ""}${formatCurrency(
                          r.valueImpact
                        )}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryCheckDetail({
  item,
  onClose,
  onDelete,
}: {
  item: InventoryCheck;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const status = statusMap[item.status];

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Phiếu kiểm kho ${item.code}`}
            code={item.code}
            status={{
              label: status.label,
              variant: status.variant,
              className:
                status.variant === "default"
                  ? "bg-primary-fixed text-primary border-primary-fixed"
                  : undefined,
            }}
            subtitle="Chi nhánh trung tâm"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{formatUser(item.createdByName, item.createdBy)}</strong>
                </span>
                <span>
                  Thời gian: <strong>{formatDate(item.date)}</strong>
                </span>
              </div>
            }
          />

          <DetailInfoGrid
            fields={[
              { label: "Mã kiểm kho", value: item.code },
              { label: "Thời gian", value: formatDate(item.date) },
              { label: "Trạng thái", value: status.label },
              { label: "Người tạo", value: formatUser(item.createdByName, item.createdBy) },
              {
                label: "Tổng sản phẩm",
                value: String(item.totalProducts),
              },
              {
                label: "SL lệch tăng",
                value: (
                  <span className="text-status-success">
                    {formatNumber(item.increaseQty)}
                  </span>
                ),
              },
              {
                label: "SL lệch giảm",
                value: (
                  <span className="text-status-error">{formatNumber(item.decreaseQty)}</span>
                ),
              },
              {
                label: "GT tăng",
                value: (
                  <span className="text-status-success">
                    {formatCurrency(item.increaseAmount)}
                  </span>
                ),
              },
              {
                label: "GT giảm",
                value: (
                  <span className="text-status-error">
                    {formatCurrency(item.decreaseAmount)}
                  </span>
                ),
              },
              {
                label: "Tổng chênh lệch",
                value: formatCurrency(
                  item.increaseAmount - item.decreaseAmount
                ),
              },
              ...(item.note
                ? [{ label: "Ghi chú", value: item.note, fullWidth: true }]
                : []),
            ]}
          />
        </div>
      ),
    },
    {
      id: "variance",
      label: "Chi tiết kiểm kê",
      content: <VarianceTab checkId={item.id} />,
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="inventory_check" entityId={item.id} />,
    },
  ];

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={onDelete}
      deleteLabel="Hủy"
    >
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function KiemKhoPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("inventory_check");
  const [data, setData] = useState<InventoryCheck[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Nút "Mở trang chứng từ" (thẻ kho) truyền ?tim=<mã> → đổ vào ô tìm.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tim");
    if (q) setSearch(q);
  }, []);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [cancellingItem, setCancellingItem] = useState<InventoryCheck | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<InventoryCheck | null>(null);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "draft",
    "in_progress",
    "balanced",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const duocXemToanChuoi = hasAny(["reports.view_all_branches", "system.manage_branches"]);
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);
  useEffect(() => { if (!duocXemToanChuoi) setViewAllBranches(false); }, [duocXemToanChuoi]);

  const statuses = getInventoryCheckStatuses();

  /* ---- Columns ---- */
  const columns: ColumnDef<InventoryCheck, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 36,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <StarCell
          starred={starred.has(row.original.id)}
          onToggle={() => toggleStar(row.original.id)}
        />
      ),
    },
    {
      accessorKey: "code",
      header: "Mã kiểm kho",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      id: "balanceDate",
      header: "Ngày cân bằng",
      size: 150,
      cell: ({ row }) =>
        row.original.status === "balanced"
          ? formatDate(row.original.updatedAt ?? row.original.date)
          : "—",
    },
    {
      accessorKey: "totalProducts",
      header: "SL thực tế",
      size: 100,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.totalProducts}</span>
      ),
    },
    {
      id: "totalActual",
      header: "Tổng thực tế",
      size: 130,
      cell: ({ row }) =>
        formatCurrency(row.original.increaseAmount + row.original.decreaseAmount),
    },
    {
      id: "totalDiff",
      header: "Tổng chênh lệch",
      size: 130,
      cell: ({ row }) => {
        const diff = row.original.increaseAmount - row.original.decreaseAmount;
        return (
          <span className={diff >= 0 ? "text-status-success" : "text-status-error"}>
            {formatCurrency(diff)}
          </span>
        );
      },
    },
    {
      accessorKey: "increaseQty",
      header: "SL lệch tăng",
      size: 100,
      cell: ({ row }) => (
        <span className="text-status-success">{formatNumber(row.original.increaseQty)}</span>
      ),
    },
    {
      accessorKey: "decreaseQty",
      header: "SL lệch giảm",
      size: 100,
      cell: ({ row }) => (
        <span className="text-status-error">{formatNumber(row.original.decreaseQty)}</span>
      ),
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
    if (permissionsLoading) return;
    if (!activeBranchId && !duocXemToanChuoi) { setData([]); setTotal(0); setOtherBranchCount(0); setLoading(false); return; }
    setLoading(true);
    // Không có try/finally thì truy vấn lỗi là cờ loading không bao giờ tắt →
    // trang treo mãi ở vòng xoay, người dùng không biết vì sao.
    try {
    const presetRange = computeListPresetRange(datePreset);
    const effectiveDateFrom = datePreset === "custom" ? dateFrom : presetRange.from;
    const effectiveDateTo = datePreset === "custom" ? dateTo : presetRange.to;
    const commonFilters = {
      ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      ...(effectiveDateFrom && { dateFrom: effectiveDateFrom }),
      ...(effectiveDateTo && { dateTo: effectiveDateTo }),
      ...(creatorFilter && { createdBy: creatorFilter }),
    };
    const branchScope = duocXemToanChuoi && viewAllBranches ? undefined : activeBranchId;
    const result = await getInventoryChecks({
      page,
      pageSize,
      search,
      branchId: branchScope,
      filters: commonFilters,
    });
    setData(result.data);
    setTotal(result.total);
    // Bảng trống vì lọc chi nhánh? Đếm phiếu ở chi nhánh khác để gợi ý (cùng bộ
    // lọc, bỏ branch). Chỉ khi đang lọc theo 1 chi nhánh cụ thể.
    if (duocXemToanChuoi && result.data.length === 0 && !viewAllBranches && activeBranchId) {
      const all = await getInventoryChecks({
        page: 0,
        pageSize: 1,
        search,
        branchId: undefined,
        filters: commonFilters,
      });
      setOtherBranchCount(all.total);
    } else {
      setOtherBranchCount(0);
    }
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách phiếu kiểm kho",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, selectedStatuses, datePreset, dateFrom, dateTo, creatorFilter, activeBranchId, viewAllBranches, toast, duocXemToanChuoi, permissionsLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, datePreset, dateFrom, dateTo, creatorFilter]);

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã kiểm kho", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Trạng thái", key: "status", width: 15, format: (v: InventoryCheck["status"]) => statusMap[v]?.label ?? v },
      { header: "Tổng SP", key: "totalProducts", width: 10 },
      { header: "SL lệch tăng", key: "increaseQty", width: 12 },
      { header: "SL lệch giảm", key: "decreaseQty", width: 12 },
      { header: "GT tăng", key: "increaseAmount", width: 15, format: (v: number) => v },
      { header: "GT giảm", key: "decreaseAmount", width: 15, format: (v: number) => v },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "phieu-kiem-kho");
    else exportToCsv(data, exportColumns, "phieu-kiem-kho");
  };

  /* ---- Apply inventory check (G7) ---- */
  const handleApply = async (row: InventoryCheck) => {
    if (applyingId) return; // prevent double-click while one is in-flight
    setApplyingId(row.id);
    try {
      await applyInventoryCheck(row.id);
      toast({
        title: "Áp dụng kiểm kê thành công",
        description: `Đã cân bằng kho theo phiếu ${row.code}`,
        variant: "success",
      });
      await fetchData();
    } catch (err) {
      toast({
        title: "Lỗi áp dụng kiểm kê",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setApplyingId(null);
    }
  };

  /* ---- KPI row (derived từ current page data) ---- */
  // Chỉ tính trên `data` đã fetch (đã được filter theo branch + status + search).
  // Không query thêm để tránh roundtrip — KPI là view-over-current-result.
  const kpi = {
    total,
    processing: data.filter((d) => d.status === "processing").length,
    balanced: data.filter((d) => d.status === "balanced").length,
    netVariance: data.reduce(
      (sum, d) => sum + (d.increaseAmount - d.decreaseAmount),
      0,
    ),
  };

  const datePresetLabel = useMemo(() => {
    if (datePreset === "all") return "Tất cả thời gian";
    if (datePreset === "custom") return !dateFrom && !dateTo ? "Tùy chỉnh" : `${dateFrom || "..."} đến ${dateTo || "..."}`;
    return STANDARD_LIST_PRESETS_WITH_ALL.find((item) => item.value === datePreset)?.label ?? "Thời gian";
  }, [dateFrom, datePreset, dateTo]);
  const clearListFilters = useCallback(() => { setSelectedStatuses([]); setDatePreset("all"); setDateFrom(""); setDateTo(""); setCreatorFilter(""); }, []);
  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (datePreset !== "all") chips.push({ key: "date", label: "Ngày tạo", value: datePresetLabel, onClear: () => { setDatePreset("all"); setDateFrom(""); setDateTo(""); } });
    if (selectedStatuses.length) chips.push({ key: "status", label: "Trạng thái", value: selectedStatuses.map((value) => statusMap[value as InventoryCheck["status"]]?.label ?? value).join(", "), onClear: () => setSelectedStatuses([]) });
    if (creatorFilter) chips.push({ key: "creator", label: "Người tạo", value: creatorFilter, onClear: () => setCreatorFilter("") });
    return chips;
  }, [creatorFilter, datePreset, datePresetLabel, selectedStatuses]);

  /* ---- Inline detail renderer ---- */
  const renderDetail = (item: InventoryCheck, onClose: () => void) => (
    <InventoryCheckDetail
      item={item}
      onClose={onClose}
      onDelete={
        item.status === "processing" ? () => setCancellingItem(item) : undefined
      }
    />
  );

  /* ---- Render ---- */
  return (
    <>
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Phiếu kiểm kho"
        density="compact"
        searchPlaceholder="Theo mã phiếu kiểm kho"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Kiểm kho",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
        ]}
      />

      {viewAllBranches && (
        <AllBranchesBanner
          branchName={currentBranch?.name}
          onBackToBranch={() => setViewAllBranches(false)}
        />
      )}

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        total={total}
        density="compact"
        columnToggle
        toolbarMetrics={<><ListMetric icon={<Icon name="inventory_2" size={15} />} label="Kết quả" value={kpi.total.toString()} hint="Tổng số phiếu theo bộ lọc" /><ListMetric icon={<Icon name="pending_actions" size={15} />} label="Phiếu tạm trang này" value={kpi.processing.toString()} hint="Chỉ tính các dòng đang hiển thị" tone={kpi.processing > 0 ? "danger" : "default"} /><ListMetric icon={<Icon name="check_circle" size={15} />} label="Cân bằng trang này" value={kpi.balanced.toString()} hint="Chỉ tính các dòng đang hiển thị" /><ListMetric icon={<Icon name={kpi.netVariance >= 0 ? "trending_up" : "trending_down"} size={15} />} label="Chênh lệch trang này" value={formatCurrency(kpi.netVariance)} hint="Chỉ tính các dòng đang hiển thị" tone={kpi.netVariance < 0 ? "danger" : "default"} /></>}
        toolbarActions={<><Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="calendar_today" size={15} /><span className="hidden sm:inline">{datePresetLabel}</span></Button><Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button></>}
        toolbarFooter={<FilterChips filters={filterChips} onClearAll={filterChips.length > 1 ? clearListFilters : undefined} />}
        emptyBranchHint={duocXemToanChuoi ? {
          otherBranchCount,
          onViewAllBranches: () => setViewAllBranches(true),
          entityLabel: "phiếu kiểm kho",
        } : undefined}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(total / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        selectable
        bulkActions={[
          {
            label: "Xuất Excel",
            icon: <Icon name="download" size={16} />,
            onClick: (selectedRows) => {
              const cols = [
                { header: "Mã kiểm kho", key: "code", width: 15 },
                {
                  header: "Thời gian",
                  key: "date",
                  width: 18,
                  format: (v: string) => formatDate(v),
                },
                {
                  header: "Trạng thái",
                  key: "status",
                  width: 15,
                  format: (v: InventoryCheck["status"]) =>
                    statusMap[v]?.label ?? v,
                },
                { header: "Tổng SP", key: "totalProducts", width: 10 },
                { header: "SL lệch tăng", key: "increaseQty", width: 12 },
                { header: "SL lệch giảm", key: "decreaseQty", width: 12 },
                {
                  header: "GT tăng",
                  key: "increaseAmount",
                  width: 15,
                  format: (v: number) => v,
                },
                {
                  header: "GT giảm",
                  key: "decreaseAmount",
                  width: 15,
                  format: (v: number) => v,
                },
              ];
              exportToExcel(selectedRows, cols, "phieu-kiem-kho-da-chon");
              toast({
                title: "Đã xuất Excel",
                description: `${selectedRows.length} phiếu kiểm kho`,
                variant: "success",
              });
            },
          },
          {
            label: "In hàng loạt",
            icon: <Icon name="print" size={16} />,
            onClick: (selectedRows) => {
              selectedRows.forEach((row) =>
                printWithPicker(
                  buildInventoryCheckPrintData(row),
                  "In phiếu kiểm kho",
                  { channel: "backoffice", docType: "inventory_check", branchId: activeBranchId },
                ),
              );
            },
          },
          {
            // CEO 04/07: áp dụng (cân bằng kho) nhiều phiếu kiểm 1 lần — mượn
            // luồng hủy-hàng-loạt. Chỉ đụng phiếu còn nháp (processing); mỗi
            // phiếu đi qua RPC atomic applyInventoryCheck như nút áp từng dòng.
            label: "Áp dụng hàng loạt",
            icon: <Icon name="check_circle" size={16} />,
            onClick: async (selectedRows) => {
              const applicable = selectedRows.filter(
                (r) => r.status === "processing",
              );
              if (applicable.length === 0) {
                toast({
                  title: "Không có phiếu nào để áp dụng",
                  description:
                    "Chỉ áp dụng được phiếu ở trạng thái Phiếu tạm (chưa cân bằng).",
                  variant: "info",
                });
                return;
              }
              if (
                !window.confirm(
                  `Áp dụng (cân bằng kho) ${applicable.length} phiếu kiểm kho? Tồn kho sẽ được điều chỉnh theo số đã đếm.`,
                )
              )
                return;
              const results = await Promise.allSettled(
                applicable.map((r) => applyInventoryCheck(r.id)),
              );
              const ok = results.filter((x) => x.status === "fulfilled").length;
              const fail = results.length - ok;
              toast({
                title:
                  fail === 0
                    ? `Đã cân bằng ${ok} phiếu`
                    : `Cân bằng ${ok}/${results.length} phiếu`,
                description:
                  fail > 0
                    ? `${fail} phiếu lỗi — mở từng phiếu để xem chi tiết.`
                    : undefined,
                variant: fail === 0 ? "success" : "error",
              });
              await fetchData();
            },
          },
          {
            label: "Hủy hàng loạt",
            icon: <Icon name="cancel" size={16} />,
            variant: "destructive",
            onClick: async (selectedRows) => {
              const cancellable = selectedRows.filter(
                (r) => r.status === "processing",
              );
              if (cancellable.length === 0) {
                toast({
                  title: "Không có phiếu nào có thể hủy",
                  description: "Chỉ hủy được phiếu ở trạng thái Phiếu tạm",
                  variant: "info",
                });
                return;
              }
              if (
                !window.confirm(
                  `Hủy ${cancellable.length} phiếu kiểm kho? Thao tác này không thể hoàn tác.`,
                )
              )
                return;
              try {
                await Promise.all(
                  cancellable.map((r) => cancelInventoryCheck(r.id)),
                );
                toast({
                  title: `Đã hủy ${cancellable.length} phiếu`,
                  variant: "success",
                });
                await fetchData();
              } catch (err) {
                toast({
                  title: "Lỗi hủy hàng loạt",
                  description:
                    err instanceof Error ? err.message : "Vui lòng thử lại",
                  variant: "error",
                });
              }
            },
          },
        ]}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={renderDetail}
        getRowId={(row) => row.id}
        rowActions={(row) => {
          // Sprint UX-1 Stage 4: standardized transaction row actions
          const workflowActions: Array<{ label: string; icon?: React.ReactNode; onClick: () => void }> = [];
          if (row.status === "processing") {
            workflowActions.push({
              label: applyingId === row.id ? "Đang áp dụng..." : "Áp dụng kiểm kê",
              icon: <Icon name="check_circle" size={16} />,
              onClick: () => handleApply(row),
            });
          }

          return buildTransactionRowActions({
            row,
            kind: "inventory_check",
            permissions: txPerms,
            onPrint: () =>
              printWithPicker(buildInventoryCheckPrintData(row), "In phiếu kiểm kho", {
                channel: "backoffice",
                docType: "inventory_check",
                branchId: activeBranchId,
              }),
            workflowActions,
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
            // Hủy — chỉ status='processing'
            onCancel:
              row.status === "processing"
                ? () => setCancellingItem(row)
                : undefined,
          });
        }}
      />

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={clearListFilters} title="Bộ lọc kiểm kho">
        <FilterGroup label="Ngày tạo" activeHint={datePresetLabel}><DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS_WITH_ALL} /></FilterGroup>
        <FilterGroup label="Trạng thái" activeHint={selectedStatuses.length ? `${selectedStatuses.length} lựa chọn` : undefined}><CheckboxFilter options={statuses} selected={selectedStatuses} onChange={setSelectedStatuses} /></FilterGroup>
        <FilterGroup label="Người tạo" activeHint={creatorFilter || undefined}><PersonFilter value={creatorFilter} onChange={setCreatorFilter} placeholder="Chọn người tạo" suggestions={[{ label: "Admin", value: "admin" }, { label: "Cao Thị Huyền Trang", value: "trang" }]} /></FilterGroup>
      </FilterPanel>
    </ListPageLayout>

    <CreateInventoryCheckDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />

    <ConfirmDialog
      open={!!cancellingItem}
      onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
      title="Hủy phiếu kiểm kho"
      description={`Bạn có chắc muốn hủy phiếu kiểm kho ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
      confirmLabel="Hủy phiếu"
      cancelLabel="Đóng"
      variant="destructive"
      loading={cancelLoading}
      onConfirm={async () => {
        if (!cancellingItem) return;
        setCancelLoading(true);
        try {
          await cancelInventoryCheck(cancellingItem.id);
          toast({
            title: "Đã hủy phiếu kiểm kho",
            description: `Phiếu ${cancellingItem.code} đã được hủy thành công`,
            variant: "success",
          });
          await fetchData();
        } catch (err) {
          toast({
            title: "Lỗi hủy phiếu kiểm kho",
            description: err instanceof Error ? err.message : "Vui lòng thử lại",
            variant: "error",
          });
        } finally {
          setCancelLoading(false);
          setCancellingItem(null);
        }
      }}
    />

    {printerDialog}

    {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
    {auditDialogTarget && (
      <AuditLogDialog
        entityType="inventory_check"
        entityId={auditDialogTarget.id}
        entityCode={auditDialogTarget.code}
        onClose={() => setAuditDialogTarget(null)}
      />
    )}
    </>
  );
}
