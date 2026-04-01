"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, Printer, Undo2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import { CreateInvoiceDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getInvoices, getInvoiceStatuses } from "@/lib/services";
import type { Invoice } from "@/lib/types";

const statusMap: Record<
  Invoice["status"],
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  processing: { label: "Đang xử lý", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
  delivery_failed: { label: "Giao thất bại", variant: "destructive" },
};

const columns: ColumnDef<Invoice, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã hóa đơn",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "returnCode",
    header: "Mã trả hàng",
    size: 130,
    cell: ({ row }) => row.original.returnCode ?? "—",
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
    header: "Tổng tiền hàng",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "discount",
    header: "Giảm giá",
    cell: ({ row }) => {
      const discount = row.original.discount;
      return discount > 0 ? (
        <span className="text-orange-600">{formatCurrency(discount)}</span>
      ) : (
        formatCurrency(0)
      );
    },
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
    header: "Người bán",
    size: 150,
  },
];

export default function HoaDonPage() {
  const router = useRouter();
  const [data, setData] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [createOpen, setCreateOpen] = useState(false);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<
    "today" | "this_week" | "this_month" | "all" | "custom"
  >("all");

  const statuses = getInvoiceStatuses();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getInvoices({
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

  const totalAmount = data.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalDiscount = data.reduce((sum, inv) => sum + inv.discount, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã HD", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Khách hàng", key: "customerName", width: 25 },
      { header: "Tổng tiền", key: "totalAmount", width: 15, format: (v: number) => v },
      { header: "Giảm giá", key: "discount", width: 15, format: (v: number) => v },
      { header: "Trạng thái", key: "status", width: 15, format: (v: Invoice["status"]) => statusMap[v]?.label ?? v },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-hoa-don");
    else exportToCsv(data, exportColumns, "danh-sach-hoa-don");
  };

  return (
    <>
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
        title="Hóa đơn"
        searchPlaceholder="Theo mã hóa đơn, khách hàng"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{ excel: () => handleExport("excel"), csv: () => handleExport("csv") }}
        actions={[
          {
            label: "Tạo hóa đơn",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
            onClick: () => setCreateOpen(true),
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
          totalAmount: formatCurrency(totalAmount),
          discount: formatCurrency(totalDiscount),
        }}
        onRowClick={(row) => router.push(`/don-hang/hoa-don/${row.id}`)}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/don-hang/hoa-don/${row.id}`) },
          { label: "In hóa đơn", icon: <Printer className="h-4 w-4" />, onClick: () => {} },
          { label: "Trả hàng", icon: <Undo2 className="h-4 w-4" />, onClick: () => {} },
          { label: "Hủy", icon: <XCircle className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>

    <CreateInvoiceDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />
    </>
  );
}
