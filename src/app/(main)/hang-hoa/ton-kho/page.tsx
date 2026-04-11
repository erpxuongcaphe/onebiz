"use client";

// Tồn kho — xem tồn kho per chi nhánh, lọc theo NVL/SKU, sắp xếp & tổng giá trị tồn

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Boxes, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getBranchStockRows, getBranches } from "@/lib/services";
import type { BranchStockRow, BranchDetail } from "@/lib/services/supabase";

type ProductTypeFilter = "all" | "nvl" | "sku";

export default function TonKhoPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>("all");
  const [lowStockOnly, setLowStockOnly] = useState<string>("all"); // all | low

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBranchStockRows({
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        productType: typeFilter !== "all" ? typeFilter : undefined,
        search: search || undefined,
        lowStockOnly: lowStockOnly === "low",
      });
      setRows(data);
    } catch (err) {
      toast({
        title: "Lỗi tải tồn kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [branchFilter, typeFilter, search, lowStockOnly, toast]);

  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, branchFilter, typeFilter, lowStockOnly]);

  const pagedData = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page, pageSize]
  );

  const totalValue = useMemo(
    () => rows.reduce((sum, r) => sum + r.stockValue, 0),
    [rows]
  );
  const totalQty = useMemo(
    () => rows.reduce((sum, r) => sum + r.quantity, 0),
    [rows]
  );
  const lowStockCount = useMemo(
    () =>
      rows.filter(
        (r) => r.minStock !== undefined && r.quantity <= (r.minStock ?? 0)
      ).length,
    [rows]
  );

  const columns: ColumnDef<BranchStockRow, unknown>[] = [
    {
      accessorKey: "productCode",
      header: "Mã hàng",
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium text-primary">
          {row.original.productCode}
        </span>
      ),
    },
    {
      accessorKey: "productName",
      header: "Tên hàng",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName}</div>
          {row.original.variantName && (
            <div className="text-xs text-muted-foreground">
              {row.original.variantName}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "productType",
      header: "Loại",
      size: 80,
      cell: ({ row }) => {
        const t = row.original.productType;
        if (!t) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge
            variant="outline"
            className={
              t === "nvl"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-blue-50 text-blue-700 border-blue-200"
            }
          >
            {t.toUpperCase()}
          </Badge>
        );
      },
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 150,
    },
    {
      accessorKey: "quantity",
      header: "Tồn",
      size: 100,
      cell: ({ row }) => {
        const r = row.original;
        const isLow =
          r.minStock !== undefined && r.quantity <= (r.minStock ?? 0);
        return (
          <span className={isLow ? "text-destructive font-semibold" : "font-medium"}>
            {r.quantity} {r.unit ?? ""}
          </span>
        );
      },
    },
    {
      accessorKey: "reserved",
      header: "Đặt trước",
      size: 90,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.reserved}</span>
      ),
    },
    {
      accessorKey: "available",
      header: "Khả dụng",
      size: 100,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.available}</span>
      ),
    },
    {
      accessorKey: "minStock",
      header: "Định mức",
      size: 90,
      cell: ({ row }) =>
        row.original.minStock !== undefined ? row.original.minStock : "—",
    },
    {
      accessorKey: "stockValue",
      header: "Giá trị tồn",
      size: 140,
      cell: ({ row }) => (
        <span className="font-medium text-right block">
          {formatCurrency(row.original.stockValue)}
        </span>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: "Cập nhật",
      size: 120,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Chi nhánh">
            <SelectFilter
              options={[
                { label: "Tất cả chi nhánh", value: "all" },
                ...branches.map((b) => ({
                  label: b.name,
                  value: b.id,
                })),
              ]}
              value={branchFilter}
              onChange={setBranchFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Loại hàng">
            <SelectFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "NVL — Nguyên vật liệu", value: "nvl" },
                { label: "SKU — Hàng bán", value: "sku" },
              ]}
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as ProductTypeFilter)}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Định mức">
            <SelectFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Dưới định mức", value: "low" },
              ]}
              value={lowStockOnly}
              onChange={setLowStockOnly}
              placeholder="Tất cả"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Tồn kho"
        searchPlaceholder="Theo mã hàng, tên hàng..."
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => {
            const cols = [
              { header: "Mã hàng", key: "productCode", width: 15 },
              { header: "Tên hàng", key: "productName", width: 30 },
              { header: "Loại", key: "productType", width: 8 },
              { header: "Chi nhánh", key: "branchName", width: 20 },
              { header: "Tồn kho", key: "quantity", width: 12, format: (v: number) => v },
              { header: "Đặt trước", key: "reserved", width: 12, format: (v: number) => v },
              { header: "Khả dụng", key: "available", width: 12, format: (v: number) => v },
              { header: "Định mức", key: "minStock", width: 12, format: (v: number | undefined) => v ?? 0 },
              { header: "Giá trị tồn", key: "stockValue", width: 15, format: (v: number) => v },
            ];
            exportToExcel(rows, cols, "ton-kho");
          },
          csv: () => {
            const cols = [
              { header: "Mã hàng", key: "productCode", width: 15 },
              { header: "Tên hàng", key: "productName", width: 30 },
              { header: "Chi nhánh", key: "branchName", width: 20 },
              { header: "Tồn kho", key: "quantity", width: 12, format: (v: number) => v },
              { header: "Khả dụng", key: "available", width: 12, format: (v: number) => v },
              { header: "Giá trị tồn", key: "stockValue", width: 15, format: (v: number) => v },
            ];
            exportToCsv(rows, cols, "ton-kho");
          },
        }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Boxes className="h-4 w-4" />}
          label="Tổng SP"
          value={rows.length.toString()}
        />
        <SummaryCard
          icon={<Boxes className="h-4 w-4" />}
          label="Tổng giá trị tồn"
          value={formatCurrency(totalValue)}
          highlight
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          label="Dưới định mức"
          value={lowStockCount.toString()}
          danger={lowStockCount > 0}
        />
      </div>

      <DataTable
        columns={columns}
        data={pagedData}
        loading={loading}
        total={rows.length}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(rows.length / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        summaryRow={{
          quantity: `${totalQty}`,
          stockValue: formatCurrency(totalValue),
        }}
        getRowId={(r) => r.id}
      />
    </ListPageLayout>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  highlight,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`border rounded-lg p-3 bg-background ${
        highlight ? "border-primary/30 bg-primary/5" : ""
      } ${danger ? "border-destructive/30 bg-destructive/5" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`text-lg font-semibold ${
          highlight ? "text-primary" : danger ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
