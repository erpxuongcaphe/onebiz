"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Upload, Pencil, Copy, Printer, Trash2, Package } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DatePresetFilter,
  PersonFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import { CreateProductDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getProducts, getProductCategories } from "@/lib/services";
import type { Product } from "@/lib/types";

// ---------------------------------------------------------------------------
// Inline detail panel for a product row
// ---------------------------------------------------------------------------
function ProductDetail({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  return (
    <InlineDetailPanel open onClose={onClose}>
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={product.name}
                  code={product.code}
                  subtitle={product.categoryName}
                  avatar={
                    product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-8 w-8 text-muted-foreground/40" />
                    )
                  }
                  tags={["Combo - đóng gói", "Bán trực tiếp", "Tích điểm"]}
                  actionLink={{
                    label: "Xem phân tích",
                    onClick: () => {},
                  }}
                />

                <DetailInfoGrid
                  columns={4}
                  fields={[
                    { label: "Mã hàng", value: product.code },
                    { label: "Mã vạch", value: null },
                    {
                      label: "Giá vốn",
                      value: formatCurrency(product.costPrice),
                    },
                    {
                      label: "Giá bán",
                      value: formatCurrency(product.sellPrice),
                    },
                    { label: "Thương hiệu", value: null },
                    { label: "Vị trí", value: null },
                    { label: "Trọng lượng", value: null },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "description",
            label: "Mô tả ghi chú",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có mô tả
              </div>
            ),
          },
          {
            id: "stock_card",
            label: "Thẻ kho",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có dữ liệu thẻ kho
              </div>
            ),
          },
          {
            id: "channels",
            label: "Liên kết kênh bán",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa liên kết kênh bán nào
              </div>
            ),
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function HangHoaPage() {
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [expectedOutDate, setExpectedOutDate] =
    useState<DatePresetValue>("all");
  const [createdDatePreset, setCreatedDatePreset] =
    useState<DatePresetValue>("all");
  const [supplierFilter, setSupplierFilter] = useState("");

  const categories = getProductCategories();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getProducts({
      page,
      pageSize,
      search,
      filters: {
        ...(categoryFilter !== "all" && { category: [categoryFilter] }),
        ...(stockFilter !== "all" && { stock: stockFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, categoryFilter, stockFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, categoryFilter, stockFilter, expectedOutDate, createdDatePreset, supplierFilter]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalStock = data.reduce((sum, p) => sum + p.stock, 0);
  const totalOrdered = data.reduce((sum, p) => sum + p.ordered, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã hàng", key: "code", width: 12 },
      { header: "Tên hàng", key: "name", width: 30 },
      {
        header: "Giá bán",
        key: "sellPrice",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Giá vốn",
        key: "costPrice",
        width: 15,
        format: (v: number) => v,
      },
      { header: "Tồn kho", key: "stock", width: 10 },
      { header: "Nhóm", key: "categoryName", width: 20 },
    ];
    if (type === "excel")
      exportToExcel(data, exportColumns, "danh-sach-hang-hoa");
    else exportToCsv(data, exportColumns, "danh-sach-hang-hoa");
  };

  const columns: ColumnDef<Product, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 36,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <StarCell
          starred={starred.has(row.original.id)}
          onToggle={() => toggleStar(row.original.id)}
        />
      ),
    },
    {
      id: "image",
      header: "",
      size: 48,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="h-9 w-9 rounded border bg-muted/40 flex items-center justify-center overflow-hidden">
          {row.original.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.original.image}
              alt={row.original.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <Package className="h-4 w-4 text-muted-foreground/40" />
          )}
        </div>
      ),
    },
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
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.sellPrice)}
        </span>
      ),
    },
    {
      accessorKey: "costPrice",
      header: "Giá vốn",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.costPrice)}
        </span>
      ),
    },
    {
      accessorKey: "stock",
      header: "Tồn kho",
      cell: ({ row }) => {
        const stock = row.original.stock;
        return (
          <span
            className={
              stock === 0
                ? "text-destructive"
                : stock <= 5
                  ? "text-yellow-600"
                  : ""
            }
          >
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
      size: 150,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "expectedOutDate",
      header: "Dự kiến hết hàng",
      size: 150,
      enableSorting: false,
      cell: () => (
        <span className="text-muted-foreground">—</span>
      ),
    },
  ];

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup
              label="Nhóm hàng"
              action={
                <span className="text-primary text-xs cursor-pointer">
                  Tạo mới
                </span>
              }
            >
              <SelectFilter
                options={categories}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder="Tất cả"
              />
            </FilterGroup>

            <FilterGroup label="Tồn kho">
              <SelectFilter
                options={[
                  { label: "Còn hàng", value: "in_stock" },
                  { label: "Hết hàng", value: "out_of_stock" },
                ]}
                value={stockFilter}
                onChange={setStockFilter}
                placeholder="Tất cả"
              />
            </FilterGroup>

            <FilterGroup label="Dự kiến hết hàng">
              <DatePresetFilter
                value={expectedOutDate}
                onChange={setExpectedOutDate}
                presets={[
                  { label: "Tháng này", value: "this_month" },
                  { label: "Tuần này", value: "this_week" },
                  { label: "Tùy chỉnh", value: "custom" },
                ]}
              />
            </FilterGroup>

            <FilterGroup label="Thời gian tạo">
              <DatePresetFilter
                value={createdDatePreset}
                onChange={setCreatedDatePreset}
                presets={[
                  { label: "Tháng này", value: "this_month" },
                  { label: "Tuần này", value: "this_week" },
                  { label: "Tùy chỉnh", value: "custom" },
                ]}
              />
            </FilterGroup>

            <FilterGroup label="Nhà cung cấp">
              <PersonFilter
                value={supplierFilter}
                onChange={setSupplierFilter}
                placeholder="Chọn nhà cung cấp"
                suggestions={[]}
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
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          actions={[
            {
              label: "Tạo mới",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
            {
              label: "Import file",
              icon: <Upload className="h-4 w-4" />,
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
            stock: formatCurrency(totalStock),
            ordered: formatCurrency(totalOrdered),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(product, onClose) => (
            <ProductDetail product={product} onClose={onClose} />
          )}
          rowActions={(row) => [
            {
              label: "Sửa",
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => {},
            },
            {
              label: "Nhân bản",
              icon: <Copy className="h-4 w-4" />,
              onClick: () => {},
            },
            {
              label: "In mã vạch",
              icon: <Printer className="h-4 w-4" />,
              onClick: () => {},
            },
            {
              label: "Xóa",
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => {},
              variant: "destructive",
              separator: true,
            },
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
