"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Printer, XCircle } from "lucide-react";
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
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getManufacturingOrders, getManufacturingStatuses } from "@/lib/services";
import type { ManufacturingOrder } from "@/lib/types";
import { CreateManufacturingOrderDialog } from "@/components/shared/dialogs";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const statusMap: Record<
  ManufacturingOrder["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  processing: { label: "Dang xu ly", variant: "secondary" },
  completed: { label: "Hoan thanh", variant: "default" },
  cancelled: { label: "Da huy", variant: "destructive" },
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
function ManufacturingOrderDetail({
  item,
  onClose,
}: {
  item: ManufacturingOrder;
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
            title={`Phieu san xuat ${item.code}`}
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
              { label: "Ma phieu", value: item.code },
              { label: "Thoi gian", value: formatDate(item.date) },
              { label: "Trang thai", value: status.label },
              { label: "Nguoi tao", value: item.createdBy },
              { label: "San pham san xuat", value: item.productName },
              { label: "Ma hang", value: item.productCode },
              {
                label: "So luong",
                value: (
                  <span className="font-semibold">{item.quantity}</span>
                ),
              },
              {
                label: "Gia thanh",
                value: formatCurrency(item.costAmount),
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "materials",
      label: "Nguyen vat lieu",
      content: (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Chua co du lieu nguyen vat lieu
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
export default function SanXuatPage() {
  const [data, setData] = useState<ManufacturingOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "processing",
    "completed",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");

  const statuses = getManufacturingStatuses();

  /* ---- Columns ---- */
  const columns: ColumnDef<ManufacturingOrder, unknown>[] = [
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
      header: "Ma phieu",
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
      accessorKey: "productName",
      header: "San pham san xuat",
      size: 220,
    },
    {
      accessorKey: "quantity",
      header: "So luong",
      size: 100,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.quantity}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trang thai",
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
    const result = await getManufacturingOrders({
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
      { header: "Ma phieu", key: "code", width: 15 },
      { header: "Thoi gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "San pham san xuat", key: "productName", width: 25 },
      { header: "Ma hang", key: "productCode", width: 12 },
      { header: "So luong", key: "quantity", width: 10 },
      { header: "Gia thanh", key: "costAmount", width: 15, format: (v: number) => v },
      { header: "Trang thai", key: "status", width: 15, format: (v: ManufacturingOrder["status"]) => statusMap[v]?.label ?? v },
      { header: "Nguoi tao", key: "createdBy", width: 15 },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "phieu-san-xuat");
    else exportToCsv(data, exportColumns, "phieu-san-xuat");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (item: ManufacturingOrder, onClose: () => void) => (
    <ManufacturingOrderDetail item={item} onClose={onClose} />
  );

  /* ---- Render ---- */
  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trang thai">
            <CheckboxFilter
              options={statuses}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Thoi gian">
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
        title="Phieu san xuat"
        searchPlaceholder="Theo ma phieu san xuat"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "San xuat",
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

      <CreateManufacturingOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />
    </ListPageLayout>
  );
}
