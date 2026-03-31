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

// --------------- Inline types & mock data ---------------

interface InventoryCheck {
  id: string;
  code: string;
  date: string;
  status: "balanced" | "unbalanced" | "processing";
  statusName: string;
  totalProducts: number;
  increaseQty: number;
  decreaseQty: number;
  increaseAmount: number;
  decreaseAmount: number;
  note?: string;
  createdBy: string;
}

const mockInventoryChecks: InventoryCheck[] = [
  { id: "1", code: "KK000001", date: "2026-03-30T14:20:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 45, increaseQty: 3, decreaseQty: 3, increaseAmount: 450000, decreaseAmount: 450000, createdBy: "Nguyễn Văn An" },
  { id: "2", code: "KK000002", date: "2026-03-29T09:15:00", status: "unbalanced", statusName: "Lệch", totalProducts: 120, increaseQty: 5, decreaseQty: 8, increaseAmount: 1200000, decreaseAmount: 2400000, note: "Lệch kho tầng 2", createdBy: "Trần Thị Bích" },
  { id: "3", code: "KK000003", date: "2026-03-28T16:30:00", status: "processing", statusName: "Đang xử lý", totalProducts: 78, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Lê Hoàng Cường" },
  { id: "4", code: "KK000004", date: "2026-03-27T10:00:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 200, increaseQty: 10, decreaseQty: 10, increaseAmount: 3500000, decreaseAmount: 3500000, createdBy: "Phạm Minh Đức" },
  { id: "5", code: "KK000005", date: "2026-03-26T08:45:00", status: "unbalanced", statusName: "Lệch", totalProducts: 55, increaseQty: 2, decreaseQty: 7, increaseAmount: 600000, decreaseAmount: 1850000, note: "Thiếu hàng mỹ phẩm", createdBy: "Hoàng Thị Em" },
  { id: "6", code: "KK000006", date: "2026-03-25T13:10:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 90, increaseQty: 4, decreaseQty: 4, increaseAmount: 800000, decreaseAmount: 800000, createdBy: "Võ Văn Phúc" },
  { id: "7", code: "KK000007", date: "2026-03-24T11:20:00", status: "processing", statusName: "Đang xử lý", totalProducts: 150, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Đặng Thị Giang" },
  { id: "8", code: "KK000008", date: "2026-03-23T15:50:00", status: "unbalanced", statusName: "Lệch", totalProducts: 67, increaseQty: 8, decreaseQty: 3, increaseAmount: 2100000, decreaseAmount: 750000, note: "Thừa hàng điện tử", createdBy: "Bùi Quang Hải" },
  { id: "9", code: "KK000009", date: "2026-03-22T09:30:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 310, increaseQty: 15, decreaseQty: 15, increaseAmount: 5200000, decreaseAmount: 5200000, createdBy: "Ngô Thị Hương" },
  { id: "10", code: "KK000010", date: "2026-03-21T14:00:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 42, increaseQty: 1, decreaseQty: 1, increaseAmount: 150000, decreaseAmount: 150000, createdBy: "Trịnh Văn Khoa" },
  { id: "11", code: "KK000011", date: "2026-03-20T10:45:00", status: "unbalanced", statusName: "Lệch", totalProducts: 88, increaseQty: 0, decreaseQty: 5, increaseAmount: 0, decreaseAmount: 1350000, note: "Hao hụt thực phẩm", createdBy: "Lý Thị Loan" },
  { id: "12", code: "KK000012", date: "2026-03-19T08:20:00", status: "processing", statusName: "Đang xử lý", totalProducts: 175, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Phan Đức Mạnh" },
  { id: "13", code: "KK000013", date: "2026-03-18T16:15:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 63, increaseQty: 6, decreaseQty: 6, increaseAmount: 1800000, decreaseAmount: 1800000, createdBy: "Dương Thị Ngọc" },
  { id: "14", code: "KK000014", date: "2026-03-17T12:00:00", status: "unbalanced", statusName: "Lệch", totalProducts: 95, increaseQty: 12, decreaseQty: 4, increaseAmount: 3600000, decreaseAmount: 980000, note: "Nhập thừa đợt trước", createdBy: "Hồ Văn Phong" },
  { id: "15", code: "KK000015", date: "2026-03-16T09:00:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 130, increaseQty: 7, decreaseQty: 7, increaseAmount: 2100000, decreaseAmount: 2100000, createdBy: "Mai Thị Quỳnh" },
  { id: "16", code: "KK000016", date: "2026-03-15T14:30:00", status: "processing", statusName: "Đang xử lý", totalProducts: 210, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Tô Văn Sơn" },
  { id: "17", code: "KK000017", date: "2026-03-14T11:10:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 50, increaseQty: 2, decreaseQty: 2, increaseAmount: 500000, decreaseAmount: 500000, createdBy: "Vương Thị Tâm" },
  { id: "18", code: "KK000018", date: "2026-03-13T15:40:00", status: "unbalanced", statusName: "Lệch", totalProducts: 74, increaseQty: 3, decreaseQty: 9, increaseAmount: 720000, decreaseAmount: 2700000, note: "Lệch kho chi nhánh 3", createdBy: "Châu Minh Uy" },
  { id: "19", code: "KK000019", date: "2026-03-12T10:25:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 160, increaseQty: 9, decreaseQty: 9, increaseAmount: 2700000, decreaseAmount: 2700000, createdBy: "Đinh Thị Vân" },
  { id: "20", code: "KK000020", date: "2026-03-11T08:00:00", status: "processing", statusName: "Đang xử lý", totalProducts: 98, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Lương Văn Xuân" },
];

// --------------- Async fetch with search, filter, pagination ---------------

async function getInventoryChecks(params: {
  page: number;
  pageSize: number;
  search: string;
  filters: { status?: string };
}): Promise<{ data: InventoryCheck[]; total: number }> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...mockInventoryChecks];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter((item) => item.code.toLowerCase().includes(q));
  }

  if (params.filters.status) {
    filtered = filtered.filter((item) => item.status === params.filters.status);
  }

  const total = filtered.length;
  const start = params.page * params.pageSize;
  const data = filtered.slice(start, start + params.pageSize);

  return { data, total };
}

// --------------- Status config ---------------

const statusMap: Record<
  InventoryCheck["status"],
  { label: string; variant: "default" | "destructive" | "secondary" }
> = {
  balanced: { label: "Đã cân bằng", variant: "default" },
  unbalanced: { label: "Lệch", variant: "destructive" },
  processing: { label: "Đang xử lý", variant: "secondary" },
};

const statusOptions = [
  { value: "", label: "Tất cả" },
  { value: "balanced", label: "Đã cân bằng" },
  { value: "unbalanced", label: "Lệch" },
  { value: "processing", label: "Đang xử lý" },
];

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
