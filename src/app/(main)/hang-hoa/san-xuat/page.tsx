"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { ListStrip } from "@/components/shared/list-strip";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import {
  FilterPanel,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  PersonFilter,
  RangeFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import { computeListPresetRange, STANDARD_LIST_PRESETS_WITH_ALL } from "@/lib/utils/list-date-preset-range";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import {
  CreateProductionOrderDialog,
  CompleteProductionOrderDialog,
  ConfirmDialog,
} from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { PipelineStatusBadge } from "@/components/shared/pipeline";
import { Button } from "@/components/ui/button";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildProductionOrderPrintData } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getProductionOrderListWorkspace,
  getProductionOrdersForExport,
  getProfilesForPersonFilter,
  getProductionOrderById,
  updateProductionStatus,
  cancelProductionOrder,
  canTransitionProductionStatus,
} from "@/lib/services";
import type { ProductionOrder, ProductionOrderStatus } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

type ViewMode = "list" | "kanban";

const SEARCH_FIELDS = [
  { value: "all", label: "Tất cả" },
  { value: "code", label: "Mã lệnh" },
  { value: "product_code", label: "Mã thành phẩm" },
  { value: "product_name", label: "Tên thành phẩm" },
  { value: "lot_number", label: "Số lô" },
  { value: "creator", label: "Người tạo" },
  { value: "note", label: "Ghi chú" },
];

const STATUS_META: Record<
  ProductionOrderStatus,
  { label: string; color: string }
> = {
  planned: { label: "Đã lên kế hoạch", color: "#94a3b8" },
  material_check: { label: "Kiểm tra NVL", color: "#f59e0b" },
  in_production: { label: "Đang sản xuất", color: "#004AC6" },
  quality_check: { label: "Kiểm chất lượng", color: "#8b5cf6" },
  completed: { label: "Hoàn thành", color: "#10b981" },
  cancelled: { label: "Đã hủy", color: "#ef4444" },
};

