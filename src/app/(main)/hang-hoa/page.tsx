"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Upload, Eye, Pencil, Copy, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DateRangeFilter,
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import { CreateProductDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getProducts, getProductCategories } from "@/lib/services";
import type { Product } from "@/lib/types";

const columns: ColumnDef<Product, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã hàng",
    size: 110,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Tên hàng",
    size: 280,
  },
  {
    accessorKey: "sellPrice",
    header: "Giá bán",
    cell: ({ row }) => formatCurrency(row.original.sellPrice),
  },
  {
    accessorKey: "costPrice",
    header: "Giá vốn",
    cell: ({ row }) => formatCurrency(row.original.costPrice),
  },
  {
    accessorKey: "stock",
    header: "Tồn kho",
    cell: ({ row }) => {
      const stock = row.original.stock;
      return (
        <span className={stock === 0 ? "text-destructive" : stock <= 5 ? "text-yellow-600" : ""}>
          {formatCurrency(stock)}
        </span>
      );
    },
  },
  {
    accessorKey: "ordered",
    header: "Khách đặt",
    cell: ({ row }) => {
      const val = row.original.ordered;
      return val > 0 ? (
        <span className="text-primary font-medium">{val}</span>
      ) : (
        <span className="text-muted-foreground">0</span>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: "Thời gian tạo",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export default function HangHoaPage() {
  const router = useRouter();
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [stockFilter, setStockFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const [createOpen, setCreateOpen] = useState(false);

  const categories = getProductCategories();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getProducts({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedCategories.length > 0 && { category: selectedCategories }),
        ...(stockFilter !== "all" && { stock: stockFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedCategories, stockFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, selectedCategories, stockFilter]);

  const totalStock = data.reduce((sum, p) => sum + p.stock, 0);
  const totalOrdered = data.reduce((sum, p) => sum + p.ordered, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã hàng", key: "code", width: 12 },
      { header: "Tên hàng", key: "name", width: 30 },
      { header: "Giá bán", key: "sellPrice", width: 15, format: (v: number) => v },
      { header: "Giá vốn", key: "costPrice", width: 15, format: (v: number) => v },
      { header: "Tồn kho", key: "stock", width: 10 },
      { header: "Nhóm", key: "categoryName", width: 20 },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-hang-hoa");
    else exportToCsv(data, exportColumns, "danh-sach-hang-hoa");
  };

  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Nhóm hàng" action={<span className="text-primary text-xs cursor-pointer">Tạo mới</span>}>
            <CheckboxFilter
              options={categories}
              selected={selectedCategories}
              onChange={setSelectedCategories}
            />
          </FilterGroup>

          <FilterGroup label="Tồn kho">
            <SelectFilter
              options={[
                { label: "Còn hàng", value: "in_stock" },
                { label: "Hết hàng", value: "out_of_stock" },
                { label: "Sắp hết (≤5)", value: "low_stock" },
              ]}
              value={stockFilter}
              onChange={setStockFilter}
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
        title="Hàng hóa"
        searchPlaceholder="Theo mã, tên hàng"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{ excel: () => handleExport("excel"), csv: () => handleExport("csv") }}
        actions={[
          { label: "Tạo mới", icon: <Plus className="h-4 w-4" />, variant: "default", onClick: () => setCreateOpen(true) },
          { label: "Import file", icon: <Upload className="h-4 w-4" /> },
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
          stock: formatCurrency(totalStock),
          ordered: formatCurrency(totalOrdered),
        }}
        onRowClick={(row) => router.push(`/hang-hoa/${row.id}`)}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/hang-hoa/${row.id}`) },
          { label: "Sửa", icon: <Pencil className="h-4 w-4" />, onClick: () => {} },
          { label: "Nhân bản", icon: <Copy className="h-4 w-4" />, onClick: () => {} },
          { label: "In mã vạch", icon: <Printer className="h-4 w-4" />, onClick: () => {} },
          { label: "Xóa", icon: <Trash2 className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>

    <CreateProductDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />
  </>
  );
}
