"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Upload, Eye, Pencil, ShoppingCart, Trash2 } from "lucide-react";
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
import { CreateCustomerDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getCustomers, getCustomerGroups } from "@/lib/services";
import type { Customer } from "@/lib/types";

const columns: ColumnDef<Customer, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã KH",
    size: 110,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Tên khách hàng",
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
        <span className={debt > 0 ? "text-destructive" : "text-muted-foreground"}>
          {formatCurrency(debt)}
        </span>
      );
    },
  },
  {
    accessorKey: "totalSales",
    header: "Tổng bán",
    cell: ({ row }) => formatCurrency(row.original.totalSales),
  },
  {
    accessorKey: "totalSalesMinusReturns",
    header: "Tổng bán trừ trả hàng",
    cell: ({ row }) => formatCurrency(row.original.totalSalesMinusReturns),
  },
  {
    accessorKey: "createdAt",
    header: "Ngày tạo",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export default function KhachHangPage() {
  const router = useRouter();
  const [data, setData] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [debtFilter, setDebtFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const [createOpen, setCreateOpen] = useState(false);

  const customerGroups = getCustomerGroups();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getCustomers({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedGroups.length > 0 && { group: selectedGroups }),
        ...(typeFilter !== "all" && { type: typeFilter }),
        ...(debtFilter !== "all" && { debt: debtFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedGroups, typeFilter, debtFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, selectedGroups, typeFilter, debtFilter]);

  const totalDebt = data.reduce((sum, c) => sum + c.currentDebt, 0);
  const totalSales = data.reduce((sum, c) => sum + c.totalSales, 0);
  const totalSalesMinusReturns = data.reduce((sum, c) => sum + c.totalSalesMinusReturns, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã KH", key: "code", width: 12 },
      { header: "Tên khách hàng", key: "name", width: 25 },
      { header: "SĐT", key: "phone", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "Nợ hiện tại", key: "currentDebt", width: 15, format: (v: number) => v },
      { header: "Tổng bán", key: "totalSales", width: 15, format: (v: number) => v },
      { header: "Nhóm", key: "groupName", width: 20 },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-khach-hang");
    else exportToCsv(data, exportColumns, "danh-sach-khach-hang");
  };

  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Nhóm khách hàng">
            <CheckboxFilter
              options={customerGroups}
              selected={selectedGroups}
              onChange={setSelectedGroups}
            />
          </FilterGroup>

          <FilterGroup label="Loại khách hàng">
            <SelectFilter
              options={[
                { label: "Cá nhân", value: "individual" },
                { label: "Doanh nghiệp", value: "company" },
              ]}
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

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
        title="Khách hàng"
        searchPlaceholder="Theo mã, tên, SĐT"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{ excel: () => handleExport("excel"), csv: () => handleExport("csv") }}
        actions={[
          { label: "Tạo mới", icon: <Plus className="h-4 w-4" />, variant: "default", onClick: () => setCreateOpen(true) },
          { label: "Import", icon: <Upload className="h-4 w-4" /> },
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
          totalSales: formatCurrency(totalSales),
          totalSalesMinusReturns: formatCurrency(totalSalesMinusReturns),
        }}
        onRowClick={(row) => router.push(`/khach-hang/${row.id}`)}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/khach-hang/${row.id}`) },
          { label: "Sửa", icon: <Pencil className="h-4 w-4" />, onClick: () => {} },
          { label: "Xem đơn hàng", icon: <ShoppingCart className="h-4 w-4" />, onClick: () => {} },
          { label: "Xóa", icon: <Trash2 className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>

    <CreateCustomerDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />
    </>
  );
}