function ProductionOrderDetail({
  orderId,
  onClose,
  onDelete,
}: {
  orderId: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProductionOrderById(orderId)
      .then((o) => {
        if (!cancelled) setOrder(o);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading || !order) {
    return (
      <InlineDetailPanel open onClose={onClose}>
        <div className="p-6 text-center text-muted-foreground">Đang tải...</div>
      </InlineDetailPanel>
    );
  }

  const meta = STATUS_META[order.status];

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={onDelete}
      deleteLabel="Hủy"
    >
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={`Lệnh sản xuất ${order.code}`}
                  code={order.code}
                  subtitle={order.branchName ?? ""}
                  status={{
                    label: meta.label,
                    variant: "default",
                    className: "",
                  }}
                />
                <div className="flex items-center gap-2">
                  <PipelineStatusBadge name={meta.label} color={meta.color} />
                </div>
                <DetailInfoGrid
                  fields={[
                    { label: "Mã phiếu", value: order.code },
                    {
                      label: "Sản phẩm",
                      value: `${order.productCode} - ${order.productName}`,
                    },
                    {
                      label: "Số lượng kế hoạch",
                      value: <span className="font-semibold">{formatNumber(order.plannedQty)}</span>,
                    },
                    {
                      label: "Đã hoàn thành",
                      value: <span className="font-semibold">{formatNumber(order.completedQty)}</span>,
                    },
                    {
                      label: "Bắt đầu KH",
                      value: order.plannedStart ? formatDate(order.plannedStart) : "—",
                    },
                    {
                      label: "Kết thúc KH",
                      value: order.plannedEnd ? formatDate(order.plannedEnd) : "—",
                    },
                    {
                      label: "Số lô",
                      value: order.lotNumber ?? "—",
                    },
                    {
                      label: "Tổng giá vốn NVL",
                      value: order.cogsAmount
                        ? formatCurrency(order.cogsAmount)
                        : "—",
                    },
                    {
                      label: "Ghi chú",
                      value: order.notes ?? "—",
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "materials",
            label: "Nguyên vật liệu",
            content: (
              <div className="space-y-2">
                {(order.materials ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa có dữ liệu NVL
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">NVL</th>
                          <th className="text-right p-2 font-medium">Kế hoạch</th>
                          <th className="text-right p-2 font-medium">Thực tế</th>
                          <th className="text-right p-2 font-medium">Giá vốn/ĐV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(order.materials ?? []).map((m) => (
                          <tr key={m.id} className="border-t">
                            <td className="p-2">
                              <div className="font-medium">{m.productName}</div>
                              <div className="text-xs text-muted-foreground">
                                {m.productCode}
                              </div>
                            </td>
                            <td className="p-2 text-right">
                              {m.plannedQty} {m.unit}
                            </td>
                            <td className="p-2 text-right">
                              {m.actualQty || 0} {m.unit}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {m.unitCost != null ? formatCurrency(m.unitCost) : "—"}
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
              <AuditHistoryTab entityType="production_order" entityId={order.id} />
            ),
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

export default function SanXuatPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const txPerms = useTxRowPermissions("production");
  const [data, setData] = useState<ProductionOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completingOrder, setCompletingOrder] = useState<ProductionOrder | null>(null);
  const [cancellingItem, setCancellingItem] = useState<ProductionOrder | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [filterOpen, setFilterOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [qtyMin, setQtyMin] = useState("");
  const [qtyMax, setQtyMax] = useState("");
  const [creatorOptions, setCreatorOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [summary, setSummary] = useState({ inProgressCount: 0, completedTodayCount: 0, cancelledCount: 0, totalCogs: 0 });
  // Sprint UX-1 Stage 4: Audit log shortcut
  const [auditDialogTarget, setAuditDialogTarget] = useState<ProductionOrder | null>(null);

  const [statusFilters, setStatusFilters] = useState<string[]>([
    "planned",
    "material_check",
    "in_production",
    "quality_check",
    "completed",
  ]);

  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const duocXemToanChuoi = hasAny(["reports.view_all_branches", "system.manage_branches"]);
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);
  useEffect(() => { if (!duocXemToanChuoi) setViewAllBranches(false); }, [duocXemToanChuoi]);
  useEffect(() => { getProfilesForPersonFilter().then(setCreatorOptions).catch(() => setCreatorOptions([])); }, []);

  const fetchData = useCallback(async () => {
    if (permissionsLoading) return;
    if (!activeBranchId && !duocXemToanChuoi) { setData([]); setTotal(0); setOtherBranchCount(0); setLoading(false); return; }
    setLoading(true);
    try {
      // Branch-aware: chỉ lấy production orders của chi nhánh đang active
      // (Xưởng rang → coffee orders, Kho tổng → yaourt/siro orders).
      // viewAllBranches (cục bộ) → bỏ lọc chi nhánh, xem tất cả.
      const branchScope = duocXemToanChuoi && viewAllBranches ? undefined : activeBranchId || undefined;
      const range = datePreset === "custom" ? { from: dateFrom || undefined, to: dateTo || undefined } : computeListPresetRange(datePreset);
      const query = { search, searchField, statuses: statusFilters, dateFrom: range.from, dateTo: range.to, createdBy: creatorFilter || undefined, qtyMin: qtyMin ? Number(qtyMin) : undefined, qtyMax: qtyMax ? Number(qtyMax) : undefined, branchId: branchScope };
      const result = await getProductionOrderListWorkspace({ page, pageSize, ...query });
      const visibleRows = viewMode === "kanban" ? await getProductionOrdersForExport(query) : result.data;
      setData(visibleRows);
      setTotal(result.total);
      setSummary(result.summary);
      // Danh sách lọc client-side (search + trạng thái). Nếu SAU khi lọc mà rỗng
      // vì đang bó theo 1 chi nhánh → đếm lệnh khớp bộ lọc ở các chi nhánh khác.
      if (duocXemToanChuoi && !viewAllBranches && activeBranchId) {
        if (result.total === 0) {
          const all = await getProductionOrderListWorkspace({ page: 0, pageSize: 1, ...query, branchId: undefined });
          setOtherBranchCount(all.total);
        } else {
          setOtherBranchCount(0);
        }
      } else {
        setOtherBranchCount(0);
      }
    } catch (err) {
      toast({
        title: "Lỗi tải lệnh sản xuất",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, activeBranchId, viewAllBranches, search, searchField, statusFilters, datePreset, dateFrom, dateTo, creatorFilter, qtyMin, qtyMax, page, pageSize, viewMode, duocXemToanChuoi, permissionsLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => { setPage(0); setExpandedRow(null); }, [search, searchField, statusFilters, datePreset, dateFrom, dateTo, creatorFilter, qtyMin, qtyMax]);

  const filtered = data;
  const pagedData = data;
  const allStatuses = Object.keys(STATUS_META);
  const datePresetLabel = datePreset === "custom"
    ? `${dateFrom || "..."} đến ${dateTo || "..."}`
    : STANDARD_LIST_PRESETS_WITH_ALL.find((item) => item.value === datePreset)?.label ?? "Thời gian";
  const filterChips: ListFilterChip[] = [
    ...(datePreset !== "all" ? [{ key: "date", label: "Thời gian", value: datePresetLabel, onClear: () => { setDatePreset("all"); setDateFrom(""); setDateTo(""); } }] : []),
    ...(creatorFilter ? [{ key: "creator", label: "Người tạo", value: creatorOptions.find((item) => item.value === creatorFilter)?.label ?? "Đã chọn", onClear: () => setCreatorFilter("") }] : []),
    ...(qtyMin || qtyMax ? [{ key: "quantity", label: "SL kế hoạch", value: `${qtyMin || "0"} đến ${qtyMax || "không giới hạn"}`, onClear: () => { setQtyMin(""); setQtyMax(""); } }] : []),
    ...(statusFilters.length === allStatuses.length
      ? []
      : [
          {
            key: "status",
            label: "Trạng thái",
            value:
              statusFilters.length === 0
                ? "Không chọn"
                : statusFilters.map((status) => STATUS_META[status as ProductionOrderStatus]?.label ?? status).join(", "),
            onClear: () => setStatusFilters(allStatuses),
          },
        ]),
  ];

  const clearListFilters = () => { setStatusFilters(allStatuses); setDatePreset("all"); setDateFrom(""); setDateTo(""); setCreatorFilter(""); setQtyMin(""); setQtyMax(""); };

  const handleExport = async (type: "excel" | "csv") => {
    const range = datePreset === "custom" ? { from: dateFrom || undefined, to: dateTo || undefined } : computeListPresetRange(datePreset);
    const rows = await getProductionOrdersForExport({
      search, searchField, statuses: statusFilters, dateFrom: range.from, dateTo: range.to, createdBy: creatorFilter || undefined, qtyMin: qtyMin ? Number(qtyMin) : undefined, qtyMax: qtyMax ? Number(qtyMax) : undefined,
      branchId: duocXemToanChuoi && viewAllBranches ? undefined : activeBranchId || undefined,
    });
    const exportColumns = [
      { header: "Mã lệnh", key: "code", width: 16 },
      { header: "Chi nhánh", key: "branchName", width: 24 },
      { header: "Mã thành phẩm", key: "productCode", width: 18 },
      { header: "Tên thành phẩm", key: "productName", width: 28 },
      { header: "Số lô", key: "lotNumber", width: 18 },
      { header: "SL kế hoạch", key: "plannedQty", width: 14 },
      { header: "SL thực tế", key: "actualQty", width: 14 },
      { header: "Giá vốn", key: "cogsAmount", width: 16 },
      { header: "Trạng thái", key: "status", width: 18, format: (value: ProductionOrderStatus) => STATUS_META[value]?.label ?? value },
      { header: "Ngày tạo", key: "createdAt", width: 18, format: (value: string) => formatDate(value) },
      { header: "Ghi chú", key: "notes", width: 28 },
    ];
    if (type === "excel") exportToExcel(rows, exportColumns, "lenh-san-xuat"); else exportToCsv(rows, exportColumns, "lenh-san-xuat");
  };

  // Derive Kanban columns from STATUS_META (skip cancelled in the main board)
  const kanbanColumns: KanbanColumn<ProductionOrder>[] = (
    Object.keys(STATUS_META) as ProductionOrderStatus[]
  )
    .filter((s) => s !== "cancelled")
    .map((status) => ({
      id: status,
      label: STATUS_META[status].label,
      color: STATUS_META[status].color,
      items: filtered.filter((o) => o.status === status),
    }));

  const handleCardMove = async (
    itemId: string,
    _fromColumnId: string,
    toColumnId: string
  ) => {
    if (toColumnId === "completed") {
      const order = data.find((item) => item.id === itemId);
      if (order) {
        setCompletingOrder(order);
        setCompleteOpen(true);
      }
      return;
    }

    try {
      await updateProductionStatus(itemId, toColumnId);
      toast({
        title: "Đã chuyển trạng thái",
        description: STATUS_META[toColumnId as ProductionOrderStatus].label,
        variant: "success",
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Không thể chuyển trạng thái",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  const columns: ColumnDef<ProductionOrder, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 110,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "product",
      header: "Sản phẩm sản xuất",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{row.original.productCode}</div>
        </div>
      ),
    },
    {
      id: "qty",
      header: "Số lượng",
      size: 130,
      cell: ({ row }) => (
        <span>
          <span className="font-medium">{formatNumber(row.original.completedQty)}</span>
          <span className="text-muted-foreground"> / {formatNumber(row.original.plannedQty)}</span>
        </span>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 150,
      cell: ({ row }) => row.original.branchName ?? "—",
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 160,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return <PipelineStatusBadge name={meta.label} color={meta.color} size="sm" />;
      },
    },
  ];

  return (
    <>
      <ListPageLayout sidebar={null}>
        <PageHeader
          title="Lệnh sản xuất"
          searchPlaceholder="Theo mã phiếu, sản phẩm..."
          searchValue={search}
          onSearchChange={setSearch}
          searchFields={SEARCH_FIELDS}
          searchField={searchField}
          onSearchFieldChange={setSearchField}
          onExport={{ excel: () => handleExport("excel"), csv: () => handleExport("csv") }}
          density="compact"
          actions={[
            {
              label: viewMode === "list" ? "Xem Kanban" : "Xem danh sách",
              icon:
                viewMode === "list" ? (
                  <Icon name="view_kanban" size={16} />
                ) : (
                  <Icon name="list" size={16} />
                ),
              variant: "outline",
              onClick: () =>
                setViewMode(viewMode === "list" ? "kanban" : "list"),
            },
            {
              label: "Tạo lệnh SX",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
          ]}
        />

        <ListStrip
          metrics={
            <>
              <ListMetric label="Tổng lệnh SX" value={formatNumber(total)} hint="Toàn bộ kết quả lọc" icon={<Icon name="factory" size={15} />} />
              <ListMetric label="Đang sản xuất" value={formatNumber(summary.inProgressCount)} tone={summary.inProgressCount > 0 ? "primary" : "default"} icon={<Icon name="precision_manufacturing" size={15} />} />
              <ListMetric label="Hoàn thành hôm nay" value={formatNumber(summary.completedTodayCount)} hint={`${summary.cancelledCount} lệnh đã hủy`} icon={<Icon name="check_circle" size={15} />} />
              <ListMetric label="Tổng giá vốn SX" value={formatCurrency(summary.totalCogs)} hint="Toàn bộ kết quả lọc" icon={<Icon name="payments" size={15} />} />
            </>
          }
          tools={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
              onClick={() => setFilterOpen(true)}
            >
              <Icon name="filter_alt" size={15} />
              <span className="hidden sm:inline">Bộ lọc</span>
              {filterChips.length > 0 && (
                <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {filterChips.length}
                </span>
              )}
            </Button>
          }
        />
        {filterChips.length > 0 && (
          <FilterChips filters={filterChips} onClearAll={clearListFilters} />
        )}

        {viewAllBranches && (
          <AllBranchesBanner
            branchName={currentBranch?.name}
            onBackToBranch={() => setViewAllBranches(false)}
          />
        )}

        {/* Empty-state mặc định — nhường chỗ cho DataTable (emptyBranchHint) khi
            trống vì lọc chi nhánh mà chi nhánh khác có lệnh, để hiện gợi ý. */}
        {!loading && filtered.length === 0 && otherBranchCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Icon name="factory" size={48} className="mb-3 opacity-30" />
            <p className="text-sm">Chưa có lệnh sản xuất nào</p>
            <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
              <Icon name="add" size={16} className="mr-1" />
              Tạo lệnh đầu tiên
            </Button>
          </div>
        ) : viewMode === "kanban" ? (
          <div className="p-4">
            <KanbanBoard
              columns={kanbanColumns}
              getItemId={(o) => o.id}
              onCardMove={handleCardMove}
              canDrop={(_id, from, to) =>
                canTransitionProductionStatus(from, to)
              }
              emptyMessage="Không có lệnh"
              renderCard={(order) => (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-primary text-xs">
                      {order.code}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(order.createdAt)}
                    </span>
                  </div>
                  <div className="text-sm font-medium truncate">
                    {order.productName ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {order.branchName ?? "—"}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t mt-1">
                    <span className="text-xs text-muted-foreground">
                      SL kế hoạch
                    </span>
                    <span className="text-xs font-semibold">
                      {formatNumber(order.completedQty)} / {formatNumber(order.plannedQty)}
                    </span>
                  </div>
                </div>
              )}
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={pagedData}
            loading={loading}
            density="compact"
            total={total}
            emptyBranchHint={duocXemToanChuoi ? {
              otherBranchCount,
              onViewAllBranches: () => setViewAllBranches(true),
              entityLabel: "lệnh sản xuất",
            } : undefined}
            pageIndex={page}
            pageSize={pageSize}
            pageCount={Math.ceil(total / pageSize)}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            expandedRow={expandedRow}
            onExpandedRowChange={setExpandedRow}
            renderDetail={(item, onClose) => (
              <ProductionOrderDetail
                orderId={item.id}
                onClose={onClose}
                onDelete={
                  item.status !== "completed" && item.status !== "cancelled"
                    ? () => setCancellingItem(item)
                    : undefined
                }
              />
            )}
            getRowId={(row) => row.id}
            rowActions={(row) =>
              buildTransactionRowActions({
                row,
                kind: "production",
                permissions: txPerms,
                onPrint: () =>
                  printDocumentWithTemplate({
                    channel: "backoffice",
                    docType: "production_order",
                    branchId: activeBranchId ?? null,
                    base: buildProductionOrderPrintData({
                      id: row.id,
                      code: row.code,
                      date: row.createdAt,
                      productName: row.productName ?? "",
                      productCode: row.productCode ?? "",
                      quantity: row.plannedQty,
                      status: row.status as
                        | "completed"
                        | "processing"
                        | "cancelled",
                      statusName: STATUS_META[row.status]?.label ?? row.status,
                      costAmount: 0,
                      createdBy: row.createdBy ?? "",
                    }),
                  }),
                // Workflow: "Hoàn thành" specific cho production
                workflowActions:
                  row.status !== "completed" && row.status !== "cancelled"
                    ? [
                        {
                          label: "Hoàn thành",
                          icon: <Icon name="check_circle" size={16} />,
                          onClick: () => {
                            setCompletingOrder(row);
                            setCompleteOpen(true);
                          },
                        },
                      ]
                    : [],
                onAuditLog: () => setAuditDialogTarget(row),
                onCancel: canTransitionProductionStatus(row.status, "cancelled")
                  ? () => setCancellingItem(row)
                  : undefined,
              })
            }
          />
        )}

        <FilterPanel
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={filterChips.length}
          onClearAll={clearListFilters}
          title="Bộ lọc lệnh sản xuất"
        >
          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={Object.entries(STATUS_META).map(([value, meta]) => ({
                label: meta.label,
                value,
              }))}
              selected={statusFilters}
              onChange={setStatusFilters}
            />
          </FilterGroup>
          <FilterGroup label="Ngày tạo">
            <DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS_WITH_ALL} />
          </FilterGroup>
          <FilterGroup label="Người tạo" activeHint={creatorOptions.find((item) => item.value === creatorFilter)?.label}><PersonFilter value={creatorFilter} onChange={setCreatorFilter} placeholder="Chọn người tạo" suggestions={creatorOptions} /></FilterGroup>
          <FilterGroup label="Số lượng kế hoạch" activeHint={qtyMin || qtyMax ? "Đang lọc" : undefined}><RangeFilter fromValue={qtyMin} toValue={qtyMax} onFromChange={setQtyMin} onToChange={setQtyMax} fromPlaceholder="Tối thiểu" toPlaceholder="Tối đa" /></FilterGroup>
        </FilterPanel>
      </ListPageLayout>

      <CreateProductionOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <CompleteProductionOrderDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        order={completingOrder}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy lệnh sản xuất"
        description={`Bạn có chắc muốn hủy lệnh sản xuất ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
        confirmLabel="Hủy lệnh"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            // Hủy qua RPC nguyên tử: hoàn NVL, cập nhật trạng thái và audit
            // trong cùng một giao dịch. RPC lỗi thì toàn bộ thao tác dừng.
            const result = await cancelProductionOrder(
              cancellingItem.id,
              "Hủy từ UI quản lý sản xuất",
            );
            const revertNote =
              result.revertedMaterialsQty > 0
                ? ` Đã hoàn ${formatNumber(result.revertedMaterialsQty)} đơn vị NVL về kho.`
                : "";
            toast({
              title: "Đã hủy lệnh sản xuất",
              description: `Lệnh ${cancellingItem.code} đã được hủy.${revertNote}`,
              variant: "success",
            });
            await fetchData();
          } catch (err) {
            toast({
              title: "Lỗi hủy lệnh sản xuất",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />
      {auditDialogTarget && (
        <AuditLogDialog
          entityType="production_order"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

      {/* total counter to avoid unused var lint */}
      <span className="hidden">{total}</span>
    </>
  );
}
