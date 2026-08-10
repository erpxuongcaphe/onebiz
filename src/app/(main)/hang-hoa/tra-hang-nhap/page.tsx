"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  SelectFilter,
  DatePresetFilter,
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
import { getPurchaseReturns, getPurchaseReturnStatuses, getPurchaseReturnItems } from "@/lib/services";
import type { PurchaseReturn } from "@/lib/types";
import { CreatePurchaseReturnDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
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
  const { activeBranchId, currentBranch } = useBranchFilter();
  const txPerms = useTxRowPermissions("purchase_return");
  const [data, setData] = useState<PurchaseReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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
  const [filterOpen, setFilterOpen] = useState(false);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  const fetchData = useCallback(async () => {
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
    const commonFilters = {
      ...(statusFilter !== "all" && { status: statusFilter }),
      ...(effectiveDateFrom && { dateFrom: effectiveDateFrom }),
      ...(effectiveDateTo && { dateTo: effectiveDateTo }),
    };
    const branchScope = viewAllBranches ? undefined : activeBranchId;
    const result = await getPurchaseReturns({
      page,
      pageSize,
      search,
      filters: {
        ...commonFilters,
        ...(branchScope && { branchId: branchScope }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    // Bảng trống vì lọc chi nhánh? Đếm phiếu ở chi nhánh khác để gợi ý (cùng bộ
    // lọc, bỏ branch). Chỉ khi đang lọc theo 1 chi nhánh cụ thể.
    if (result.data.length === 0 && !viewAllBranches && activeBranchId) {
      const all = await getPurchaseReturns({
        page: 0,
        pageSize: 1,
        search,
        filters: commonFilters,
      });
      setOtherBranchCount(all.total);
    } else {
      setOtherBranchCount(0);
    }
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách phiếu trả hàng nhập",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, activeBranchId, datePreset, dateFrom, dateTo, viewAllBranches, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, statusFilter, activeBranchId, datePreset, dateFrom, dateTo]);

  const pageCompleted = data.filter((row) => row.status === "completed").length;
  const pageDraft = data.filter((row) => row.status === "draft").length;
  const pageValue = data.reduce((sum, row) => sum + (row.totalAmount ?? 0), 0);
  const datePresetLabel = useMemo(() => {
    if (datePreset === "all") return "Tất cả thời gian";
    if (datePreset === "custom") return !dateFrom && !dateTo ? "Tùy chỉnh" : `${dateFrom || "..."} đến ${dateTo || "..."}`;
    return STANDARD_LIST_PRESETS_WITH_ALL.find((item) => item.value === datePreset)?.label ?? "Thời gian";
  }, [dateFrom, datePreset, dateTo]);
  const clearListFilters = useCallback(() => { setStatusFilter("all"); setDatePreset("all"); setDateFrom(""); setDateTo(""); }, []);
  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (datePreset !== "all") chips.push({ key: "date", label: "Thời gian", value: datePresetLabel, onClear: () => { setDatePreset("all"); setDateFrom(""); setDateTo(""); } });
    if (statusFilter !== "all") chips.push({ key: "status", label: "Trạng thái", value: statusOptions.find((item) => item.value === statusFilter)?.label ?? statusFilter, onClear: () => setStatusFilter("all") });
    return chips;
  }, [datePreset, datePresetLabel, statusFilter]);

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Trả hàng nhập"
        density="compact"
        searchPlaceholder="Theo mã phiếu"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo phiếu trả", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
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
        toolbarMetrics={<><ListMetric icon={<Icon name="undo" size={15} />} label="Kết quả" value={total.toString()} hint="Tổng số phiếu theo bộ lọc" /><ListMetric icon={<Icon name="check_circle" size={15} />} label="Hoàn thành trang này" value={pageCompleted.toString()} hint="Chỉ tính các dòng đang hiển thị" /><ListMetric icon={<Icon name="edit_note" size={15} />} label="Phiếu tạm trang này" value={pageDraft.toString()} hint="Chỉ tính các dòng đang hiển thị" tone={pageDraft > 0 ? "danger" : "default"} /><ListMetric icon={<Icon name="payments" size={15} />} label="Giá trị trang này" value={formatCurrency(pageValue)} hint="Chỉ tính các dòng đang hiển thị" /></>}
        toolbarActions={<><Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="calendar_today" size={15} /><span className="hidden sm:inline">{datePresetLabel}</span></Button><Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button></>}
        toolbarFooter={<FilterChips filters={filterChips} onClearAll={filterChips.length > 1 ? clearListFilters : undefined} />}
        emptyBranchHint={{
          otherBranchCount,
          onViewAllBranches: () => setViewAllBranches(true),
          entityLabel: "phiếu trả hàng",
        }}
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
