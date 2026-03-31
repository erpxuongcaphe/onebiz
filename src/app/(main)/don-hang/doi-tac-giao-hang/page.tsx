"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { formatDate } from "@/lib/format";

// --- Types ---

interface DeliveryPartner {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  activeOrders: number;
  completedOrders: number;
  status: "active" | "inactive";
  statusName: string;
  createdAt: string;
}

// --- Status config ---

const statusMap: Record<
  DeliveryPartner["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  active: { label: "Đang hoạt động", variant: "default" },
  inactive: { label: "Ngừng hoạt động", variant: "secondary" },
};

// --- Mock data ---

const mockPartners: DeliveryPartner[] = [
  { id: "1", name: "GrabExpress", phone: "1900636836", email: "support@grab.com", address: "Tầng 35, Bitexco Financial Tower, Q.1, TP.HCM", activeOrders: 12, completedOrders: 345, status: "active", statusName: "Đang hoạt động", createdAt: "2025-01-15T08:00:00" },
  { id: "2", name: "Giao Hàng Nhanh", phone: "1900636688", email: "hotro@ghn.vn", address: "405/15 Xô Viết Nghệ Tĩnh, P.25, Q.Bình Thạnh, TP.HCM", activeOrders: 28, completedOrders: 1230, status: "active", statusName: "Đang hoạt động", createdAt: "2024-06-10T09:30:00" },
  { id: "3", name: "Giao Hàng Tiết Kiệm", phone: "1900636620", email: "hotro@ghtk.vn", address: "Tầng 5, 102 Thái Thịnh, Q.Đống Đa, Hà Nội", activeOrders: 35, completedOrders: 2150, status: "active", statusName: "Đang hoạt động", createdAt: "2024-03-22T10:00:00" },
  { id: "4", name: "J&T Express", phone: "1900120077", email: "cs@jtexpress.vn", address: "Tầng 3, 27A Cộng Hòa, P.4, Q.Tân Bình, TP.HCM", activeOrders: 18, completedOrders: 876, status: "active", statusName: "Đang hoạt động", createdAt: "2024-08-05T14:20:00" },
  { id: "5", name: "Viettel Post", phone: "1900866868", email: "cskh@viettelpost.com.vn", address: "Tầng 2, Tòa nhà HH4, Sông Đà, Q.Nam Từ Liêm, Hà Nội", activeOrders: 22, completedOrders: 1580, status: "active", statusName: "Đang hoạt động", createdAt: "2024-02-18T08:45:00" },
  { id: "6", name: "BEST Express", phone: "1900636033", email: "cskh@best-inc.vn", address: "Tầng 6, 81 Cách Mạng Tháng 8, P.Bến Thành, Q.1, TP.HCM", activeOrders: 0, completedOrders: 420, status: "inactive", statusName: "Ngừng hoạt động", createdAt: "2024-11-30T11:00:00" },
  { id: "7", name: "Ninja Van", phone: "1900886877", email: "support@ninjavan.co", address: "Lô E2a-7, Đường D1, Khu CNC, Q.9, TP.HCM", activeOrders: 8, completedOrders: 567, status: "active", statusName: "Đang hoạt động", createdAt: "2025-02-01T09:15:00" },
  { id: "8", name: "Ahamove", phone: "1900545411", email: "support@ahamove.com", address: "Tầng 7, Viettel Complex, 285 CMT8, P.12, Q.10, TP.HCM", activeOrders: 5, completedOrders: 198, status: "active", statusName: "Đang hoạt động", createdAt: "2025-05-12T16:30:00" },
];

// --- Mock API ---

async function getDeliveryPartners(params: {
  page: number;
  pageSize: number;
  search: string;
}): Promise<{ data: DeliveryPartner[]; total: number }> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...mockPartners];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  }

  const start = params.page * params.pageSize;
  return {
    data: filtered.slice(start, start + params.pageSize),
    total: filtered.length,
  };
}

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
      />
    </div>
  );
}
