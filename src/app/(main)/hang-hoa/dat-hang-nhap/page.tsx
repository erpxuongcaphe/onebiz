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

// === Types ===
interface PurchaseOrderEntry {
  id: string;
  code: string;
  date: string;
  supplierName: string;
  totalAmount: number;
  status: "pending" | "partial" | "completed" | "cancelled";
  statusName: string;
  expectedDate: string;
  createdBy: string;
}

// === Status config ===
const statusMap: Record<
  PurchaseOrderEntry["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Chờ nhập", variant: "secondary" },
  partial: { label: "Nhập một phần", variant: "outline" },
  completed: { label: "Hoàn thành", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = [
  { label: "Chờ nhập", value: "pending" },
  { label: "Nhập một phần", value: "partial" },
  { label: "Hoàn thành", value: "completed" },
  { label: "Đã hủy", value: "cancelled" },
];

// === Mock data ===
const mockData: PurchaseOrderEntry[] = [
  { id: "1", code: "DHN000001", date: "2026-03-30T10:00:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 32000000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-05", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "DHN000002", date: "2026-03-29T14:30:00", supplierName: "Công ty CP Thành Công", totalAmount: 18500000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-04-02", createdBy: "Trần Thị B" },
  { id: "3", code: "DHN000003", date: "2026-03-28T09:15:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 45000000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-04-03", createdBy: "Lê Văn C" },
  { id: "4", code: "DHN000004", date: "2026-03-27T16:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 12800000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-06", createdBy: "Phạm Thị D" },
  { id: "5", code: "DHN000005", date: "2026-03-26T08:30:00", supplierName: "Công ty CP Đại Việt", totalAmount: 27600000, status: "cancelled", statusName: "Đã hủy", expectedDate: "2026-04-01", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "DHN000006", date: "2026-03-25T11:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 56000000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-30", createdBy: "Trần Thị B" },
  { id: "7", code: "DHN000007", date: "2026-03-24T13:45:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 21300000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-04", createdBy: "Lê Văn C" },
  { id: "8", code: "DHN000008", date: "2026-03-23T15:15:00", supplierName: "Công ty CP Thành Công", totalAmount: 9800000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-28", createdBy: "Phạm Thị D" },
  { id: "9", code: "DHN000009", date: "2026-03-22T10:30:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 38500000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-04-01", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "DHN000010", date: "2026-03-21T08:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 15200000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-07", createdBy: "Trần Thị B" },
  { id: "11", code: "DHN000011", date: "2026-03-20T14:00:00", supplierName: "Công ty CP Đại Việt", totalAmount: 42000000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-26", createdBy: "Lê Văn C" },
  { id: "12", code: "DHN000012", date: "2026-03-19T09:30:00", supplierName: "Công ty TNHH An Phú", totalAmount: 8700000, status: "cancelled", statusName: "Đã hủy", expectedDate: "2026-03-25", createdBy: "Phạm Thị D" },
  { id: "13", code: "DHN000013", date: "2026-03-18T16:30:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 29000000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-03-28", createdBy: "Nguyễn Văn A" },
  { id: "14", code: "DHN000014", date: "2026-03-17T11:15:00", supplierName: "Công ty CP Thành Công", totalAmount: 16400000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-08", createdBy: "Trần Thị B" },
  { id: "15", code: "DHN000015", date: "2026-03-16T08:45:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 53000000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-22", createdBy: "Lê Văn C" },
  { id: "16", code: "DHN000016", date: "2026-03-15T13:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 11500000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-20", createdBy: "Phạm Thị D" },
  { id: "17", code: "DHN000017", date: "2026-03-14T15:30:00", supplierName: "Công ty CP Đại Việt", totalAmount: 34200000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-10", createdBy: "Nguyễn Văn A" },
  { id: "18", code: "DHN000018", date: "2026-03-13T10:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 19800000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-03-24", createdBy: "Trần Thị B" },
];

async function fetchPurchaseOrders(params: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
}): Promise<{ data: PurchaseOrderEntry[]; total: number }> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  let filtered = [...mockData];
  if (params.search) {
    const s = params.search.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.code.toLowerCase().includes(s) ||
        item.supplierName.toLowerCase().includes(s)
    );
  }
  if (params.statusFilter && params.statusFilter !== "all") {
    filtered = filtered.filter((item) => item.status === params.statusFilter);
  }
  const total = filtered.length;
  const start = params.page * params.pageSize;
  return { data: filtered.slice(start, start + params.pageSize), total };
}

// === Columns ===
const columns: ColumnDef<PurchaseOrderEntry, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã đặt hàng",
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
    accessorKey: "supplierName",
    header: "NCC",
    size: 220,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "expectedDate",
    header: "Ngày dự kiến nhận",
    size: 150,
    cell: ({ row }) => formatDate(row.original.expectedDate),
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

export default function DatHangNhapPage() {
  const [data, setData] = useState<PurchaseOrderEntry[]>([]);
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
    const result = await fetchPurchaseOrders({
      page,
      pageSize,
      search,
      statusFilter,
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
        title="Đặt hàng nhập"
        searchPlaceholder="Theo mã, NCC"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Đặt hàng", icon: <Plus className="h-4 w-4" />, variant: "default" },
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
