"use client";

/**
 * Chuyển kho — Inter-branch Stock Transfer page — Sprint 7
 *
 * Features:
 *   - View existing transfers (stock_transfers table)
 *   - Create new transfer (dialog with product picker)
 *   - Complete / Cancel transfer actions
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  PersonFilter,
  RangeFilter,
  SelectFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL,
} from "@/lib/utils/list-date-preset-range";
import { useDebounce } from "@/lib/utils/use-debounce";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { usePermissions, useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { formatDate, formatNumber } from "@/lib/format";
import {
  getBranches,
  getBranchStockRows,
  getProfilesForPersonFilter,
} from "@/lib/services";
import {
  getStockTransfersForExport,
  getStockTransferListWorkspace,
  getStockTransferById,
  createStockTransfer,
  completeStockTransfer,
  cancelStockTransfer,
  updateTransferStatus,
  getTransferStatusMeta,
} from "@/lib/services/supabase/transfers";
import {
  phamViChuyenKho,
  getStockTransfersTheoPhamVi,
} from "@/lib/services/supabase/stock-transfer-list-scope";
import type {
  StockTransfer,
  StockTransferStatus,
  StockTransferItem,
} from "@/lib/services/supabase/transfers";
import { formatUser } from "@/lib/format";
import type { BranchDetail } from "@/lib/services/supabase/branches";
import { Icon } from "@/components/ui/icon";
import { exportToExcelFromSchema } from "@/lib/excel";
import { stockTransferExcelSchema } from "@/lib/excel/schemas";

const STATUS_META = getTransferStatusMeta();
const SEARCH_FIELDS = [
  { value: "code", label: "Mã phiếu" },
  { value: "from_branch_code", label: "Mã kho xuất" },
  { value: "from_branch_name", label: "Tên kho xuất" },
  { value: "to_branch_code", label: "Mã kho nhận" },
  { value: "to_branch_name", label: "Tên kho nhận" },
  { value: "product_code", label: "Mã sản phẩm" },
  { value: "product_name", label: "Tên sản phẩm" },
  { value: "creator_name", label: "Người tạo" },
  { value: "note", label: "Ghi chú" },
];
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export default function ChuyenKhoPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch, isReady: branchReady } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const txPerms = useTxRowPermissions("stock_transfer");
  const [data, setData] = useState<StockTransfer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [searchField, setSearchField] = useState("code");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fromBranchId, setFromBranchId] = useState("all");
  const [toBranchId, setToBranchId] = useState("all");
  const [createdBy, setCreatedBy] = useState("");
  const [itemCountMin, setItemCountMin] = useState("");
  const [itemCountMax, setItemCountMax] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const [summary, setSummary] = useState({ inTransitCount: 0, completedCount: 0, cancelledCount: 0, totalItems: 0 });
  const [branchOptions, setBranchOptions] = useState<
    { label: string; value: string }[]
  >([{ label: "Tất cả", value: "all" }]);
  const [creatorOptions, setCreatorOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const requestSequence = useRef(0);

  const duocXemToanChuoi = hasAny([
    "reports.view_all_branches",
    "system.manage_branches",
  ]);

  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  useEffect(() => {
    if (!duocXemToanChuoi) setViewAllBranches(false);
  }, [duocXemToanChuoi]);

  // Branches for dialog
  const [branches, setBranches] = useState<BranchDetail[]>([]);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Confirm dialog state cho action huỷ / hoàn thành / bắt đầu chuyển
  // Mỗi action đều thao tác tồn kho thật (OUT / IN) — cần xác nhận trước khi fire.
  type ConfirmAction = "start" | "complete" | "cancel";
  const [pendingAction, setPendingAction] = useState<{
    type: ConfirmAction;
    transfer: StockTransfer;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<StockTransfer | null>(null);

  useEffect(() => {
    if (!branchReady) return;
    Promise.all([getBranches(), getProfilesForPersonFilter()])
      .then(([branchRows, profiles]) => {
        setBranches(branchRows);
        setBranchOptions([
          { label: "Tất cả", value: "all" },
          ...branchRows.map((branch) => ({
            label: branch.code ? `${branch.code} · ${branch.name}` : branch.name,
            value: branch.id,
          })),
        ]);
        setCreatorOptions(profiles);
      })
      .catch(() => {
        setBranches([]);
        setBranchOptions([{ label: "Tất cả", value: "all" }]);
        setCreatorOptions([]);
      });
  }, [branchReady]);

  const dateRange = useMemo(
    () =>
      datePreset === "custom"
        ? { from: dateFrom || undefined, to: dateTo || undefined }
        : computeListPresetRange(datePreset),
    [dateFrom, datePreset, dateTo],
  );

  const commonFilters = useMemo<Record<string, string | string[]>>(
    () => ({
      ...(statusFilter.length > 0 && { status: statusFilter }),
      ...(dateRange.from && { dateFrom: dateRange.from }),
      ...(dateRange.to && { dateTo: dateRange.to }),
      ...(fromBranchId !== "all" && { fromBranchId }),
      ...(toBranchId !== "all" && { toBranchId }),
      ...(createdBy && { createdBy }),
      ...(itemCountMin && { itemCountMin }),
      ...(itemCountMax && { itemCountMax }),
    }),
    [
      createdBy,
      dateRange.from,
      dateRange.to,
      fromBranchId,
      itemCountMax,
      itemCountMin,
      statusFilter,
      toBranchId,
    ],
  );

  const phamVi = useMemo(
    () =>
      phamViChuyenKho({
        activeBranchId,
        viewAllBranches,
        duocXemToanChuoi,
      }),
    [activeBranchId, duocXemToanChuoi, viewAllBranches],
  );

  const fetchData = useCallback(async () => {
    if (!branchReady || permissionsLoading) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const result = phamVi.mode === "none" ? { data: [], total: 0, summary: { inTransitCount: 0, completedCount: 0, cancelledCount: 0, totalItems: 0 } } : await getStockTransferListWorkspace({
        page, pageSize, search: debouncedSearch || undefined, searchField,
        statuses: statusFilter, dateFrom: dateRange.from, dateTo: dateRange.to,
        fromBranchId: fromBranchId !== "all" ? fromBranchId : undefined,
        toBranchId: toBranchId !== "all" ? toBranchId : undefined, createdBy: createdBy || undefined,
        itemCountMin: itemCountMin ? Number(itemCountMin) : undefined, itemCountMax: itemCountMax ? Number(itemCountMax) : undefined,
        branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
      });
      if (requestId !== requestSequence.current) return;
      setData(result.data);
      setTotal(result.total);
      setSummary(result.summary);

      const count = result.data.length === 0 && phamVi.mode === "branch" && duocXemToanChuoi
        ? Math.max(0, (await getStockTransferListWorkspace({
            page: 0,
            pageSize: 1,
            search: debouncedSearch || undefined,
            searchField,
            statuses: statusFilter,
            dateFrom: dateRange.from,
            dateTo: dateRange.to,
            fromBranchId: fromBranchId !== "all" ? fromBranchId : undefined,
            toBranchId: toBranchId !== "all" ? toBranchId : undefined,
            createdBy: createdBy || undefined,
            itemCountMin: itemCountMin ? Number(itemCountMin) : undefined,
            itemCountMax: itemCountMax ? Number(itemCountMax) : undefined,
          })).total - result.total)
        : 0;
      if (requestId === requestSequence.current) setOtherBranchCount(count);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      toast({
        variant: "error",
        title: "Lỗi tải dữ liệu chuyển kho",
        description: error instanceof Error ? error.message : "Vui lòng thử lại",
      });
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [
    branchReady,
    commonFilters,
    debouncedSearch,
    page,
    pageSize,
    permissionsLoading,
    phamVi,
    searchField,
    toast,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [
    createdBy,
    dateFrom,
    datePreset,
    dateTo,
    debouncedSearch,
    fromBranchId,
    itemCountMax,
    itemCountMin,
    searchField,
    statusFilter,
    toBranchId,
  ]);

  // Mở ConfirmDialog cho action tương ứng — không fire action thật ở đây.
  const requestStartTransit = (t: StockTransfer) =>
    setPendingAction({ type: "start", transfer: t });
  const requestComplete = (t: StockTransfer) =>
    setPendingAction({ type: "complete", transfer: t });
  const requestCancel = (t: StockTransfer) =>
    setPendingAction({ type: "cancel", transfer: t });

  // Thực thi sau khi user xác nhận trong ConfirmDialog.
  const executePendingAction = async () => {
    if (!pendingAction) return;
    const { type, transfer } = pendingAction;
    setActionBusy(true);
    try {
      if (type === "start") {
        await updateTransferStatus(transfer.id, "in_transit");
        toast({
          title: "Đã bắt đầu vận chuyển",
          description: "Hàng đang trên đường tới kho nhận",
          variant: "success",
        });
      } else if (type === "complete") {
        await completeStockTransfer(transfer.id);
        toast({ title: "Đã hoàn thành chuyển kho", variant: "success" });
      } else {
        await cancelStockTransfer(transfer.id);
        toast({ title: "Đã huỷ phiếu chuyển kho", variant: "success" });
      }
      setPendingAction(null);
      fetchData();
    } catch (err) {
      const titleByType: Record<ConfirmAction, string> = {
        start: "Lỗi cập nhật trạng thái",
        complete: "Lỗi hoàn thành",
        cancel: "Lỗi huỷ phiếu",
      };
      toast({
        title: titleByType[type],
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setActionBusy(false);
    }
  };

  const pendingDialogConfig = (() => {
    if (!pendingAction) return null;
    const { type, transfer } = pendingAction;
    const route = `${transfer.fromBranchName} → ${transfer.toBranchName}`;
    if (type === "start") {
      return {
        title: "Bắt đầu vận chuyển?",
        description: `Phiếu ${transfer.code} (${route}): hàng sẽ rời kho xuất và ghi nhận trạng thái “đang chuyển”. Bạn có chắc chắn?`,
        confirmLabel: "Bắt đầu vận chuyển",
        variant: "default" as const,
      };
    }
    if (type === "complete") {
      return {
        title: "Xác nhận đã nhận hàng?",
        description: `Phiếu ${transfer.code} (${route}): hệ thống sẽ trừ tồn kho xuất và cộng tồn kho nhận. Thao tác không thể hoàn tác — chỉ xác nhận khi đã nhận đủ hàng.`,
        confirmLabel: "Hoàn thành nhập kho",
        variant: "default" as const,
      };
    }
    return {
      title: "Huỷ phiếu chuyển kho?",
      description:
        transfer.status === "in_transit"
          ? `Phiếu ${transfer.code}: HÀNG ĐÃ RỜI KHO XUẤT. Huỷ phiếu sẽ không tự động trả hàng về — cần xử lý thủ công. Bạn có chắc chắn?`
          : `Phiếu ${transfer.code} (${route}) sẽ bị huỷ. Thao tác không thể hoàn tác.`,
      confirmLabel: "Huỷ phiếu",
      variant: "destructive" as const,
    };
  })();

  const columns: ColumnDef<StockTransfer, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary font-medium">
          {row.original.code}
        </span>
      ),
    },
    {
      id: "route",
      header: "Từ → Đến",
      size: 280,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-sm min-w-0">
          <div className="min-w-0 max-w-[120px]" title={row.original.fromBranchName}>
            <div className="font-medium truncate">{row.original.fromBranchName}</div>
            <div className="text-xs text-muted-foreground font-mono truncate">
              {row.original.fromBranchCode || "—"}
            </div>
          </div>
          <Icon name="arrow_forward" size={14} className="text-muted-foreground shrink-0" />
          <div className="min-w-0 max-w-[120px]" title={row.original.toBranchName}>
            <div className="font-medium truncate">{row.original.toBranchName}</div>
            <div className="text-xs text-muted-foreground font-mono truncate">
              {row.original.toBranchCode || "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "totalItems",
      header: "Sản phẩm",
      size: 90,
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono">
          {row.original.totalItems}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 120,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return (
          <Badge
            variant="secondary"
            style={{ backgroundColor: meta.color + "20", color: meta.color }}
          >
            {meta.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 140,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "createdByName",
      header: "Người tạo",
      size: 150,
      cell: ({ row }) => (
        <span className="text-xs">
          {formatUser(row.original.createdByName, row.original.createdBy)}
        </span>
      ),
    },
    {
      accessorKey: "note",
      header: "Ghi chú",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground truncate max-w-[180px] block">
          {row.original.note || "—"}
        </span>
      ),
    },
    // Sprint UX-1 Stage 4: removed inline action column — moved to standardized
    // rowActions menu (DataTable rowActions prop below).
  ];

  const pageCount = Math.ceil(total / pageSize);
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  const pageInTransit = data.filter((item) => item.status === "in_transit").length;
  const pageCompleted = data.filter((item) => item.status === "completed").length;
  const pageProductCount = data.reduce((sum, item) => sum + item.totalItems, 0);
  const pageStuckTransit = data.filter(
      (t) =>
        t.status === "in_transit" &&
        now - new Date(t.createdAt).getTime() > sevenDaysMs,
    ).length;

  const datePresetLabel = useMemo(() => {
    if (datePreset === "all") return "Tất cả thời gian";
    if (datePreset === "custom") {
      if (!dateFrom && !dateTo) return "Tùy chỉnh";
      return `${dateFrom || "..."} đến ${dateTo || "..."}`;
    }
    return (
      STANDARD_LIST_PRESETS_WITH_ALL.find((item) => item.value === datePreset)
        ?.label ?? "Thời gian"
    );
  }, [dateFrom, datePreset, dateTo]);

  const clearListFilters = useCallback(() => {
    setStatusFilter([]);
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setFromBranchId("all");
    setToBranchId("all");
    setCreatedBy("");
    setItemCountMin("");
    setItemCountMax("");
  }, []);

  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (datePreset !== "all") {
      chips.push({
        key: "date",
        label: "Thời gian",
        value: datePresetLabel,
        onClear: () => {
          setDatePreset("all");
          setDateFrom("");
          setDateTo("");
        },
      });
    }
    if (statusFilter.length > 0) {
      chips.push({
        key: "status",
        label: "Trạng thái",
        value: statusFilter
          .map((value) => STATUS_META[value as StockTransferStatus]?.label ?? value)
          .join(", "),
        onClear: () => setStatusFilter([]),
      });
    }
    if (fromBranchId !== "all") {
      chips.push({
        key: "fromBranch",
        label: "Kho xuất",
        value:
          branchOptions.find((option) => option.value === fromBranchId)?.label ??
          "Đã chọn",
        onClear: () => setFromBranchId("all"),
      });
    }
    if (toBranchId !== "all") {
      chips.push({
        key: "toBranch",
        label: "Kho nhận",
        value:
          branchOptions.find((option) => option.value === toBranchId)?.label ??
          "Đã chọn",
        onClear: () => setToBranchId("all"),
      });
    }
    if (createdBy) {
      chips.push({
        key: "creator",
        label: "Người tạo",
        value:
          creatorOptions.find((option) => option.value === createdBy)?.label ??
          "Đã chọn",
        onClear: () => setCreatedBy(""),
      });
    }
    if (itemCountMin || itemCountMax) {
      chips.push({
        key: "itemCount",
        label: "Số mặt hàng",
        value: `${itemCountMin || "0"} đến ${itemCountMax || "không giới hạn"}`,
        onClear: () => {
          setItemCountMin("");
          setItemCountMax("");
        },
      });
    }
    return chips;
  }, [
    branchOptions,
    createdBy,
    creatorOptions,
    datePreset,
    datePresetLabel,
    fromBranchId,
    itemCountMax,
    itemCountMin,
    statusFilter,
    toBranchId,
  ]);

  const chuaCoPhamVi = phamVi.mode === "none";
  const emptyState = chuaCoPhamVi
    ? "no-scope"
    : debouncedSearch.trim() || datePreset !== "all" || filterChips.length > 0
      ? "no-results"
      : "no-data";

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Chuyển kho"
        density="compact"
        searchPlaceholder="Nhập nội dung tìm kiếm"
        searchValue={search}
        onSearchChange={setSearch}
        searchFields={SEARCH_FIELDS}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        onExport={{
          excel: async () => {
            if (phamVi.mode === "none") return;
            try {
              toast({
                title: "Đang chuẩn bị file Excel…",
                description: "Tải toàn bộ phiếu và dòng sản phẩm theo bộ lọc hiện tại",
                variant: "info",
              });
              const rows = await getStockTransfersForExport({
                search: debouncedSearch || undefined,
                searchField,
                filters: commonFilters,
                branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
              });
              if (rows.length === 0) {
                toast({ title: "Không có dữ liệu để xuất", variant: "info" });
                return;
              }
              await exportToExcelFromSchema(rows, stockTransferExcelSchema);
            } catch (error) {
              toast({
                title: "Lỗi xuất Excel",
                description: error instanceof Error ? error.message : "Vui lòng thử lại",
                variant: "error",
              });
            }
          },
        }}
        actions={[
          {
            label: "Tạo phiếu chuyển kho",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setShowCreate(true),
          },
        ]}
      />

      {viewAllBranches && (
        <AllBranchesBanner
          branchName={currentBranch?.name}
          onBackToBranch={() => setViewAllBranches(false)}
        />
      )}

      {pageStuckTransit > 0 && (
        <div className="mx-3 mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <div className="flex items-start gap-2">
            <Icon name="warning" size={17} className="text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-destructive">
                Trang này có {pageStuckTransit} phiếu đang vận chuyển quá 7 ngày
              </div>
              <div className="text-muted-foreground mt-0.5">
                Cần kiểm tra với kho nhận; cảnh báo này chỉ tính các dòng đang hiển thị.
              </div>
            </div>
          </div>
        </div>
      )}

      <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          density="compact"
          columnToggle
          toolbarMetrics={
            <>
              <ListMetric
                icon={<Icon name="swap_horiz" size={15} />}
                label="Kết quả"
                value={formatNumber(total)}
                hint="Tổng số phiếu theo toàn bộ bộ lọc"
              />
              <ListMetric
                icon={<Icon name="inventory_2" size={15} />}
                label="Tổng mặt hàng"
                value={formatNumber(summary.totalItems)}
                hint="Toàn bộ kết quả lọc"
                tone="primary"
              />
              <ListMetric
                icon={<Icon name="local_shipping" size={15} />}
                label="Đang chuyển"
                value={formatNumber(summary.inTransitCount)}
                hint="Toàn bộ kết quả lọc"
              />
              <ListMetric
                icon={<Icon name="check_circle" size={15} />}
                label="Hoàn thành"
                value={formatNumber(summary.completedCount)}
                hint={`${summary.cancelledCount} phiếu đã hủy`}
              />
            </>
          }
          toolbarActions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
                onClick={() => setFilterOpen(true)}
              >
                <Icon name="calendar_today" size={15} />
                <span className="hidden sm:inline">{datePresetLabel}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
                onClick={() => setFilterOpen(true)}
                aria-label={`Mở bộ lọc${
                  filterChips.length ? `, ${filterChips.length} điều kiện` : ""
                }`}
              >
                <Icon name="filter_alt" size={15} />
                <span className="hidden sm:inline">Bộ lọc</span>
                {filterChips.length > 0 && (
                  <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                    {filterChips.length}
                  </span>
                )}
              </Button>
            </>
          }
          toolbarFooter={
            <FilterChips
              filters={filterChips}
              onClearAll={filterChips.length > 1 ? clearListFilters : undefined}
            />
          }
          defaultColumnVisibility={{ createdByName: false }}
          emptyState={emptyState}
          emptyTitle={
            chuaCoPhamVi
              ? "Chưa có chi nhánh làm việc"
              : emptyState === "no-results"
                ? "Không tìm thấy phiếu chuyển kho"
                : "Chưa có phiếu chuyển kho"
          }
          emptyDescription={
            chuaCoPhamVi
              ? "Hãy chọn một chi nhánh hoặc dùng quyền xem toàn chuỗi."
              : emptyState === "no-results"
                ? "Thử thay đổi thời gian, trạng thái, kho hoặc nội dung tìm kiếm."
                : "Phiếu chuyển kho mới sẽ hiển thị tại đây sau khi được tạo."
          }
          emptyIcon={chuaCoPhamVi ? "apartment" : "swap_horiz"}
          emptyBranchHint={
            duocXemToanChuoi
              ? {
                  otherBranchCount,
                  onViewAllBranches: () => setViewAllBranches(true),
                  entityLabel: "phiếu chuyển kho",
                }
              : undefined
          }
          pageIndex={page}
          pageSize={pageSize}
          pageCount={pageCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          summaryRow={{ totalItems: formatNumber(pageProductCount) }}
          getRowId={(r) => r.id}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(item, onClose) => (
            <TransferDetail item={item} onClose={onClose} />
          )}
          rowActions={(row) => {
            // Sprint UX-1 Stage 4: standardized transaction row actions
            const workflowActions: Array<{ label: string; icon?: React.ReactNode; onClick: () => void }> = [];
            if (row.status === "draft") {
              workflowActions.push({
                label: "Bắt đầu vận chuyển",
                icon: <Icon name="local_shipping" size={16} />,
                onClick: () => requestStartTransit(row),
              });
            } else if (row.status === "in_transit") {
              workflowActions.push({
                label: "Hoàn thành nhập kho",
                icon: <Icon name="check_circle" size={16} />,
                onClick: () => requestComplete(row),
              });
            }

            return buildTransactionRowActions({
              row,
              kind: "stock_transfer",
              permissions: txPerms,
              onView: () => {
                const idx = data.findIndex((d) => d.id === row.id);
                setExpandedRow(expandedRow === idx ? null : idx);
              },
              workflowActions,
              // Audit log shortcut
              onAuditLog: () => setAuditDialogTarget(row),
              // Hủy — chỉ chưa completed/cancelled
              onCancel:
                row.status !== "completed" && row.status !== "cancelled"
                  ? () => requestCancel(row)
                  : undefined,
            });
          }}
        />

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={clearListFilters}
        title="Bộ lọc chuyển kho"
      >
        <FilterGroup label="Thời gian tạo" activeHint={datePresetLabel}>
          <DatePresetFilter
            value={datePreset}
            onChange={setDatePreset}
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            presets={STANDARD_LIST_PRESETS_WITH_ALL}
          />
        </FilterGroup>

        <FilterGroup
          label="Trạng thái"
          activeHint={statusFilter.length ? `${statusFilter.length} lựa chọn` : undefined}
        >
          <CheckboxFilter
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
        </FilterGroup>

        <FilterGroup
          label="Kho xuất"
          activeHint={
            fromBranchId === "all"
              ? undefined
              : branchOptions.find((option) => option.value === fromBranchId)?.label
          }
        >
          <SelectFilter
            options={branchOptions}
            value={fromBranchId}
            onChange={setFromBranchId}
            placeholder="Tất cả"
          />
        </FilterGroup>

        <FilterGroup
          label="Kho nhận"
          activeHint={
            toBranchId === "all"
              ? undefined
              : branchOptions.find((option) => option.value === toBranchId)?.label
          }
        >
          <SelectFilter
            options={branchOptions}
            value={toBranchId}
            onChange={setToBranchId}
            placeholder="Tất cả"
          />
        </FilterGroup>

        <FilterGroup
          label="Người tạo"
          activeHint={creatorOptions.find((option) => option.value === createdBy)?.label}
        >
          <PersonFilter
            value={createdBy}
            onChange={setCreatedBy}
            placeholder="Chọn người tạo"
            suggestions={creatorOptions}
          />
        </FilterGroup>

        <FilterGroup
          label="Số mặt hàng"
          activeHint={itemCountMin || itemCountMax ? "Đang lọc" : undefined}
        >
          <RangeFilter
            fromValue={itemCountMin}
            toValue={itemCountMax}
            onFromChange={setItemCountMin}
            onToChange={setItemCountMax}
            fromPlaceholder="Tối thiểu"
            toPlaceholder="Tối đa"
          />
        </FilterGroup>
      </FilterPanel>

      {/* Create Transfer Dialog */}
      <CreateTransferDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        branches={branches}
        creating={creating}
        onSubmit={async (input) => {
          setCreating(true);
          try {
            const result = await createStockTransfer(input);
            toast({
              title: `Đã tạo phiếu ${result.code}`,
              variant: "success",
            });
            setShowCreate(false);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi tạo phiếu",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setCreating(false);
          }
        }}
      />

      {/* Confirm destructive transfer actions (start / complete / cancel).
          Ba action này đều ảnh hưởng tồn kho thật nên luôn yêu cầu xác nhận. */}
      {pendingDialogConfig && (
        <ConfirmDialog
          open={pendingAction !== null}
          onOpenChange={(o) => {
            if (!o) setPendingAction(null);
          }}
          title={pendingDialogConfig.title}
          description={pendingDialogConfig.description}
          confirmLabel={pendingDialogConfig.confirmLabel}
          cancelLabel="Đóng"
          variant={pendingDialogConfig.variant}
          loading={actionBusy}
          onConfirm={executePendingAction}
        />
      )}

      {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
      {auditDialogTarget && (
        <AuditLogDialog
          entityType="stock_transfer"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}
    </ListPageLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Transfer Detail Panel                                               */
/* ------------------------------------------------------------------ */

function TransferDetail({
  item,
  onClose,
}: {
  item: StockTransfer;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StockTransferItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingItems(true);
    getStockTransferById(item.id)
      .then((res) => {
        if (cancelled) return;
        setItems(res?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const meta = STATUS_META[item.status];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailTabs
          defaultTab="info"
          tabs={[
            {
              id: "info",
              label: "Thông tin",
              content: (
                <div className="space-y-4">
                  <DetailHeader
                    title={`Phiếu chuyển kho ${item.code}`}
                    code={item.code}
                    status={{
                      label: meta.label,
                      variant: "secondary",
                      className: "",
                    }}
                    subtitle={`${item.fromBranchName} → ${item.toBranchName}`}
                    meta={
                      <div className="flex items-center gap-4 flex-wrap text-xs">
                        <span>
                          Người tạo:{" "}
                          <strong>{formatUser(item.createdByName, item.createdBy)}</strong>
                        </span>
                        <span>
                          Ngày tạo: <strong>{formatDate(item.createdAt)}</strong>
                        </span>
                      </div>
                    }
                  />
                  <DetailInfoGrid
                    fields={[
                      { label: "Mã phiếu", value: item.code },
                      { label: "Kho xuất", value: item.fromBranchName },
                      { label: "Kho nhận", value: item.toBranchName },
                      { label: "Trạng thái", value: meta.label },
                      {
                        label: "Số mặt hàng",
                        value: String(item.totalItems),
                      },
                      {
                        label: "Ngày hoàn thành",
                        value: item.completedAt
                          ? formatDate(item.completedAt)
                          : "—",
                      },
                      { label: "Ghi chú", value: item.note || "—" },
                    ]}
                  />
                </div>
              ),
            },
            {
              id: "items",
              label: "Sản phẩm",
              content: (
                <div className="space-y-2">
                  {loadingItems ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                      <Icon
                        name="progress_activity"
                        size={16}
                        className="animate-spin mr-2"
                      />
                      Đang tải...
                    </div>
                  ) : !items || items.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                      Phiếu chưa có sản phẩm
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="text-left p-2 font-medium">Sản phẩm</th>
                            <th className="text-right p-2 font-medium w-24">
                              Số lượng
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, idx) => (
                            <tr key={`${it.productId}-${idx}`} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{it.productName}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {it.productCode}
                                </div>
                              </td>
                              <td className="p-2 text-right tabular-nums">
                                {formatNumber(it.quantity)} {it.unit ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: "history",
              label: "Lịch sử",
              content: (
                <AuditHistoryTab entityType="stock_transfer" entityId={item.id} />
              ),
            },
          ]}
        />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Transfer Dialog                                             */
/* ------------------------------------------------------------------ */

interface CreateTransferDialogProps {
  open: boolean;
  onClose: () => void;
  branches: BranchDetail[];
  creating: boolean;
  onSubmit: (input: {
    fromBranchId: string;
    toBranchId: string;
    items: StockTransferItem[];
    note?: string;
  }) => void;
}

interface ProductSearchResult {
  id: string;
  code: string;
  name: string;
  unit?: string;
  stock: number;
}

function CreateTransferDialog({
  open,
  onClose,
  branches,
  creating,
  onSubmit,
}: CreateTransferDialogProps) {
  const [fromBranch, setFromBranch] = useState("");
  const [toBranch, setToBranch] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<
    (StockTransferItem & { id: string; stock: number })[]
  >([]);

  // Product search
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!productSearch.trim()) {
      setSearchResults([]);
      return;
    }
    if (!fromBranch) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // Filter by fromBranch stock — chỉ show SP có tồn > 0 tại chi nhánh xuất
      const rows = await getBranchStockRows({
        branchId: fromBranch,
        search: productSearch,
      });
      const inStock = rows
        .filter((r) => r.quantity > 0)
        .slice(0, 10)
        .map((r) => ({
          id: r.productId,
          code: r.productCode,
          name: r.productName,
          unit: r.unit ?? undefined,
          stock: r.quantity,
        }));
      setSearchResults(inStock);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [productSearch, fromBranch]);

  useEffect(() => {
    const timer = setTimeout(handleSearch, 300);
    return () => clearTimeout(timer);
  }, [handleSearch]);

  const addProduct = (prod: ProductSearchResult) => {
    if (items.some((i) => i.id === prod.id)) return;
    setItems((prev) => [
      ...prev,
      {
        id: prod.id,
        productId: prod.id,
        productName: prod.name,
        productCode: prod.code,
        unit: prod.unit,
        quantity: 1,
        stock: prod.stock,
      },
    ]);
    setProductSearch("");
    setSearchResults([]);
  };

  const updateQuantity = (id: string, qty: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        // Cap [1 .. stock] — không cho user type số lớn hơn tồn tại chi nhánh xuất.
        // Nếu stock = 0 (edge case: vừa bị chuyển hết trước đó), giữ ở mức 1 để
        // user thấy rõ warning "vượt tồn" thay vì silent lock ở 0.
        const maxQty = Math.max(1, Math.floor(item.stock));
        const bounded = Math.min(Math.max(1, Math.floor(qty) || 1), maxQty);
        return { ...item, quantity: bounded };
      }),
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Các item có qty > stock — thường xảy ra khi stock bị thay đổi ngoài
  // (user khác chuyển kho song song) hoặc khi item mới add với stock = 0.
  const overStockItems = items.filter((i) => i.quantity > i.stock);

  const handleSubmit = () => {
    if (!fromBranch || !toBranch) return;
    if (items.length === 0) return;
    if (overStockItems.length > 0) return;
    onSubmit({
      fromBranchId: fromBranch,
      toBranchId: toBranch,
      items: items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        productCode: i.productCode,
        unit: i.unit,
        quantity: i.quantity,
      })),
      note: note || undefined,
    });
  };

  const reset = () => {
    setFromBranch("");
    setToBranch("");
    setNote("");
    setItems([]);
    setProductSearch("");
    setSearchResults([]);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const isValid =
    Boolean(fromBranch) &&
    Boolean(toBranch) &&
    fromBranch !== toBranch &&
    items.length > 0 &&
    overStockItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="swap_horiz" />
            Tạo phiếu chuyển kho
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Branch selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Kho xuất</Label>
              <Select
                value={fromBranch}
                onValueChange={(v) => {
                  setFromBranch(v ?? "");
                  // Reset items — SP từ branch cũ có thể không còn valid ở branch mới
                  setItems([]);
                  setProductSearch("");
                  setSearchResults([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn chi nhánh xuất" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Kho nhận</Label>
              <Select value={toBranch} onValueChange={(v) => setToBranch(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn chi nhánh nhận" />
                </SelectTrigger>
                <SelectContent>
                  {branches
                    .filter((b) => b.id !== fromBranch)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {fromBranch === toBranch && fromBranch && (
            <p className="text-xs text-destructive">
              Chi nhánh xuất và nhận không được trùng nhau
            </p>
          )}

          {/* Product search */}
          <div>
            <Label className="text-xs">Thêm sản phẩm</Label>
            <div className="relative">
              <Input
                placeholder={fromBranch ? "Tìm theo mã, tên sản phẩm..." : "Chọn kho xuất trước"}
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                disabled={!fromBranch}
              />
              {searching && (
                <Icon name="progress_activity" size={16} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            {fromBranch && (
              <p className="text-xs text-muted-foreground mt-1">
                Chỉ hiển thị mặt hàng có tồn kho tại chi nhánh xuất.
              </p>
            )}
            {fromBranch && productSearch.trim() && !searching && searchResults.length === 0 && (
              <p className="text-xs text-destructive mt-1">
                Không tìm thấy mặt hàng còn tồn tại chi nhánh này.
              </p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-1 border rounded-lg max-h-40 overflow-auto bg-background shadow-sm">
                {searchResults.map((prod) => (
                  <button
                    key={prod.id}
                    onClick={() => addProduct(prod)}
                    disabled={items.some((i) => i.id === prod.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between disabled:opacity-50"
                  >
                    <div>
                      <span className="font-medium">{prod.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({prod.code})
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Tồn: {formatNumber(prod.stock)} {prod.unit ?? ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium">
                      Sản phẩm
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium w-20">
                      Tồn
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium w-28">
                      Số lượng
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const overStock = item.quantity > item.stock;
                    return (
                      <tr
                        key={item.id}
                        className={`border-t ${overStock ? "bg-status-error/5" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Icon name="inventory_2" size={14} className="text-muted-foreground" />
                            <div>
                              <p className="font-medium text-xs">
                                {item.productName}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {item.productCode}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td
                          className={`text-center text-xs ${overStock ? "text-status-error font-medium" : "text-muted-foreground"}`}
                        >
                          {formatNumber(item.stock)} {item.unit ?? ""}
                        </td>
                        <td className="text-center px-2">
                          <Input
                            type="number"
                            min={1}
                            max={Math.max(1, item.stock)}
                            value={item.quantity}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              updateQuantity(item.id, parseInt(e.target.value) || 1)
                            }
                            className={`h-7 text-center text-xs w-20 mx-auto ${overStock ? "border-status-error focus-visible:ring-status-error" : ""}`}
                            aria-invalid={overStock || undefined}
                          />
                        </td>
                        <td className="px-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-status-error hover:text-status-error"
                            onClick={() => removeItem(item.id)}
                          >
                            <Icon name="delete" size={14} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {overStockItems.length > 0 && (
                <div className="px-3 py-2 bg-status-error/10 border-t border-status-error/30 text-xs text-status-error flex items-start gap-2">
                  <Icon name="warning" size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Có {overStockItems.length} mặt hàng vượt tồn kho tại chi nhánh
                    xuất. Vui lòng giảm số lượng trước khi tạo phiếu.
                  </span>
                </div>
              )}
            </div>
          )}

          {items.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg border-dashed">
              Chưa có sản phẩm. Tìm và thêm sản phẩm cần chuyển kho.
            </div>
          )}

          {/* Note */}
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Lý do chuyển kho..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Hủy
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || creating}>
            {creating && <Icon name="progress_activity" size={16} className="animate-spin mr-1" />}
            Tạo phiếu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
