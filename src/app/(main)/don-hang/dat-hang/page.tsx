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

// --- Types ---

interface Order {
  id: string;
  code: string;
  date: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  status: "new" | "confirmed" | "delivering" | "completed" | "cancelled";
  statusName: string;
  createdBy: string;
}

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

const statusOptions = [
  { label: "Mới", value: "new" },
  { label: "Đã xác nhận", value: "confirmed" },
  { label: "Đang giao", value: "delivering" },
  { label: "Hoàn thành", value: "completed" },
  { label: "Đã hủy", value: "cancelled" },
];

// --- Mock data ---

const mockOrders: Order[] = [
  { id: "1", code: "DH000001", date: "2026-03-31T08:15:00", customerName: "Nguyễn Văn An", customerPhone: "0901234567", totalAmount: 1250000, status: "new", statusName: "Mới", createdBy: "Trần Minh" },
  { id: "2", code: "DH000002", date: "2026-03-31T09:30:00", customerName: "Trần Thị Bích", customerPhone: "0912345678", totalAmount: 3450000, status: "confirmed", statusName: "Đã xác nhận", createdBy: "Nguyễn Hà" },
  { id: "3", code: "DH000003", date: "2026-03-30T14:20:00", customerName: "Lê Hoàng Cường", customerPhone: "0923456789", totalAmount: 890000, status: "delivering", statusName: "Đang giao", createdBy: "Trần Minh" },
  { id: "4", code: "DH000004", date: "2026-03-30T10:45:00", customerName: "Phạm Thị Dung", customerPhone: "0934567890", totalAmount: 5670000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "5", code: "DH000005", date: "2026-03-29T16:00:00", customerName: "Hoàng Văn Em", customerPhone: "0945678901", totalAmount: 2340000, status: "cancelled", statusName: "Đã hủy", createdBy: "Nguyễn Hà" },
  { id: "6", code: "DH000006", date: "2026-03-29T11:20:00", customerName: "Vũ Thị Phương", customerPhone: "0956789012", totalAmount: 4120000, status: "new", statusName: "Mới", createdBy: "Trần Minh" },
  { id: "7", code: "DH000007", date: "2026-03-28T08:30:00", customerName: "Đặng Quốc Gia", customerPhone: "0967890123", totalAmount: 1780000, status: "confirmed", statusName: "Đã xác nhận", createdBy: "Lê Hương" },
  { id: "8", code: "DH000008", date: "2026-03-28T15:10:00", customerName: "Bùi Thị Hạnh", customerPhone: "0978901234", totalAmount: 6230000, status: "delivering", statusName: "Đang giao", createdBy: "Nguyễn Hà" },
  { id: "9", code: "DH000009", date: "2026-03-27T09:45:00", customerName: "Ngô Minh Khải", customerPhone: "0989012345", totalAmount: 950000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "10", code: "DH000010", date: "2026-03-27T13:00:00", customerName: "Lý Thị Lan", customerPhone: "0990123456", totalAmount: 3890000, status: "new", statusName: "Mới", createdBy: "Lê Hương" },
  { id: "11", code: "DH000011", date: "2026-03-26T10:30:00", customerName: "Đỗ Văn Mạnh", customerPhone: "0361234567", totalAmount: 7450000, status: "confirmed", statusName: "Đã xác nhận", createdBy: "Nguyễn Hà" },
  { id: "12", code: "DH000012", date: "2026-03-26T14:15:00", customerName: "Trịnh Thị Ngọc", customerPhone: "0372345678", totalAmount: 2100000, status: "delivering", statusName: "Đang giao", createdBy: "Trần Minh" },
  { id: "13", code: "DH000013", date: "2026-03-25T08:00:00", customerName: "Phan Quốc Oai", customerPhone: "0383456789", totalAmount: 4560000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "14", code: "DH000014", date: "2026-03-25T11:40:00", customerName: "Mai Thị Phượng", customerPhone: "0394567890", totalAmount: 1340000, status: "cancelled", statusName: "Đã hủy", createdBy: "Trần Minh" },
  { id: "15", code: "DH000015", date: "2026-03-24T16:20:00", customerName: "Cao Văn Quang", customerPhone: "0705678901", totalAmount: 8900000, status: "new", statusName: "Mới", createdBy: "Nguyễn Hà" },
  { id: "16", code: "DH000016", date: "2026-03-24T09:00:00", customerName: "Đinh Thị Rạng", customerPhone: "0716789012", totalAmount: 2670000, status: "confirmed", statusName: "Đã xác nhận", createdBy: "Lê Hương" },
  { id: "17", code: "DH000017", date: "2026-03-23T13:30:00", customerName: "Tạ Minh Sơn", customerPhone: "0727890123", totalAmount: 5120000, status: "delivering", statusName: "Đang giao", createdBy: "Trần Minh" },
  { id: "18", code: "DH000018", date: "2026-03-23T10:15:00", customerName: "Hà Thị Trang", customerPhone: "0738901234", totalAmount: 1890000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Hà" },
  { id: "19", code: "DH000019", date: "2026-03-22T15:45:00", customerName: "Lương Văn Uy", customerPhone: "0749012345", totalAmount: 3210000, status: "new", statusName: "Mới", createdBy: "Lê Hương" },
  { id: "20", code: "DH000020", date: "2026-03-22T08:50:00", customerName: "Châu Thị Vân", customerPhone: "0750123456", totalAmount: 6780000, status: "cancelled", statusName: "Đã hủy", createdBy: "Trần Minh" },
  { id: "21", code: "DH000021", date: "2026-03-21T11:00:00", customerName: "Dương Xuân Bắc", customerPhone: "0561234567", totalAmount: 4350000, status: "confirmed", statusName: "Đã xác nhận", createdBy: "Nguyễn Hà" },
  { id: "22", code: "DH000022", date: "2026-03-21T14:30:00", customerName: "Tô Thị Yến", customerPhone: "0572345678", totalAmount: 990000, status: "delivering", statusName: "Đang giao", createdBy: "Lê Hương" },
  { id: "23", code: "DH000023", date: "2026-03-20T09:20:00", customerName: "Kiều Văn Đạt", customerPhone: "0583456789", totalAmount: 7230000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "24", code: "DH000024", date: "2026-03-20T16:40:00", customerName: "Quách Thị Hiền", customerPhone: "0594567890", totalAmount: 1560000, status: "new", statusName: "Mới", createdBy: "Nguyễn Hà" },
  { id: "25", code: "DH000025", date: "2026-03-19T12:00:00", customerName: "Thái Bảo Long", customerPhone: "0865678901", totalAmount: 4890000, status: "confirmed", statusName: "Đã xác nhận", createdBy: "Lê Hương" },
];

// --- Mock API ---

async function getOrders(params: {
  page: number;
  pageSize: number;
  search: string;
  filters: { status?: string };
}): Promise<{ data: Order[]; total: number }> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...mockOrders];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (o) =>
        o.code.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q)
    );
  }

  if (params.filters.status && params.filters.status !== "all") {
    filtered = filtered.filter((o) => o.status === params.filters.status);
  }

  const start = params.page * params.pageSize;
  return {
    data: filtered.slice(start, start + params.pageSize),
    total: filtered.length,
  };
}

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
      />
    </ListPageLayout>
  );
}
