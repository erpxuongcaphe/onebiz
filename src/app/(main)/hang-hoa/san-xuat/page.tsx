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
interface ManufacturingOrder {
  id: string;
  code: string;
  date: string;
  productName: string;
  productCode: string;
  quantity: number;
  status: "completed" | "processing" | "cancelled";
  statusName: string;
  costAmount: number;
  createdBy: string;
}

// === Status config ===
const statusMap: Record<
  ManufacturingOrder["status"],
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  processing: { label: "Đang xử lý", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = [
  { label: "Hoàn thành", value: "completed" },
  { label: "Đang xử lý", value: "processing" },
  { label: "Đã hủy", value: "cancelled" },
];

// === Mock data ===
const mockData: ManufacturingOrder[] = [
  { id: "1", code: "PSX000001", date: "2026-03-30T14:20:00", productName: "Bánh mì ngọt", productCode: "SP001", quantity: 200, status: "completed", statusName: "Hoàn thành", costAmount: 3000000, createdBy: "Nguyễn Văn A" },
  { id: "2", code: "PSX000002", date: "2026-03-29T09:15:00", productName: "Bánh mì mặn", productCode: "SP002", quantity: 150, status: "completed", statusName: "Hoàn thành", costAmount: 2700000, createdBy: "Trần Thị B" },
  { id: "3", code: "PSX000003", date: "2026-03-28T16:30:00", productName: "Nước ép cam", productCode: "SP003", quantity: 500, status: "processing", statusName: "Đang xử lý", costAmount: 5000000, createdBy: "Lê Văn C" },
  { id: "4", code: "PSX000004", date: "2026-03-27T08:45:00", productName: "Sữa chua trái cây", productCode: "SP004", quantity: 300, status: "completed", statusName: "Hoàn thành", costAmount: 4500000, createdBy: "Phạm Thị D" },
  { id: "5", code: "PSX000005", date: "2026-03-26T11:00:00", productName: "Bánh quy bơ", productCode: "SP005", quantity: 100, status: "cancelled", statusName: "Đã hủy", costAmount: 1500000, createdBy: "Nguyễn Văn A" },
  { id: "6", code: "PSX000006", date: "2026-03-25T13:30:00", productName: "Bánh mì ngọt", productCode: "SP001", quantity: 250, status: "completed", statusName: "Hoàn thành", costAmount: 3750000, createdBy: "Trần Thị B" },
  { id: "7", code: "PSX000007", date: "2026-03-24T10:00:00", productName: "Nước ép dưa hấu", productCode: "SP006", quantity: 400, status: "processing", statusName: "Đang xử lý", costAmount: 3200000, createdBy: "Lê Văn C" },
  { id: "8", code: "PSX000008", date: "2026-03-23T15:45:00", productName: "Kem socola", productCode: "SP007", quantity: 80, status: "completed", statusName: "Hoàn thành", costAmount: 2400000, createdBy: "Phạm Thị D" },
  { id: "9", code: "PSX000009", date: "2026-03-22T07:30:00", productName: "Bánh bông lan", productCode: "SP008", quantity: 120, status: "completed", statusName: "Hoàn thành", costAmount: 1800000, createdBy: "Nguyễn Văn A" },
  { id: "10", code: "PSX000010", date: "2026-03-21T09:00:00", productName: "Sữa đậu nành", productCode: "SP009", quantity: 600, status: "processing", statusName: "Đang xử lý", costAmount: 4200000, createdBy: "Trần Thị B" },
  { id: "11", code: "PSX000011", date: "2026-03-20T14:15:00", productName: "Bánh cuốn", productCode: "SP010", quantity: 180, status: "completed", statusName: "Hoàn thành", costAmount: 2160000, createdBy: "Lê Văn C" },
  { id: "12", code: "PSX000012", date: "2026-03-19T11:30:00", productName: "Nước ép cam", productCode: "SP003", quantity: 350, status: "cancelled", statusName: "Đã hủy", costAmount: 3500000, createdBy: "Phạm Thị D" },
  { id: "13", code: "PSX000013", date: "2026-03-18T08:00:00", productName: "Bánh mì mặn", productCode: "SP002", quantity: 200, status: "completed", statusName: "Hoàn thành", costAmount: 3600000, createdBy: "Nguyễn Văn A" },
  { id: "14", code: "PSX000014", date: "2026-03-17T16:00:00", productName: "Kem vani", productCode: "SP011", quantity: 90, status: "processing", statusName: "Đang xử lý", costAmount: 2700000, createdBy: "Trần Thị B" },
  { id: "15", code: "PSX000015", date: "2026-03-16T10:45:00", productName: "Bánh quy bơ", productCode: "SP005", quantity: 160, status: "completed", statusName: "Hoàn thành", costAmount: 2400000, createdBy: "Lê Văn C" },
];

async function fetchManufacturingOrders(params: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
}): Promise<{ data: ManufacturingOrder[]; total: number }> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  let filtered = [...mockData];
  if (params.search) {
    const s = params.search.toLowerCase();
    filtered = filtered.filter((item) => item.code.toLowerCase().includes(s));
  }
  if (params.statusFilter && params.statusFilter !== "all") {
    filtered = filtered.filter((item) => item.status === params.statusFilter);
  }
  const total = filtered.length;
  const start = params.page * params.pageSize;
  return { data: filtered.slice(start, start + params.pageSize), total };
}

// === Columns ===
const columns: ColumnDef<ManufacturingOrder, unknown>[] = [
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
    accessorKey: "productName",
    header: "Hàng sản xuất",
    size: 200,
  },
  {
    accessorKey: "productCode",
    header: "Mã hàng",
    size: 100,
  },
  {
    accessorKey: "quantity",
    header: "SL sản xuất",
    size: 110,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.quantity}</span>
    ),
  },
  {
    accessorKey: "costAmount",
    header: "Giá thành",
    cell: ({ row }) => formatCurrency(row.original.costAmount),
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
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

export default function SanXuatPage() {
  const [data, setData] = useState<ManufacturingOrder[]>([]);
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
    const result = await fetchManufacturingOrders({
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
        title="Sản xuất"
        searchPlaceholder="Theo mã phiếu"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo phiếu SX", icon: <Plus className="h-4 w-4" />, variant: "default" },
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
