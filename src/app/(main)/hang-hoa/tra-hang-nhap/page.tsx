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
import { Button } from "@/components/ui/button";
// CEO 06/06/2026 Phase 4: migrate khỏi legacy DateRangeFilter sang
// DatePresetFilter + STANDARD_LIST_PRESETS_WITH_ALL (12 option).
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
import { getSupplierReturnListWorkspace, getSupplierReturnsForExport, getPurchaseReturnStatuses, getPurchaseReturnItems } from "@/lib/services";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import type { PurchaseReturn } from "@/lib/types";
import { CreatePurchaseReturnDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { DocumentNoteBox } from "@/components/shared/document-note-box";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildPurchaseReturnPrintData, toPrintLines } from "@/lib/print-templates";
import { Icon } from "@/components/ui/icon";

// === Status config ===
const statusMap: Record<
  PurchaseReturn["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  draft: { label: "Phiếu tạm", variant: "secondary" },
};

const statusOptions = getPurchaseReturnStatuses();

// === Inline Detail ===
function PurchaseReturnDetail({
  item,
  onClose,
}: {
  item: PurchaseReturn;
  onClose: () => void;
}) {
  const st = statusMap[item.status];
  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Trả hàng nhập ${item.code}`}
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
              { label: "Mã trả hàng", value: item.code },
              { label: "Ngày trả", value: formatDate(item.date) },
              { label: "Chi nhánh", value: item.branchName ?? "---" },
              { label: "Mã nhập hàng", value: item.importCode },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền trả", value: formatCurrency(item.totalAmount) },
              { label: "Trạng thái", value: st.label },
              { label: "Người tạo", value: formatUser(item.createdByName, item.createdBy) },
            ]}
          />

          {/* 06/08: form tạo có ô Ghi chú nhưng chi tiết không hiện. */}
          <DocumentNoteBox note={item.note} />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="purchase_return" entityId={item.id} />,
    },
  ];
  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

// === Columns ===
const columns: ColumnDef<PurchaseReturn, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã trả hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "importCode",
    header: "Mã nhập hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.importCode}</span>
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
    size: 160,
    cell: ({ row }) => row.original.branchName ?? "---",
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền trả",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    size: 120,
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

export default function TraHangNhapPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady: branchReady } = useBranchFilter();
  const { isLoading: permissionsLoading } = usePermissions();
  const txPerms = useTxRowPermissions("purchase_return");
  const [data, setData] = useState<PurchaseReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<PurchaseReturn | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [summary, setSummary] = useState({ completedCount: 0, draftCount: 0, totalValue: 0 });

  const fetchData = useCallback(async () => {
    if (!branchReady || permissionsLoading) return;
    setLoading(true);
    // Không có try/finally thì truy vấn lỗi là cờ loading không bao giờ tắt →
    // trang treo mãi ở vòng xoay, người dùng không biết vì sao.
    try {
    const presetRange = computeListPresetRange(datePreset);
    const effectiveDateFrom = datePreset === "custom" ? dateFrom : presetRange.from;
    const effectiveDateTo = datePreset === "custom" ? dateTo : presetRange.to;
    // Lọc chung (không kèm chi nhánh) — dùng lại cho cả lời gọi chính lẫn probe
    // "đếm phiếu ở chi nhánh khác". Service này nhận chi nhánh qua filters.branchId,
    // falsy/"all" → tất cả chi nhánh.
    const result = await getSupplierReturnListWorkspace({ page, pageSize, search, searchField,
      status: statusFilter, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined, branchId: activeBranchId });
    setData(result.data);
    setTotal(result.total);
    setSummary(result.summary);
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách phiếu trả hàng nhập",
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
  }, [search, searchField, statusFilter, activeBranchId, datePreset, dateFrom, dateTo, amountMin, amountMax]);
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
        title="Trả hàng nhập"
        density="compact"
        searchPlaceholder="Theo mã phiếu, mã nhập, NCC, ghi chú"
        searchValue={search}
        onSearchChange={setSearch}
        searchFields={[
          { value: "all", label: "Tất cả" }, { value: "code", label: "Mã phiếu trả" },
          { value: "import_code", label: "Mã nhập hàng" }, { value: "supplier", label: "Nhà cung cấp" },
          { value: "note", label: "Ghi chú" },
        ]}
        searchField={searchField}
        onSearchFieldChange={(value) => { setSearchField(value); setPage(0); }}
        onExport={{
          excel: async () => {
            const range = computeListPresetRange(datePreset);
            const rows = await getSupplierReturnsForExport({ search, searchField, status: statusFilter,
              dateFrom: datePreset === "custom" ? dateFrom : range.from, dateTo: datePreset === "custom" ? dateTo : range.to,
              amountMin: amountMin ? Number(amountMin) : undefined, amountMax: amountMax ? Number(amountMax) : undefined, branchId: activeBranchId });
            exportToExcel(rows, [
              { header: "Mã phiếu trả", key: "code", width: 16 }, { header: "Mã nhập hàng", key: "importCode", width: 16 },
              { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "Chi nhánh", key: "branchName", width: 22 }, { header: "Mã NCC", key: "supplierCode", width: 16 },
              { header: "Nhà cung cấp", key: "supplierName", width: 28 }, { header: "Tổng tiền trả", key: "totalAmount", width: 18 },
              { header: "Trạng thái", key: "statusName", width: 16 }, { header: "Người tạo", key: "createdByName", width: 20 },
              { header: "Ghi chú", key: "note", width: 30 },
            ], "tra-hang-nhap");
          },
          csv: async () => {
            const range = computeListPresetRange(datePreset);
            const rows = await getSupplierReturnsForExport({ search, searchField, status: statusFilter,
              dateFrom: datePreset === "custom" ? dateFrom : range.from, dateTo: datePreset === "custom" ? dateTo : range.to,
              amountMin: amountMin ? Number(amountMin) : undefined, amountMax: amountMax ? Number(amountMax) : undefined, branchId: activeBranchId });
            exportToCsv(rows, [
              { header: "Mã phiếu trả", key: "code", width: 16 }, { header: "Mã nhập hàng", key: "importCode", width: 16 },
              { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "Chi nhánh", key: "branchName", width: 22 }, { header: "Mã NCC", key: "supplierCode", width: 16 },
              { header: "Nhà cung cấp", key: "supplierName", width: 28 }, { header: "Tổng tiền trả", key: "totalAmount", width: 18 },
              { header: "Trạng thái", key: "statusName", width: 16 }, { header: "Người tạo", key: "createdByName", width: 20 },
              { header: "Ghi chú", key: "note", width: 30 },
            ], "tra-hang-nhap");
          },
        }}
        actions={[
          { label: "Tạo phiếu trả", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
        ]}
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        total={total}
        density="compact"
        columnToggle
        toolbarMetrics={<><ListMetric icon={<Icon name="undo" size={15} />} label="Kết quả" value={total.toString()} hint="Toàn bộ kết quả lọc" /><ListMetric icon={<Icon name="check_circle" size={15} />} label="Hoàn thành" value={summary.completedCount.toString()} hint="Toàn bộ kết quả lọc" /><ListMetric icon={<Icon name="edit_note" size={15} />} label="Phiếu tạm" value={summary.draftCount.toString()} hint="Toàn bộ kết quả lọc" tone={summary.draftCount > 0 ? "danger" : "default"} /><ListMetric icon={<Icon name="payments" size={15} />} label="Tổng giá trị trả" value={formatCurrency(summary.totalValue)} hint="Toàn bộ kết quả lọc" /></>}
        toolbarActions={<><Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="calendar_today" size={15} /><span className="hidden sm:inline">{datePresetLabel}</span></Button><Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button></>}
        toolbarFooter={<FilterChips filters={filterChips} onClearAll={filterChips.length > 1 ? clearListFilters : undefined} />}
        emptyState={emptyState}
        emptyTitle={
          emptyState === "no-results"
            ? "Không tìm thấy phiếu trả hàng nhập"
            : "Chưa có phiếu trả hàng nhập"
        }
        emptyDescription={
          emptyState === "no-results"
            ? "Thử thay đổi thời gian, trạng thái, giá trị hoặc nội dung tìm kiếm."
            : "Phiếu trả hàng nhập mới sẽ hiển thị tại đây sau khi được tạo."
        }
        emptyIcon="assignment_return"
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
          <PurchaseReturnDetail item={item} onClose={onClose} />
        )}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "purchase_return",
            permissions: txPerms,
            onView: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
            onPrint: async () => {
              const items = await getPurchaseReturnItems(row.id);
              await printDocumentWithTemplate({
                channel: "backoffice",
                docType: "purchase_return",
                branchId: row.branchId ?? activeBranchId ?? null,
                base: buildPurchaseReturnPrintData(row, toPrintLines(items)),
              });
            },
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
          })
        }
      />

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={clearListFilters} title="Bộ lọc trả hàng nhập">
        <FilterGroup label="Trạng thái" activeHint={statusFilter !== "all" ? statusOptions.find((item) => item.value === statusFilter)?.label : undefined}><SelectFilter options={statusOptions} value={statusFilter} onChange={setStatusFilter} placeholder="Tất cả" /></FilterGroup>
        <FilterGroup label="Thời gian" activeHint={datePresetLabel}><DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS_WITH_ALL} /></FilterGroup>
        <FilterGroup label="Giá trị phiếu" activeHint={amountMin || amountMax ? "Đang lọc" : undefined}><RangeFilter fromValue={amountMin} toValue={amountMax} onFromChange={setAmountMin} onToChange={setAmountMax} fromPlaceholder="Số tiền tối thiểu" toPlaceholder="Số tiền tối đa" /></FilterGroup>
      </FilterPanel>

      <CreatePurchaseReturnDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
      {auditDialogTarget && (
        <AuditLogDialog
          entityType="purchase_return"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}
    </ListPageLayout>
  );
}
