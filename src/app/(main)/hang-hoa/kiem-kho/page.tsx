"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Printer, XCircle, CheckCircle2 } from "lucide-react";
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
import { getInventoryChecks, getInventoryCheckStatuses, applyInventoryCheck } from "@/lib/services";
import type { InventoryCheck } from "@/lib/types";
import { CreateInventoryCheckDialog } from "@/components/shared/dialogs";
import { useToast } from "@/lib/contexts";

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
      label: "Thong tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Phieu kiem kho ${item.code}`}
            code={item.code}
            status={{
              label: status.label,
              variant: status.variant,
              className:
                status.variant === "default"
                  ? "bg-blue-100 text-blue-700 border-blue-200"
                  : undefined,
            }}
            subtitle="Chi nhanh trung tam"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Nguoi tao: <strong>{item.createdBy}</strong>
                </span>
                <span>
                  Thoi gian: <strong>{formatDate(item.date)}</strong>
                </span>
              </div>
            }
          />

          <DetailInfoGrid
            fields={[
              { label: "Ma kiem kho", value: item.code },
              { label: "Thoi gian", value: formatDate(item.date) },
              { label: "Trang thai", value: status.label },
              { label: "Nguoi tao", value: item.createdBy },
              {
                label: "Tong san pham",
                value: String(item.totalProducts),
              },
              {
                label: "SL lech tang",
                value: (
                  <span className="text-green-600">
                    {item.increaseQty}
                  </span>
                ),
              },
              {
                label: "SL lech giam",
                value: (
                  <span className="text-red-600">{item.decreaseQty}</span>
                ),
              },
              {
                label: "GT tang",
                value: (
                  <span className="text-green-600">
                    {formatCurrency(item.increaseAmount)}
                  </span>
                ),
              },
              {
                label: "GT giam",
                value: (
                  <span className="text-red-600">
                    {formatCurrency(item.decreaseAmount)}
                  </span>
                ),
              },
              {
                label: "Tong chenh lech",
                value: formatCurrency(
                  item.increaseAmount - item.decreaseAmount
                ),
              },
              ...(item.note
                ? [{ label: "Ghi chu", value: item.note, fullWidth: true }]
                : []),
            ]}
          />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lich su",
      content: (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Chua co lich su
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
  const [data, setData] = useState<InventoryCheck[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

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
      header: "Ma kiem kho",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "date",
      header: "Thoi gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      id: "balanceDate",
      header: "Ngay can bang",
      size: 150,
      cell: ({ row }) =>
        row.original.status === "balanced"
          ? formatDate(row.original.date)
          : "—",
    },
    {
      accessorKey: "totalProducts",
      header: "SL thuc te",
      size: 100,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.totalProducts}</span>
      ),
    },
    {
      id: "totalActual",
      header: "Tong thuc te",
      size: 130,
      cell: ({ row }) =>
        formatCurrency(row.original.increaseAmount + row.original.decreaseAmount),
    },
    {
      id: "totalDiff",
      header: "Tong chenh lech",
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
      header: "SL lech tang",
      size: 100,
      cell: ({ row }) => (
        <span className="text-green-600">{row.original.increaseQty}</span>
      ),
    },
    {
      accessorKey: "decreaseQty",
      header: "SL lech giam",
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
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
        ...(creatorFilter && { createdBy: creatorFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, creatorFilter]);

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
      { header: "Ma kiem kho", key: "code", width: 15 },
      { header: "Thoi gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Trang thai", key: "status", width: 15, format: (v: InventoryCheck["status"]) => statusMap[v]?.label ?? v },
      { header: "Tong SP", key: "totalProducts", width: 10 },
      { header: "SL lech tang", key: "increaseQty", width: 12 },
      { header: "SL lech giam", key: "decreaseQty", width: 12 },
      { header: "GT tang", key: "increaseAmount", width: 15, format: (v: number) => v },
      { header: "GT giam", key: "decreaseAmount", width: 15, format: (v: number) => v },
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
          <FilterGroup label="Ngay tao">
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              presets={[
                { label: "Thang nay", value: "this_month" },
                { label: "Hom nay", value: "today" },
                { label: "Hom qua", value: "yesterday" },
                { label: "Tuan nay", value: "this_week" },
                { label: "Thang truoc", value: "last_month" },
                { label: "Tuy chinh", value: "custom" },
              ]}
            />
          </FilterGroup>

          <FilterGroup label="Trang thai">
            <CheckboxFilter
              options={statuses}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Nguoi tao">
            <PersonFilter
              value={creatorFilter}
              onChange={setCreatorFilter}
              placeholder="Chon nguoi tao"
              suggestions={[
                { label: "Admin", value: "admin" },
                { label: "Cao Thi Huyen Trang", value: "trang" },
              ]}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Phieu kiem kho"
        searchPlaceholder="Theo ma phieu kiem kho"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Kiem kho",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
          {
            label: "Xuat file",
            icon: <Download className="h-4 w-4" />,
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
                  icon: <CheckCircle2 className="h-4 w-4" />,
                  onClick: () => handleApply(row),
                },
              ]
            : []),
          {
            label: "In phieu",
            icon: <Printer className="h-4 w-4" />,
            onClick: () => {},
          },
          {
            label: "Huy",
            icon: <XCircle className="h-4 w-4" />,
            onClick: () => {},
            variant: "destructive",
            separator: true,
          },
        ]}
      />
    </ListPageLayout>

    <CreateInventoryCheckDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />
    </>
  );
}
