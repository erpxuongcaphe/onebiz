"use client";

// Tồn kho — xem tồn kho per chi nhánh, lọc theo NVL/SKU, sắp xếp & tổng giá trị tồn

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  ActiveFiltersBar,
  type ActiveFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import { Badge } from "@/components/ui/badge";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import {
  getBranchStockPage,
  getBranchStockAggregates,
  getBranchStockRows,
  getBranches,
  getProductStockBreakdown,
  getProductStockMovements,
} from "@/lib/services";
import type { BranchStockRow, BranchDetail } from "@/lib/services/supabase";
import type { StockMovement } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { initialStockExcelSchema, type InitialStockImportRow } from "@/lib/excel/schemas";
import { exportToExcelFromSchema } from "@/lib/excel";
import { bulkImportInitialStock } from "@/lib/services/supabase/excel-import";

type ProductTypeFilter = "all" | "nvl" | "sku";

// ---------------------------------------------------------------------------
// Inline detail panel — hiển thị khi click 1 row tồn kho
//   • Tab "Tồn các chi nhánh" — breakdown cross-branch cho SP này
//   • Tab "Lịch sử xuất nhập" — 50 movement gần nhất cho SP này
// ---------------------------------------------------------------------------
function StockRowDetail({
  row,
  onClose,
}: {
  row: BranchStockRow;
  onClose: () => void;
}) {
  const [branches, setBranches] = useState<
    Array<{
      branchId: string;
      branchName: string;
      branchCode?: string;
      quantity: number;
      reserved: number;
      available: number;
      updatedAt: string;
    }>
  >([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingBranches(true);
      try {
        const bk = await getProductStockBreakdown(row.productId);
        if (!cancelled) setBranches(bk);
      } catch {
        if (!cancelled) setBranches([]);
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    })();
    (async () => {
      setLoadingMovements(true);
      try {
        const res = await getProductStockMovements(row.productId, {
          page: 0,
          pageSize: 50,
        });
        if (!cancelled) setMovements(res.data);
      } catch {
        if (!cancelled) setMovements([]);
      } finally {
        if (!cancelled) setLoadingMovements(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.productId]);

  const totalQty = branches.reduce((s, b) => s + b.quantity, 0);
  const totalReserved = branches.reduce((s, b) => s + b.reserved, 0);

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
                  title={row.productName}
                  code={row.productCode}
                  subtitle={row.variantName ?? row.branchName}
                />
                <DetailInfoGrid
                  fields={[
                    { label: "Loại", value: (row.productType ?? "—").toUpperCase() },
                    { label: "Đơn vị", value: row.unit ?? "—" },
                    {
                      label: "Tồn tại chi nhánh này",
                      value: (
                        <span className="font-semibold">
                          {row.quantity} {row.unit ?? ""}
                        </span>
                      ),
                    },
                    {
                      label: "Đặt trước",
                      value: `${row.reserved} ${row.unit ?? ""}`,
                    },
                    {
                      label: "Khả dụng",
                      value: (
                        <span className="font-semibold">
                          {row.available} {row.unit ?? ""}
                        </span>
                      ),
                    },
                    {
                      label: "Định mức",
                      value: row.minStock !== undefined ? `${row.minStock} ${row.unit ?? ""}` : "—",
                    },
                    {
                      label: "Giá vốn",
                      value: row.costPrice ? formatCurrency(row.costPrice) : "—",
                    },
                    {
                      label: "Giá trị tồn",
                      value: formatCurrency(row.stockValue),
                    },
                    { label: "Cập nhật", value: formatDate(row.updatedAt) },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "branches",
            label: `Tồn các chi nhánh (${branches.length})`,
            content: (
              <div className="space-y-3">
                {loadingBranches ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải...
                  </div>
                ) : branches.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa ghi nhận tồn ở chi nhánh nào.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">Chi nhánh</th>
                          <th className="text-right p-2 font-medium">Tồn</th>
                          <th className="text-right p-2 font-medium">Đặt trước</th>
                          <th className="text-right p-2 font-medium">Khả dụng</th>
                          <th className="text-right p-2 font-medium">Cập nhật</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => (
                          <tr key={b.branchId} className="border-t">
                            <td className="p-2">
                              <div className="font-medium">{b.branchName}</div>
                              {b.branchCode && (
                                <div className="text-xs text-muted-foreground">
                                  {b.branchCode}
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-right tabular-nums font-semibold">
                              {b.quantity}
                            </td>
                            <td className="p-2 text-right tabular-nums text-muted-foreground">
                              {b.reserved}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {b.available}
                            </td>
                            <td className="p-2 text-right text-xs text-muted-foreground">
                              {formatDate(b.updatedAt)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t bg-muted/20 font-semibold">
                          <td className="p-2">Tổng toàn hệ thống</td>
                          <td className="p-2 text-right tabular-nums">{totalQty}</td>
                          <td className="p-2 text-right tabular-nums">
                            {totalReserved}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {totalQty - totalReserved}
                          </td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "movements",
            label: `Lịch sử xuất nhập (${movements.length})`,
            content: (
              <div className="space-y-2">
                {loadingMovements ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải...
                  </div>
                ) : movements.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa có lịch sử xuất nhập cho sản phẩm này.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">Thời gian</th>
                          <th className="text-left p-2 font-medium">Loại</th>
                          <th className="text-right p-2 font-medium">Số lượng</th>
                          <th className="text-left p-2 font-medium">Người tạo</th>
                          <th className="text-left p-2 font-medium">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m) => (
                          <tr key={m.id} className="border-t">
                            <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                              {formatDate(m.date)}
                            </td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">
                                {m.typeName}
                              </Badge>
                            </td>
                            <td
                              className={`p-2 text-right tabular-nums font-medium ${
                                m.type === "import"
                                  ? "text-success"
                                  : m.type === "export"
                                    ? "text-destructive"
                                    : ""
                              }`}
                            >
                              {m.type === "export" ? "-" : m.type === "import" ? "+" : ""}
                              {m.quantity}
                            </td>
                            <td className="p-2 text-xs">
                              {m.createdByName || "—"}
                            </td>
                            <td className="p-2 text-xs text-muted-foreground max-w-[240px] truncate">
                              {m.note ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

export default function TonKhoPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Default branch filter theo branch đang active của user.
  // User có thể override sang "all" qua dropdown nếu là owner/admin.
  const [branchFilter, setBranchFilter] = useState<string>(activeBranchId ?? "all");

  // Sync khi user switch branch ở global selector (header).
  useEffect(() => {
    if (activeBranchId) setBranchFilter(activeBranchId);
  }, [activeBranchId]);
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>("all");
  const [lowStockOnly, setLowStockOnly] = useState<string>("all"); // all | low

  const [importOpen, setImportOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        productType: typeFilter !== "all" ? typeFilter : undefined,
        search: search || undefined,
      };
      // Parallel: page rows + aggregates (server-side)
      const [pageResult, aggregates] = await Promise.all([
        getBranchStockPage({
          ...filters,
          lowStockOnly: lowStockOnly === "low",
          offset: page * pageSize,
          limit: pageSize,
        }),
        getBranchStockAggregates(filters),
      ]);
      setRows(pageResult.rows);
      setTotalRows(pageResult.total);
      setTotalQty(aggregates.totalQty);
      setTotalValue(aggregates.totalValue);
      setLowStockCount(aggregates.lowStockCount);
    } catch (err) {
      toast({
        title: "Lỗi tải tồn kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [branchFilter, typeFilter, search, lowStockOnly, page, pageSize, toast]);

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
    setExpandedRow(null);
  }, [search, branchFilter, typeFilter, lowStockOnly]);

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
                ? "bg-status-warning/10 text-status-warning border-status-warning/25"
                : "bg-primary-fixed text-primary border-primary-fixed"
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

  // Active filter chips data — UX cải thiện cho user thấy đang lọc gì.
  const activeFilters: ActiveFilter[] = [];
  if (branchFilter !== "all") {
    const branchName = branches.find((b) => b.id === branchFilter)?.name ?? branchFilter;
    activeFilters.push({
      key: "branch",
      label: "Chi nhánh",
      value: branchName,
      onClear: () => setBranchFilter("all"),
    });
  }
  if (typeFilter !== "all") {
    activeFilters.push({
      key: "type",
      label: "Loại",
      value: typeFilter === "nvl" ? "NVL" : "SKU",
      onClear: () => setTypeFilter("all"),
    });
  }
  if (lowStockOnly !== "all") {
    activeFilters.push({
      key: "low",
      label: "Định mức",
      value: "Dưới định mức",
      onClear: () => setLowStockOnly("all"),
    });
  }
  const handleClearAllFilters = () => {
    setBranchFilter("all");
    setTypeFilter("all");
    setLowStockOnly("all");
  };

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <ActiveFiltersBar
            filters={activeFilters}
            onClearAll={handleClearAllFilters}
          />

          <FilterGroup
            label="Chi nhánh"
            activeHint={
              branchFilter !== "all"
                ? branches.find((b) => b.id === branchFilter)?.name?.slice(0, 12)
                : undefined
            }
          >
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

          <FilterGroup
            label="Loại hàng"
            activeHint={typeFilter !== "all" ? typeFilter.toUpperCase() : undefined}
          >
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

          <FilterGroup
            label="Định mức"
            activeHint={lowStockOnly === "low" ? "Dưới ĐM" : undefined}
          >
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
        actions={[
          {
            label: "Tải mẫu tồn kho đầu kỳ",
            icon: <Icon name="description" size={16} />,
            variant: "ghost",
            onClick: () => downloadTemplate(initialStockExcelSchema),
          },
          {
            label: "Nhập tồn kho đầu kỳ",
            icon: <Icon name="upload" size={16} />,
            onClick: () => setImportOpen(true),
          },
        ]}
        onExport={{
          excel: async () => {
            // Fetch full dataset (no pagination) for export
            const all = await getBranchStockRows({
              branchId: branchFilter !== "all" ? branchFilter : undefined,
              productType: typeFilter !== "all" ? typeFilter : undefined,
              search: search || undefined,
              lowStockOnly: lowStockOnly === "low",
            });
            const stockRows: InitialStockImportRow[] = all
              .filter((r) => r.branchCode)
              .map((r) => ({
                productCode: r.productCode,
                productName: r.productName,
                branchCode: r.branchCode ?? "",
                quantity: r.quantity,
                costPrice: r.costPrice ?? 0,
                note: `Xuất từ tồn kho hiện tại — giá trị ${r.stockValue}`,
              }));
            exportToExcelFromSchema(stockRows, initialStockExcelSchema);
          },
          csv: async () => {
            const all = await getBranchStockRows({
              branchId: branchFilter !== "all" ? branchFilter : undefined,
              productType: typeFilter !== "all" ? typeFilter : undefined,
              search: search || undefined,
              lowStockOnly: lowStockOnly === "low",
            });
            const cols = [
              { header: "Mã hàng", key: "productCode", width: 15 },
              { header: "Tên hàng", key: "productName", width: 30 },
              { header: "Chi nhánh", key: "branchName", width: 20 },
              { header: "Tồn kho", key: "quantity", width: 12, format: (v: number) => v },
              { header: "Khả dụng", key: "available", width: 12, format: (v: number) => v },
              { header: "Giá trị tồn", key: "stockValue", width: 15, format: (v: number) => v },
            ];
            exportToCsv(all, cols, "ton-kho");
          },
        }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="inventory" size={16} />}
          label="Tổng SP"
          value={totalRows.toString()}
        />
        <SummaryCard
          icon={<Icon name="inventory" size={16} />}
          label="Tổng giá trị tồn"
          value={formatCurrency(totalValue)}
          highlight
        />
        <SummaryCard
          icon={<Icon name="warning" size={16} className="text-destructive" />}
          label="Dưới định mức"
          value={lowStockCount.toString()}
          danger={lowStockCount > 0}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        total={totalRows}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(totalRows / pageSize)}
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
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(stockRow, onClose) => (
          <StockRowDetail row={stockRow} onClose={onClose} />
        )}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={initialStockExcelSchema}
        onCommit={bulkImportInitialStock}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập tồn kho đầu kỳ hoàn tất",
            description: "Tồn kho các sản phẩm đã được cập nhật theo chi nhánh.",
            variant: "success",
          });
        }}
      />
    </ListPageLayout>
  );
}

