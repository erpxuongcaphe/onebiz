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
interface DisposalExport {
  id: string;
  code: string;
  date: string;
  totalProducts: number;
  totalAmount: number;
  reason: string;
  status: "completed" | "draft";
  statusName: string;
  createdBy: string;
}

// === Status config ===
const statusMap: Record<
  DisposalExport["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  draft: { label: "Phiếu tạm", variant: "secondary" },
};

const statusOptions = [
  { label: "Hoàn thành", value: "completed" },
  { label: "Phiếu tạm", value: "draft" },
];

// === Mock data ===
const mockData: DisposalExport[] = [
  { id: "1", code: "XH000001", date: "2026-03-30T10:30:00", totalProducts: 5, totalAmount: 1200000, reason: "Hàng hết hạn sử dụng", status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "XH000002", date: "2026-03-28T14:00:00", totalProducts: 3, totalAmount: 850000, reason: "Hàng bị hỏng", status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
  { id: "3", code: "XH000003", date: "2026-03-27T09:15:00", totalProducts: 8, totalAmount: 3200000, reason: "Hàng lỗi từ nhà cung cấp", status: "draft", statusName: "Phiếu tạm", createdBy: "Lê Văn C" },
  { id: "4", code: "XH000004", date: "2026-03-25T16:45:00", totalProducts: 2, totalAmount: 650000, reason: "Hàng hết hạn sử dụng", status: "completed", statusName: "Hoàn thành", createdBy: "Phạm Thị D" },
  { id: "5", code: "XH000005", date: "2026-03-24T11:20:00", totalProducts: 12, totalAmount: 5400000, reason: "Hàng bị ẩm mốc", status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "XH000006", date: "2026-03-23T08:00:00", totalProducts: 4, totalAmount: 1800000, reason: "Hàng bị hỏng do vận chuyển", status: "draft", statusName: "Phiếu tạm", createdBy: "Trần Thị B" },
  { id: "7", code: "XH000007", date: "2026-03-22T13:30:00", totalProducts: 6, totalAmount: 2100000, reason: "Hàng lỗi kỹ thuật", status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "8", code: "XH000008", date: "2026-03-20T15:00:00", totalProducts: 1, totalAmount: 350000, reason: "Hàng hết hạn sử dụng", status: "completed", statusName: "Hoàn thành", createdBy: "Phạm Thị D" },
  { id: "9", code: "XH000009", date: "2026-03-19T10:45:00", totalProducts: 7, totalAmount: 2900000, reason: "Hàng bị hỏng", status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "XH000010", date: "2026-03-18T09:00:00", totalProducts: 3, totalAmount: 1100000, reason: "Thu hồi sản phẩm", status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
];

async function fetchDisposalExports(params: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
}): Promise<{ data: DisposalExport[]; total: number }> {
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
const columns: ColumnDef<DisposalExport, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu",
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
    accessorKey: "totalProducts",
    header: "Tổng SP",
    size: 80,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.totalProducts}</span>
    ),
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng giá trị",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "reason",
    header: "Lý do",
    size: 220,
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

export default function XuatHuyPage() {
  const [data, setData] = useState<DisposalExport[]>([]);
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
    const result = await fetchDisposalExports({
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
        title="Xuất hủy"
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
      />
    </ListPageLayout>
  );
}
