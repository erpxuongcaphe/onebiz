"use client";

/**
 * Báo cáo Xuất-Nhập-Tồn (XNT).
 *
 * Format chuẩn KiotViet (CEO 06/05/2026):
 * - View "Tổng hợp" (9 cột): Mã / Tên / ĐVT / Tồn đầu / Nhập / Xuất / Tồn cuối
 * - View "Chi tiết" (13 cột): NHẬP × 5 (NCC/Kiểm/Trả/Chuyển/SX) + XUẤT × 6
 * - Filter: 16 preset thời gian + chi nhánh + search SP
 * - Export: View hiện tại (1 sheet) hoặc Đầy đủ (multi-sheet kế toán pivot)
 *
 * Built trên framework `@/components/shared/report` Sprint REP-1.
 */

import { useEffect, useState, useCallback } from "react";
import { useBranchFilter } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
  type ColumnGroup,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildReportTitleRows,
} from "@/lib/utils/excel-export";
import { getXntReport, type XntRow, type XntReportResult } from "@/lib/services";
import { cn } from "@/lib/utils";

type SubMode = "summary" | "detail";

const SUB_MODES: { key: SubMode; label: string; icon: string }[] = [
  { key: "summary", label: "Tổng hợp", icon: "view_module" },
  { key: "detail", label: "Chi tiết", icon: "view_list" },
];

