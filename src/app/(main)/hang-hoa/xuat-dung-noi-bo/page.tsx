"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  PersonFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import { Button } from "@/components/ui/button";
import { computeListPresetRange, STANDARD_LIST_PRESETS } from "@/lib/utils/list-date-preset-range";
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
import { getInternalExports, getInternalExportStatuses, cancelInternalExport } from "@/lib/services";
import type { InternalExport } from "@/lib/types";
import { CreateInternalExportDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildInternalExportPrintData } from "@/lib/print-templates";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const statusMap: Record<
  InternalExport["status"],
  { label: string; variant: "secondary" | "default" }
> = {
  draft: { label: "Phiếu tạm", variant: "secondary" },
  completed: { label: "Hoàn thành", variant: "default" },
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
function InternalExportDetail({
  item,
  onClose,
}: {
  item: InternalExport;
  onClose: () => void;
}) {
  const status = statusMap[item.status];

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Phiếu xuất nội bộ ${item.code}`}
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
              { label: "Mã phiếu", value: item.code },
              { label: "Thời gian", value: formatDate(item.date) },
              { label: "Trạng thái", value: status.label },
              { label: "Người tạo", value: formatUser(item.createdByName, item.createdBy) },
              {
                label: "Tổng sản phẩm",
                value: String(item.totalProducts),
              },
              {
                label: "Tổng giá trị",
                value: (
                  <span className="font-semibold text-primary">
                    {formatCurrency(item.totalAmount)}
                  </span>
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
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="internal_export" entityId={item.id} />,
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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function XuatDungNoiBoPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch } = useBranchFilter();
  const txPerms = useTxRowPermissions("internal_export");
  const [data, setData] = useState<InternalExport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<InternalExport | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  // Sprint UX-1 Stage 4: Audit log shortcut
  const [auditDialogTarget, setAuditDialogTarget] = useState<InternalExport | null>(null);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "draft",
    "completed",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  const statuses = getInternalExportStatuses();

  /* ---- Columns ---- */
  const columns: ColumnDef<InternalExport, unknown>[] = [
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
      header: "Mã phiếu",
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
      accessorKey: "createdBy",
      header: "Người tạo",
      size: 150,
      cell: ({ row }) => formatUser(row.original.createdByName, row.original.createdBy),
    },
    {
      accessorKey: "totalAmount",
      header: "Tổng giá trị",
      size: 140,
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
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
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
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
    const branchScope = viewAllBranches ? undefined : activeBranchId;
    const result = await getInternalExports({
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
    if (result.data.length === 0 && !viewAllBranches && activeBranchId) {
      const all = await getInternalExports({
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
        title: "Không tải được danh sách phiếu xuất dùng nội bộ",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, selectedStatuses, datePreset, dateFrom, dateTo, creatorFilter, activeBranchId, viewAllBranches, toast]);

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
      { header: "Mã phiếu", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Người tạo", key: "createdBy", width: 15 },
      { header: "Tổng giá trị", key: "totalAmount", width: 15, format: (v: number) => v },
      { header: "Trạng thái", key: "status", width: 15, format: (v: InternalExport["status"]) => statusMap[v]?.label ?? v },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "xuat-dung-noi-bo");
    else exportToCsv(data, exportColumns, "xuat-dung-noi-bo");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (item: InternalExport, onClose: () => void) => (
    <InternalExportDetail item={item} onClose={onClose} />
  );

  const pageCompleted = data.filter((row) => row.status === "completed").length;
  const pageDraft = data.filter((row) => row.status === "draft").length;
  const datePresetLabel = useMemo(() => {
    if (datePreset === "custom") {
      if (!dateFrom && !dateTo) return "Tùy chỉnh";
      return `${dateFrom || "..."} đến ${dateTo || "..."}`;
    }
    return STANDARD_LIST_PRESETS.find((item) => item.value === datePreset)?.label ?? "Thời gian";
  }, [dateFrom, datePreset, dateTo]);
  const clearListFilters = useCallback(() => {
    setSelectedStatuses([]);
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setCreatorFilter("");
  }, []);
  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (datePreset !== "all") chips.push({ key: "date", label: "Thời gian", value: datePresetLabel, onClear: () => { setDatePreset("all"); setDateFrom(""); setDateTo(""); } });
    if (selectedStatuses.length) chips.push({ key: "status", label: "Trạng thái", value: selectedStatuses.map((value) => statusMap[value as InternalExport["status"]]?.label ?? value).join(", "), onClear: () => setSelectedStatuses([]) });
    if (creatorFilter) chips.push({ key: "creator", label: "Người tạo", value: creatorFilter, onClear: () => setCreatorFilter("") });
    return chips;
  }, [creatorFilter, datePreset, datePresetLabel, selectedStatuses]);

  /* ---- Render ---- */
  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Xuất dùng nội bộ"
        density="compact"
        searchPlaceholder="Theo mã phiếu xuất nội bộ"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Xuất dùng nội bộ",
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
        toolbarMetrics={<><ListMetric icon={<Icon name="inventory_2" size={15} />} label="Kết quả" value={total.toString()} hint="Tổng số phiếu theo bộ lọc" /><ListMetric icon={<Icon name="check_circle" size={15} />} label="Hoàn thành trang này" value={pageCompleted.toString()} hint="Chỉ tính các dòng đang hiển thị" /><ListMetric icon={<Icon name="edit_note" size={15} />} label="Phiếu tạm trang này" value={pageDraft.toString()} hint="Chỉ tính các dòng đang hiển thị" tone={pageDraft > 0 ? "danger" : "default"} /></>}
        toolbarActions={<><Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="calendar_today" size={15} /><span className="hidden sm:inline">{datePresetLabel}</span></Button><Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)} aria-label={`Mở bộ lọc${filterChips.length ? `, ${filterChips.length} điều kiện` : ""}`}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button></>}
        toolbarFooter={<FilterChips filters={filterChips} onClearAll={filterChips.length > 1 ? clearListFilters : undefined} />}
        emptyBranchHint={{
          otherBranchCount,
          onViewAllBranches: () => setViewAllBranches(true),
          entityLabel: "phiếu xuất dùng",
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
        bulkActions={[
          {
            label: "Xuất Excel",
            icon: <Icon name="download" size={16} />,
            onClick: (selectedRows) => {
              const cols = [
                { header: "Mã phiếu", key: "code", width: 15 },
                {
                  header: "Thời gian",
                  key: "date",
                  width: 18,
                  format: (v: string) => formatDate(v),
                },
                { header: "Người tạo", key: "createdBy", width: 15 },
                {
                  header: "Tổng giá trị",
                  key: "totalAmount",
                  width: 15,
                  format: (v: number) => v,
                },
                {
                  header: "Trạng thái",
                  key: "status",
                  width: 15,
                  format: (v: InternalExport["status"]) =>
                    statusMap[v]?.label ?? v,
                },
              ];
              exportToExcel(selectedRows, cols, "xuat-noi-bo-da-chon");
              toast({
                title: "Đã xuất Excel",
                description: `${selectedRows.length} phiếu xuất nội bộ`,
                variant: "success",
              });
            },
          },
          {
            label: "In hàng loạt",
            icon: <Icon name="print" size={16} />,
            onClick: async (selectedRows) => {
              for (const row of selectedRows) {
                await printDocumentWithTemplate({
                  channel: "backoffice",
                  docType: "internal_export",
                  // CEO 05/07: mẫu in theo chi nhánh CỦA PHIẾU, không theo filter
                  branchId: row.branchId ?? activeBranchId ?? null,
                  base: buildInternalExportPrintData(row),
                });
              }
            },
          },
          {
            label: "Hủy hàng loạt",
            icon: <Icon name="cancel" size={16} />,
            variant: "destructive",
            onClick: async (selectedRows) => {
              const cancellable = selectedRows.filter(
                (r) => r.status === "draft" || r.status === "completed",
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
                  `Hủy ${cancellable.length} phiếu xuất nội bộ? Thao tác này không thể hoàn tác.`,
                )
              )
                return;
              try {
                await Promise.all(
                  cancellable.map((r) => cancelInternalExport(r.id)),
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
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "internal_export",
            permissions: txPerms,
            onPrint: () =>
              printDocumentWithTemplate({
                channel: "backoffice",
                docType: "internal_export",
                branchId: row.branchId ?? activeBranchId ?? null,
                base: buildInternalExportPrintData(row),
              }),
            onAuditLog: () => setAuditDialogTarget(row),
            // 28/07: cho huỷ cả phiếu ĐÃ HOÀN THÀNH — hoàn kho theo sổ cái
            // qua RPC 00228. Trước đây chỉ nhận 'draft' nên nút này là nút
            // chết (mọi phiếu xuất dùng nội bộ đều tạo thẳng ở 'completed').
            onCancel:
              row.status === "draft" || row.status === "completed"
                ? () => setCancellingItem(row)
                : undefined,
          })
        }
      />

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={clearListFilters} title="Bộ lọc xuất dùng nội bộ">
        <FilterGroup label="Trạng thái" activeHint={selectedStatuses.length ? `${selectedStatuses.length} lựa chọn` : undefined}><CheckboxFilter options={statuses} selected={selectedStatuses} onChange={setSelectedStatuses} /></FilterGroup>
        <FilterGroup label="Thời gian" activeHint={datePresetLabel}><DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS} /></FilterGroup>
        <FilterGroup label="Người tạo" activeHint={creatorFilter || undefined}><PersonFilter value={creatorFilter} onChange={setCreatorFilter} placeholder="Chọn người tạo" suggestions={[{ label: "Admin", value: "admin" }, { label: "Cao Thị Huyền Trang", value: "trang" }]} /></FilterGroup>
      </FilterPanel>

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="internal_export"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

      <CreateInternalExportDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy phiếu xuất nội bộ"
        description={
          cancellingItem?.status === "completed"
            ? `Hủy phiếu ${cancellingItem?.code ?? ""}? Số hàng đã xuất sẽ được CỘNG TRẢ LẠI kho, kèm bút toán đối ứng để tra cứu. Không thể hoàn tác.`
            : `Bạn có chắc muốn hủy phiếu xuất nội bộ ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`
        }
        confirmLabel="Hủy phiếu"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            await cancelInternalExport(cancellingItem.id);
            toast({
              title: "Đã hủy phiếu xuất nội bộ",
              description: `Phiếu ${cancellingItem.code} đã được hủy thành công`,
              variant: "success",
            });
            await fetchData();
          } catch (err) {
            toast({
              title: "Không thể hủy phiếu",
              description: err instanceof Error ? err.message : "Đã xảy ra lỗi khi hủy phiếu",
              variant: "error",
            });
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />
    </ListPageLayout>
  );
}
