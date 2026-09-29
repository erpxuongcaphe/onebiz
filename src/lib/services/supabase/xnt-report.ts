/**
 * Báo cáo Xuất - Nhập - Tồn.
 *
 * Dữ liệu được tổng hợp ở Postgres để không giới hạn 1.000 dòng và để tái dựng
 * đúng tồn cuối và giá trị của kỳ lịch sử. Hàm chỉ đọc, không cập nhật tồn kho.
 */

import type { DateRange } from "@/lib/types/report";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";
import { getClient, handleError } from "./base";

export interface XntRow {
  productId: string;
  code: string;
  name: string;
  unit: string;
  categoryName: string | null;
  openingQty: number;
  openingValue: number | null;
  inSupplier: number;
  inCheck: number;
  inReturn: number;
  inTransfer: number;
  inProduction: number;
  outSale: number;
  outDisposal: number;
  outSupplierReturn: number;
  outCheck: number;
  outTransfer: number;
  outProduction: number;
  outInternal: number;
  inOther: number;
  outOther: number;
  totalIn: number;
  totalOut: number;
  inValue: number | null;
  outValue: number | null;
  closingQty: number;
  closingValue: number | null;
  valuedMovementCount: number;
  missingCostMovementCount: number;
  valuationComplete: boolean;
  byBranch?: XntBranchBreakdown[];
}

export interface XntBranchBreakdown {
  branchId: string;
  branchName: string;
  openingQty: number;
  openingValue: number | null;
  totalIn: number;
  totalOut: number;
  inValue: number | null;
  outValue: number | null;
  closingQty: number;
  closingValue: number | null;
}

export interface XntReportResult {
  rows: XntRow[];
  subtotal: {
    productCount: number;
    openingQty: number;
    openingValue: number | null;
    totalIn: number;
    inValue: number | null;
    totalOut: number;
    outValue: number | null;
    closingQty: number;
    closingValue: number | null;
    valuedProductCount: number;
    incompleteValuationCount: number;
  };
  range: DateRange;
}

interface XntOptions {
  range: DateRange;
  branchId?: string;
  search?: string;
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getXntReport(
  options: XntOptions,
): Promise<XntReportResult> {
  const rangeWindow = toCreatedAtRangeWindow(options.range);
  if (!rangeWindow) throw new Error("Khoảng thời gian báo cáo không hợp lệ.");

  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_xnt_report_v2", {
    p_date_from: rangeWindow.start,
    p_date_to: rangeWindow.end,
    p_branch_id: options.branchId ?? null,
    p_search: options.search?.trim() || null,
  });
  if (error) handleError(error, "getXntReport");
  if (!Array.isArray(data)) {
    throw new Error("Máy chủ không trả kết quả Xuất - Nhập - Tồn.");
  }

  const rows: XntRow[] = (data as Array<Record<string, unknown>>).map((raw) => {
    const inSupplier = number(raw.in_supplier);
    const inCheck = number(raw.in_check);
    const inReturn = number(raw.in_return);
    const inTransfer = number(raw.in_transfer);
    const inProduction = number(raw.in_production);
    const inOther = number(raw.in_other);
    const outSale = number(raw.out_sale);
    const outDisposal = number(raw.out_disposal);
    const outSupplierReturn = number(raw.out_supplier_return);
    const outCheck = number(raw.out_check);
    const outTransfer = number(raw.out_transfer);
    const outProduction = number(raw.out_production);
    const outInternal = number(raw.out_internal);
    const outOther = number(raw.out_other);
    const totalIn =
      inSupplier + inCheck + inReturn + inTransfer + inProduction + inOther;
    const totalOut =
      outSale + outDisposal + outSupplierReturn + outCheck + outTransfer
      + outProduction + outInternal + outOther;
    const openingQty = number(raw.opening_qty);
    const closingQty = number(raw.closing_qty);

    return {
      productId: String(raw.product_id ?? ""),
      code: String(raw.code ?? ""),
      name: String(raw.name ?? ""),
      unit: String(raw.unit ?? ""),
      categoryName: raw.category_name ? String(raw.category_name) : null,
      openingQty,
      openingValue: nullableNumber(raw.opening_value),
      inSupplier,
      inCheck,
      inReturn,
      inTransfer,
      inProduction,
      inOther,
      outSale,
      outDisposal,
      outSupplierReturn,
      outCheck,
      outTransfer,
      outProduction,
      outInternal,
      outOther,
      totalIn,
      totalOut,
      inValue: nullableNumber(raw.in_value),
      outValue: nullableNumber(raw.out_value),
      closingQty,
      closingValue: nullableNumber(raw.closing_value),
      valuedMovementCount: number(raw.valued_movement_count),
      missingCostMovementCount: number(raw.missing_cost_movement_count),
      valuationComplete: raw.valuation_complete === true,
    };
  });

  const subtotal = rows.reduce<XntReportResult["subtotal"]>(
    (sum, row) => ({
      productCount: sum.productCount + 1,
      openingQty: sum.openingQty + row.openingQty,
      openingValue:
        sum.openingValue === null || row.openingValue === null
          ? null
          : sum.openingValue + row.openingValue,
      totalIn: sum.totalIn + row.totalIn,
      inValue:
        sum.inValue === null || row.inValue === null
          ? null
          : sum.inValue + row.inValue,
      totalOut: sum.totalOut + row.totalOut,
      outValue:
        sum.outValue === null || row.outValue === null
          ? null
          : sum.outValue + row.outValue,
      closingQty: sum.closingQty + row.closingQty,
      closingValue:
        sum.closingValue === null || row.closingValue === null
          ? null
          : sum.closingValue + row.closingValue,
      valuedProductCount: sum.valuedProductCount + (row.valuationComplete ? 1 : 0),
      incompleteValuationCount:
        sum.incompleteValuationCount + (row.valuationComplete ? 0 : 1),
    }),
    {
      productCount: 0,
      openingQty: 0,
      openingValue: 0,
      totalIn: 0,
      inValue: 0,
      totalOut: 0,
      outValue: 0,
      closingQty: 0,
      closingValue: 0,
      valuedProductCount: 0,
      incompleteValuationCount: 0,
    },
  );

  return { rows, subtotal, range: options.range };
}
