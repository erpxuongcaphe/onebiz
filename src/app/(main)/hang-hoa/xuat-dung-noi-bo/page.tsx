"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, Trash2 } from "lucide-react";
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
import { getInternalExports, getInternalExportStatuses } from "@/lib/services";
import type { InternalExport } from "@/lib/types";

// === Status config ===
const statusMap: Record<
  InternalExport["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  draft: { label: "Phiếu tạm", variant: "secondary" },
};

const statusOptions = getInternalExportStatuses();

// === Columns ===
const columns: ColumnDef<InternalExport, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu",
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
    accessorKey: "totalProducts",
    header: "Tổng SP",
    size: 80,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.totalProducts}</span>
    ),
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
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
    accessorKey: "note",
    header: "Ghi chú",
    size: 200,
    cell: ({ row }) => row.original.note || "—",
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

export default function XuatDungNoiBoPage() {
  const [data, setData] = useState<InternalExport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getInternalExports({
      page,
      pageSize,
      search,
      filters: {
        ...(statusFilter !== "all" && { status: statusFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter]);

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <SelectFilter
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Tất cả"
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
        title="Xuất dùng nội bộ"
        searchPlaceholder="Theo mã phiếu"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo phiếu", icon: <Plus className="h-4 w-4" />, variant: "default" },
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
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => {} },
          { label: "Xóa", icon: <Trash2 className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>
  );
}
