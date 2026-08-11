"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildInputInvoicePrintData, toPrintLines } from "@/lib/print-templates";
import { getInputInvoiceListWorkspace, getInputInvoicesForExport, getInputInvoiceStatuses, cancelInputInvoice, recordInputInvoice, getInputInvoiceItems } from "@/lib/services";
import { ConfirmDialog } from "@/components/shared/dialogs";
// PERF (CEO 23/05/2026): Lazy-load CreateInputInvoiceDialog (662 dòng).
import dynamic from "next/dynamic";
const CreateInputInvoiceDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-input-invoice-dialog").then(
      (m) => m.CreateInputInvoiceDialog,
    ),
  { ssr: false },
);
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import type { InputInvoice } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// === Status config ===
const statusMap: Record<
  InputInvoice["status"],
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  recorded: { label: "Đã ghi sổ", variant: "default" },
  unrecorded: { label: "Chưa ghi sổ", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = getInputInvoiceStatuses();

// === Inline Detail ===
function InputInvoiceDetail({
  item,
  onClose,
  onDelete,
}: {
  item: InputInvoice;
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
            title={`Hóa đơn đầu vào ${item.code}`}
            code={item.code}
            status={{ label: st.label, variant: st.variant }}
            subtitle={item.branchName ? `Chi nhánh: ${item.branchName}` : undefined}
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
              { label: "Mã hóa đơn", value: item.code },
              { label: "Ngày hóa đơn", value: formatDate(item.date) },
              { label: "Chi nhánh", value: item.branchName ?? "---" },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền hàng", value: formatCurrency(item.totalAmount) },
              { label: "Thuế", value: formatCurrency(item.taxAmount) },
              { label: "Trạng thái", value: st.label },
              { label: "Người tạo", value: formatUser(item.createdByName, item.createdBy) },
            ]}
          />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="input_invoice" entityId={item.id} />,
    },
  ];
  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={onDelete}
    >
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

// === Columns ===
const columns: ColumnDef<InputInvoice, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã hóa đơn",
    size: 140,
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
    header: "Nhà cung cấp",
    size: 220,
  },
  {
    accessorKey: "branchName",
    header: "Chi nhánh",
    size: 160,
    cell: ({ row }) => row.original.branchName ?? "---",
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền hàng",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "taxAmount",
    header: "Thuế",
    cell: ({ row }) => formatCurrency(row.original.taxAmount),
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
    size: 140,
    cell: ({ row }) => formatUser(row.original.createdByName, row.original.createdBy),
  },
];

