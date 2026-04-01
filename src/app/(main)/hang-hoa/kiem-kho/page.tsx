"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import { formatCurrency, formatDate } from "@/lib/format";
import { getInventoryChecks, getInventoryCheckStatuses } from "@/lib/services";
import type { InventoryCheck } from "@/lib/types";

// --------------- Status config ---------------

const statusMap: Record<
  InventoryCheck["status"],
  { label: string; variant: "default" | "destructive" | "secondary" }
> = {
  balanced: { label: "Đã cân bằng", variant: "default" },
  unbalanced: { label: "Lệch", variant: "destructive" },
  processing: { label: "Đang xử lý", variant: "secondary" },
};

const statusOptions = getInventoryCheckStatuses();

// --------------- Column definitions ---------------

const columns: ColumnDef<InventoryCheck, unknown>[] = [
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
    accessorKey: "status",
    header: "Trạng thái",
    size: 130,
    cell: ({ row }) => {
      const { label, variant } = statusMap[row.original.status];
      return <Badge variant={variant}>{label}</Badge>;
    },
  },
  {
    accessorKey: "totalProducts",
    header: "Tổng SP",
    size: 90,
  },
  {
    accessorKey: "increaseQty",
    header: "SL tăng",
    size: 90,
    cell: ({ row }) => (
      <span className="text-green-600">{row.original.increaseQty}</span>
    ),
  },
  {
    accessorKey: "decreaseQty",
    header: "SL giảm",
    size: 90,
    cell: ({ row }) => (
      <span className="text-red-600">{row.original.decreaseQty}</span>
    ),
  },
  {
    accessorKey: "increaseAmount",
    header: "GT tăng",
    size: 120,
    cell: ({ row }) => formatCurrency(row.original.increaseAmount),
  },
  {
    accessorKey: "decreaseAmount",
    header: "GT giảm",
    size: 120,
    cell: ({ row }) => formatCurrency(row.original.decreaseAmount),
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 150,
  },
];

// --------------- Page component ---------------

export default function KiemKhoPage() {
  const [data, setData] = useState<InventoryCheck[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [selectedStatus, setSelectedStatus] = useState("");
  const [datePreset, setDatePreset] = useState<
    "today" | "this_week" | "this_month" | "all" | "custom"
  >("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getInventoryChecks({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedStatus && { status: selectedStatus }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, selectedStatus]);

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <SelectFilter
              options={statusOptions}
              value={selectedStatus}
              onChange={setSelectedStatus}
            />
          </FilterGroup>

          <FilterGroup label="Thời gian">
            <DateRangeFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Kiểm kho"
        searchPlaceholder="Theo mã phiếu kiểm kho"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Kiểm kho",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
          },
          {
            label: "Xuất file",
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
      />
    </ListPageLayout>
  );
}
