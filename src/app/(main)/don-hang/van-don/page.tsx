"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Eye, MapPin, XCircle } from "lucide-react";
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
import { getShippingOrders, getShippingStatuses, getPartnerOptions } from "@/lib/services";
import type { ShippingOrder } from "@/lib/types";

// --- Status config ---

const statusMap: Record<
  ShippingOrder["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  pending: { label: "Chờ lấy hàng", variant: "secondary" },
  picking: { label: "Đang lấy hàng", variant: "outline" },
  shipping: { label: "Đang giao", variant: "outline" },
  delivered: { label: "Đã giao", variant: "default" },
  failed: { label: "Giao thất bại", variant: "destructive" },
  returned: { label: "Đã hoàn", variant: "destructive" },
};

const statusOptions = getShippingStatuses();
const partnerOptions = getPartnerOptions();

// --- Columns ---

const columns: ColumnDef<ShippingOrder, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã vận đơn",
    size: 120,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "invoiceCode",
    header: "Mã hóa đơn",
    size: 120,
  },
  {
    accessorKey: "deliveryPartner",
    header: "Đối tác GH",
    size: 160,
  },
  {
    accessorKey: "customerName",
    header: "Người nhận",
    size: 160,
  },
  {
    accessorKey: "customerPhone",
    header: "SĐT",
    size: 120,
  },
  {
    accessorKey: "fee",
    header: "Phí GH",
    cell: ({ row }) => formatCurrency(row.original.fee),
  },
  {
    accessorKey: "cod",
    header: "Thu hộ COD",
    cell: ({ row }) => formatCurrency(row.original.cod),
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

export default function VanDonPage() {
  const router = useRouter();
  const [data, setData] = useState<ShippingOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<
    "today" | "this_week" | "this_month" | "all" | "custom"
  >("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getShippingOrders({
      page,
      pageSize,
      search,
      filters: {
        ...(statusFilter !== "all" && { status: statusFilter }),
        ...(partnerFilter !== "all" && { partner: partnerFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, statusFilter, partnerFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, partnerFilter]);

  const totalFee = data.reduce((sum, o) => sum + o.fee, 0);
  const totalCod = data.reduce((sum, o) => sum + o.cod, 0);

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

          <FilterGroup label="Đối tác GH">
            <SelectFilter
              options={partnerOptions}
              value={partnerFilter}
              onChange={setPartnerFilter}
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
        title="Vận đơn"
        searchPlaceholder="Theo mã vận đơn, SĐT"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tạo vận đơn",
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
          fee: formatCurrency(totalFee),
          cod: formatCurrency(totalCod),
        }}
        onRowClick={(row) => router.push(`/don-hang/van-don/${row.id}`)}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/don-hang/van-don/${row.id}`) },
          { label: "Theo dõi", icon: <MapPin className="h-4 w-4" />, onClick: () => {} },
          { label: "Hủy", icon: <XCircle className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>
  );
}
