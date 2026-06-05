"use client";

/**
 * Trang Phân tích "Khách hàng × Sản phẩm" — CEO 14/05/2026.
 *
 * 2 view mode (toggle):
 *  1. **Pivot KH × Nhóm hàng** (default)
 *     - Ma trận: rows=KH, cols=nhóm hàng, cell=doanh thu (heatmap)
 *     - Click row "Tổng" để drill xuống mode 2 với customerId filter
 *     - Sticky header + first column khi scroll
 *     - Row TỔNG cuối cùng cho từng cột
 *
 *  2. **Drill-down KH → Mặt hàng**
 *     - Layout master-detail: trái = list KH (sort theo DT), phải = SP của KH
 *     - Search KH ở trái
 *     - Bảng SP ở phải có: tên / nhóm / SL / doanh thu / % tổng KH
 *
 * Cả 2 mode đều có Export Excel (view: 1 sheet đang xem, full: cả 2 mode +
 * data thô).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChartCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import {
  getRevenueByCustomerAndCategory,
  getRevenueByCustomerAndProduct,
} from "@/lib/services";
import type {
  CustomerCategoryCell,
  CustomerProductCell,
} from "@/lib/services/supabase/analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { cn } from "@/lib/utils";

type Mode = "pivot" | "drilldown";

/**
 * Convert mảng dài (matrix dạng row) → ma trận 2D để render pivot.
 * Trả về:
 *   - customers: list KH (sort theo tổng DT desc)
 *   - categories: list nhóm hàng (sort theo tổng DT desc)
 *   - matrix: Map<custId, Map<catId|"null", revenue>>
 *   - rowTotals: Map<custId, totalRevenue>
 *   - colTotals: Map<catId|"null", totalRevenue>
 *   - grandTotal: tổng cộng
 */
