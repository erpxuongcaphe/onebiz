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
interface PurchaseReturn {
  id: string;
  code: string;
  date: string;
  importCode: string;
  supplierName: string;
  totalAmount: number;
  status: "completed" | "draft";
  statusName: string;
  createdBy: string;
}

// === Status config ===
const statusMap: Record<
  PurchaseReturn["status"],
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
const mockData: PurchaseReturn[] = [
  { id: "1", code: "THN000001", date: "2026-03-30T10:00:00", importCode: "NH000012", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 8500000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "THN000002", date: "2026-03-28T14:30:00", importCode: "NH000015", supplierName: "Công ty CP Thành Công", totalAmount: 3200000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
  { id: "3", code: "THN000003", date: "2026-03-27T09:00:00", importCode: "NH000018", supplierName: "Công ty TNHH Minh Quang", totalAmount: 12500000, status: "draft", statusName: "Phiếu tạm", createdBy: "Lê Văn C" },
  { id: "4", code: "THN000004", date: "2026-03-25T16:15:00", importCode: "NH000020", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 4800000, status: "completed", statusName: "Hoàn thành", createdBy: "Phạm Thị D" },
  { id: "5", code: "THN000005", date: "2026-03-24T11:30:00", importCode: "NH000022", supplierName: "Công ty CP Đại Việt", totalAmount: 15600000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "THN000006", date: "2026-03-22T08:45:00", importCode: "NH000025", supplierName: "Công ty TNHH An Phú", totalAmount: 6700000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
  { id: "7", code: "THN000007", date: "2026-03-20T13:00:00", importCode: "NH000028", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 9200000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "8", code: "THN000008", date: "2026-03-19T15:30:00", importCode: "NH000030", supplierName: "Công ty CP Thành Công", totalAmount: 2100000, status: "draft", statusName: "Phiếu tạm", createdBy: "Phạm Thị D" },
  { id: "9", code: "THN000009", date: "2026-03-17T10:15:00", importCode: "NH000033", supplierName: "Công ty TNHH Minh Quang", totalAmount: 18300000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "THN000010", date: "2026-03-16T09:00:00", importCode: "NH000035", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 5400000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
];

async function fetchPurchaseReturns(params: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
}): Promise<{ data: PurchaseReturn[]; total: number }> {
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
const columns: ColumnDef<PurchaseReturn, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã trả hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "importCode",
    header: "Mã nhập hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.importCode}</span>
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
    header: "Tổng tiền trả",
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
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

export default function TraHangNhapPage() {
  const [data, setData] = useState<PurchaseReturn[]>([]);
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
    const result = await fetchPurchaseReturns({
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
        title="Trả hàng nhập"
        searchPlaceholder="Theo mã phiếu"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo phiếu trả", icon: <Plus className="h-4 w-4" />, variant: "default" },
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
