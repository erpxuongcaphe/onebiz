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
interface InputInvoice {
  id: string;
  code: string;
  date: string;
  supplierName: string;
  totalAmount: number;
  taxAmount: number;
  status: "recorded" | "unrecorded";
  statusName: string;
  createdBy: string;
}

// === Status config ===
const statusMap: Record<
  InputInvoice["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  recorded: { label: "Đã ghi sổ", variant: "default" },
  unrecorded: { label: "Chưa ghi sổ", variant: "secondary" },
};

const statusOptions = [
  { label: "Đã ghi sổ", value: "recorded" },
  { label: "Chưa ghi sổ", value: "unrecorded" },
];

// === Mock data ===
const mockData: InputInvoice[] = [
  { id: "1", code: "HDDV000001", date: "2026-03-30T10:00:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 25000000, taxAmount: 2500000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "HDDV000002", date: "2026-03-29T14:30:00", supplierName: "Công ty CP Thành Công", totalAmount: 18500000, taxAmount: 1850000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Trần Thị B" },
  { id: "3", code: "HDDV000003", date: "2026-03-28T09:00:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 42000000, taxAmount: 4200000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Lê Văn C" },
  { id: "4", code: "HDDV000004", date: "2026-03-27T16:15:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 9800000, taxAmount: 980000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Phạm Thị D" },
  { id: "5", code: "HDDV000005", date: "2026-03-26T11:30:00", supplierName: "Công ty CP Đại Việt", totalAmount: 35600000, taxAmount: 3560000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "HDDV000006", date: "2026-03-25T08:45:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 15200000, taxAmount: 1520000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Trần Thị B" },
  { id: "7", code: "HDDV000007", date: "2026-03-24T13:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 28700000, taxAmount: 2870000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Lê Văn C" },
  { id: "8", code: "HDDV000008", date: "2026-03-23T15:30:00", supplierName: "Công ty CP Thành Công", totalAmount: 6500000, taxAmount: 650000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Phạm Thị D" },
  { id: "9", code: "HDDV000009", date: "2026-03-22T10:15:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 51000000, taxAmount: 5100000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "HDDV000010", date: "2026-03-21T09:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 12300000, taxAmount: 1230000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Trần Thị B" },
  { id: "11", code: "HDDV000011", date: "2026-03-20T14:45:00", supplierName: "Công ty CP Đại Việt", totalAmount: 22100000, taxAmount: 2210000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Lê Văn C" },
  { id: "12", code: "HDDV000012", date: "2026-03-19T11:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 8900000, taxAmount: 890000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Phạm Thị D" },
  { id: "13", code: "HDDV000013", date: "2026-03-18T08:30:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 31500000, taxAmount: 3150000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "14", code: "HDDV000014", date: "2026-03-17T16:00:00", supplierName: "Công ty CP Thành Công", totalAmount: 14700000, taxAmount: 1470000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Trần Thị B" },
  { id: "15", code: "HDDV000015", date: "2026-03-16T10:30:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 47800000, taxAmount: 4780000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Lê Văn C" },
];

async function fetchInputInvoices(params: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
}): Promise<{ data: InputInvoice[]; total: number }> {
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
    const result = await fetchInputInvoices({
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