function pivotMatrix(cells: CustomerCategoryCell[]) {
  const customersMap = new Map<string, string>();
  const categoriesMap = new Map<string, string>();
  const matrix = new Map<string, Map<string, number>>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let grandTotal = 0;

  for (const c of cells) {
    customersMap.set(c.customerId, c.customerName);
    const catKey = c.categoryId ?? "null";
    categoriesMap.set(catKey, c.categoryName);

    let row = matrix.get(c.customerId);
    if (!row) {
      row = new Map();
      matrix.set(c.customerId, row);
    }
    row.set(catKey, (row.get(catKey) ?? 0) + c.revenue);

    rowTotals.set(c.customerId, (rowTotals.get(c.customerId) ?? 0) + c.revenue);
    colTotals.set(catKey, (colTotals.get(catKey) ?? 0) + c.revenue);
    grandTotal += c.revenue;
  }

  // Sort KH theo tổng DT desc
  const customers = Array.from(customersMap.entries())
    .map(([id, name]) => ({ id, name, total: rowTotals.get(id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  // Sort nhóm hàng theo tổng DT desc
  const categories = Array.from(categoriesMap.entries())
    .map(([id, name]) => ({ id, name, total: colTotals.get(id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  return { customers, categories, matrix, rowTotals, colTotals, grandTotal };
}

/** Class màu heatmap theo tỉ lệ % so với cell max trong matrix. */
function heatmapClass(value: number, max: number): string {
  if (value === 0 || max === 0) return "";
  const pct = value / max;
  if (pct >= 0.75) return "bg-primary/20 font-semibold";
  if (pct >= 0.5) return "bg-primary/12";
  if (pct >= 0.25) return "bg-primary/6";
  if (pct > 0) return "bg-primary/3";
  return "";
}

export default function KhachSanPhamPage() {
  const { activeBranchId } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultPreset: "thisMonth",
  });

  const [mode, setMode] = useState<Mode>("pivot");
  const [loading, setLoading] = useState(true);
  const [categoryCells, setCategoryCells] = useState<CustomerCategoryCell[]>([]);
  const [productCells, setProductCells] = useState<CustomerProductCell[]>([]);

  // Drill-down state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [productDetail, setProductDetail] = useState<CustomerProductCell[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  // ── Load primary data ──
  useEffect(() => {
    setLoading(true);
    Promise.all([
      getRevenueByCustomerAndCategory(activeBranchId ?? undefined, range, 50),
      getRevenueByCustomerAndProduct(activeBranchId ?? undefined, range, undefined, 200),
    ])
      .then(([cats, prods]) => {
        setCategoryCells(cats);
        setProductCells(prods);
      })
      .catch((err) => {
        toast({
          title: "Lỗi tải dữ liệu",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      })
      .finally(() => setLoading(false));
  }, [activeBranchId, range, toast]);

  // ── Drill-down: load chi tiết SP của 1 KH ──
  useEffect(() => {
    if (!selectedCustomerId || mode !== "drilldown") return;
    setLoadingDetail(true);
    getRevenueByCustomerAndProduct(
      activeBranchId ?? undefined,
      range,
      selectedCustomerId,
    )
      .then(setProductDetail)
      .catch((err: unknown) => {
        console.error(
          "[phan-tich/khach-san-pham] load product detail failed:",
          err,
        );
        setProductDetail([]);
      })
      .finally(() => setLoadingDetail(false));
  }, [selectedCustomerId, activeBranchId, range, mode]);

  // ── Pivot matrix ──
  const pivot = useMemo(() => pivotMatrix(categoryCells), [categoryCells]);
  const maxCellValue = useMemo(() => {
    let max = 0;
    for (const row of pivot.matrix.values()) {
      for (const v of row.values()) {
        if (v > max) max = v;
      }
    }
    return max;
  }, [pivot.matrix]);

  // ── Drill-down: list KH sort + filter ──
  const customerList = useMemo(() => {
    return pivot.customers.filter((c) =>
      search.trim() === ""
        ? true
        : c.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
  }, [pivot.customers, search]);

  // Auto-select KH đầu tiên khi vào drill-down lần đầu
  useEffect(() => {
    if (mode === "drilldown" && !selectedCustomerId && customerList.length > 0) {
      setSelectedCustomerId(customerList[0].id);
    }
  }, [mode, selectedCustomerId, customerList]);

  // ── Export Excel ──
  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title:
          mode === "pivot"
            ? "BÁO CÁO KHÁCH HÀNG × NHÓM HÀNG"
            : "BÁO CÁO KHÁCH HÀNG × MẶT HÀNG",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });

      let sheet: ExcelSheet;
      if (mode === "pivot") {
        // 1 sheet pivot: cột = nhóm hàng + cột TỔNG
        const columns = [
          { label: "Khách hàng", key: "customer", width: 32 },
          ...pivot.categories.map((cat) => ({
            label: cat.name,
            key: `cat_${cat.id}`,
            width: 16,
            format: "currency" as const,
          })),
          {
            label: "TỔNG",
            key: "total",
            width: 18,
            format: "currency" as const,
          },
        ];
        const rows = pivot.customers.map((cust) => {
          const row: Record<string, unknown> = {
            customer: cust.name,
            total: cust.total,
          };
          for (const cat of pivot.categories) {
            row[`cat_${cat.id}`] = pivot.matrix.get(cust.id)?.get(cat.id) ?? 0;
          }
          return row;
        });
        sheet = {
          name: "KH x Nhóm hàng",
          titleRows: title,
          columns,
          rows,
          footer: {
            customer: "TỔNG",
            total: pivot.grandTotal,
            ...Object.fromEntries(
              pivot.categories.map((cat) => [
                `cat_${cat.id}`,
                pivot.colTotals.get(cat.id) ?? 0,
              ]),
            ),
          },
        };
      } else {
        // Drill-down: bảng SP của KH đang chọn
        const selectedCust = pivot.customers.find(
          (c) => c.id === selectedCustomerId,
        );
        sheet = {
          name: "Chi tiết SP",
          titleRows: [
            ...title,
            selectedCust ? `Khách hàng: ${selectedCust.name}` : "",
          ].filter(Boolean),
          columns: [
            { label: "Sản phẩm", key: "name", width: 32 },
            { label: "Nhóm", key: "category", width: 18 },
            { label: "SL", key: "qty", width: 10, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: productDetail.map((p) => ({
            name: p.productName,
            category: p.categoryName ?? "Chưa phân loại",
            qty: p.quantity,
            revenue: p.revenue,
          })),
          footer: {
            name: "TỔNG",
            category: "",
            qty: productDetail.reduce((s, p) => s + p.quantity, 0),
            revenue: productDetail.reduce((s, p) => s + p.revenue, 0),
          },
        };
      }
      exportReportToExcel({
        kind: "khach-hang",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({ title: "Đã xuất Excel (view)", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [
    mode,
    pivot,
    productDetail,
    selectedCustomerId,
    range,
    branchLabel,
    toast,
  ]);

  const handleExportFull = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO KHÁCH HÀNG × SẢN PHẨM — ĐẦY ĐỦ",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheets: ExcelSheet[] = [
        // Sheet 1: Pivot KH × nhóm hàng
        {
          name: "Pivot KH x Nhóm",
          titleRows: title,
          columns: [
            { label: "Khách hàng", key: "customer", width: 32 },
            ...pivot.categories.map((cat) => ({
              label: cat.name,
              key: `cat_${cat.id}`,
              width: 16,
              format: "currency" as const,
            })),
            { label: "TỔNG", key: "total", width: 18, format: "currency" as const },
          ],
          rows: pivot.customers.map((cust) => {
            const row: Record<string, unknown> = {
              customer: cust.name,
              total: cust.total,
            };
            for (const cat of pivot.categories) {
              row[`cat_${cat.id}`] = pivot.matrix.get(cust.id)?.get(cat.id) ?? 0;
            }
            return row;
          }),
          footer: {
            customer: "TỔNG",
            total: pivot.grandTotal,
            ...Object.fromEntries(
              pivot.categories.map((cat) => [
                `cat_${cat.id}`,
                pivot.colTotals.get(cat.id) ?? 0,
              ]),
            ),
          },
        },
        // Sheet 2: Flat list KH × SP (data thô)
        {
          name: "KH x Mặt hàng",
          titleRows: ["TẤT CẢ KHÁCH × MẶT HÀNG", ...title.slice(1)],
          columns: [
            { label: "Khách hàng", key: "customerName", width: 28 },
            { label: "Sản phẩm", key: "productName", width: 32 },
            { label: "Nhóm", key: "categoryName", width: 18 },
            { label: "SL", key: "quantity", width: 10, format: "number" },
            { label: "Doanh thu (VND)", key: "revenue", width: 18, format: "currency" },
          ],
          rows: productCells.map((p) => ({
            customerName: p.customerName,
            productName: p.productName,
            categoryName: p.categoryName ?? "Chưa phân loại",
            quantity: p.quantity,
            revenue: p.revenue,
          })),
          footer: {
            customerName: "TỔNG",
            productName: "",
            categoryName: "",
            quantity: productCells.reduce((s, p) => s + p.quantity, 0),
            revenue: productCells.reduce((s, p) => s + p.revenue, 0),
          },
        },
      ];
      exportReportToExcel({
        kind: "khach-hang",
        mode: "full",
        range,
        branchName: branchLabel,
        sheets,
      });
      toast({
        title: "Đã xuất Excel (đầy đủ)",
        description: "2 sheet: Pivot KH×Nhóm + Flat KH×Mặt hàng.",
        variant: "success",
        duration: 5000,
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [pivot, productCells, range, branchLabel, toast]);

  return (
    <div className="flex flex-col h-full">
      <ReportPageHeader
        title="Khách hàng × Sản phẩm"
        subtitle="Pivot doanh thu khách hàng theo nhóm hàng + drill-down từng mặt hàng"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || categoryCells.length === 0}
      />

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {/* Mode switcher — Pivot vs Drill-down */}
        <div className="inline-flex rounded-lg border border-outline-variant/30 bg-surface-container-low p-1">
          {(
            [
              {
                id: "pivot" as const,
                label: "Pivot KH × Nhóm hàng",
                icon: "table_view",
              },
              {
                id: "drilldown" as const,
                label: "Drill-down KH × Mặt hàng",
                icon: "account_tree",
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === m.id
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-container",
              )}
            >
              <Icon name={m.icon} size={14} />
              {m.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : pivot.customers.length === 0 ? (
          <ChartCard title="Chưa có dữ liệu">
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Icon name="inbox" size={48} className="mx-auto mb-3 opacity-40" />
              <p>
                Chưa có đơn hàng nào có gắn khách hàng trong khoảng thời gian này.
              </p>
              <p className="text-xs mt-1">
                Khách lẻ (không gắn khách) sẽ không hiển thị trong báo cáo này.
              </p>
            </div>
          </ChartCard>
        ) : mode === "pivot" ? (
          /* ────────────────────────────────────────
             MODE 1: PIVOT KH × NHÓM HÀNG (heatmap)
             ──────────────────────────────────────── */
          <ChartCard
            title="Doanh thu khách hàng theo nhóm hàng"
            subtitle={`${pivot.customers.length} khách × ${pivot.categories.length} nhóm — heatmap đậm = doanh thu cao`}
          >
            <div className="overflow-x-auto rounded-lg border border-outline-variant/20">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-surface-container-low sticky top-0 z-10">
                  <tr>
                    <th
                      className="text-left text-xs font-semibold text-muted-foreground py-2.5 px-3 sticky left-0 bg-surface-container-low z-20 border-r border-outline-variant/20"
                      style={{ minWidth: 200 }}
                    >
                      Khách hàng
                    </th>
                    {pivot.categories.map((cat) => (
                      <th
                        key={cat.id}
                        className="text-right text-xs font-semibold text-muted-foreground py-2.5 px-3 whitespace-nowrap"
                        style={{ minWidth: 130 }}
                      >
                        {cat.name}
                      </th>
                    ))}
                    <th
                      className="text-right text-xs font-bold text-primary py-2.5 px-3 bg-primary/5 sticky right-0 z-10"
                      style={{ minWidth: 140 }}
                    >
                      TỔNG
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pivot.customers.map((cust) => {
                    const row = pivot.matrix.get(cust.id);
                    return (
                      <tr
                        key={cust.id}
                        className="border-t border-outline-variant/10 hover:bg-surface-container-low"
                      >
                        <td className="text-sm font-medium text-foreground py-2 px-3 sticky left-0 bg-background hover:bg-surface-container-low z-10 border-r border-outline-variant/20">
                          {cust.name}
                        </td>
                        {pivot.categories.map((cat) => {
                          const value = row?.get(cat.id) ?? 0;
                          return (
                            <td
                              key={cat.id}
                              className={cn(
                                "text-right text-sm tabular-nums py-2 px-3 transition-colors",
                                heatmapClass(value, maxCellValue),
                                value === 0 && "text-muted-foreground/40",
                              )}
                            >
                              {value === 0 ? "—" : formatCurrency(value)}
                            </td>
                          );
                        })}
                        <td className="text-right text-sm font-bold text-primary tabular-nums py-2 px-3 bg-primary/5 sticky right-0">
                          {formatCurrency(cust.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-container-low font-bold">
                  <tr className="border-t-2 border-foreground/20">
                    <td className="py-2.5 px-3 sticky left-0 bg-surface-container-low z-10 border-r border-outline-variant/20">
                      TỔNG
                    </td>
                    {pivot.categories.map((cat) => (
                      <td
                        key={cat.id}
                        className="text-right tabular-nums py-2.5 px-3 text-foreground"
                      >
                        {formatCurrency(pivot.colTotals.get(cat.id) ?? 0)}
                      </td>
                    ))}
                    <td className="text-right tabular-nums py-2.5 px-3 text-primary bg-primary/10 sticky right-0">
                      {formatCurrency(pivot.grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground mt-3">
              <Icon name="info" size={12} className="inline mr-1 align-text-bottom" />
              Top 50 khách theo doanh thu. Click chuyển sang <strong>Drill-down</strong>{" "}
              ở trên để xem chi tiết mặt hàng từng khách.
            </p>
          </ChartCard>
        ) : (
          /* ────────────────────────────────────────
             MODE 2: DRILL-DOWN KH → MẶT HÀNG
             ──────────────────────────────────────── */
          <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-4">
            {/* Left panel: KH list */}
            <ChartCard
              title="Khách hàng"
              subtitle={`${pivot.customers.length} KH — click để xem chi tiết`}
            >
              <div className="space-y-2">
                <Input
                  placeholder="Tìm tên khách hàng..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="max-h-[500px] overflow-y-auto space-y-0.5">
                  {customerList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      Không tìm thấy khách phù hợp
                    </p>
                  ) : (
                    customerList.map((cust) => {
                      const isActive = cust.id === selectedCustomerId;
                      return (
                        <button
                          key={cust.id}
                          onClick={() => setSelectedCustomerId(cust.id)}
                          className={cn(
                            "w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors",
                            isActive
                              ? "bg-primary text-on-primary"
                              : "hover:bg-surface-container",
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium truncate">
                              {cust.name}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] tabular-nums shrink-0",
                                isActive
                                  ? "text-on-primary/80"
                                  : "text-muted-foreground",
                              )}
                            >
                              {formatCurrency(cust.total)}đ
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </ChartCard>

            {/* Right panel: SP detail */}
            <ChartCard
              title={(() => {
                const cust = pivot.customers.find(
                  (c) => c.id === selectedCustomerId,
                );
                return cust
                  ? `Mặt hàng đã mua — ${cust.name}`
                  : "Chọn khách hàng";
              })()}
              subtitle={
                selectedCustomerId
                  ? `${productDetail.length} mặt hàng`
                  : "Click 1 khách bên trái"
              }
            >
              {!selectedCustomerId ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <Icon
                    name="arrow_back"
                    size={32}
                    className="mx-auto mb-2 opacity-50"
                  />
                  Chọn khách hàng từ danh sách bên trái
                </div>
              ) : loadingDetail ? (
                <div className="py-12 flex items-center justify-center">
                  <Icon
                    name="progress_activity"
                    size={24}
                    className="animate-spin text-muted-foreground"
                  />
                </div>
              ) : productDetail.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Khách này chưa mua món nào trong khoảng thời gian này
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-container-low">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3 font-medium w-8">#</th>
                        <th className="py-2 px-3 font-medium">Sản phẩm</th>
                        <th className="py-2 px-3 font-medium">Nhóm</th>
                        <th className="py-2 px-3 font-medium text-right">SL</th>
                        <th className="py-2 px-3 font-medium text-right">
                          Doanh thu
                        </th>
                        <th className="py-2 px-3 font-medium text-right">% KH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = productDetail.reduce(
                          (s, p) => s + p.revenue,
                          0,
                        );
                        return productDetail.map((p, i) => (
                          <tr
                            key={p.productId}
                            className="border-b last:border-0 hover:bg-surface-container-low"
                          >
                            <td className="py-1.5 px-3 text-muted-foreground text-xs tabular-nums">
                              {i + 1}
                            </td>
                            <td className="py-1.5 px-3 font-medium">
                              {p.productName}
                            </td>
                            <td className="py-1.5 px-3 text-muted-foreground text-xs">
                              {p.categoryName ?? "—"}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums">
                              {p.quantity}
                            </td>
                            <td className="py-1.5 px-3 text-right font-medium tabular-nums">
                              {formatCurrency(p.revenue)}đ
                            </td>
                            <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums">
                              {total > 0
                                ? ((p.revenue / total) * 100).toFixed(1) + "%"
                                : "—"}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-foreground/20 font-bold">
                        <td colSpan={3} className="py-2 px-3">
                          TỔNG
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {productDetail.reduce((s, p) => s + p.quantity, 0)}
                        </td>
                        <td className="py-2 px-3 text-right text-primary tabular-nums">
                          {formatCurrency(
                            productDetail.reduce((s, p) => s + p.revenue, 0),
                          )}đ
                        </td>
                        <td className="py-2 px-3 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}
