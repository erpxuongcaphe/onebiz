"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { formatDate } from "@/lib/format";
import { getDeliveryPartners } from "@/lib/services";
import type { DeliveryPartner } from "@/lib/types";

// --- Status config ---

const statusMap: Record<
  DeliveryPartner["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  active: { label: "Đang hoạt động", variant: "default" },
  inactive: { label: "Ngừng hoạt động", variant: "secondary" },
};

// --- Columns ---

const columns: ColumnDef<DeliveryPartner, unknown>[] = [
  {
    accessorKey: "name",
    header: "Tên đối tác",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "phone",
    header: "SĐT",
    size: 130,
  },
  {
    accessorKey: "email",
    header: "Email",
    size: 200,
    cell: ({ row }) => row.original.email ?? "—",
  },
  {
    accessorKey: "activeOrders",
    header: "Đơn đang giao",
    size: 120,
    cell: ({ row }) => (
      <span className={row.original.activeOrders > 0 ? "text-blue-600 font-medium" : ""}>
        {row.original.activeOrders}
      </span>
    ),
  },
  {
    accessorKey: "completedOrders",
    header: "Đơn hoàn thành",
    size: 130,
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
    accessorKey: "createdAt",
    header: "Ngày tạo",
    size: 150,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

// --- Page ---

export default function DoiTacGiaoHangPage() {
  const [data, setData] = useState<DeliveryPartner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getDeliveryPartners({
      page,
      pageSize,
      search,
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      <PageHeader
        title="Đối tác giao hàng"
        searchPlaceholder="Theo tên đối tác"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Thêm đối tác",
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
        rowActions={(row) => [
          { label: "Sửa", icon: <Pencil className="h-4 w-4" />, onClick: () => {} },
          { label: "Vô hiệu hóa", icon: <Ban className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </div>
  );
}
