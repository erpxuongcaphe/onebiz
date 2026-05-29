/**
 * Xuất-Nhập-Tồn Report Service.
 *
 * Format chuẩn KiotViet (CEO 06/05/2026 ảnh tham khảo):
 *
 * Tổng hợp (9 cột):
 *   Mã hàng | Tên hàng | Tồn đầu kỳ | GT đầu kỳ | SL Nhập | GT Nhập |
 *   SL Xuất | GT Xuất | Tồn cuối kỳ | GT cuối kỳ
 *
 * Chi tiết (13 cột breakdown):
 *   NHẬP: NCC / Kiểm(+) / Trả KH / Chuyển đến / SX nhập
 *   XUẤT: Bán / Hủy / Trả NCC / Kiểm(-) / Chuyển đi / SX xuất
 *
 * Mapping reference_type → bucket (best-effort):
 *   - in:  purchase_entry → ncc
 *          sales_return → return_in
 *          production → production_in
 *          transfer → transfer_in
 *          inventory_check → check_in (positive)
 *   - out: invoice → sale
 *          disposal → disposal
 *          supplier_return / purchase_return → ncc_return
 *          transfer → transfer_out
 *          inventory_check → check_out (negative)
 *          production → production_out
 *          internal_export / internal_sale → internal
 *
 * Tồn đầu kỳ = stock hiện tại - (nhập - xuất) trong kỳ.
 * Giá trị = SL × cost_price (FIFO/Average — tạm dùng cost_price snapshot).
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import type { DateRange } from "@/lib/types/report";

// ============================================================
// Types
// ============================================================

export interface XntRow {
  productId: string;
  code: string;
  name: string;
  unit: string;
  categoryName: string | null;

  // Tồn đầu kỳ
  openingQty: number;
  openingValue: number;

  // Nhập breakdown
  inSupplier: number; // Nhập NCC
  inCheck: number; // Kiểm (+)
  inReturn: number; // Trả KH (nhập)
  inTransfer: number; // Chuyển đến
  inProduction: number; // SX nhập

  // Xuất breakdown
  outSale: number; // Bán
  outDisposal: number; // Hủy
  outSupplierReturn: number; // Trả NCC
  outCheck: number; // Kiểm (-)
  outTransfer: number; // Chuyển đi
  outProduction: number; // SX xuất (nguyên liệu)
  outInternal: number; // Xuất nội bộ (gộp vào "Xuất khác")

  // Tổng hợp
  totalIn: number;
  totalOut: number;
  inValue: number;
  outValue: number;

  // Tồn cuối kỳ
  closingQty: number;
  closingValue: number;

  /** Sub-rows theo chi nhánh — chỉ có khi mode='by-branch' */
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
  /** Subtotal across all rows */
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
  /** Filter theo product code/name search */
  search?: string;
}

// ============================================================
// Mapping: reference_type → bucket
// ============================================================

type InBucket =
  | "supplier"
  | "check"
  | "return"
  | "transfer"
  | "production"
  | "other";
type OutBucket =
  | "sale"
  | "disposal"
  | "supplier_return"
  | "check"
  | "transfer"
  | "production"
  | "internal"
  | "other";

function mapInBucket(referenceType: string | null): InBucket {
  if (!referenceType) return "other";
  const rt = referenceType.toLowerCase();
  if (
    rt === "purchase_entry" ||
    rt === "purchase_order" ||
    rt === "goods_receipt" ||
    rt.startsWith("purchase_")
  )
    return "supplier";
  if (rt === "inventory_check" || rt === "stock_adjustment") return "check";
  // CEO 29/05/2026: hoàn kho do HỦY hóa đơn completed (movement bù type='in').
  // Gom vào "hàng trả lại" để tổng Nhập cân với Xuất gốc (net = 0), tránh
  // lệch tồn đầu kỳ. Xem RPC void_completed_invoice_atomic (migration 00117).
  if (rt === "sales_return" || rt === "invoice_void") return "return";
  if (rt === "transfer" || rt === "stock_transfer") return "transfer";
  if (rt === "production" || rt === "production_complete") return "production";
  return "other";
}

