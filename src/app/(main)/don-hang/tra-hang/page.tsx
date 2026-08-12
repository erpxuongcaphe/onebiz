"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
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
  type DatePresetValue,
  PersonFilter,
  RangeFilter,
  SelectFilter,
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
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { DocumentNoteBox } from "@/components/shared/document-note-box";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import { buildReturnPrintData, toPrintLines } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  phamViTraHang,
  getReturnsTheoPhamVi,
  demTraHangChiNhanhKhac,
  getReturnItems,
  getProfilesForPersonFilter,
  type ReturnItemRow,
} from "@/lib/services";
import type { ReturnOrder } from "@/lib/types";
// PERF (CEO 23/05/2026): Lazy-load CreateReturnDialog (556 dòng).
import dynamic from "next/dynamic";
const CreateReturnDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-return-dialog").then(
      (m) => m.CreateReturnDialog,
    ),
  { ssr: false },
);
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { usePermissions, useTxRowPermissions } from "@/lib/permissions";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

// --- Status config ---

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  draft: { label: "Phiếu tạm", variant: "secondary" },
  confirmed: { label: "Đã xác nhận", variant: "secondary" },
  completed: { label: "Đã trả", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const returnStatusOptions = [
  { label: "Phiếu tạm", value: "draft" },
  { label: "Đã xác nhận", value: "confirmed" },
  { label: "Đã trả", value: "completed" },
  { label: "Đã hủy", value: "cancelled" },
];

const refundStateOptions = [
  { label: "Tất cả", value: "all" },
  { label: "Chưa ghi nhận hoàn tiền", value: "none" },
  { label: "Đã ghi nhận hoàn tiền", value: "recorded" },
];

const searchFields = [
  { value: "code", label: "Mã phiếu trả" },
  { value: "invoice_code", label: "Mã hóa đơn" },
  { value: "customer_name", label: "Tên khách hàng" },
  { value: "customer_code", label: "Mã khách hàng" },
  { value: "customer_phone", label: "Số điện thoại" },
  { value: "reason", label: "Lý do trả" },
  { value: "note", label: "Ghi chú" },
];

// --- Inline Detail ---

function ReturnDetail({
  returnOrder,
  onClose,
}: {
  returnOrder: ReturnOrder;
  onClose: () => void;
}) {
  const status = statusMap[returnOrder.status] ?? {
    label: returnOrder.status,
    variant: "secondary" as const,
  };

  // Lazy fetch line items thật (P0 audit fix).
  const [items, setItems] = useState<ReturnItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    getReturnItems(returnOrder.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setItemsLoading(false); });
    return () => { cancelled = true; };
  }, [returnOrder.id]);

  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

  return (
    <InlineDetailPanel open onClose={onClose}>
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={returnOrder.customerName}
                  code={returnOrder.code}
                  status={{
                    label: status.label,
                    variant: status.variant,
                    className:
                      status.variant === "default"
                        ? "bg-status-success/10 text-status-success border-status-success/25"
                        : status.variant === "destructive"
                          ? "bg-status-error/10 text-status-error border-status-error/25"
                          : undefined,
                  }}
                  subtitle={returnOrder.branchName || "—"}
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo:{" "}
                        <strong>{formatUser(undefined, returnOrder.createdBy)}</strong>
                      </span>
                      <span>
                        Ngày trả:{" "}
                        <strong>{formatDate(returnOrder.date)}</strong>
                      </span>
                      <span>
                        Hóa đơn gốc:{" "}
                        <strong>{returnOrder.invoiceCode}</strong>
                      </span>
                      {returnOrder.customerCode && (
                        <span>
                          Mã KH: <strong>{returnOrder.customerCode}</strong>
                        </span>
                      )}
                    </div>
                  }
                />

                {itemsLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải sản phẩm...
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Phiếu trả này không có sản phẩm.
                  </div>
                ) : (
                  <DetailItemsTable
                    columns={[
                      { header: "Mã hàng", accessor: "productCode" as never },
                      { header: "Tên hàng", accessor: "productName" as never },
                      { header: "Đơn vị", accessor: "unit" as never },
                      {
                        header: "SL trả",
                        accessor: "quantity" as never,
                        align: "right",
                      },
                      {
                        header: "Đơn giá",
                        accessor: (item: Record<string, unknown>) =>
                          formatCurrency(item.unitPrice as number),
                        align: "right",
                      },
                      {
                        header: "Thành tiền",
                        accessor: (item: Record<string, unknown>) => (
                          <span className="text-primary font-semibold">
                            {formatCurrency(item.total as number)}
                          </span>
                        ),
                        align: "right",
                      },
                    ]}
                    items={items as unknown as Record<string, unknown>[]}
                    summary={[
                      {
                        label: `Tổng tiền hàng (${items.length})`,
                        value: formatCurrency(subtotal),
                      },
                      {
                        label: "Cần trả khách",
                        value: formatCurrency(returnOrder.totalAmount),
                        className: "font-bold text-base",
                      },
                      {
                        label: "Đã hoàn khách",
                        value: formatCurrency(returnOrder.refundedAmount),
                      },
                    ]}
                  />
                )}

                {returnOrder.reason && (
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Lý do trả: </span>
                    <strong>{returnOrder.reason}</strong>
                  </div>
                )}

                {/* 06/08: trước là <textarea> trần không hiện note đã lưu.
                    Phiếu trả không có luồng sửa trường mềm → chỉ hiển thị. */}
                <DocumentNoteBox note={returnOrder.note} />
              </div>
            ),
          },
          {
            id: "payment_history",
            label: "Lịch sử",
            content: <AuditHistoryTab entityType="sales_return" entityId={returnOrder.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

// --- Page ---

export default function TraHangPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch, isReady: branchReady } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("sales_return");
  const [data, setData] = useState<ReturnOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [searchField, setSearchField] = useState("code");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<ReturnOrder | null>(null);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "completed",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [creatorOptions, setCreatorOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [refundState, setRefundState] = useState("all");
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
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

  useEffect(() => {
    if (!branchReady) return;
    getProfilesForPersonFilter().then(setCreatorOptions).catch(() => setCreatorOptions([]));
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
      ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      ...(dateRange.from && { dateFrom: dateRange.from }),
      ...(dateRange.to && { dateTo: dateRange.to }),
      ...(createdBy && { createdBy }),
      ...(amountMin && { amountMin }),
      ...(amountMax && { amountMax }),
      ...(refundState !== "all" && { refundState }),
    }),
    [
      amountMax,
      amountMin,
      createdBy,
      dateRange.from,
      dateRange.to,
      refundState,
      selectedStatuses,
    ],
  );

  const phamVi = useMemo(
    () =>
      phamViTraHang({
        activeBranchId,
        viewAllBranches,
        duocXemToanChuoi,
      }),
    [activeBranchId, duocXemToanChuoi, viewAllBranches],
  );

  const chuaCoPhamVi = phamVi.mode === "none";

  const fetchData = useCallback(async () => {
    if (!branchReady || permissionsLoading) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const result = await getReturnsTheoPhamVi(phamVi, {
        page,
        pageSize,
        search: debouncedSearch,
        searchField,
        filters: commonFilters,
      });
      if (requestId !== requestSequence.current) return;

      setData(result.data);
      setTotal(result.total);

      const count =
        result.data.length === 0
          ? await demTraHangChiNhanhKhac(phamVi, {
              search: debouncedSearch,
              searchField,
              filters: commonFilters,
            })
          : 0;
      if (requestId === requestSequence.current) setOtherBranchCount(count);
    } catch (e) {
      if (requestId !== requestSequence.current) return;
      toast({
        variant: "error",
        title: "Không tải được danh sách phiếu trả hàng",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
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
    amountMax,
    amountMin,
    createdBy,
    dateFrom,
    datePreset,
    dateTo,
    debouncedSearch,
    refundState,
    searchField,
    selectedStatuses,
  ]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageReturnAmount = data.reduce((sum, item) => sum + item.totalAmount, 0);
  const pageRefundedAmount = data.reduce(
    (sum, item) => sum + item.refundedAmount,
    0,
  );
  const pageOutstandingAmount = data.reduce(
    (sum, item) => sum + Math.max(0, item.totalAmount - item.refundedAmount),
    0,
  );

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
    setSelectedStatuses([]);
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setCreatedBy("");
    setAmountMin("");
    setAmountMax("");
    setRefundState("all");
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
    if (selectedStatuses.length > 0) {
      chips.push({
        key: "status",
        label: "Trạng thái",
        value: selectedStatuses
          .map(
            (value) =>
              returnStatusOptions.find((option) => option.value === value)?.label ?? value,
          )
          .join(", "),
        onClear: () => setSelectedStatuses([]),
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
    if (amountMin || amountMax) {
      chips.push({
        key: "amount",
        label: "Giá trị phiếu",
        value: `${amountMin ? formatCurrency(Number(amountMin)) : "0 ₫"} đến ${
          amountMax ? formatCurrency(Number(amountMax)) : "không giới hạn"
        }`,
        onClear: () => {
          setAmountMin("");
          setAmountMax("");
        },
      });
    }
    if (refundState !== "all") {
      chips.push({
        key: "refund",
        label: "Hoàn tiền",
        value:
          refundStateOptions.find((option) => option.value === refundState)?.label ??
          refundState,
        onClear: () => setRefundState("all"),
      });
    }
    return chips;
  }, [
    amountMax,
    amountMin,
    createdBy,
    creatorOptions,
    datePreset,
    datePresetLabel,
    refundState,
    selectedStatuses,
  ]);
  const emptyState = chuaCoPhamVi
    ? "no-scope"
    : debouncedSearch.trim() || datePreset !== "all" || filterChips.length > 0
      ? "no-results"
      : "no-data";

  const handleExport = useCallback(async (type: "excel" | "csv") => {
    if (exporting || phamVi.mode === "none") return;
    setExporting(true);
    const exportColumns = [
      { header: "Mã trả hàng", key: "code", width: 15 },
      { header: "Mã hóa đơn", key: "invoiceCode", width: 15 },
      {
        header: "Thời gian",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
      { header: "Chi nhánh", key: "branchName", width: 22 },
      { header: "Mã khách hàng", key: "customerCode", width: 16 },
      { header: "Khách hàng", key: "customerName", width: 25 },
      { header: "Số điện thoại", key: "customerPhone", width: 16 },
      {
        header: "Giá trị trả hàng",
        key: "totalAmount",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Đã hoàn khách",
        key: "refundedAmount",
        width: 15,
        format: (v: number) => v,
      },
      { header: "Lý do trả", key: "reason", width: 30 },
      { header: "Người tạo", key: "createdBy", width: 18 },
      {
        header: "Trạng thái",
        key: "statusName",
        width: 15,
      },
      { header: "Ghi chú", key: "note", width: 35 },
    ];
    try {
      const rows: ReturnOrder[] = [];
      const seen = new Set<string>();
      let exportPage = 0;
      let expectedTotal = Number.POSITIVE_INFINITY;
      while (rows.length < expectedTotal) {
        const result = await getReturnsTheoPhamVi(phamVi, {
          page: exportPage,
          pageSize: 500,
          search: debouncedSearch,
          searchField,
          filters: commonFilters,
        });
        expectedTotal = result.total;
        for (const row of result.data) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            rows.push(row);
          }
        }
        if (result.data.length < 500) break;
        exportPage += 1;
      }

      if (rows.length === 0) {
        toast({ variant: "info", title: "Không có phiếu trả hàng để xuất" });
        return;
      }
      if (type === "excel") {
        exportToExcel(rows, exportColumns, "danh-sach-tra-hang");
      } else {
        exportToCsv(rows, exportColumns, "danh-sach-tra-hang");
      }
      toast({
        variant: "success",
        title: "Đã xuất danh sách trả hàng",
        description: `${formatNumber(rows.length)} phiếu theo đúng bộ lọc`,
      });
    } catch (error) {
      toast({
        variant: "error",
        title: "Không xuất được danh sách trả hàng",
        description: error instanceof Error ? error.message : "Vui lòng thử lại",
      });
    } finally {
      setExporting(false);
    }
  }, [
    commonFilters,
    debouncedSearch,
    exporting,
    phamVi,
    searchField,
    toast,
  ]);

  const columns: ColumnDef<ReturnOrder, unknown>[] = [
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
      header: "Mã trả hàng",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "invoiceCode",
      header: "Mã hóa đơn",
      size: 120,
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "customerCode",
      header: "Mã KH",
      size: 100,
      cell: ({ row }) => row.original.customerCode ?? "—",
    },
    {
      accessorKey: "customerName",
      header: "Khách hàng",
      size: 180,
    },
    {
      accessorKey: "customerPhone",
      header: "Số điện thoại",
      size: 125,
      cell: ({ row }) => row.original.customerPhone ?? "—",
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 150,
      cell: ({ row }) => row.original.branchName ?? "—",
    },
    {
      accessorKey: "totalAmount",
      header: "Giá trị trả hàng",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      accessorKey: "refundedAmount",
      header: "Đã hoàn khách",
      cell: ({ row }) => (
        <span className="text-right block text-primary font-semibold">
          {formatCurrency(row.original.refundedAmount)}
        </span>
      ),
    },
    {
      accessorKey: "reason",
      header: "Lý do trả",
      size: 180,
      cell: ({ row }) => (
        <span className="block max-w-[180px] truncate" title={row.original.reason}>
          {row.original.reason || "—"}
        </span>
      ),
    },
    {
      accessorKey: "createdBy",
      header: "Người tạo",
      size: 130,
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 120,
      cell: ({ row }) => {
        const status = statusMap[row.original.status];
        return <Badge variant={status.variant}>{status.label}</Badge>;
      },
    },
  ];

  return (
    <>
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Trả hàng"
        density="compact"
        searchPlaceholder="Nhập nội dung tìm kiếm"
        searchValue={search}
        onSearchChange={setSearch}
        searchFields={searchFields}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        onExport={{
          excel: () => void handleExport("excel"),
          csv: () => void handleExport("csv"),
        }}
        actions={[
          {
            label: "Trả hàng",
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
        toolbarMetrics={
          <>
            <ListMetric
              icon={<Icon name="undo" size={15} />}
              label="Kết quả"
              value={formatNumber(total)}
              hint="Tổng số phiếu theo toàn bộ bộ lọc"
            />
            <ListMetric
              icon={<Icon name="receipt_long" size={15} />}
              label="Giá trị trang này"
              value={formatCurrency(pageReturnAmount)}
              hint={`Tổng của ${data.length} dòng đang hiển thị`}
              tone="primary"
            />
            <ListMetric
              icon={<Icon name="payments" size={15} />}
              label="Đã hoàn trang này"
              value={formatCurrency(pageRefundedAmount)}
              hint={`Tổng của ${data.length} dòng đang hiển thị`}
            />
            <ListMetric
              icon={<Icon name="pending_actions" size={15} />}
              label="Còn hoàn trang này"
              value={formatCurrency(pageOutstandingAmount)}
              hint="Giá trị phiếu trừ số tiền đã hoàn trên trang hiện tại"
              tone={pageOutstandingAmount > 0 ? "danger" : "default"}
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
              aria-label={`Mở bộ lọc${filterChips.length ? `, ${filterChips.length} điều kiện` : ""}`}
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
        defaultColumnVisibility={{
          customerPhone: false,
          branchName: false,
          reason: false,
          createdBy: false,
        }}
        emptyState={emptyState}
        emptyTitle={
          chuaCoPhamVi
            ? "Chưa có chi nhánh làm việc"
            : emptyState === "no-results"
              ? "Không tìm thấy phiếu trả hàng"
              : "Chưa có phiếu trả hàng"
        }
        emptyDescription={
          chuaCoPhamVi
            ? "Hãy chọn một chi nhánh hoặc dùng quyền xem toàn chuỗi."
            : emptyState === "no-results"
              ? "Thử thay đổi thời gian, trạng thái hoặc nội dung tìm kiếm."
              : "Phiếu trả hàng mới sẽ hiển thị tại đây sau khi được tạo."
        }
        emptyIcon={chuaCoPhamVi ? "apartment" : "undo"}
        emptyBranchHint={
          duocXemToanChuoi
            ? {
                otherBranchCount,
                onViewAllBranches: () => setViewAllBranches(true),
                entityLabel: "phiếu trả hàng",
              }
            : undefined
        }
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(total / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        selectable
        summaryRow={{
          totalAmount: formatCurrency(pageReturnAmount),
          refundedAmount: formatCurrency(pageRefundedAmount),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(returnOrder, onClose) => (
          <ReturnDetail returnOrder={returnOrder} onClose={onClose} />
        )}
        getRowId={(row) => row.id}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "sales_return",
            permissions: txPerms,
            onView: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
            onPrint: async () => {
              const items = await getReturnItems(row.id);
              printWithPicker(
                buildReturnPrintData(
                  {
                    code: row.code,
                    date: row.date,
                    customerName: row.customerName,
                    totalRefund: row.totalAmount,
                    createdBy: row.createdBy,
                  },
                  toPrintLines(items),
                ),
                "In phiếu trả hàng",
                { channel: "retail", docType: "sale_return", branchId: activeBranchId },
              );
            },
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
          })
        }
      />

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={clearListFilters}
        title="Bộ lọc trả hàng"
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
          activeHint={
            selectedStatuses.length > 0
              ? `${selectedStatuses.length} lựa chọn`
              : undefined
          }
        >
          <CheckboxFilter
            options={returnStatusOptions}
            selected={selectedStatuses}
            onChange={setSelectedStatuses}
          />
        </FilterGroup>

        <FilterGroup
          label="Người tạo"
          activeHint={
            creatorOptions.find((option) => option.value === createdBy)?.label
          }
        >
          <PersonFilter
            value={createdBy}
            onChange={setCreatedBy}
            placeholder="Chọn người tạo"
            suggestions={creatorOptions}
          />
        </FilterGroup>

        <FilterGroup
          label="Giá trị phiếu"
          activeHint={amountMin || amountMax ? "Đang lọc" : undefined}
        >
          <RangeFilter
            fromValue={amountMin}
            toValue={amountMax}
            onFromChange={setAmountMin}
            onToChange={setAmountMax}
            fromPlaceholder="Số tiền tối thiểu"
            toPlaceholder="Số tiền tối đa"
          />
        </FilterGroup>

        <FilterGroup
          label="Tình trạng hoàn tiền"
          activeHint={
            refundState === "all"
              ? undefined
              : refundStateOptions.find((option) => option.value === refundState)
                  ?.label
          }
        >
          <SelectFilter
            options={refundStateOptions}
            value={refundState}
            onChange={setRefundState}
            placeholder="Tất cả"
          />
        </FilterGroup>
      </FilterPanel>
    </ListPageLayout>

    <CreateReturnDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />

    {printerDialog}

    {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
    {auditDialogTarget && (
      <AuditLogDialog
        entityType="sales_return"
        entityId={auditDialogTarget.id}
        entityCode={auditDialogTarget.code}
        onClose={() => setAuditDialogTarget(null)}
      />
    )}
    </>
  );
}
