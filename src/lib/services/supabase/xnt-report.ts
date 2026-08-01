/**
 * Báo cáo Xuất - Nhập - Tồn.
 *
 * Dữ liệu được tổng hợp ở Postgres để không giới hạn 1.000 dòng và để tái dựng
 * đúng tồn cuối của kỳ lịch sử. Hàm chỉ đọc, không cập nhật tồn kho.
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
  openingValue: number;
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
  inValue: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
  byBranch?: XntBranchBreakdown[];
}

export interface XntBranchBreakdown {
  branchId: string;
  branchName: string;
  openingQty: number;
  openingValue: number;
  totalIn: number;
  totalOut: number;
  inValue: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
}

export interface XntReportResult {
  rows: XntRow[];
  subtotal: {
    productCount: number;
    openingQty: number;
    openingValue: number;
    totalIn: number;
    inValue: number;
    totalOut: number;
    outValue: number;
    closingQty: number;
    closingValue: number;
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

export async function getXntReport(
  options: XntOptions,
): Promise<XntReportResult> {
  const rangeWindow = toCreatedAtRangeWindow(options.range);
  if (!rangeWindow) throw new Error("Khoảng thời gian báo cáo không hợp lệ.");

  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_xnt_report", {
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
    const cost = number(raw.cost_price);
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
      openingValue: openingQty * cost,
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
      inValue: totalIn * cost,
      outValue: totalOut * cost,
      closingQty,
      closingValue: closingQty * cost,
    };
  });

  const subtotal = rows.reduce<XntReportResult["subtotal"]>(
    (sum, row) => ({
      productCount: sum.productCount + 1,
      openingQty: sum.openingQty + row.openingQty,
      openingValue: sum.openingValue + row.openingValue,
      totalIn: sum.totalIn + row.totalIn,
      inValue: sum.inValue + row.inValue,
      totalOut: sum.totalOut + row.totalOut,
      outValue: sum.outValue + row.outValue,
      closingQty: sum.closingQty + row.closingQty,
      closingValue: sum.closingValue + row.closingValue,
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
    },
  );

  return { rows, subtotal, range: options.range };
}
