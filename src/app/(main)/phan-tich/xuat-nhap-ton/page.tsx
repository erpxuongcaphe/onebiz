"use client";

/**
 * Báo cáo Xuất-Nhập-Tồn (XNT).
 *
 * Format chuẩn KiotViet (CEO 06/05/2026):
 * - View "Tổng hợp" (11 cột): Mã / Tên / ĐVT + số lượng và giá trị Tồn đầu / Nhập / Xuất / Tồn cuối
 * - View "Chi tiết" (20 cột): Mã / Tên / Tồn đầu + NHẬP × 6 + XUẤT × 8 + Tồn cuối
 * - Filter: 16 preset thời gian + chi nhánh + search SP
 * - Export: View hiện tại (1 sheet) hoặc Đầy đủ (multi-sheet kế toán pivot)
 *
 * Built trên framework `@/components/shared/report` Sprint REP-1.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatStockQuantity as formatNumber, formatCurrency, formatDate } from "@/lib/format";
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
import { buildXntMovementHref } from "@/lib/reports/xnt-drilldown";
import { filterXntRows, sumXntRows, sumXntQuantities, type XntRowFilter } from "@/lib/reports/xnt-view";
import { sortReportRows } from "@/lib/reports/table-sort";
import { withXntUnitValues, XNT_VALUE_GROUPS, XNT_SUMMARY_EXCEL_COLUMNS, XNT_SUMMARY_COLUMN_GROUPS, type XntValuedRow } from "@/lib/reports/xnt-unit-values";

type SubMode = "summary" | "detail";

const HISTORICAL_VALUE_NOTE = "Giá trị được tính từ giá vốn chốt tại từng phát sinh kho. Mặt hàng thiếu snapshot lịch sử được để trống, không ước tính bằng giá vốn hiện tại.";

function formatValuation(value: number | null): string {
  return value === null ? "Chưa đủ dữ liệu" : formatCurrency(value);
}

const SUB_MODES: { key: SubMode; label: string; icon: string }[] = [
  { key: "summary", label: "Tổng hợp", icon: "view_module" },
  { key: "detail", label: "Chi tiết", icon: "view_list" },
];

export default function XuatNhapTonPage() {
  const { activeBranchId, isReady, branches } = useBranchFilter();
  const { toast } = useToast();

  const {
    preset,
    range,
    setPreset,
    setCustomRange,
  } = useReportState({
    defaultPreset: "thisMonth",
    defaultViewMode: "table", // XNT default table (số liệu nhiều, biểu đồ ít ý nghĩa)
  });

  const [subMode, setSubMode] = useState<SubMode>("summary");
  const [rowFilter, setRowFilter] = useState<XntRowFilter>("activity");
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [unitFilter, setUnitFilter] = useState<string | undefined>();
  const [sortState, setSortState] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<XntReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await getXntReport({
        range,
        branchId: activeBranchId ?? undefined,
        search: debouncedSearch || undefined,
      });
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Failed to fetch XNT report:", err);
      setData(null);
      toast({
        title: "Lỗi tải báo cáo Xuất - Nhập - Tồn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [range, activeBranchId, debouncedSearch, toast]);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [fetchData, isReady]);

  const branchName =
    branches.find((b) => b.id === activeBranchId)?.name ?? "Tất cả chi nhánh";
  const visibleRows = useMemo(
    () => {
      const filtered = filterXntRows(data?.rows ?? [], rowFilter, { categoryName: categoryFilter, unit: unitFilter }).map(withXntUnitValues);
      return sortState ? sortReportRows(filtered, (row) => row[sortState.id as keyof XntValuedRow], sortState.direction) : sortReportRows(filtered, (row) => row.code, "asc");
    },
    [data?.rows, rowFilter, sortState, categoryFilter, unitFilter],
  );
  const visibleSubtotal = useMemo(() => sumXntRows(visibleRows), [visibleRows]);
  const quantityTotals = useMemo(() => sumXntQuantities(visibleRows), [visibleRows]);
  const categories = useMemo(() => [...new Set([
    ...(data?.rows ?? []).map((row) => row.categoryName ?? ""),
    ...(categoryFilter === undefined ? [] : [categoryFilter]),
  ])].sort((a, b) => a.localeCompare(b, "vi")), [data?.rows, categoryFilter]);
  const units = useMemo(() => [...new Set([
    ...(data?.rows ?? []).map((row) => row.unit),
    ...(unitFilter === undefined ? [] : [unitFilter]),
  ])].sort((a, b) => a.localeCompare(b, "vi")), [data?.rows, unitFilter]);
  const formatQuantityTotal = (value: number | null) => value === null ? "Nhiều ĐVT" : formatNumber(value);
  const incompleteVisibleCount = visibleSubtotal.incompleteValuationCount;

  // ========================================================
  // Excel export — view mode (mirror current view)
  // ========================================================
  const handleExportView = useCallback(async () => {
    if (exporting) return;
    if (!data) return;
    setExporting(true);
    try {

    const titleRows = buildReportTitleRows({
      title:
        subMode === "detail"
          ? "Báo cáo xuất nhập tồn chi tiết"
          : "Báo cáo xuất nhập tồn",
      range,
      branchName,
      generatedAt: new Date(),
    });
    titleRows.push(HISTORICAL_VALUE_NOTE);
    titleRows.push(`Nhóm hàng: ${categoryFilter === undefined ? "Tất cả" : categoryFilter || "Chưa phân nhóm"}; ĐVT: ${unitFilter ?? "Tất cả"}; Tìm kiếm: ${debouncedSearch || "Tất cả"}`);

    if (subMode === "summary") {
      await exportReportToExcel({
        kind: "xuat-nhap-ton",
        mode: "view",
        range,
        branchName,
        sheets: [
          {
            name: "Xuất nhập tồn",
            autoFilter: true,
            titleRows,
            tablePreferenceKey: "report.xuat-nhap-ton.summary",
            columnGroups: XNT_SUMMARY_COLUMN_GROUPS,
            columns: XNT_SUMMARY_EXCEL_COLUMNS,
            rows: visibleRows.map((r) => ({
              ...r,
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
            footerLabel: `SL mặt hàng: ${visibleSubtotal.productCount}`,
            footer: {
              openingQty: quantityTotals.openingQty,
              openingValue: visibleSubtotal.openingValue,
              totalIn: quantityTotals.totalIn,
              inValue: visibleSubtotal.inValue,
              totalOut: quantityTotals.totalOut,
              outValue: visibleSubtotal.outValue,
              closingQty: quantityTotals.closingQty,
              closingValue: visibleSubtotal.closingValue,
            },
          },
        ],
      });
    } else {
      // Detail mode keeps every movement bucket visible, including internal issues.
      await exportReportToExcel({
        kind: "xuat-nhap-ton",
        mode: "view",
        range,
        branchName,
        sheets: [
          {
            name: "XNT chi tiết",
            autoFilter: true,
            titleRows,
            tablePreferenceKey: "report.xuat-nhap-ton.detail",
            columnGroups: [
              { label: "", span: 5 },
              { label: "NHẬP", span: 6 },
              { label: "XUẤT", span: 8 },
              { label: "", span: 2 }, // Tồn cuối + GT cuối
            ],
            columns: [
              { label: "Mã hàng", key: "code", width: 14 },
              { label: "Tên hàng", key: "name", width: 32 },
              { label: "ĐVT", key: "unit", width: 8 },
              { label: "Tồn đầu", key: "openingQty", width: 10, format: "number" },
              { label: "GT đầu", key: "openingValue", width: 14, format: "currency" },
              // NHẬP 6 cột
              { label: "NCC", key: "inSupplier", width: 10, format: "number" },
              { label: "Kiểm(+)", key: "inCheck", width: 10, format: "number" },
              { label: "Trả KH", key: "inReturn", width: 10, format: "number" },
              { label: "Chuyển đến", key: "inTransfer", width: 11, format: "number" },
              { label: "SX nhập", key: "inProduction", width: 10, format: "number" },
              { label: "Khác(+)", key: "inOther", width: 10, format: "number" },
              // XUẤT 8 cột
              { label: "Bán", key: "outSale", width: 10, format: "number" },
              { label: "Hủy", key: "outDisposal", width: 10, format: "number" },
              { label: "Trả NCC", key: "outSupplierReturn", width: 11, format: "number" },
              { label: "Kiểm(-)", key: "outCheck", width: 10, format: "number" },
              { label: "Chuyển đi", key: "outTransfer", width: 11, format: "number" },
              { label: "SX xuất", key: "outProduction", width: 10, format: "number" },
              { label: "Nội bộ", key: "outInternal", width: 10, format: "number" },
              { label: "Khác(-)", key: "outOther", width: 10, format: "number" },
              { label: "Tồn cuối", key: "closingQty", width: 10, format: "number" },
              { label: "GT cuối", key: "closingValue", width: 14, format: "currency" },
            ].map((column) => ({ ...column, format: column.format as "number" | "currency" | undefined, decimalPlaces: 4 })),
            rows: visibleRows.map((r) => ({
              code: r.code,
              name: r.name,
              unit: r.unit,
              openingQty: r.openingQty,
              openingValue: r.openingValue,
              inSupplier: r.inSupplier,
              inCheck: r.inCheck,
              inReturn: r.inReturn,
              inTransfer: r.inTransfer,
              inProduction: r.inProduction,
              inOther: r.inOther,
              outSale: r.outSale,
              outDisposal: r.outDisposal,
              outSupplierReturn: r.outSupplierReturn,
              outCheck: r.outCheck,
              outTransfer: r.outTransfer,
              outProduction: r.outProduction,
              outInternal: r.outInternal,
              outOther: r.outOther,
              closingQty: r.closingQty,
              closingValue: r.closingValue,
            })),
            footerLabel: `SL mặt hàng: ${visibleSubtotal.productCount}`,
            footer: { ...quantityTotals, openingValue: visibleSubtotal.openingValue, closingValue: visibleSubtotal.closingValue },
          },
        ],
      });
    }
      toast({ title: "Đã xuất Excel theo bộ lọc", variant: "success" });
    } catch (error) {
      toast({ title: "Không thể xuất Excel", description: error instanceof Error ? error.message : "Vui lòng thử lại.", variant: "error" });
    } finally {
      setExporting(false);
    }
  }, [data, range, branchName, subMode, visibleRows, visibleSubtotal, quantityTotals, categoryFilter, unitFilter, debouncedSearch, exporting, toast]);

  // ========================================================
  // Excel export — full mode (multi-sheet kế toán pivot)
  // ========================================================
  const handleExportFull = useCallback(async () => {
    if (exporting) return;
    if (!data) return;
    setExporting(true);
    try {

    const titleRows = buildReportTitleRows({
      title: "Báo cáo xuất nhập tồn — Đầy đủ",
      range,
      branchName,
      generatedAt: new Date(),
    });
    titleRows.push(HISTORICAL_VALUE_NOTE);

    await exportReportToExcel({
      kind: "xuat-nhap-ton",
      mode: "full",
      range,
      branchName,
      disclaimer: HISTORICAL_VALUE_NOTE,
      sheets: [
        // Sheet 1 — Tổng hợp 9 cột
        {
          name: "1. Tổng hợp",
          autoFilter: true,
          titleRows,
          columnGroups: [{ label: "MẶT HÀNG", span: 4 }, ...XNT_SUMMARY_COLUMN_GROUPS.slice(1)],
          columns: [...XNT_SUMMARY_EXCEL_COLUMNS.slice(0, 3), { label: "Nhóm hàng", key: "categoryName", width: 22 }, ...XNT_SUMMARY_EXCEL_COLUMNS.slice(3)],
          rows: visibleRows.map((r) => ({
            ...r,
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
          footerLabel: `SL mặt hàng: ${visibleSubtotal.productCount}`,
          footer: {
            openingQty: quantityTotals.openingQty,
            openingValue: visibleSubtotal.openingValue,
            totalIn: quantityTotals.totalIn,
            inValue: visibleSubtotal.inValue,
            totalOut: quantityTotals.totalOut,
            outValue: visibleSubtotal.outValue,
            closingQty: quantityTotals.closingQty,
            closingValue: visibleSubtotal.closingValue,
          },
        },
        // Sheet 2 — Chi tiết NHẬP/XUẤT 20 cột
        {
          name: "2. Chi tiết NHẬP-XUẤT",
          autoFilter: true,
          titleRows,
          columnGroups: [
            { label: "", span: 5 },
            { label: "NHẬP", span: 6 },
            { label: "XUẤT", span: 8 },
            { label: "", span: 2 },
          ],
          columns: [
            { label: "Mã hàng", key: "code", width: 14 },
            { label: "Tên hàng", key: "name", width: 32 },
            { label: "ĐVT", key: "unit", width: 8 },
            { label: "Tồn đầu", key: "openingQty", width: 10, format: "number" },
            { label: "GT đầu", key: "openingValue", width: 14, format: "currency" },
            { label: "NCC", key: "inSupplier", width: 10, format: "number" },
            { label: "Kiểm(+)", key: "inCheck", width: 10, format: "number" },
            { label: "Trả KH", key: "inReturn", width: 10, format: "number" },
            { label: "Chuyển đến", key: "inTransfer", width: 11, format: "number" },
            { label: "SX nhập", key: "inProduction", width: 10, format: "number" },
            { label: "Khác(+)", key: "inOther", width: 10, format: "number" },
            { label: "Bán", key: "outSale", width: 10, format: "number" },
            { label: "Hủy", key: "outDisposal", width: 10, format: "number" },
            { label: "Trả NCC", key: "outSupplierReturn", width: 11, format: "number" },
            { label: "Kiểm(-)", key: "outCheck", width: 10, format: "number" },
            { label: "Chuyển đi", key: "outTransfer", width: 11, format: "number" },
            { label: "SX xuất", key: "outProduction", width: 10, format: "number" },
            { label: "Nội bộ", key: "outInternal", width: 10, format: "number" },
            { label: "Khác(-)", key: "outOther", width: 10, format: "number" },
            { label: "Tồn cuối", key: "closingQty", width: 10, format: "number" },
            { label: "GT cuối", key: "closingValue", width: 14, format: "currency" },
          ].map((column) => ({ ...column, format: column.format as "number" | "currency" | undefined, decimalPlaces: 4 })),
          rows: visibleRows.map((r) => ({
            code: r.code,
            name: r.name,
            unit: r.unit,
            openingQty: r.openingQty,
            openingValue: r.openingValue,
            inSupplier: r.inSupplier,
            inCheck: r.inCheck,
            inReturn: r.inReturn,
            inTransfer: r.inTransfer,
            inProduction: r.inProduction,
            inOther: r.inOther,
            outSale: r.outSale,
            outDisposal: r.outDisposal,
            outSupplierReturn: r.outSupplierReturn,
            outCheck: r.outCheck,
            outTransfer: r.outTransfer,
            outProduction: r.outProduction,
            outInternal: r.outInternal,
            outOther: r.outOther,
            closingQty: r.closingQty,
            closingValue: r.closingValue,
          })),
          footerLabel: `SL mặt hàng: ${visibleSubtotal.productCount}`,
          footer: { ...quantityTotals, openingValue: visibleSubtotal.openingValue, closingValue: visibleSubtotal.closingValue },
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
            { key: "Tìm mặt hàng", value: debouncedSearch || "Tất cả" },
            { key: "Nhóm hàng", value: categoryFilter === undefined ? "Tất cả" : categoryFilter || "Chưa phân nhóm" },
            { key: "Đơn vị tính", value: unitFilter ?? "Tất cả" },
            { key: "Tổng số lượng", value: unitFilter ?? (units.length > 1 ? "Không cộng các đơn vị khác nhau" : units[0] ?? "Không có dữ liệu") },
            { key: "Lọc tồn", value: rowFilter === "activity" ? "Có phát sinh" : rowFilter === "closing-stock" ? "Tồn cuối khác 0" : "Tất cả" },
            { key: "Sắp xếp", value: sortState ? `${sortState.id} (${sortState.direction})` : "Mã hàng tăng dần" },
            { key: "Đơn giá BQ", value: "Thành tiền lịch sử / số lượng; để trống khi số lượng bằng 0 hoặc thiếu giá trị; không cộng đơn giá" },
            { key: "Cơ sở giá trị tồn", value: "Snapshot giá vốn tại từng phát sinh; dòng thiếu lịch sử không được ước tính" },
            { key: "Người xuất", value: "—" },
            {
              key: "Thời gian xuất",
              value: formatDate(new Date()),
            },
          ],
        },
      ],
    });
      toast({ title: "Đã xuất Excel đầy đủ theo bộ lọc", variant: "success" });
    } catch (error) {
      toast({ title: "Không thể xuất Excel", description: error instanceof Error ? error.message : "Vui lòng thử lại.", variant: "error" });
    } finally {
      setExporting(false);
    }
  }, [data, range, branchName, visibleRows, visibleSubtotal, quantityTotals, categoryFilter, unitFilter, units, debouncedSearch, rowFilter, sortState, exporting, toast]);

  // ========================================================
  // Render: column definitions
  // ========================================================

  const summaryBaseColumns: DataTableColumn<XntValuedRow>[] = [
    {
      label: "Mã hàng", key: "code", align: "left", width: "120px",
      sticky: true, hideable: false,
      cell: (r) => (
        <Link
          className="text-primary hover:underline"
          href={buildXntMovementHref({ productId: r.productId, productCode: r.code, branchId: activeBranchId ?? undefined, from: range.from, to: range.to })}
          title="Xem phát sinh kho của mặt hàng"
        >
          {r.code}
        </Link>
      ),
    },
    { label: "Tên hàng", key: "name", align: "left" },
    { label: "ĐVT", key: "unit", align: "center", width: "80px" },
    {
      label: "Tồn đầu kỳ",
      key: "openingQty",
      align: "right",
      cell: (r) => formatNumber(r.openingQty),
      subtotalCell: formatQuantityTotal(quantityTotals.openingQty),
    },
    {
      label: "Giá trị đầu kỳ",
      key: "openingValue",
      align: "right",
      cell: (r) => formatValuation(r.openingValue),
      subtotalCell: formatValuation(visibleSubtotal.openingValue),
    },
    {
      label: "Số lượng nhập",
      key: "totalIn",
      align: "right",
      cell: (r) => formatNumber(r.totalIn),
      subtotalCell: formatQuantityTotal(quantityTotals.totalIn),
    },
    {
      label: "Giá trị nhập",
      key: "inValue",
      align: "right",
      cell: (r) => formatValuation(r.inValue),
      subtotalCell: formatValuation(visibleSubtotal.inValue),
    },
    {
      label: "Số lượng xuất",
      key: "totalOut",
      align: "right",
      cell: (r) => formatNumber(r.totalOut),
      subtotalCell: formatQuantityTotal(quantityTotals.totalOut),
    },
    {
      label: "Giá trị xuất",
      key: "outValue",
      align: "right",
      cell: (r) => formatValuation(r.outValue),
      subtotalCell: formatValuation(visibleSubtotal.outValue),
    },
    {
      label: "Tồn cuối kỳ",
      key: "closingQty",
      align: "right",
      cell: (r) => formatNumber(r.closingQty),
      subtotalCell: formatQuantityTotal(quantityTotals.closingQty),
    },
    {
      label: "Giá trị cuối kỳ",
      key: "closingValue",
      align: "right",
      cell: (r) => formatValuation(r.closingValue),
      subtotalCell: formatValuation(visibleSubtotal.closingValue),
    },
  ];

  const summaryColumns: DataTableColumn<XntValuedRow>[] = [
    ...summaryBaseColumns.slice(0, 3),
    ...XNT_VALUE_GROUPS.flatMap((group): DataTableColumn<XntValuedRow>[] => [
      { ...summaryBaseColumns.find((column) => column.key === group.quantity)!, label: "Số lượng", width: "130px" },
      {
        label: "Đơn giá BQ", key: group.price, align: "right", width: "140px",
        cell: (row) => row[group.price] === null ? (Math.abs(row[group.quantity]) < 1e-9 ? "—" : "Chưa đủ dữ liệu") : formatNumber(row[group.price]!),
        subtotalCell: "—",
      },
      { ...summaryBaseColumns.find((column) => column.key === group.value)!, label: "Thành tiền", width: "160px" },
    ]),
  ];

  const detailColumns: DataTableColumn<XntRow>[] = [
    {
      label: "Mã hàng", key: "code", align: "left", width: "110px",
      sticky: true, hideable: false,
      cell: (r) => (
        <Link
          className="text-primary hover:underline"
          href={buildXntMovementHref({ productId: r.productId, productCode: r.code, branchId: activeBranchId ?? undefined, from: range.from, to: range.to })}
          title="Xem phát sinh kho của mặt hàng"
        >
          {r.code}
        </Link>
      ),
    },
    { label: "Tên hàng", key: "name", align: "left", width: "220px" },
    { label: "ĐVT", key: "unit", align: "center", width: "80px" },
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
      cell: (r) => formatValuation(r.openingValue),
    },
    // NHẬP × 6 — Đợt 2b (17/07): thêm "Nhập khác" (inOther: tồn đầu kỳ...) —
    // service tính từ A3 nhưng UI chưa từng render → màn Chi tiết rơi số.
    { label: "Nhập từ NCC", key: "inSupplier", align: "right", cell: (r) => formatNumber(r.inSupplier) },
    { label: "Kiểm kê (+)", key: "inCheck", align: "right", cell: (r) => formatNumber(r.inCheck) },
    { label: "Khách trả", key: "inReturn", align: "right", cell: (r) => formatNumber(r.inReturn) },
    { label: "Chuyển kho đến", key: "inTransfer", align: "right", cell: (r) => formatNumber(r.inTransfer) },
    { label: "Sản xuất nhập", key: "inProduction", align: "right", cell: (r) => formatNumber(r.inProduction) },
    { label: "Nhập khác", key: "inOther", align: "right", cell: (r) => formatNumber(r.inOther) },
    // XUẤT × 8, including internal issues already counted in totalOut.
    { label: "Bán hàng", key: "outSale", align: "right", cell: (r) => formatNumber(r.outSale) },
    { label: "Xuất huỷ", key: "outDisposal", align: "right", cell: (r) => formatNumber(r.outDisposal) },
    { label: "Trả NCC", key: "outSupplierReturn", align: "right", cell: (r) => formatNumber(r.outSupplierReturn) },
    { label: "Kiểm kê (−)", key: "outCheck", align: "right", cell: (r) => formatNumber(r.outCheck) },
    { label: "Chuyển kho đi", key: "outTransfer", align: "right", cell: (r) => formatNumber(r.outTransfer) },
    { label: "Sản xuất xuất", key: "outProduction", align: "right", cell: (r) => formatNumber(r.outProduction) },
    { label: "Xuất nội bộ", key: "outInternal", align: "right", cell: (r) => formatNumber(r.outInternal) },
    { label: "Xuất khác", key: "outOther", align: "right", cell: (r) => formatNumber(r.outOther) },
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
      cell: (r) => formatValuation(r.closingValue),
    },
  ];

  const detailColumnGroups: ColumnGroup[] = [
    { label: "", span: 5 },
    { label: "NHẬP", span: 6, variant: "input" },
    { label: "XUẤT", span: 8, variant: "output" },
    { label: "", span: 2 },
  ];

  const detailColumnsWithTotals = detailColumns.map((column) => {
    if (column.key in quantityTotals) {
      return { ...column, subtotalCell: formatQuantityTotal(quantityTotals[column.key as keyof typeof quantityTotals]) };
    }
    if (column.key === "openingValue" || column.key === "closingValue") {
      return { ...column, subtotalCell: formatValuation(visibleSubtotal[column.key]) };
    }
    return column;
  });

  const subtotalLabel = data
    ? `SL mặt hàng: ${visibleSubtotal.productCount}`
    : "—";
  const emptyState =
    rowFilter === "activity"
      ? "Không có tồn đầu, biến động hoặc tồn cuối trong kỳ này."
      : rowFilter === "closing-stock"
        ? "Không có mặt hàng có tồn cuối kỳ khác 0."
        : debouncedSearch
          ? "Không tìm thấy mặt hàng phù hợp."
          : "Chưa có dữ liệu trong kỳ này.";

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <ReportPageHeader
        title="Báo cáo Xuất - Nhập - Tồn"
        subtitle={
          subMode === "detail"
            ? "Chi tiết theo từng loại giao dịch nhập, xuất"
            : undefined
        }
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={handleExportView}
        onExportFull={handleExportFull}
        exportDisabled={loading || exporting || !data}
      />

      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground lg:px-6">
        <p>{HISTORICAL_VALUE_NOTE} Đơn giá BQ = thành tiền / số lượng; không cộng đơn giá. Bấm mã hàng để đối chiếu phát sinh.</p>
        {!loading && incompleteVisibleCount > 0 && (
          <p className="mt-1 font-medium text-status-warning" role="status">
            {incompleteVisibleCount} mặt hàng chưa đủ căn cứ định giá tồn; giá trị từng cột thiếu dữ liệu được để trống để tránh cộng sai.
          </p>
        )}
      </div>

      {/* Sub-mode toggle + Search */}
      <div className="bg-surface-container-lowest border-b border-border px-4 lg:px-6 py-2 flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-full p-0.5 bg-surface-container-low border border-border">
          {SUB_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => { setSubMode(m.key); setSortState(null); }}
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
            aria-label="Tìm mặt hàng"
            className="h-8 w-full rounded-md border border-border bg-surface-container-lowest pl-8 pr-8 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-container hover:text-foreground"
              aria-label="Xóa nội dung tìm kiếm"
              title="Xóa nội dung tìm kiếm"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div
          role="group"
          aria-label="Lọc mặt hàng theo tồn kho"
          className="inline-flex shrink-0 items-center rounded-md border border-border bg-surface-container-low p-0.5"
        >
          {([
            ["activity", "Có phát sinh"],
            ["closing-stock", "Tồn cuối khác 0"],
            ["all", "Tất cả"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={rowFilter === value}
              onClick={() => setRowFilter(value)}
              className={cn(
                "h-7 rounded px-2.5 text-xs font-medium transition-colors",
                rowFilter === value
                  ? "bg-primary text-primary-foreground ambient-shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select aria-label="Lọc nhóm hàng" value={categoryFilter === undefined ? "all" : `category:${categoryFilter}`} onChange={(event) => setCategoryFilter(event.target.value === "all" ? undefined : event.target.value.slice(9))} className="h-8 max-w-full rounded-md border border-border bg-surface-container-lowest px-2 text-xs">
          <option value="all">Tất cả nhóm hàng</option>
          {categories.map((category) => <option key={category} value={`category:${category}`}>{category || "Chưa phân nhóm"}</option>)}
        </select>
        <select aria-label="Lọc đơn vị tính" value={unitFilter === undefined ? "all" : `unit:${unitFilter}`} onChange={(event) => setUnitFilter(event.target.value === "all" ? undefined : event.target.value.slice(5))} className="h-8 max-w-full rounded-md border border-border bg-surface-container-lowest px-2 text-xs">
          <option value="all">Tất cả ĐVT</option>
          {units.map((unit) => <option key={unit} value={`unit:${unit}`}>{unit || "Chưa có ĐVT"}</option>)}
        </select>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {visibleRows.length}/{data?.rows.length ?? 0} mặt hàng
        </span>
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
          <div className="bg-surface-container-lowest rounded-lg ambient-shadow">
            {subMode === "summary" ? (
              <ReportDataTable
                columns={summaryColumns}
                columnGroups={XNT_SUMMARY_COLUMN_GROUPS}
                tablePreferenceKey="report.xuat-nhap-ton.summary"
                rows={visibleRows}
                sortState={sortState}
                onSortChange={setSortState}
                getRowKey={(r) => r.productId}
                subtotalLabel={subtotalLabel}
                defaultPageSize={50}
                pageSizeOptions={[25, 50, 100, 200]}
                emptyState={emptyState}
              />
            ) : (
              <ReportDataTable
                columns={detailColumnsWithTotals}
                tablePreferenceKey="report.xuat-nhap-ton.detail"
                columnGroups={detailColumnGroups}
                rows={visibleRows}
                sortState={sortState}
                onSortChange={setSortState}
                getRowKey={(r) => r.productId}
                subtotalLabel={subtotalLabel}
                defaultPageSize={50}
                pageSizeOptions={[25, 50, 100, 200]}
                emptyState={emptyState}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
