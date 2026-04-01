"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Eye, CheckCircle, FileText, XCircle } from "lucide-react";
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
import { getOrders, getOrderStatuses } from "@/lib/services";
import type { SalesOrder as Order } from "@/lib/types";

// --- Status config ---

const statusMap: Record<
  Order["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  new: { label: "Mới", variant: "secondary" },
  confirmed: { label: "Đã xác nhận", variant: "default" },
  delivering: { label: "Đang giao", variant: "outline" },
  completed: { label: "Hoàn thành", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = getOrderStatuses();

// --- Columns ---

const columns: ColumnDef<Order, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã đơn",
    size: 120,
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
    accessorKey: "customerName",
    header: "Khách hàng",
    size: 180,
  },
  {
    accessorKey: "customerPhone",
    header: "SĐT",
    size: 120,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    cell: ({ row }) => {
      const s = statusMap[row.original.status];
      return <Badge variant={s.variant}>{s.label}</Badge>;
    },
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 130,
  },
];

// --- Page ---

export default function DatHangPage() {
  const router = useRouter();
  const [data, setData] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<
    "today" | "this_week" | "this_month" | "all" | "custom"
  >("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getOrders({
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

  const totalAmount = data.reduce((sum, o) => sum + o.totalAmount, 0);

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
        title="Đặt hàng"
        searchPlaceholder="Theo mã đơn, khách hàng"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tạo đơn hàng",
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
        summaryRow={{
          totalAmount: formatCurrency(totalAmount),
        }}
        onRowClick={(row) => router.push(`/don-hang/dat-hang/${row.id}`)}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/don-hang/dat-hang/${row.id}`) },
          { label: "Xác nhận", icon: <CheckCircle className="h-4 w-4" />, onClick: () => {} },
          { label: "Tạo hóa đơn", icon: <FileText className="h-4 w-4" />, onClick: () => {} },
          { label: "Hủy", icon: <XCircle className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>
  );
}
