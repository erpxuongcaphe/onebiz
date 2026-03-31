"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { formatDate } from "@/lib/format";

interface PriceBook {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  status: "active" | "inactive" | "scheduled";
  statusName: string;
  productCount: number;
  createdBy: string;
  createdAt: string;
}

const mockPriceBooks: PriceBook[] = [
  {
    id: "BG001",
    name: "Giá bán lẻ",
    startDate: "2024-01-01T00:00:00",
    status: "active",
    statusName: "Đang áp dụng",
    productCount: 1250,
    createdBy: "Nguyễn Văn A",
    createdAt: "2023-12-20T09:30:00",
  },
  {
    id: "BG002",
    name: "Giá bán buôn",
    startDate: "2024-01-01T00:00:00",
    status: "active",
    statusName: "Đang áp dụng",
    productCount: 980,
    createdBy: "Nguyễn Văn A",
    createdAt: "2023-12-20T10:15:00",
  },
  {
    id: "BG003",
    name: "Giá VIP",
    startDate: "2024-03-01T00:00:00",
    status: "active",
    statusName: "Đang áp dụng",
    productCount: 540,
    createdBy: "Trần Thị B",
    createdAt: "2024-02-15T14:00:00",
  },
  {
    id: "BG004",
    name: "Giá đại lý",
    startDate: "2024-02-01T00:00:00",
    status: "active",
    statusName: "Đang áp dụng",
    productCount: 870,
    createdBy: "Trần Thị B",
    createdAt: "2024-01-25T08:45:00",
  },
  {
    id: "BG005",
    name: "Giá khuyến mãi Tết",
    startDate: "2025-01-15T00:00:00",
    endDate: "2025-02-15T23:59:59",
    status: "inactive",
    statusName: "Ngừng áp dụng",
    productCount: 320,
    createdBy: "Lê Văn C",
    createdAt: "2024-12-10T16:30:00",
  },
  {
    id: "BG006",
    name: "Giá khuyến mãi hè",
    startDate: "2026-06-01T00:00:00",
    endDate: "2026-08-31T23:59:59",
    status: "scheduled",
    statusName: "Chờ áp dụng",
    productCount: 450,
    createdBy: "Lê Văn C",
    createdAt: "2026-03-20T11:00:00",
  },
  {
    id: "BG007",
    name: "Giá nhân viên",
    startDate: "2024-06-01T00:00:00",
    status: "active",
    statusName: "Đang áp dụng",
    productCount: 1100,
    createdBy: "Nguyễn Văn A",
    createdAt: "2024-05-20T09:00:00",
  },
  {
    id: "BG008",
    name: "Giá đối tác",
    startDate: "2024-04-01T00:00:00",
    status: "inactive",
    statusName: "Ngừng áp dụng",
    productCount: 650,
    createdBy: "Trần Thị B",
    createdAt: "2024-03-15T13:20:00",
  },
];

async function fetchPriceBooks(search: string): Promise<{ data: PriceBook[]; total: number }> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const filtered = mockPriceBooks.filter((pb) =>
    pb.name.toLowerCase().includes(search.toLowerCase())
  );
  return { data: filtered, total: filtered.length };
}

const statusVariantMap: Record<PriceBook["status"], "default" | "secondary" | "outline"> = {
  active: "default",
  inactive: "secondary",
  scheduled: "outline",
};

const columns: ColumnDef<PriceBook, unknown>[] = [
  {
    accessorKey: "name",
    header: "Tên bảng giá",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "startDate",
    header: "Ngày bắt đầu",
    size: 150,
    cell: ({ row }) => formatDate(row.original.startDate),
  },
  {
    accessorKey: "endDate",
    header: "Ngày kết thúc",
    size: 150,
    cell: ({ row }) =>
      row.original.endDate ? formatDate(row.original.endDate) : "Không giới hạn",
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    size: 140,
    cell: ({ row }) => (
      <Badge variant={statusVariantMap[row.original.status]}>
        {row.original.statusName}
      </Badge>
    ),
  },
  {
    accessorKey: "productCount",
    header: "Số SP áp dụng",
    size: 120,
    cell: ({ row }) => row.original.productCount.toLocaleString("vi-VN"),
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 150,
  },
  {
    accessorKey: "createdAt",
    header: "Ngày tạo",
    size: 150,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export default function ThietLapGiaPage() {
  const [data, setData] = useState<PriceBook[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await fetchPriceBooks(search);
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col">
      <PageHeader
        title="Thiết lập giá"
        searchPlaceholder="Theo tên bảng giá"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Thêm bảng giá",
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
      />
    </div>
  );
}
