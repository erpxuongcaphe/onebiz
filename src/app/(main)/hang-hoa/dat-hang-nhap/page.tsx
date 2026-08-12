"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
  SelectFilter,
  DatePresetFilter,
  RangeFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
// CEO 06/06/2026 Phase 4: migrate khỏi legacy DateRangeFilter
import { computeListPresetRange, STANDARD_LIST_PRESETS_WITH_ALL } from "@/lib/utils/list-date-preset-range";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildPurchaseEntryPrintData, toPrintLines } from "@/lib/print-templates";
import {
  getPurchaseOrderListWorkspace,
  getPurchaseOrdersForExport,
  getPurchaseEntryStatuses,
  cancelPurchaseOrderEntry,
  getPurchaseOrderItems,
} from "@/lib/services";
import { ConfirmDialog } from "@/components/shared/dialogs";
// PERF (CEO 23/05/2026): Lazy-load CreatePurchaseEntryDialog (630 dòng).
import dynamic from "next/dynamic";
const CreatePurchaseEntryDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-purchase-entry-dialog").then(
      (m) => m.CreatePurchaseEntryDialog,
    ),
  { ssr: false },
);
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { purchaseOrderExcelSchema } from "@/lib/excel/schemas";
import { bulkImportPurchaseOrders } from "@/lib/services/supabase/excel-import";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import { DocumentNoteBox } from "@/components/shared/document-note-box";
import type { PurchaseOrderEntry } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