export default function HoaDonDauVaoPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady: branchReady } = useBranchFilter();
  const { isLoading: permissionsLoading } = usePermissions();
  const txPerms = useTxRowPermissions("input_invoice");
  const [data, setData] = useState<InputInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Phase 6.3 (CEO 12/05): hủy hoá đơn dùng `cancelInputInvoice` (soft-delete
  // + audit log + giữ lịch sử), thay vì `deleteInputInvoice` hard-delete.
  // Yêu cầu nhập lý do hủy ≥ 5 ký tự để tracking loss-prevention.
  const [deletingInvoice, setDeletingInvoice] = useState<InputInvoice | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Record
  const [recordingInvoice, setRecordingInvoice] = useState<InputInvoice | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);

  // Sprint UX-1 Stage 4: Audit log shortcut
  const [auditDialogTarget, setAuditDialogTarget] = useState<InputInvoice | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [summary, setSummary] = useState({
    recordedCount: 0,
    unrecordedCount: 0,
    cancelledCount: 0,
    activeValue: 0,
    taxValue: 0,
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
    const result = await getInputInvoiceListWorkspace({
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
        title: "Không tải được danh sách hoá đơn đầu vào",
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

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Hóa đơn đầu vào"
        density="compact"
        searchPlaceholder="Theo mã HĐ, mã/tên NCC, ghi chú"
        searchValue={search}
        onSearchChange={setSearch}
        searchFields={[
          { value: "all", label: "Tất cả" },
          { value: "code", label: "Mã hóa đơn" },
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
            const cols = [
              { header: "Mã HĐ", key: "code", width: 15 },
              { header: "Ngày", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "Chi nhánh", key: "branchName", width: 22 },
              { header: "Mã NCC", key: "supplierCode", width: 16 },
              { header: "NCC", key: "supplierName", width: 25 },
              { header: "Tiền hàng", key: "totalAmount", width: 18, format: (v: number) => v },
              { header: "Thuế", key: "taxAmount", width: 15, format: (v: number) => v },
              { header: "Trạng thái", key: "statusName", width: 15 },
              { header: "Ghi chú", key: "note", width: 30 },
            ];
            const presetRange = computeListPresetRange(datePreset);
            const rows = await getInputInvoicesForExport({
              search,
              searchField,
              status: statusFilter,
              dateFrom: datePreset === "custom" ? dateFrom : presetRange.from,
              dateTo: datePreset === "custom" ? dateTo : presetRange.to,
              amountMin: amountMin ? Number(amountMin) : undefined,
              amountMax: amountMax ? Number(amountMax) : undefined,
              branchId: activeBranchId,
            });
            exportToExcel(rows, cols, "hoa-don-dau-vao");
          },
          csv: async () => {
            const cols = [
              { header: "Mã HĐ", key: "code", width: 15 },
              { header: "Ngày", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "Chi nhánh", key: "branchName", width: 22 },
              { header: "Mã NCC", key: "supplierCode", width: 16 },
              { header: "NCC", key: "supplierName", width: 25 },
              { header: "Tiền hàng", key: "totalAmount", width: 18, format: (v: number) => v },
              { header: "Thuế", key: "taxAmount", width: 15, format: (v: number) => v },
              { header: "Trạng thái", key: "statusName", width: 15 },
              { header: "Ghi chú", key: "note", width: 30 },
            ];
            const presetRange = computeListPresetRange(datePreset);
            const rows = await getInputInvoicesForExport({
              search,
              searchField,
              status: statusFilter,
              dateFrom: datePreset === "custom" ? dateFrom : presetRange.from,
              dateTo: datePreset === "custom" ? dateTo : presetRange.to,
              amountMin: amountMin ? Number(amountMin) : undefined,
              amountMax: amountMax ? Number(amountMax) : undefined,
              branchId: activeBranchId,
            });
            exportToCsv(rows, cols, "hoa-don-dau-vao");
          },
        }}
        actions={txPerms.canEdit ? [
          { label: "Tạo mới", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
        ] : []}
      />

      <CreateInputInvoiceDialog
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
        toolbarMetrics={<><ListMetric icon={<Icon name="receipt_long" size={15} />} label="Kết quả" value={total.toString()} hint={`${summary.cancelledCount} hóa đơn đã hủy`} /><ListMetric icon={<Icon name="check_circle" size={15} />} label="Đã ghi sổ" value={summary.recordedCount.toString()} hint="Toàn bộ kết quả lọc" /><ListMetric icon={<Icon name="warning" size={15} />} label="Chưa ghi sổ" value={summary.unrecordedCount.toString()} hint="Toàn bộ kết quả lọc" tone={summary.unrecordedCount > 0 ? "danger" : "default"} /><ListMetric icon={<Icon name="payments" size={15} />} label="Tiền hàng" value={formatCurrency(summary.activeValue)} hint={`Thuế: ${formatCurrency(summary.taxValue)}`} /></>}
        toolbarActions={<><Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="calendar_today" size={15} /><span className="hidden sm:inline">{datePresetLabel}</span></Button><Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button></>}
        toolbarFooter={<FilterChips filters={filterChips} onClearAll={filterChips.length > 1 ? clearListFilters : undefined} />}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(total / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        selectable
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(item, onClose) => (
          <InputInvoiceDetail
            item={item}
            onClose={onClose}
            onDelete={
              txPerms.canCancel && item.status !== "cancelled"
                ? () => setDeletingInvoice(item)
                : undefined
            }
          />
        )}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "input_invoice",
            permissions: txPerms,
            onView: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
            onPrint: async () => {
              const items = await getInputInvoiceItems(row.id);
              await printDocumentWithTemplate({
                channel: "backoffice",
                docType: "input_invoice",
                branchId: row.branchId ?? activeBranchId ?? null,
                base: buildInputInvoicePrintData(row, toPrintLines(items)),
              });
            },
            // Workflow: "Ghi nhận" cho HĐ chưa ghi sổ
            workflowActions:
              row.status === "unrecorded" && txPerms.canCancel
                ? [
                    {
                      label: "Ghi nhận",
                      icon: <Icon name="menu_book" size={16} />,
                      onClick: () => setRecordingInvoice(row),
                    },
                  ]
                : [],
            onAuditLog: () => setAuditDialogTarget(row),
            // Phase 6.3: cancel = soft-delete + audit log + lý do bắt buộc.
            onCancel:
              row.status !== "cancelled"
                ? () => {
                    setDeletingInvoice(row);
                    setCancelReason("");
                  }
                : undefined,
          })
        }
      />

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={clearListFilters} title="Bộ lọc hóa đơn đầu vào">
        <FilterGroup label="Trạng thái" activeHint={statusFilter !== "all" ? statusOptions.find((item) => item.value === statusFilter)?.label : undefined}><SelectFilter options={statusOptions} value={statusFilter} onChange={setStatusFilter} placeholder="Tất cả" /></FilterGroup>
        <FilterGroup label="Thời gian" activeHint={datePresetLabel}><DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS_WITH_ALL} /></FilterGroup>
        <FilterGroup label="Giá trị hóa đơn" activeHint={amountMin || amountMax ? "Đang lọc" : undefined}><RangeFilter fromValue={amountMin} toValue={amountMax} onFromChange={setAmountMin} onToChange={setAmountMax} fromPlaceholder="Số tiền tối thiểu" toPlaceholder="Số tiền tối đa" /></FilterGroup>
      </FilterPanel>

      {/* Phase 6.3 (CEO 12/05): Dialog hủy với textarea lý do bắt buộc */}
      <Dialog
        open={!!deletingInvoice}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingInvoice(null);
            setCancelReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-status-error">Hủy hoá đơn đầu vào</DialogTitle>
            <DialogDescription>
              Hủy hoá đơn{" "}
              <strong>{deletingInvoice?.code}</strong>
              {deletingInvoice?.supplierName && (
                <> · NCC: {deletingInvoice.supplierName}</>
              )}. Hệ thống ghi lý do vào lịch sử thao tác, không xoá cứng.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs font-medium text-foreground">
              Lý do hủy <span className="text-status-error">*</span>
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="VD: NCC giao sai mặt hàng, đã nhận lại hàng..."
              rows={3}
              disabled={deleteLoading}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {cancelReason.length > 0 && cancelReason.trim().length < 5 && (
              <p className="text-[11px] text-status-error">
                Lý do tối thiểu 5 ký tự.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteLoading}
              onClick={() => {
                setDeletingInvoice(null);
                setCancelReason("");
              }}
            >
              Đóng
            </Button>
            <Button
              variant="destructive"
              disabled={deleteLoading || cancelReason.trim().length < 5}
              onClick={async () => {
                if (!deletingInvoice) return;
                setDeleteLoading(true);
                try {
                  await cancelInputInvoice(deletingInvoice.id, cancelReason.trim());
                  toast({
                    title: "Đã hủy hoá đơn đầu vào",
                    description: `${deletingInvoice.code} — lý do: ${cancelReason.trim()}`,
                    variant: "success",
                  });
                  setDeletingInvoice(null);
                  setCancelReason("");
                  fetchData();
                } catch (err) {
                  toast({
                    title: "Lỗi hủy hoá đơn đầu vào",
                    description: err instanceof Error ? err.message : "Vui lòng thử lại",
                    variant: "error",
                  });
                } finally {
                  setDeleteLoading(false);
                }
              }}
            >
              {deleteLoading ? "Đang hủy..." : "Hủy hoá đơn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="input_invoice"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

      <ConfirmDialog
        open={!!recordingInvoice}
        onOpenChange={(open) => { if (!open) setRecordingInvoice(null); }}
        title="Ghi nhận hoá đơn đầu vào"
        description={`Ghi nhận hoá đơn đầu vào ${recordingInvoice?.code ?? ""}?`}
        confirmLabel="Ghi nhận"
        cancelLabel="Đóng"
        loading={recordLoading}
        onConfirm={async () => {
          if (!recordingInvoice) return;
          setRecordLoading(true);
          try {
            await recordInputInvoice(recordingInvoice.id);
            toast({
              title: "Đã ghi nhận hoá đơn đầu vào",
              description: recordingInvoice.code,
              variant: "success",
            });
            setRecordingInvoice(null);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi ghi nhận hoá đơn",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setRecordLoading(false);
          }
        }}
      />
    </ListPageLayout>
  );
}
