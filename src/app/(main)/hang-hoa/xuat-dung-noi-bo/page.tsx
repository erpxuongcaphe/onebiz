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
interface InternalExport {
  id: string;
  code: string;
  date: string;
  totalProducts: number;
  totalAmount: number;
  status: "completed" | "draft";
  statusName: string;
  note?: string;
  createdBy: string;
}

// === Status config ===
const statusMap: Record<
  InternalExport["status"],
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
const mockData: InternalExport[] = [
  { id: "1", code: "XNBP000001", date: "2026-03-30T10:00:00", totalProducts: 5, totalAmount: 2500000, status: "completed", statusName: "Hoàn thành", note: "Dùng cho văn phòng", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "XNBP000002", date: "2026-03-29T14:30:00", totalProducts: 3, totalAmount: 1800000, status: "draft", statusName: "Phiếu tạm", note: "Dùng cho kho", createdBy: "Trần Thị B" },
  { id: "3", code: "XNBP000003", date: "2026-03-28T09:15:00", totalProducts: 8, totalAmount: 4200000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "4", code: "XNBP000004", date: "2026-03-27T16:45:00", totalProducts: 2, totalAmount: 900000, status: "completed", statusName: "Hoàn thành", note: "Cho bộ phận bán hàng", createdBy: "Phạm Thị D" },
  { id: "5", code: "XNBP000005", date: "2026-03-26T08:30:00", totalProducts: 10, totalAmount: 6500000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "XNBP000006", date: "2026-03-25T11:00:00", totalProducts: 4, totalAmount: 2100000, status: "completed", statusName: "Hoàn thành", note: "Quà tặng nhân viên", createdBy: "Trần Thị B" },
  { id: "7", code: "XNBP000007", date: "2026-03-24T15:20:00", totalProducts: 6, totalAmount: 3300000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "8", code: "XNBP000008", date: "2026-03-23T13:10:00", totalProducts: 1, totalAmount: 450000, status: "draft", statusName: "Phiếu tạm", note: "Dùng thử sản phẩm mới", createdBy: "Phạm Thị D" },
  { id: "9", code: "XNBP000009", date: "2026-03-22T10:30:00", totalProducts: 7, totalAmount: 3800000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "XNBP000010", date: "2026-03-21T08:00:00", totalProducts: 3, totalAmount: 1600000, status: "completed", statusName: "Hoàn thành", note: "Cho chi nhánh 2", createdBy: "Trần Thị B" },
  { id: "11", code: "XNBP000011", date: "2026-03-20T14:00:00", totalProducts: 5, totalAmount: 2750000, status: "draft", statusName: "Phiếu tạm", createdBy: "Lê Văn C" },
  { id: "12", code: "XNBP000012", date: "2026-03-19T09:45:00", totalProducts: 9, totalAmount: 5100000, status: "completed", statusName: "Hoàn thành", note: "Sự kiện công ty", createdBy: "Phạm Thị D" },
];

async function fetchInternalExports(params: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
}): Promise<{ data: InternalExport[]; total: number }> {
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
    const result = await fetchInternalExports({
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
      />
    </ListPageLayout>
  );
}
