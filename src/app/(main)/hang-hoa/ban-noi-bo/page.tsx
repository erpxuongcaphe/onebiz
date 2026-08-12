"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
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
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import type { ItemColumn } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import {
  phamViBanNoiBo,
  getInternalSalesTheoPhamVi,
  getInternalSaleById,
  getInternalSalesForExport,
  getInternalSaleListWorkspace,
  cancelInternalSale,
  getBranches,
  getProfilesForPersonFilter,
} from "@/lib/services";
import { CreateInternalSaleDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { usePermissions, useTxRowPermissions } from "@/lib/permissions";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { internalSaleExcelSchema } from "@/lib/excel/schemas";
import { bulkImportInternalSales } from "@/lib/services/supabase/excel-import";
import { exportToExcelFromSchema } from "@/lib/excel";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildInternalSalePrintData, toPrintLines } from "@/lib/print-templates";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface InternalSaleRow {
  id: string;
  code: string;
  fromBranchId: string;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchCode: string;
  toBranchName: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  subtotal: number;
  taxAmount: number;
  total: number;
  note?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

interface InternalSaleItemDetail {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  amount: number;
}

/* ------------------------------------------------------------------ */
/*  Status config — Stitch tokens thay vì hex                           */
/* ------------------------------------------------------------------ */

type StatusKey = "draft" | "confirmed" | "completed" | "cancelled";

const STATUS_META: Record<
  StatusKey,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    // Dùng utility class thay vì inline hex để theo Stitch tokens.
    badgeClass: string;
  }
> = {
  draft: {
    label: "Nháp",
    variant: "outline",
    badgeClass: "bg-muted text-muted-foreground border-muted-foreground/25",
  },
  confirmed: {
    label: "Xác nhận",
    variant: "outline",
    badgeClass: "bg-primary-fixed text-primary border-primary/30",
  },
  completed: {
    label: "Hoàn thành",
    variant: "outline",
    badgeClass: "bg-status-success/10 text-status-success border-status-success/25",
  },
  cancelled: {
    label: "Đã hủy",
    variant: "outline",
    badgeClass: "bg-destructive/10 text-destructive border-destructive/25",
  },
};

const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const SEARCH_FIELDS = [
  { value: "code", label: "Mã phiếu nội bộ" },
  { value: "from_branch_name", label: "Tên chi nhánh bán" },
  { value: "from_branch_code", label: "Mã chi nhánh bán" },
  { value: "to_branch_name", label: "Tên chi nhánh mua" },
  { value: "to_branch_code", label: "Mã chi nhánh mua" },
  { value: "product_name", label: "Tên sản phẩm" },
  { value: "product_code", label: "Mã sản phẩm" },
  { value: "creator_name", label: "Người tạo" },
  { value: "note", label: "Ghi chú" },
];

/* ------------------------------------------------------------------ */
/*  Detail panel                                                        */
/* ------------------------------------------------------------------ */