// === Status config ===
const statusMap: Record<
  PurchaseOrderEntry["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Chờ nhập", variant: "secondary" },
  partial: { label: "Nhập một phần", variant: "outline" },
  completed: { label: "Hoàn thành", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = getPurchaseEntryStatuses();

// === Inline Detail ===
function PurchaseOrderEntryDetail({
  item,
  onClose,
  onDelete,
}: {
  item: PurchaseOrderEntry;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const st = statusMap[item.status];
  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Đặt hàng nhập ${item.code}`}
            code={item.code}
            status={{ label: st.label, variant: st.variant }}
            subtitle={item.branchName ?? "Chưa xác định chi nhánh"}
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{formatUser(item.createdByName, item.createdBy)}</strong>
                </span>
                <span>
                  Ngày tạo: <strong>{formatDate(item.date)}</strong>
                </span>
              </div>
            }
          />
          <DetailInfoGrid
            fields={[
              { label: "Mã đặt hàng", value: item.code },
              { label: "Ngày đặt", value: formatDate(item.date) },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền", value: formatCurrency(item.totalAmount) },
              { label: "Ngày dự kiến nhận", value: formatDate(item.expectedDate) },
              { label: "Trạng thái", value: st.label },
              { label: "Người tạo", value: formatUser(item.createdByName, item.createdBy) },
            ]}
          />

          {/* 06/08: ghi chú phiếu đặt NCC — trước đây không hiện trong chi tiết. */}
          <DocumentNoteBox note={item.note} />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="purchase_order" entityId={item.id} />,
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

// === Columns ===
const columns: ColumnDef<PurchaseOrderEntry, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã đặt hàng",
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
    accessorKey: "supplierName",
    header: "NCC",
    size: 220,
  },
  {
    accessorKey: "branchName",
    header: "Chi nhánh",
    size: 170,
    cell: ({ row }) => row.original.branchName ?? "---",
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "expectedDate",
    header: "Ngày dự kiến nhận",
    size: 150,
    cell: ({ row }) => formatDate(row.original.expectedDate),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    size: 130,
    cell: ({ row }) => {
      const { label, variant } = statusMap[row.original.status];
      return <Badge variant={variant}>{label}</Badge>;
    },
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm">
        {formatUser(row.original.createdByName, row.original.createdBy)}
      </span>
    ),
  },
];

export default function DatHangNhapPage() {
  const { activeBranchId, isReady: branchReady } = useBranchFilter();
  const { isLoading: permissionsLoading } = usePermissions();
  const txPerms = useTxRowPermissions("purchase_order");
  const [data, setData] = useState<PurchaseOrderEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [cancellingItem, setCancellingItem] = useState<PurchaseOrderEntry | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<PurchaseOrderEntry | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [summary, setSummary] = useState({
    outstandingCount: 0,
    outstandingValue: 0,
    completedCount: 0,
    cancelledCount: 0,
  });

  const fetchData = useCallback(async () => {
    if (!branchReady || permissionsLoading) return;
    setLoading(true);
    // Không có try/finally thì truy vấn lỗi là cờ loading không bao giờ tắt →
    // trang treo mãi ở vòng xoay, người dùng không biết vì sao.
    try {
    const presetRange = computeListPresetRange(datePreset);
    const effectiveDateFrom = datePreset === "custom" ? dateFrom : presetRange.from;
    const effectiveDateTo = datePreset === "custom" ? dateTo : presetRange.to;
    const result = await getPurchaseOrderListWorkspace({
      page,
      pageSize,
      search,
      searchField,
      status: statusFilter,
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined,
      branchId: activeBranchId,
    });
    setData(result.data);
    setTotal(result.total);
    setSummary(result.summary);
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách đơn đặt hàng nhập",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, amountMax, amountMin, branchReady, dateFrom, datePreset, dateTo, page, pageSize, permissionsLoading, search, searchField, statusFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [activeBranchId, amountMax, amountMin, search, searchField, statusFilter, datePreset, dateFrom, dateTo]);
  const datePresetLabel = useMemo(() => {
    if (datePreset === "all") return "Tất cả thời gian";
    if (datePreset === "custom") return !dateFrom && !dateTo ? "Tùy chỉnh" : `${dateFrom || "..."} đến ${dateTo || "..."}`;
    return STANDARD_LIST_PRESETS_WITH_ALL.find((item) => item.value === datePreset)?.label ?? "Thời gian";
  }, [dateFrom, datePreset, dateTo]);
  const clearListFilters = useCallback(() => { setStatusFilter("all"); setDatePreset("all"); setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax(""); }, []);
  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (datePreset !== "all") chips.push({ key: "date", label: "Thời gian", value: datePresetLabel, onClear: () => { setDatePreset("all"); setDateFrom(""); setDateTo(""); } });
    if (statusFilter !== "all") chips.push({ key: "status", label: "Trạng thái", value: statusOptions.find((item) => item.value === statusFilter)?.label ?? statusFilter, onClear: () => setStatusFilter("all") });
    if (amountMin || amountMax) chips.push({ key: "amount", label: "Giá trị", value: `${amountMin ? formatCurrency(Number(amountMin)) : "0 ₫"} - ${amountMax ? formatCurrency(Number(amountMax)) : "không giới hạn"}`, onClear: () => { setAmountMin(""); setAmountMax(""); } });
    return chips;
  }, [amountMax, amountMin, datePreset, datePresetLabel, statusFilter]);
  const emptyState =
    search.trim() || datePreset !== "all" || filterChips.length > 0
      ? "no-results"
      : "no-data";

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Đặt hàng nhập"
        density="compact"
        searchPlaceholder="Theo mã đơn, mã/tên NCC, ghi chú"
        searchValue={search}
        onSearchChange={setSearch}
        searchFields={[
          { value: "all", label: "Tất cả" },
          { value: "code", label: "Mã đơn" },
          { value: "supplier", label: "Nhà cung cấp" },
          { value: "note", label: "Ghi chú" },
        ]}
        searchField={searchField}
        onSearchFieldChange={(value) => {
          setSearchField(value);
          setPage(0);
        }}
        onExport={{
          excel: async () => {
            // Export theo schema Import → mỗi dòng = 1 line item, gộp theo "code"
            // User có thể edit + upload lại mà không mất field nào (round-trip)
            try {
              toast({
                title: "Đang chuẩn bị file Excel…",
                description: "Tải tất cả dòng hàng theo bộ lọc hiện tại",
                variant: "info",
              });
              const rows = await getPurchaseOrdersForExport({
                search: search || undefined,
                status: statusFilter !== "all" ? statusFilter : undefined,
              });
              if (rows.length === 0) {
                toast({ title: "Không có dữ liệu để xuất", variant: "info" });
                return;
              }
              exportToExcelFromSchema(rows, purchaseOrderExcelSchema);
            } catch (err) {
              toast({
                title: "Lỗi xuất Excel",
                description: err instanceof Error ? err.message : "Vui lòng thử lại",
                variant: "error",
              });
            }
          },
          csv: () => {
            const cols = [
              { header: "Mã", key: "code", width: 15 },
              { header: "Ngày", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "NCC", key: "supplierName", width: 25 },
              { header: "Tổng tiền", key: "totalAmount", width: 18, format: (v: number) => v },
              { header: "Trạng thái", key: "statusName", width: 15 },
            ];
            exportToCsv(data, cols, "dat-hang-nhap");
          },
        }}
        actions={[
          { label: "Đặt hàng", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
          { label: "Nhập Excel", icon: <Icon name="upload_file" size={16} />, variant: "outline", onClick: () => setImportOpen(true) },
        ]}
      />

      <CreatePurchaseEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        total={total}
        density="compact"
        columnToggle
        toolbarMetrics={<><ListMetric icon={<Icon name="shopping_cart" size={15} />} label="Kết quả" value={total.toString()} hint="Tổng số đơn theo bộ lọc" /><ListMetric icon={<Icon name="hourglass_top" size={15} />} label="Chờ / đang nhập" value={summary.outstandingCount.toString()} hint={formatCurrency(summary.outstandingValue)} tone={summary.outstandingCount > 0 ? "danger" : "default"} /><ListMetric icon={<Icon name="check_circle" size={15} />} label="Hoàn tất" value={summary.completedCount.toString()} hint="Toàn bộ kết quả lọc" /><ListMetric icon={<Icon name="cancel" size={15} />} label="Đã hủy" value={summary.cancelledCount.toString()} hint="Toàn bộ kết quả lọc" /></>}
        toolbarActions={<><Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="calendar_today" size={15} /><span className="hidden sm:inline">{datePresetLabel}</span></Button><Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button></>}
        toolbarFooter={<FilterChips filters={filterChips} onClearAll={filterChips.length > 1 ? clearListFilters : undefined} />}
        emptyState={emptyState}
        emptyTitle={
          emptyState === "no-results"
            ? "Không tìm thấy đơn đặt hàng nhập"
            : "Chưa có đơn đặt hàng nhập"
        }
        emptyDescription={
          emptyState === "no-results"
            ? "Thử thay đổi thời gian, trạng thái, giá trị hoặc nội dung tìm kiếm."
            : "Đơn đặt hàng nhập mới sẽ hiển thị tại đây sau khi được tạo."
        }
        emptyIcon="shopping_cart"
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
                { header: "Mã", key: "code", width: 15 },
                {
                  header: "Ngày",
                  key: "date",
                  width: 18,
                  format: (v: string) => formatDate(v),
                },
                { header: "NCC", key: "supplierName", width: 25 },
                {
                  header: "Tổng tiền",
                  key: "totalAmount",
                  width: 18,
                  format: (v: number) => v,
                },
                { header: "Trạng thái", key: "statusName", width: 15 },
              ];
              exportToCsv(selectedRows, cols, "dat-hang-nhap-da-chon");
              toast({
                title: "Đã xuất file",
                description: `${selectedRows.length} đơn đặt hàng nhập`,
                variant: "success",
              });
            },
          },
          {
            label: "In hàng loạt",
            icon: <Icon name="print" size={16} />,
            onClick: async (selectedRows) => {
              for (const row of selectedRows) {
                const items = await getPurchaseOrderItems(row.id);
                await printDocumentWithTemplate({
                  channel: "backoffice",
                  docType: "purchase_order",
                  branchId: row.branchId ?? activeBranchId ?? null,
                  base: buildPurchaseEntryPrintData(row, toPrintLines(items)),
                });
              }
            },
          },
          {
            label: "Hủy hàng loạt",
            icon: <Icon name="cancel" size={16} />,
            variant: "destructive",
            onClick: async (selectedRows) => {
              const cancellable = selectedRows.filter((r) => r.status === "pending");
              if (cancellable.length === 0) {
                toast({
                  title: "Không có đơn nào có thể hủy",
                  description:
                    "Chỉ hủy đơn chưa nhập hàng. Đơn đã nhập một phần phải đóng phần còn thiếu tại trang Nhập hàng.",
                  variant: "info",
                });
                return;
              }
              if (
                !window.confirm(
                  `Hủy ${cancellable.length} đơn đặt hàng nhập? Thao tác này không thể hoàn tác.`,
                )
              )
                return;
              try {
                await Promise.all(
                  cancellable.map((r) => cancelPurchaseOrderEntry(r.id)),
                );
                toast({
                  title: `Đã hủy ${cancellable.length} đơn`,
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
        renderDetail={(item, onClose) => (
          <PurchaseOrderEntryDetail
            item={item}
            onClose={onClose}
            onDelete={
              item.status === "pending"
                ? () => setCancellingItem(item)
                : undefined
            }
          />
        )}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "purchase_order",
            permissions: txPerms,
            onView: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
            onPrint: async () => {
              const items = await getPurchaseOrderItems(row.id);
              await printDocumentWithTemplate({
                channel: "backoffice",
                docType: "purchase_order",
                branchId: row.branchId ?? activeBranchId ?? null,
                base: buildPurchaseEntryPrintData(row, toPrintLines(items)),
              });
            },
            // Workflow: chuyển sang nhập hàng
            workflowActions: [
              {
                label: "Nhập hàng",
                icon: <Icon name="add_box" size={16} />,
                onClick: () => {
                  toast({ variant: "info", title: "Chuyển đến trang nhập hàng" });
                  router.push("/hang-hoa/nhap-hang");
                },
              },
            ],
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
            // Chỉ hủy đơn chưa nhận hàng; đơn partial phải đóng phần còn thiếu.
            onCancel:
              row.status === "pending"
                ? () => setCancellingItem(row)
                : undefined,
          })
        }
      />

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={clearListFilters} title="Bộ lọc đặt hàng nhập">
        <FilterGroup label="Trạng thái" activeHint={statusFilter !== "all" ? statusOptions.find((item) => item.value === statusFilter)?.label : undefined}><SelectFilter options={statusOptions} value={statusFilter} onChange={setStatusFilter} placeholder="Tất cả" /></FilterGroup>
        <FilterGroup label="Thời gian" activeHint={datePresetLabel}><DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS_WITH_ALL} /></FilterGroup>
        <FilterGroup label="Giá trị đơn" activeHint={amountMin || amountMax ? "Đang lọc" : undefined}><RangeFilter fromValue={amountMin} toValue={amountMax} onFromChange={setAmountMin} onToChange={setAmountMax} fromPlaceholder="Số tiền tối thiểu" toPlaceholder="Số tiền tối đa" /></FilterGroup>
      </FilterPanel>

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy đơn đặt hàng nhập"
        description={`Bạn có chắc muốn hủy đơn đặt hàng nhập ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
        confirmLabel="Hủy đơn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            await cancelPurchaseOrderEntry(cancellingItem.id);
            toast({
              title: "Đã hủy đơn đặt hàng nhập",
              description: `Đơn ${cancellingItem.code} đã được hủy thành công`,
              variant: "success",
            });
            await fetchData();
          } catch (err) {
            toast({
              title: "Không thể hủy đơn",
              description: err instanceof Error ? err.message : "Đã xảy ra lỗi khi hủy đơn",
              variant: "error",
            });
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={purchaseOrderExcelSchema}
        onCommit={bulkImportPurchaseOrders}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách đơn nhập đã được cập nhật.",
            variant: "success",
          });
        }}
      />

      {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
      {auditDialogTarget && (
        <AuditLogDialog
          entityType="purchase_order"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}
    </ListPageLayout>
  );
}