function mapOutBucket(referenceType: string | null): OutBucket {
  if (!referenceType) return "other";
  const rt = referenceType.toLowerCase();
  if (rt === "invoice" || rt === "sale" || rt === "pos_sale") return "sale";
  if (rt === "disposal" || rt === "disposal_export") return "disposal";
  if (rt === "supplier_return" || rt === "purchase_return")
    return "supplier_return";
  if (rt === "inventory_check" || rt === "stock_adjustment") return "check";
  if (rt === "transfer" || rt === "stock_transfer") return "transfer";
  if (rt === "production" || rt === "production_consume") return "production";
  if (rt === "internal_export" || rt === "internal_sale" || rt === "input_invoice")
    return "internal";
  return "other";
}

// ============================================================
// Main service
// ============================================================

/**
 * Get XNT report. Returns one row per product with full breakdown.
 *
 * Strategy:
 * - Fetch all stock_movements trong kỳ (filter by branch nếu có)
 * - Fetch all products active
 * - Aggregate movements client-side (vì split theo reference_type → khó SQL)
 * - Calculate openingQty = currentStock - (sumIn - sumOut)
 *
 * Performance: với 500 SP × 5000 movements/tháng → ~25k rows fetch + group.
 * Acceptable cho báo cáo (không phải hot path).
 */
