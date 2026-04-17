"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getInventoryChecks, getInventoryCheckStatuses, applyInventoryCheck, cancelInventoryCheck } from "@/lib/services";
import type { InventoryCheck } from "@/lib/types";
import { CreateInventoryCheckDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocument } from "@/lib/print-document";
import { buildInventoryCheckPrintData } from "@/lib/print-templates";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const statusMap: Record<
  InventoryCheck["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  processing: { label: "Phiếu tạm", variant: "secondary" },
  balanced: { label: "Đã cân bằng kho", variant: "default" },
  unbalanced: { label: "Đã hủy", variant: "destructive" },
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
function InventoryCheckDetail({
  item,
  onClose,
}: {
  item: InventoryCheck;
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
            title={`Phiếu kiểm kho ${item.code}`}
            code={item.code}
            status={{
              label: status.label,
              variant: status.variant,
              className:
                status.variant === "default"
                  ? "bg-blue-100 text-blue-700 border-blue-200"
                  : undefined,
            }}
            subtitle="Chi nhánh trung tâm"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{item.createdBy}</strong>
                </span>
                <span>
                  Thời gian: <strong>{formatDate(item.date)}</strong>
                </span>
              </div>
            }
          />

          <DetailInfoGrid
            fields={[
              { label: "Mã kiểm kho", value: item.code },
              { label: "Thời gian", value: formatDate(item.date) },
              { label: "Trạng thái", value: status.label },
              { label: "Người tạo", value: item.createdBy },
              {
                label: "Tổng sản phẩm",
                value: String(item.totalProducts),
              },
              {
                label: "SL lệch tăng",
                value: (
                  <span className="text-green-600">
                    {item.increaseQty}
                  </span>
                ),
              },
              {
                label: "SL lệch giảm",
                value: (
                  <span className="text-red-600">{item.decreaseQty}</span>
                ),
              },
              {
                label: "GT tăng",
                value: (
                  <span className="text-green-600">
                    {formatCurrency(item.increaseAmount)}
                  </span>
                ),
              },
              {
                label: "GT giảm",
                value: (
                  <span className="text-red-600">
                    {formatCurrency(item.decreaseAmount)}
                  </span>
                ),
              },
              {
                label: "Tổng chênh lệch",
                value: formatCurrency(
                  item.increaseAmount - item.decreaseAmount
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
      content: (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Chưa có lịch sử
        </div>
      ),
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
export default function KiemKhoPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<InventoryCheck[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [cancellingItem, setCancellingItem] = useState<InventoryCheck | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "processing",
    "balanced",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");

  const statuses = getInventoryCheckStatuses();

  /* ---- Columns ---- */
  const columns: ColumnDef<InventoryCheck, unknown>[] = [
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
      header: "Mã kiểm kho",
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
      id: "balanceDate",
      header: "Ngày cân bằng",
      size: 150,
      cell: ({ row }) =>
        row.original.status === "balanced"
          ? formatDate(row.original.date)
          : "—",
    },
    {
      accessorKey: "totalProducts",
      header: "SL thực tế",
      size: 100,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.totalProducts}</span>
      ),
    },
    {
      id: "totalActual",
      header: "Tổng thực tế",
      size: 130,
      cell: ({ row }) =>
        formatCurrency(row.original.increaseAmount + row.original.decreaseAmount),
    },
    {
      id: "totalDiff",
      header: "Tổng chênh lệch",
      size: 130,
      cell: ({ row }) => {
        const diff = row.original.increaseAmount - row.original.decreaseAmount;
        return (
          <span className={diff >= 0 ? "text-green-600" : "text-red-600"}>
            {formatCurrency(diff)}
          </span>
        );
      },
    },
    {
      accessorKey: "increaseQty",
      header: "SL lệch tăng",
      size: 100,
      cell: ({ row }) => (
        <span className="text-green-600">{row.original.increaseQty}</span>
      ),
    },
    {
      accessorKey: "decreaseQty",
      header: "SL lệch giảm",
      size: 100,
      cell: ({ row }) => (
        <span className="text-red-600">{row.original.decreaseQty}</span>
      ),
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getInventoryChecks({
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
      { header: "Mã kiểm kho", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Trạng thái", key: "status", width: 15, format: (v: InventoryCheck["status"]) => statusMap[v]?.label ?? v },
      { header: "Tổng SP", key: "totalProducts", width: 10 },
      { header: "SL lệch tăng", key: "increaseQty", width: 12 },
      { header: "SL lệch giảm", key: "decreaseQty", width: 12 },
      { header: "GT tăng", key: "increaseAmount", width: 15, format: (v: number) => v },
      { header: "GT giảm", key: "decreaseAmount", width: 15, format: (v: number) => v },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "phieu-kiem-kho");
    else exportToCsv(data, exportColumns, "phieu-kiem-kho");
  };

  /* ---- Apply inventory check (G7) ---- */
  const handleApply = async (row: InventoryCheck) => {
    if (applyingId) return; // prevent double-click while one is in-flight
    setApplyingId(row.id);
    try {
      await applyInventoryCheck(row.id);
      toast({
        title: "Áp dụng kiểm kê thành công",
        description: `Đã cân bằng kho theo phiếu ${row.code}`,
        variant: "success",
      });
      await fetchData();
    } catch (err) {
      toast({
        title: "Lỗi áp dụng kiểm kê",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setApplyingId(null);
    }
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (item: InventoryCheck, onClose: () => void) => (
    <InventoryCheckDetail item={item} onClose={onClose} />
  );

  /* ---- Render ---- */
  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Ngày tạo">
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

          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={statuses}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
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
        title="Phiếu kiểm kho"
        searchPlaceholder="Theo mã phiếu kiểm kho"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Kiểm kho",
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
          ...(row.status === "processing"
            ? [
                {
                  label: applyingId === row.id ? "Đang áp dụng..." : "Áp dụng kiểm kê",
                  icon: <Icon name="check_circle" size={16} />,
                  onClick: () => handleApply(row),
                },
              ]
            : []),
          {
            label: "In phiếu",
            icon: <Icon name="print" size={16} />,
            onClick: () => printDocument(buildInventoryCheckPrintData(row)),
          },
          ...(row.status === "processing"
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
    </ListPageLayout>

    <CreateInventoryCheckDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />

    <ConfirmDialog
      open={!!cancellingItem}
      onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
      title="Hủy phiếu kiểm kho"
      description={`Bạn có chắc muốn hủy phiếu kiểm kho ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
      confirmLabel="Hủy phiếu"
      cancelLabel="Đóng"
      variant="destructive"
      loading={cancelLoading}
      onConfirm={async () => {
        if (!cancellingItem) return;
        setCancelLoading(true);
        try {
          await cancelInventoryCheck(cancellingItem.id);
          toast({
            title: "Đã hủy phiếu kiểm kho",
            description: `Phiếu ${cancellingItem.code} đã được hủy thành công`,
            variant: "success",
          });
          await fetchData();
        } catch (err) {
          toast({
            title: "Lỗi hủy phiếu kiểm kho",
            description: err instanceof Error ? err.message : "Vui lòng thử lại",
            variant: "error",
          });
        } finally {
          setCancelLoading(false);
          setCancellingItem(null);
        }
      }}
    />
    </>
  );
}
