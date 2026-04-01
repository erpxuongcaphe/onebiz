"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
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
import { getInputInvoices, getInputInvoiceStatuses } from "@/lib/services";
import type { InputInvoice } from "@/lib/types";

// === Status config ===
const statusMap: Record<
  InputInvoice["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  recorded: { label: "Đã ghi sổ", variant: "default" },
  unrecorded: { label: "Chưa ghi sổ", variant: "secondary" },
};

const statusOptions = getInputInvoiceStatuses();

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
  },
];

export default function HoaDonDauVaoPage() {
  const [data, setData] = useState<InputInvoice[]>([]);
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
    const result = await getInputInvoices({
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
        title="Hóa đơn đầu vào"
        searchPlaceholder="Theo mã HĐ, NCC"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo mới", icon: <Plus className="h-4 w-4" />, variant: "default" },
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