export async function getXntReport(
  options: XntOptions,
): Promise<XntReportResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { range, branchId, search } = options;

  // Convert range to ISO timestamps with timezone HCM
  // from = "YYYY-MM-DD" → "YYYY-MM-DDT00:00:00+07:00"
  // to   = "YYYY-MM-DD" → "YYYY-MM-DDT23:59:59+07:00"
  const fromIso = `${range.from}T00:00:00+07:00`;
  const toIso = `${range.to}T23:59:59+07:00`;

  // 1. Fetch products (filter by search if provided)
  let productsQuery = supabase
    .from("products")
    .select("id, code, name, unit, stock, cost_price, category_id")
    .eq("tenant_id", tenantId)
    .order("name");

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    productsQuery = productsQuery.or(`code.ilike.${q},name.ilike.${q}`);
  }

  const { data: products, error: pErr } = await productsQuery;
  if (pErr) handleError(pErr, "getXntReport.products");

  // 2. Fetch product_categories for category names
  const categoryIds = Array.from(
    new Set(
      (products ?? []).map((p) => (p as { category_id?: string }).category_id).filter(Boolean),
    ),
  ) as string[];
  let categoryMap = new Map<string, string>();
  if (categoryIds.length > 0) {
    const { data: cats } = await supabase
      .from("categories")
      .select("id, name")
      .in("id", categoryIds);
    categoryMap = new Map(
      (cats ?? []).map((c) => [c.id as string, c.name as string]),
    );
  }

  // 3. Fetch stock_movements trong kỳ
  let movementsQuery = supabase
    .from("stock_movements")
    .select("product_id, type, quantity, reference_type, branch_id, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (branchId) movementsQuery = movementsQuery.eq("branch_id", branchId);

  const { data: movements, error: mErr } = await movementsQuery;
  if (mErr) handleError(mErr, "getXntReport.movements");

  // Branch report must use branch snapshot as closing stock. Using
  // products.stock here would mix company-wide closing stock with
  // branch-filtered movements, making opening/closing balances drift.
  const branchClosingStock = new Map<string, number>();
  if (branchId) {
    const { data: branchStock, error: bsErr } = await supabase
      .from("branch_stock")
      .select("product_id, quantity")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId);
    if (bsErr) handleError(bsErr, "getXntReport.branch_stock");
    for (const row of branchStock ?? []) {
      branchClosingStock.set(row.product_id, Number(row.quantity ?? 0));
    }
  }

  // 4. Aggregate movements per product
  const aggMap = new Map<
    string,
    {
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
    }
  >();

  for (const m of movements ?? []) {
    const pid = m.product_id;
    let agg = aggMap.get(pid);
    if (!agg) {
      agg = {
        inSupplier: 0,
        inCheck: 0,
        inReturn: 0,
        inTransfer: 0,
        inProduction: 0,
        outSale: 0,
        outDisposal: 0,
        outSupplierReturn: 0,
        outCheck: 0,
        outTransfer: 0,
        outProduction: 0,
        outInternal: 0,
      };
      aggMap.set(pid, agg);
    }
    const qty = Number(m.quantity ?? 0);
    if (m.type === "in") {
      const bucket = mapInBucket(m.reference_type);
      switch (bucket) {
        case "supplier":
          agg.inSupplier += qty;
          break;
        case "check":
          agg.inCheck += qty;
          break;
        case "return":
          agg.inReturn += qty;
          break;
        case "transfer":
          agg.inTransfer += qty;
          break;
        case "production":
          agg.inProduction += qty;
          break;
      }
    } else if (m.type === "out") {
      const bucket = mapOutBucket(m.reference_type);
      switch (bucket) {
        case "sale":
          agg.outSale += qty;
          break;
        case "disposal":
          agg.outDisposal += qty;
          break;
        case "supplier_return":
          agg.outSupplierReturn += qty;
          break;
        case "check":
          agg.outCheck += qty;
          break;
        case "transfer":
          agg.outTransfer += qty;
          break;
        case "production":
          agg.outProduction += qty;
          break;
        case "internal":
          agg.outInternal += qty;
          break;
      }
    } else if (m.type === "adjust") {
      // adjust without explicit direction — use reference_type to infer
      const inBucket = mapInBucket(m.reference_type);
      if (inBucket === "check") {
        // Cannot tell sign từ schema — heuristic: nếu reference_type='inventory_check'
        // thì gộp vào inCheck (best-effort, có thể tách 2 buckets sau)
        agg.inCheck += qty;
      }
    } else if (m.type === "transfer") {
      // transfer: cũng không có direction explicit — gộp vào in/out theo
      // best-effort. Skip cho MVP (sẽ refine khi có metadata branch_to/from)
      const inBucket = mapInBucket(m.reference_type);
      if (inBucket === "transfer") {
        agg.inTransfer += qty;
      }
    }
  }

  // 5. Build rows
  const rows: XntRow[] = [];
  const subtotal = {
    productCount: 0,
    openingQty: 0,
    openingValue: 0,
    totalIn: 0,
    inValue: 0,
    totalOut: 0,
    outValue: 0,
    closingQty: 0,
    closingValue: 0,
  };

  for (const p of products ?? []) {
    const agg = aggMap.get(p.id) ?? {
      inSupplier: 0,
      inCheck: 0,
      inReturn: 0,
      inTransfer: 0,
      inProduction: 0,
      outSale: 0,
      outDisposal: 0,
      outSupplierReturn: 0,
      outCheck: 0,
      outTransfer: 0,
      outProduction: 0,
      outInternal: 0,
    };
    const totalIn =
      agg.inSupplier +
      agg.inCheck +
      agg.inReturn +
      agg.inTransfer +
      agg.inProduction;
    const totalOut =
      agg.outSale +
      agg.outDisposal +
      agg.outSupplierReturn +
      agg.outCheck +
      agg.outTransfer +
      agg.outProduction +
      agg.outInternal;

    const closingQty = branchId
      ? branchClosingStock.get(p.id) ?? 0
      : Number(p.stock ?? 0);
    const openingQty = closingQty - (totalIn - totalOut);
    const cost = Number(p.cost_price ?? 0);

    const row: XntRow = {
      productId: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit ?? "",
      categoryName: (p as { category_id?: string }).category_id
        ? categoryMap.get((p as { category_id?: string }).category_id!) ?? null
        : null,
      openingQty,
      openingValue: openingQty * cost,
      inSupplier: agg.inSupplier,
      inCheck: agg.inCheck,
      inReturn: agg.inReturn,
      inTransfer: agg.inTransfer,
      inProduction: agg.inProduction,
      outSale: agg.outSale,
      outDisposal: agg.outDisposal,
      outSupplierReturn: agg.outSupplierReturn,
      outCheck: agg.outCheck,
      outTransfer: agg.outTransfer,
      outProduction: agg.outProduction,
      outInternal: agg.outInternal,
      totalIn,
      totalOut,
      inValue: totalIn * cost,
      outValue: totalOut * cost,
      closingQty,
      closingValue: closingQty * cost,
    };

    rows.push(row);

    subtotal.productCount += 1;
    subtotal.openingQty += row.openingQty;
    subtotal.openingValue += row.openingValue;
    subtotal.totalIn += row.totalIn;
    subtotal.inValue += row.inValue;
    subtotal.totalOut += row.totalOut;
    subtotal.outValue += row.outValue;
    subtotal.closingQty += row.closingQty;
    subtotal.closingValue += row.closingValue;
  }

  return { rows, subtotal, range };
}