export default function XuatNhapTonPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();

  const {
    preset,
    range,
    setPreset,
    setCustomRange,
    viewMode,
    setViewMode,
  } = useReportState({
    defaultPreset: "thisMonth",
    defaultViewMode: "table", // XNT default table (số liệu nhiều, biểu đồ ít ý nghĩa)
  });

  const [subMode, setSubMode] = useState<SubMode>("summary");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<XntReportResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getXntReport({
        range,
        branchId: activeBranchId ?? undefined,
        search: search.trim() || undefined,
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch XNT report:", err);
    } finally {
      setLoading(false);
    }
  }, [range, activeBranchId, search]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";

  // ========================================================
  // Excel export — view mode (mirror current view)
  // ========================================================
  const handleExportView = useCallback(() => {
    if (!data) return;

    const titleRows = buildReportTitleRows({
      title:
        subMode === "detail"
          ? "Báo cáo xuất nhập tồn chi tiết"
          : "Báo cáo xuất nhập tồn",
      range,
      branchName,
      generatedAt: new Date(),
    });

    if (subMode === "summary") {
      exportReportToExcel({
        kind: "xuat-nhap-ton",
        mode: "view",
        range,
        branchName,
        sheets: [
          {
            name: "Xuất nhập tồn",
            titleRows,
            columns: [
              { label: "Mã hàng", key: "code", width: 14 },
              { label: "Tên hàng", key: "name", width: 36 },
              { label: "ĐVT", key: "unit", width: 8 },
              { label: "Tồn đầu kỳ", key: "openingQty", width: 12, format: "number" },
              { label: "Giá trị đầu kỳ", key: "openingValue", width: 16, format: "currency" },
              { label: "SL Nhập", key: "totalIn", width: 10, format: "number" },
              { label: "Giá trị nhập", key: "inValue", width: 16, format: "currency" },
              { label: "SL Xuất", key: "totalOut", width: 10, format: "number" },
              { label: "Giá trị xuất", key: "outValue", width: 16, format: "currency" },
              { label: "Tồn cuối kỳ", key: "closingQty", width: 12, format: "number" },
              { label: "Giá trị cuối kỳ", key: "closingValue", width: 16, format: "currency" },
            ],
            rows: data.rows.map((r) => ({
              code: r.code,
              name: r.name,
              unit: r.unit,
              openingQty: r.openingQty,
              openingValue: r.openingValue,
              totalIn: r.totalIn,
              inValue: r.inValue,
              totalOut: r.totalOut,
              outValue: r.outValue,
              closingQty: r.closingQty,
              closingValue: r.closingValue,
            })),
            footerLabel: `SL mặt hàng: ${data.subtotal.productCount}`,
            footer: {
              openingQty: data.subtotal.openingQty,
              openingValue: data.subtotal.openingValue,
              totalIn: data.subtotal.totalIn,
              inValue: data.subtotal.inValue,
              totalOut: data.subtotal.totalOut,
              outValue: data.subtotal.outValue,
              closingQty: data.subtotal.closingQty,
              closingValue: data.subtotal.closingValue,
            },
          },
        ],
      });
    } else {
      // detail mode — 13 cột chia NHẬP/XUẤT
      exportReportToExcel({
        kind: "xuat-nhap-ton",
        mode: "view",
        range,
        branchName,
        sheets: [
          {
            name: "XNT chi tiết",
            titleRows,
            columnGroups: [
              { label: "", span: 4 }, // Mã / Tên / ĐVT / Tồn đầu+GT đầu (4)
              { label: "NHẬP", span: 5 },
              { label: "XUẤT", span: 6 },
              { label: "", span: 2 }, // Tồn cuối + GT cuối
            ],
            columns: [
              { label: "Mã hàng", key: "code", width: 14 },
              { label: "Tên hàng", key: "name", width: 32 },
              { label: "Tồn đầu", key: "openingQty", width: 10, format: "number" },
              { label: "GT đầu", key: "openingValue", width: 14, format: "currency" },
              // NHẬP 5 cột
              { label: "NCC", key: "inSupplier", width: 10, format: "number" },
              { label: "Kiểm(+)", key: "inCheck", width: 10, format: "number" },
              { label: "Trả KH", key: "inReturn", width: 10, format: "number" },
              { label: "Chuyển đến", key: "inTransfer", width: 11, format: "number" },
              { label: "SX nhập", key: "inProduction", width: 10, format: "number" },
              // XUẤT 6 cột
              { label: "Bán", key: "outSale", width: 10, format: "number" },
              { label: "Hủy", key: "outDisposal", width: 10, format: "number" },
              { label: "Trả NCC", key: "outSupplierReturn", width: 11, format: "number" },
              { label: "Kiểm(-)", key: "outCheck", width: 10, format: "number" },
              { label: "Chuyển đi", key: "outTransfer", width: 11, format: "number" },
              { label: "SX xuất", key: "outProduction", width: 10, format: "number" },
              { label: "Tồn cuối", key: "closingQty", width: 10, format: "number" },
              { label: "GT cuối", key: "closingValue", width: 14, format: "currency" },
            ],
            rows: data.rows.map((r) => ({
              code: r.code,
              name: r.name,
              openingQty: r.openingQty,
              openingValue: r.openingValue,
              inSupplier: r.inSupplier,
              inCheck: r.inCheck,
              inReturn: r.inReturn,
              inTransfer: r.inTransfer,
              inProduction: r.inProduction,
              outSale: r.outSale,
              outDisposal: r.outDisposal,
              outSupplierReturn: r.outSupplierReturn,
              outCheck: r.outCheck,
              outTransfer: r.outTransfer,
              outProduction: r.outProduction,
              closingQty: r.closingQty,
              closingValue: r.closingValue,
            })),
            footerLabel: `SL mặt hàng: ${data.subtotal.productCount}`,
          },
        ],
      });
    }
  }, [data, range, branchName, subMode]);

  // ========================================================
  // Excel export — full mode (multi-sheet kế toán pivot)
  // ========================================================
  const handleExportFull = useCallback(() => {
    if (!data) return;

    const titleRows = buildReportTitleRows({
      title: "Báo cáo xuất nhập tồn — Đầy đủ",
      range,
      branchName,
      generatedAt: new Date(),
    });

    exportReportToExcel({
      kind: "xuat-nhap-ton",
      mode: "full",
      range,
      branchName,
      sheets: [
        // Sheet 1 — Tổng hợp 9 cột
        {
          name: "1. Tổng hợp",
          titleRows,
          columns: [
            { label: "Mã hàng", key: "code", width: 14 },
            { label: "Tên hàng", key: "name", width: 36 },
            { label: "ĐVT", key: "unit", width: 8 },
            { label: "Nhóm hàng", key: "categoryName", width: 18 },
            { label: "Tồn đầu kỳ", key: "openingQty", width: 12, format: "number" },
            { label: "GT đầu kỳ", key: "openingValue", width: 16, format: "currency" },
            { label: "SL Nhập", key: "totalIn", width: 10, format: "number" },
            { label: "GT Nhập", key: "inValue", width: 16, format: "currency" },
            { label: "SL Xuất", key: "totalOut", width: 10, format: "number" },
            { label: "GT Xuất", key: "outValue", width: 16, format: "currency" },
            { label: "Tồn cuối kỳ", key: "closingQty", width: 12, format: "number" },
            { label: "GT cuối kỳ", key: "closingValue", width: 16, format: "currency" },
          ],
          rows: data.rows.map((r) => ({
            code: r.code,
            name: r.name,
            unit: r.unit,
            categoryName: r.categoryName ?? "—",
            openingQty: r.openingQty,
            openingValue: r.openingValue,
            totalIn: r.totalIn,
            inValue: r.inValue,
            totalOut: r.totalOut,
            outValue: r.outValue,
            closingQty: r.closingQty,
            closingValue: r.closingValue,
          })),
          footerLabel: `SL mặt hàng: ${data.subtotal.productCount}`,
          footer: {
            openingQty: data.subtotal.openingQty,
            openingValue: data.subtotal.openingValue,
            totalIn: data.subtotal.totalIn,
            inValue: data.subtotal.inValue,
            totalOut: data.subtotal.totalOut,
            outValue: data.subtotal.outValue,
            closingQty: data.subtotal.closingQty,
            closingValue: data.subtotal.closingValue,
          },
        },
        // Sheet 2 — Chi tiết NHẬP/XUẤT 13 cột
        {
          name: "2. Chi tiết NHẬP-XUẤT",
          titleRows,
          columnGroups: [
            { label: "", span: 4 },
            { label: "NHẬP", span: 5 },
            { label: "XUẤT", span: 6 },
            { label: "", span: 2 },
          ],
          columns: [
            { label: "Mã hàng", key: "code", width: 14 },
            { label: "Tên hàng", key: "name", width: 32 },
            { label: "Tồn đầu", key: "openingQty", width: 10, format: "number" },
            { label: "GT đầu", key: "openingValue", width: 14, format: "currency" },
            { label: "NCC", key: "inSupplier", width: 10, format: "number" },
            { label: "Kiểm(+)", key: "inCheck", width: 10, format: "number" },
            { label: "Trả KH", key: "inReturn", width: 10, format: "number" },
            { label: "Chuyển đến", key: "inTransfer", width: 11, format: "number" },
            { label: "SX nhập", key: "inProduction", width: 10, format: "number" },
            { label: "Bán", key: "outSale", width: 10, format: "number" },
            { label: "Hủy", key: "outDisposal", width: 10, format: "number" },
            { label: "Trả NCC", key: "outSupplierReturn", width: 11, format: "number" },
            { label: "Kiểm(-)", key: "outCheck", width: 10, format: "number" },
            { label: "Chuyển đi", key: "outTransfer", width: 11, format: "number" },
            { label: "SX xuất", key: "outProduction", width: 10, format: "number" },
            { label: "Tồn cuối", key: "closingQty", width: 10, format: "number" },
            { label: "GT cuối", key: "closingValue", width: 14, format: "currency" },
          ],
          rows: data.rows.map((r) => ({
            code: r.code,
            name: r.name,
            openingQty: r.openingQty,
            openingValue: r.openingValue,
            inSupplier: r.inSupplier,
            inCheck: r.inCheck,
            inReturn: r.inReturn,
            inTransfer: r.inTransfer,
            inProduction: r.inProduction,
            outSale: r.outSale,
            outDisposal: r.outDisposal,
            outSupplierReturn: r.outSupplierReturn,
            outCheck: r.outCheck,
            outTransfer: r.outTransfer,
            outProduction: r.outProduction,
            closingQty: r.closingQty,
            closingValue: r.closingValue,
          })),
        },
        // Sheet 3 — Tham số (kỳ báo cáo + chi nhánh + phương pháp)
        {
          name: "3. Tham số",
          columns: [
            { label: "Tham số", key: "key", width: 24 },
            { label: "Giá trị", key: "value", width: 36 },
          ],
          rows: [
            { key: "Từ ngày", value: range.from },
            { key: "Đến ngày", value: range.to },
            { key: "Chi nhánh", value: branchName },
            { key: "Phương pháp tính giá", value: "Cost price snapshot (best-effort)" },
            { key: "Người xuất", value: "—" },
            {
              key: "Thời gian xuất",
              value: new Date().toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              }),
            },
          ],
        },
      ],
    });
  }, [data, range, branchName]);

  // ========================================================
  // Render: column definitions
  // ========================================================

  const summaryColumns: DataTableColumn<XntRow>[] = [
    { label: "Mã hàng", key: "code", align: "left", width: "120px" },
    { label: "Tên hàng", key: "name", align: "left" },
    {
      label: "Tồn đầu kỳ",
      key: "openingQty",
      align: "right",
      cell: (r) => formatNumber(r.openingQty),
      subtotalCell: data ? formatNumber(data.subtotal.openingQty) : "0",
    },
    {
      label: "Giá trị đầu kỳ",
      key: "openingValue",
      align: "right",
      cell: (r) => formatCurrency(r.openingValue),
      subtotalCell: data ? formatCurrency(data.subtotal.openingValue) : "0",
    },
    {
      label: "Số lượng nhập",
      key: "totalIn",
      align: "right",
      cell: (r) => formatNumber(r.totalIn),
      subtotalCell: data ? formatNumber(data.subtotal.totalIn) : "0",
    },
    {
      label: "Giá trị nhập",
      key: "inValue",
      align: "right",
      cell: (r) => formatCurrency(r.inValue),
      subtotalCell: data ? formatCurrency(data.subtotal.inValue) : "0",
    },
    {
      label: "Số lượng xuất",
      key: "totalOut",
      align: "right",
      cell: (r) => formatNumber(r.totalOut),
      subtotalCell: data ? formatNumber(data.subtotal.totalOut) : "0",
    },
    {
      label: "Giá trị xuất",
      key: "outValue",
      align: "right",
      cell: (r) => formatCurrency(r.outValue),
      subtotalCell: data ? formatCurrency(data.subtotal.outValue) : "0",
    },
    {
      label: "Tồn cuối kỳ",
      key: "closingQty",
      align: "right",
      cell: (r) => formatNumber(r.closingQty),
      subtotalCell: data ? formatNumber(data.subtotal.closingQty) : "0",
    },
    {
      label: "Giá trị cuối kỳ",
      key: "closingValue",
      align: "right",
      cell: (r) => formatCurrency(r.closingValue),
      subtotalCell: data ? formatCurrency(data.subtotal.closingValue) : "0",
    },
  ];

  const detailColumns: DataTableColumn<XntRow>[] = [
    { label: "Mã hàng", key: "code", align: "left", width: "110px" },
    { label: "Tên hàng", key: "name", align: "left", width: "220px" },
    {
      label: "Tồn đầu kỳ",
      key: "openingQty",
      align: "right",
      cell: (r) => formatNumber(r.openingQty),
    },
    {
      label: "Giá trị đầu kỳ",
      key: "openingValue",
      align: "right",
      cell: (r) => formatCurrency(r.openingValue),
    },
    // NHẬP × 5
    { label: "Nhập từ NCC", key: "inSupplier", align: "right", cell: (r) => formatNumber(r.inSupplier) },
    { label: "Kiểm kê (+)", key: "inCheck", align: "right", cell: (r) => formatNumber(r.inCheck) },
    { label: "Khách trả", key: "inReturn", align: "right", cell: (r) => formatNumber(r.inReturn) },
    { label: "Chuyển kho đến", key: "inTransfer", align: "right", cell: (r) => formatNumber(r.inTransfer) },
    { label: "Sản xuất nhập", key: "inProduction", align: "right", cell: (r) => formatNumber(r.inProduction) },
    // XUẤT × 6
    { label: "Bán hàng", key: "outSale", align: "right", cell: (r) => formatNumber(r.outSale) },
    { label: "Xuất huỷ", key: "outDisposal", align: "right", cell: (r) => formatNumber(r.outDisposal) },
    { label: "Trả NCC", key: "outSupplierReturn", align: "right", cell: (r) => formatNumber(r.outSupplierReturn) },
    { label: "Kiểm kê (−)", key: "outCheck", align: "right", cell: (r) => formatNumber(r.outCheck) },
    { label: "Chuyển kho đi", key: "outTransfer", align: "right", cell: (r) => formatNumber(r.outTransfer) },
    { label: "Sản xuất xuất", key: "outProduction", align: "right", cell: (r) => formatNumber(r.outProduction) },
    {
      label: "Tồn cuối kỳ",
      key: "closingQty",
      align: "right",
      cell: (r) => formatNumber(r.closingQty),
    },
    {
      label: "Giá trị cuối kỳ",
      key: "closingValue",
      align: "right",
      cell: (r) => formatCurrency(r.closingValue),
    },
  ];

  const detailColumnGroups: ColumnGroup[] = [
    { label: "", span: 4 },
    { label: "NHẬP", span: 5, variant: "input" },
    { label: "XUẤT", span: 6, variant: "output" },
    { label: "", span: 2 },
  ];

  const subtotalLabel = data
    ? `SL mặt hàng: ${data.subtotal.productCount}`
    : "—";

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <ReportPageHeader
        title="Báo cáo Xuất - Nhập - Tồn"
        subtitle={
          subMode === "detail"
            ? "Chi tiết NHẬP/XUẤT theo từng loại giao dịch (kế toán)"
            : "Tổng hợp tồn đầu, nhập, xuất, tồn cuối kỳ"
        }
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || !data}
      />

      {/* Sub-mode toggle + Search */}
      <div className="bg-surface-container-lowest border-b border-border px-4 lg:px-6 py-2 flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-full p-0.5 bg-surface-container-low border border-border">
          {SUB_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setSubMode(m.key)}
              className={cn(
                "inline-flex items-center gap-1 px-3 h-7 rounded-full text-xs font-medium transition-colors press-scale-sm",
                subMode === m.key
                  ? "bg-primary text-primary-foreground ambient-shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon name={m.icon} size={14} />
              {m.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Icon
            name="search"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã / tên hàng..."
            className="w-full pl-8 pr-3 h-8 text-xs rounded-full border border-border bg-surface-container-lowest outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 lg:p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              name="progress_activity"
              size={32}
              className="animate-spin text-muted-foreground"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Đang tải dữ liệu báo cáo...
            </p>
          </div>
        ) : !data ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Không có dữ liệu
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow">
            {subMode === "summary" ? (
              <ReportDataTable
                columns={summaryColumns}
                rows={data.rows}
                getRowKey={(r) => r.productId}
                subtotalLabel={subtotalLabel}
                emptyState="Chưa có dữ liệu trong kỳ này"
              />
            ) : (
              <ReportDataTable
                columns={detailColumns}
                columnGroups={detailColumnGroups}
                rows={data.rows}
                getRowKey={(r) => r.productId}
                subtotalLabel={subtotalLabel}
                emptyState="Chưa có dữ liệu trong kỳ này"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
