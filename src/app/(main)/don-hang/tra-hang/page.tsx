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

// --- Types ---

interface ReturnOrder {
  id: string;
  code: string;
  invoiceCode: string;
  date: string;
  customerName: string;
  totalAmount: number;
  status: "completed" | "draft";
  statusName: string;
  createdBy: string;
}

// --- Status config ---

const statusMap: Record<
  ReturnOrder["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  draft: { label: "Phiếu tạm", variant: "secondary" },
};

const statusOptions = [
  { label: "Hoàn thành", value: "completed" },
  { label: "Phiếu tạm", value: "draft" },
];

// --- Mock data ---

const mockReturns: ReturnOrder[] = [
  { id: "1", code: "TH000001", invoiceCode: "HD000045", date: "2026-03-31T09:00:00", customerName: "Nguyễn Văn An", totalAmount: 450000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "2", code: "TH000002", invoiceCode: "HD000038", date: "2026-03-30T14:30:00", customerName: "Trần Thị Bích", totalAmount: 1200000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "3", code: "TH000003", invoiceCode: "HD000032", date: "2026-03-29T10:15:00", customerName: "Lê Hoàng Cường", totalAmount: 380000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "4", code: "TH000004", invoiceCode: "HD000028", date: "2026-03-28T16:45:00", customerName: "Phạm Thị Dung", totalAmount: 2350000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "5", code: "TH000005", invoiceCode: "HD000025", date: "2026-03-27T08:20:00", customerName: "Hoàng Văn Em", totalAmount: 670000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "6", code: "TH000006", invoiceCode: "HD000021", date: "2026-03-26T13:00:00", customerName: "Vũ Thị Phương", totalAmount: 1890000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "7", code: "TH000007", invoiceCode: "HD000018", date: "2026-03-25T11:30:00", customerName: "Đặng Quốc Gia", totalAmount: 540000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "8", code: "TH000008", invoiceCode: "HD000015", date: "2026-03-24T15:10:00", customerName: "Bùi Thị Hạnh", totalAmount: 3120000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "9", code: "TH000009", invoiceCode: "HD000012", date: "2026-03-23T09:40:00", customerName: "Ngô Minh Khải", totalAmount: 780000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "10", code: "TH000010", invoiceCode: "HD000009", date: "2026-03-22T14:00:00", customerName: "Lý Thị Lan", totalAmount: 1560000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "11", code: "TH000011", invoiceCode: "HD000006", date: "2026-03-21T10:50:00", customerName: "Đỗ Văn Mạnh", totalAmount: 4200000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "12", code: "TH000012", invoiceCode: "HD000003", date: "2026-03-20T16:20:00", customerName: "Trịnh Thị Ngọc", totalAmount: 920000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
];

// --- Mock API ---

async function getReturns(params: {
  page: number;
  pageSize: number;
  search: string;
  filters: { status?: string };
}): Promise<{ data: ReturnOrder[]; total: number }> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...mockReturns];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (o) =>
        o.code.toLowerCase().includes(q) ||
        o.invoiceCode.toLowerCase().includes(q)
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

const columns: ColumnDef<ReturnOrder, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã trả hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "invoiceCode",
    header: "Mã hóa đơn",
    size: 130,
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
    accessorKey: "totalAmount",
    header: "Tổng tiền trả",
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

export default function TraHangPage() {
  const [data, setData] = useState<ReturnOrder[]>([]);
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
    const result = await getReturns({
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

  const totalReturnAmount = data.reduce((sum, o) => sum + o.totalAmount, 0);

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
        title="Trả hàng"
        searchPlaceholder="Theo mã phiếu, hóa đơn"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tạo phiếu trả",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
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
          totalAmount: formatCurrency(totalReturnAmount),
        }}
      />
    </ListPageLayout>
  );
}
