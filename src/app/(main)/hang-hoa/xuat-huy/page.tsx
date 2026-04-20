"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocument } from "@/lib/print-document";
import { buildDisposalPrintData } from "@/lib/print-templates";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  PersonFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
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
import { getDisposalExports, getDisposalStatuses, cancelDisposalExport } from "@/lib/services";
import type { DisposalExport } from "@/lib/types";
import { CreateDisposalDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const statusMap: Record<
  DisposalExport["status"],
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
function DisposalExportDetail({
  item,
  onClose,
}: {
  item: DisposalExport;
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
            title={`Phiếu xuất hủy ${item.code}`}
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
                  Người tạo: <strong>{formatUser(undefined, item.createdBy)}</strong>
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
              { label: "Người tạo", value: formatUser(undefined, item.createdBy) },
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
              ...(item.reason
                ? [
                    {
                      label: "Lý do",
                      value: item.reason,
                      fullWidth: true,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="disposal_export" entityId={item.id} />,
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
export default function XuatHuyPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<DisposalExport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<DisposalExport | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

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

  const statuses = getDisposalStatuses();

  /* ---- Columns ---- */
  const columns: ColumnDef<DisposalExport, unknown>[] = [
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
    const result = await getDisposalExports({
      page,
      pageSize,
      search,
      branchId: activeBranchId,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
        ...(creatorFilter && { createdBy: creatorFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, creatorFilter, activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, datePreset, creatorFilter]);

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã phiếu", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Người tạo", key: "createdBy", width: 15 },
      { header: "Tổng giá trị", key: "totalAmount", width: 15, format: (v: number) => v },
      { header: "Lý do", key: "reason", width: 25 },
      { header: "Trạng thái", key: "status", width: 15, format: (v: DisposalExport["status"]) => statusMap[v]?.label ?? v },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "xuat-huy");
    else exportToCsv(data, exportColumns, "xuat-huy");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (item: DisposalExport, onClose: () => void) => (
    <DisposalExportDetail item={item} onClose={onClose} />
  );

  /* ---- Render ---- */
  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={statuses}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Thời gian">
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              presets={[
                { label: "Tháng này", value: "this_month" },
                { label: "Hôm nay", value: "today" },
                { label: "Hôm qua", value: "yesterday" },
                { label: "Tuần này", value: "this_week" },
                { label: "Tháng trước", value: "last_month" },
                { label: "Tùy chỉnh", value: "custom" },
              ]}
            />
          </FilterGroup>

          <FilterGroup label="Người tạo">
            <PersonFilter
              value={creatorFilter}
              onChange={setCreatorFilter}
              placeholder="Chọn người tạo"
              suggestions={[
                { label: "Admin", value: "admin" },
                { label: "Cao Thị Huyền Trang", value: "trang" },
              ]}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Xuất hủy"
        searchPlaceholder="Theo mã phiếu xuất hủy"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Xuất hủy",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
          {
            label: "Xuất file",
            icon: <Icon name="download" size={16} />,
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        total={total}
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
        renderDetail={renderDetail}
        getRowId={(row) => row.id}
        rowActions={(row) => [
          {
            label: "In phiếu",
            icon: <Icon name="print" size={16} />,
            onClick: () => printDocument(buildDisposalPrintData(row)),
          },
          ...(row.status === "draft"
            ? [
                {
                  label: "Hủy",
                  icon: <Icon name="cancel" size={16} />,
                  onClick: () => setCancellingItem(row),
                  variant: "destructive" as const,
                  separator: true,
                },
              ]
            : []),
        ]}
      />

      <CreateDisposalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy phiếu xuất hủy"
        description={`Bạn có chắc muốn hủy phiếu xuất hủy ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
        confirmLabel="Hủy phiếu"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            await cancelDisposalExport(cancellingItem.id);
            toast({
              title: "Đã hủy phiếu xuất hủy",
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
