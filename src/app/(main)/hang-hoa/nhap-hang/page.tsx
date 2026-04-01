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
  CheckboxFilter,
  SelectFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import { formatCurrency, formatDate } from "@/lib/format";
import { getPurchaseOrders, getPurchaseOrderStatuses } from "@/lib/services";
import type { PurchaseOrder } from "@/lib/types";

const statusMap: Record<
  PurchaseOrder["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  draft: { label: "Phiếu tạm", variant: "secondary" },
  imported: { label: "Đã nhập", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const columns: ColumnDef<PurchaseOrder, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã nhập hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "orderCode",
    header: "Mã đặt hàng",
    size: 130,
    cell: ({ row }) => row.original.orderCode || "—",
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
    accessorKey: "amountOwed",
    header: "Cần trả NCC",
    cell: ({ row }) => formatCurrency(row.original.amountOwed),
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

export default function NhapHangPage() {
  const [data, setData] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const statuses = getPurchaseOrderStatuses();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getPurchaseOrders({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, selectedStatuses]);

  const totalAmountOwed = data.reduce((sum, o) => sum + o.amountOwed, 0);

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={statuses}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Thời gian nhập">
            <DateRangeFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Nhập hàng"
        searchPlaceholder="Theo mã phiếu, NCC"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Nhập hàng", icon: <Plus className="h-4 w-4" />, variant: "default" },
          { label: "Xuất file", icon: <Download className="h-4 w-4" /> },
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
          amountOwed: formatCurrency(totalAmountOwed),
        }}
      />
    </ListPageLayout>
  );
}
