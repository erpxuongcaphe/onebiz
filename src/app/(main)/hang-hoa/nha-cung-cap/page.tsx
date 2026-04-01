"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Upload, Download, Eye, Pencil, PackagePlus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import { CreateSupplierDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { getSuppliers } from "@/lib/services";
import type { Supplier } from "@/lib/types";

const columns: ColumnDef<Supplier, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã NCC",
    size: 110,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Tên NCC",
    size: 280,
  },
  {
    accessorKey: "phone",
    header: "Điện thoại",
    size: 130,
  },
  {
    accessorKey: "currentDebt",
    header: "Nợ hiện tại",
    cell: ({ row }) => {
      const debt = row.original.currentDebt;
      return (
        <span className={debt > 0 ? "text-destructive" : ""}>
          {formatCurrency(debt)}
        </span>
      );
    },
  },
  {
    accessorKey: "totalPurchases",
    header: "Tổng mua hàng",
    cell: ({ row }) => formatCurrency(row.original.totalPurchases),
  },
  {
    accessorKey: "createdAt",
    header: "Ngày tạo",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export default function NhaCungCapPage() {
  const router = useRouter();
  const [data, setData] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [createOpen, setCreateOpen] = useState(false);

  // Filters
  const [debtFilter, setDebtFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getSuppliers({
      page,
      pageSize,
      search,
      filters: {
        ...(debtFilter !== "all" && { debt: debtFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, debtFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, debtFilter]);

  const totalDebt = data.reduce((sum, s) => sum + s.currentDebt, 0);
  const totalPurchases = data.reduce((sum, s) => sum + s.totalPurchases, 0);

  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Công nợ">
            <SelectFilter
              options={[
                { label: "Đang nợ", value: "has_debt" },
                { label: "Không nợ", value: "no_debt" },
              ]}
              value={debtFilter}
              onChange={setDebtFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Thời gian tạo">
            <DateRangeFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Nhà cung cấp"
        searchPlaceholder="Theo mã, tên, SĐT NCC"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo mới", icon: <Plus className="h-4 w-4" />, variant: "default", onClick: () => setCreateOpen(true) },
          { label: "Import file", icon: <Upload className="h-4 w-4" /> },
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
          currentDebt: formatCurrency(totalDebt),
          totalPurchases: formatCurrency(totalPurchases),
        }}
        onRowClick={(row) => router.push(`/hang-hoa/nha-cung-cap/${row.id}`)}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/hang-hoa/nha-cung-cap/${row.id}`) },
          { label: "Sửa", icon: <Pencil className="h-4 w-4" />, onClick: () => {} },
          { label: "Xem nhập hàng", icon: <PackagePlus className="h-4 w-4" />, onClick: () => {} },
          { label: "Xóa", icon: <Trash2 className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>

    <CreateSupplierDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />
    </>
  );
}