function InternalSaleDetail({
  item,
  onClose,
  onCancel,
}: {
  item: InternalSaleRow;
  onClose: () => void;
  onCancel?: () => void;
}) {
  const meta = STATUS_META[item.status];

  const [detail, setDetail] = useState<{ items?: InternalSaleItemDetail[] } | null>(null);
  useEffect(() => {
    getInternalSaleById(item.id)
      .then((d) => setDetail(d as { items?: InternalSaleItemDetail[] }))
      .catch(() => {});
  }, [item.id]);

  const itemColumns: ItemColumn<InternalSaleItemDetail>[] = [
    {
      header: "Sản phẩm",
      accessor: (it) => (
        <div>
          <div className="font-medium">{it.productName}</div>
          <div className="text-xs text-muted-foreground">
            {it.productCode} · {it.unit}
          </div>
        </div>
      ),
    },
    { header: "SL", accessor: "quantity", align: "right", className: "w-16" },
    {
      header: "Đơn giá",
      accessor: (it) => formatCurrency(it.unitPrice),
      align: "right",
      className: "w-28",
    },
    {
      header: "VAT",
      accessor: (it) => `${it.vatRate}%`,
      align: "right",
      className: "w-16",
    },
    {
      header: "Thành tiền",
      accessor: (it) => (
        <span className="font-medium">{formatCurrency(it.amount)}</span>
      ),
      align: "right",
      className: "w-32",
    },
  ];

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Đơn nội bộ ${item.code}`}
            code={item.code}
            status={{
              label: meta.label,
              variant: meta.variant,
              className: meta.badgeClass,
            }}
            subtitle={`${item.fromBranchName || "—"} → ${item.toBranchName || "—"}`}
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo:{" "}
                  <strong>{formatUser(item.createdByName, item.createdBy)}</strong>
                </span>
                <span>
                  Thời gian: <strong>{formatDate(item.createdAt)}</strong>
                </span>
              </div>
            }
          />
          <DetailInfoGrid
            fields={[
              { label: "Mã đơn", value: item.code },
              { label: "Trạng thái", value: meta.label },
              { label: "Bên bán", value: item.fromBranchName || "—" },
              { label: "Bên mua", value: item.toBranchName || "—" },
              { label: "Tạm tính", value: formatCurrency(item.subtotal) },
              { label: "Thuế VAT", value: formatCurrency(item.taxAmount) },
              { label: "Tổng cộng", value: formatCurrency(item.total) },
              { label: "Ghi chú", value: item.note || "—" },
            ]}
          />
        </div>
      ),
    },
    {
      id: "items",
      label: `Sản phẩm${detail?.items ? ` (${detail.items.length})` : ""}`,
      content: detail?.items ? (
        <DetailItemsTable
          columns={itemColumns}
          items={detail.items}
          summary={[
            { label: "Tạm tính", value: formatCurrency(item.subtotal) },
            { label: "Thuế VAT", value: formatCurrency(item.taxAmount) },
            {
              label: "Tổng cộng",
              value: formatCurrency(item.total),
              className: "text-base font-bold text-primary",
            },
          ]}
        />
      ) : (
        <div className="p-4 text-center text-sm text-muted-foreground">
          Đang tải sản phẩm...
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="internal_sale" entityId={item.id} />,
    },
  ];

  const canCancel =
    (item.status === "draft" || item.status === "confirmed") && !!onCancel;

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={canCancel ? onCancel : undefined}
      deleteLabel="Hủy đơn"
    >
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page component                                                      */
/* ------------------------------------------------------------------ */

export default function InternalSalePage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch, isReady: branchReady } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const txPerms = useTxRowPermissions("internal_sale");
  const [data, setData] = useState<InternalSaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [searchField, setSearchField] = useState("code");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fromBranchId, setFromBranchId] = useState("all");
  const [toBranchId, setToBranchId] = useState("all");
  const [createdBy, setCreatedBy] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [branchOptions, setBranchOptions] = useState<
    { label: string; value: string }[]
  >([{ label: "Tất cả", value: "all" }]);
  const [creatorOptions, setCreatorOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<InternalSaleRow | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  // Sprint UX-1 Stage 4: Audit log shortcut + In phiếu (anomaly fix)
  const [auditDialogTarget, setAuditDialogTarget] = useState<InternalSaleRow | null>(null);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const requestSequence = useRef(0);
  const [summary, setSummary] = useState({ completedCount: 0, cancelledCount: 0, totalValue: 0, completedValue: 0, taxValue: 0 });

  const duocXemToanChuoi = hasAny([
    "reports.view_all_branches",
    "system.manage_branches",
  ]);

  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  useEffect(() => {
    if (!duocXemToanChuoi) setViewAllBranches(false);
  }, [duocXemToanChuoi]);

  useEffect(() => {
    if (!branchReady) return;
    Promise.all([getBranches(), getProfilesForPersonFilter()])
      .then(([branches, profiles]) => {
        setBranchOptions([
          { label: "Tất cả", value: "all" },
          ...branches.map((branch) => ({
            label: branch.code ? `${branch.code} · ${branch.name}` : branch.name,
            value: branch.id,
          })),
        ]);
        setCreatorOptions(profiles);
      })
      .catch(() => {
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
      ...(amountMin && { amountMin }),
      ...(amountMax && { amountMax }),
    }),
    [
      amountMax,
      amountMin,
      createdBy,
      dateRange.from,
      dateRange.to,
      fromBranchId,
      statusFilter,
      toBranchId,
    ],
  );

  const phamVi = useMemo(
    () =>
      phamViBanNoiBo({
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
      const result = phamVi.mode === "none" ? { data: [], total: 0, summary: { completedCount: 0, cancelledCount: 0, totalValue: 0, completedValue: 0, taxValue: 0 } } : await getInternalSaleListWorkspace({
        page, pageSize, search: debouncedSearch || undefined, searchField, statuses: statusFilter,
        dateFrom: dateRange.from, dateTo: dateRange.to,
        fromBranchId: fromBranchId !== "all" ? fromBranchId : undefined,
        toBranchId: toBranchId !== "all" ? toBranchId : undefined, createdBy: createdBy || undefined,
        amountMin: amountMin ? Number(amountMin) : undefined, amountMax: amountMax ? Number(amountMax) : undefined,
        branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
      });
      if (requestId !== requestSequence.current) return;
      setData(result.data as InternalSaleRow[]);
      setTotal(result.total);
      setSummary(result.summary);

      const count = result.data.length === 0 && phamVi.mode === "branch" && duocXemToanChuoi
        ? Math.max(0, (await getInternalSaleListWorkspace({
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
            amountMin: amountMin ? Number(amountMin) : undefined,
            amountMax: amountMax ? Number(amountMax) : undefined,
          })).total - result.total)
        : 0;
      if (requestId === requestSequence.current) setOtherBranchCount(count);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      toast({
        title: "Không tải được danh sách bán nội bộ",
        description: error instanceof Error ? error.message : "Lỗi không xác định",
        variant: "error",
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
    fromBranchId,
    searchField,
    statusFilter,
    toBranchId,
  ]);

  const pageCompletedCount = data.filter((item) => item.status === "completed").length;
  const pageTotalAmount = data.reduce((sum, item) => sum + item.total, 0);
  const pageCompletedAmount = data
    .filter((item) => item.status === "completed")
    .reduce((sum, item) => sum + item.total, 0);
  const pageTaxAmount = data.reduce((sum, item) => sum + item.taxAmount, 0);

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
    setAmountMin("");
    setAmountMax("");
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
          .map((value) => STATUS_META[value as StatusKey]?.label ?? value)
          .join(", "),
        onClear: () => setStatusFilter([]),
      });
    }
    if (fromBranchId !== "all") {
      chips.push({
        key: "fromBranch",
        label: "Chi nhánh bán",
        value:
          branchOptions.find((option) => option.value === fromBranchId)?.label ??
          "Đã chọn",
        onClear: () => setFromBranchId("all"),
      });
    }
    if (toBranchId !== "all") {
      chips.push({
        key: "toBranch",
        label: "Chi nhánh mua",
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
    if (amountMin || amountMax) {
      chips.push({
        key: "amount",
        label: "Tổng tiền",
        value: `${amountMin ? formatCurrency(Number(amountMin)) : "0 ₫"} đến ${
          amountMax ? formatCurrency(Number(amountMax)) : "không giới hạn"
        }`,
        onClear: () => {
          setAmountMin("");
          setAmountMax("");
        },
      });
    }
    return chips;
  }, [
    amountMax,
    amountMin,
    branchOptions,
    createdBy,
    creatorOptions,
    datePreset,
    datePresetLabel,
    fromBranchId,
    statusFilter,
    toBranchId,
  ]);

  const columns: ColumnDef<InternalSaleRow>[] = [
    {
      accessorKey: "code",
      header: "Mã đơn",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Thời gian",
      size: 140,
      cell: ({ row }) => (
        <span className="text-sm">{formatDate(row.original.createdAt)}</span>
      ),
    },
    {
      id: "flow",
      header: "Bên bán → bên mua",
      size: 330,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-sm">
          <span
            className="font-medium truncate max-w-[135px]"
            title={`${row.original.fromBranchCode} · ${row.original.fromBranchName}`}
          >
            {[row.original.fromBranchCode, row.original.fromBranchName]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
          <Icon name="arrow_forward" size={14} className="text-muted-foreground shrink-0" />
          <span
            className="font-medium truncate max-w-[135px]"
            title={`${row.original.toBranchCode} · ${row.original.toBranchName}`}
          >
            {[row.original.toBranchCode, row.original.toBranchName]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "subtotal",
      header: "Tạm tính",
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm">{formatCurrency(row.original.subtotal)}</span>
      ),
    },
    {
      accessorKey: "taxAmount",
      header: "VAT",
      size: 110,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatCurrency(row.original.taxAmount)}
        </span>
      ),
    },
    {
      accessorKey: "total",
      header: "Tổng tiền",
      size: 130,
      cell: ({ row }) => (
        <span className="font-semibold">{formatCurrency(row.original.total)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 120,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return (
          <Badge variant={meta.variant} className={meta.badgeClass}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdByName",
      header: "Người tạo",
      size: 140,
      cell: ({ row }) => (
        <span className="text-sm">
          {formatUser(row.original.createdByName, row.original.createdBy)}
        </span>
      ),
    },
  ];

  async function handleCancel() {
    if (!cancellingItem) return;
    setCancelLoading(true);
    try {
      await cancelInternalSale(cancellingItem.id);
      toast({
        title: "Đã hủy đơn nội bộ",
        description: `Đơn ${cancellingItem.code} đã được hủy thành công.`,
        variant: "success",
      });
      await fetchData();
    } catch (err) {
      toast({
        title: "Lỗi hủy đơn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setCancelLoading(false);
      setCancellingItem(null);
    }
  }

  return (
    <>
      <ListPageLayout sidebar={null}>
        <PageHeader
          title="Bán nội bộ chuỗi"
          density="compact"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Nhập nội dung tìm kiếm"
          searchFields={SEARCH_FIELDS}
          searchField={searchField}
          onSearchFieldChange={setSearchField}
          onExport={{
            excel: async () => {
              if (phamVi.mode === "none") return;
              try {
                toast({
                  title: "Đang chuẩn bị file Excel…",
                  description: "Tải tất cả dòng hàng theo bộ lọc hiện tại",
                  variant: "info",
                });
                const rows = await getInternalSalesForExport({
                  search: debouncedSearch || undefined,
                  searchField,
                  filters: commonFilters,
                  branchId:
                    phamVi.mode === "branch" ? phamVi.branchId : undefined,
                });
                if (rows.length === 0) {
                  toast({ title: "Không có dữ liệu để xuất", variant: "info" });
                  return;
                }
                exportToExcelFromSchema(rows, internalSaleExcelSchema);
              } catch (err) {
                toast({
                  title: "Lỗi xuất Excel",
                  description: err instanceof Error ? err.message : "Vui lòng thử lại",
                  variant: "error",
                });
              }
            },
          }}
          actions={[
            {
              label: "Tạo đơn nội bộ",
              icon: <Icon name="add" size={16} />,
              onClick: () => setShowCreate(true),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload_file" size={16} />,
              variant: "outline",
              onClick: () => setImportOpen(true),
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
                icon={<Icon name="swap_horiz" size={15} />}
                label="Kết quả"
                value={formatNumber(total)}
                hint="Tổng số phiếu theo toàn bộ bộ lọc"
              />
              <ListMetric
                icon={<Icon name="receipt_long" size={15} />}
                label="Tổng giá trị"
                value={formatCurrency(summary.totalValue)}
                hint="Toàn bộ kết quả lọc"
                tone="primary"
              />
              <ListMetric
                icon={<Icon name="task_alt" size={15} />}
                label="Hoàn thành"
                value={`${formatNumber(summary.completedCount)} · ${formatCurrency(summary.completedValue)}`}
                hint={`${summary.cancelledCount} phiếu đã hủy`}
              />
              <ListMetric
                icon={<Icon name="percent" size={15} />}
                label="Tổng VAT"
                value={formatCurrency(summary.taxValue)}
                hint="Toàn bộ kết quả lọc"
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
          defaultColumnVisibility={{
            subtotal: false,
            taxAmount: false,
            createdByName: false,
          }}
          emptyTitle={
            chuaCoPhamVi
              ? "Chưa có chi nhánh làm việc"
              : "Không tìm thấy phiếu bán nội bộ"
          }
          emptyDescription={
            chuaCoPhamVi
              ? "Hãy chọn một chi nhánh hoặc dùng quyền xem toàn chuỗi."
              : "Thử thay đổi thời gian, trạng thái, chi nhánh hoặc nội dung tìm kiếm."
          }
          emptyIcon={chuaCoPhamVi ? "apartment" : "swap_horiz"}
          emptyBranchHint={
            duocXemToanChuoi
              ? {
                  otherBranchCount,
                  onViewAllBranches: () => setViewAllBranches(true),
                  entityLabel: "phiếu bán nội bộ",
                }
              : undefined
          }
          pageSize={pageSize}
          pageIndex={page}
          pageCount={Math.ceil(total / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          summaryRow={{
            subtotal: formatCurrency(data.reduce((sum, item) => sum + item.subtotal, 0)),
            taxAmount: formatCurrency(pageTaxAmount),
            total: formatCurrency(pageTotalAmount),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(row, onClose) => (
            <InternalSaleDetail
              item={row}
              onClose={onClose}
              onCancel={
                row.status !== "completed" && row.status !== "cancelled"
                  ? () => setCancellingItem(row)
                  : undefined
              }
            />
          )}
          rowActions={(row) =>
            buildTransactionRowActions({
              row,
              kind: "internal_sale",
              permissions: txPerms,
              onView: () => {
                const idx = data.findIndex((d) => d.id === row.id);
                setExpandedRow(expandedRow === idx ? null : idx);
              },
              // Anomaly fix Stage 5c: thêm In phiếu (trước đây thiếu)
              // Nạp chi tiết hàng trước rồi mới in (item dùng field `amount`).
              onPrint: async () => {
                const detail = await getInternalSaleById(row.id);
                const lines = toPrintLines(
                  detail.items.map((it) => ({ ...it, total: it.amount })),
                );
                await printDocumentWithTemplate({
                  channel: "backoffice",
                  docType: "internal_sale",
                  branchId: activeBranchId ?? null,
                  base: buildInternalSalePrintData(row, lines),
                });
              },
              onAuditLog: () => setAuditDialogTarget(row),
              onCancel:
                row.status !== "completed" && row.status !== "cancelled"
                  ? () => setCancellingItem(row)
                  : undefined,
            })
          }
        />

        <FilterPanel
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={filterChips.length}
          onClearAll={clearListFilters}
          title="Bộ lọc bán nội bộ"
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
            label="Chi nhánh bán"
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
            label="Chi nhánh mua"
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
            label="Tổng tiền"
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
        </FilterPanel>
      </ListPageLayout>

      <CreateInternalSaleDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => {
          if (!open && !cancelLoading) setCancellingItem(null);
        }}
        title="Hủy đơn nội bộ"
        description={`Bạn có chắc muốn hủy đơn ${cancellingItem?.code ?? ""}? Chỉ đơn nháp hoặc đã xác nhận mới được hủy; thao tác này không làm thay đổi tồn kho.`}
        confirmLabel="Hủy đơn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={handleCancel}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={internalSaleExcelSchema}
        onCommit={bulkImportInternalSales}
        onFinished={() => {
          setPage(1);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách đơn bán nội bộ đã được cập nhật.",
            variant: "success",
          });
        }}
      />

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="internal_sale"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}
    </>
  );
}
