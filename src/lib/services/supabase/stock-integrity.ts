/**
 * Stock Integrity Service (CEO 13/05/2026).
 *
 * Wraps RPC `verify_stock_invariants` (migration 00073) để daily check
 * drift giữa 3 lớp lưu tồn:
 *   - products.stock (tổng công ty)
 *   - branch_stock.quantity (theo chi nhánh)
 *   - product_lots.current_qty (theo lô FIFO)
 *
 * Dùng cho:
 *   - Trang admin "Toàn vẹn kho" — owner check on-demand
 *   - Cron job ban đêm — alert nếu phát hiện drift
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

export interface StockInvariantViolation1 {
  productId: string;
  code: string;
  name: string;
  productStock: number;
  branchStockSum: number;
  drift: number;
}

export interface StockInvariantViolation23 {
  branchId: string;
  branchName: string;
  productId: string;
  productCode: string;
  productName: string;
  branchStockQty: number;
  movementSum?: number; // invariant 2
  lotSum?: number; // invariant 3
  drift: number;
}

export interface StockInvariantsResult {
  verifiedAt: string;
  tenantId: string;
  tolerance: number;
  allOk: boolean;
  invariant1: {
    description: string;
    violationsCount: number;
    violations: StockInvariantViolation1[];
  };
  invariant2: {
    description: string;
    violationsCount: number;
    violations: StockInvariantViolation23[];
  };
  invariant3: {
    description: string;
    violationsCount: number;
    violations: StockInvariantViolation23[];
  };
}

/**
 * Verify 3 invariant kho — trả về list product/branch nào drift.
 *
 * @param tolerance — sai lệch cho phép (rounding noise). Default 0.01.
 * @returns Object chứa violations từng invariant + tổng kết.
 */
export async function verifyStockInvariants(
  tolerance: number = 0.01,
): Promise<StockInvariantsResult> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("verify_stock_invariants", {
    p_tenant_id: null, // dùng tenant của user đang login
    p_tolerance: tolerance,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC verify_stock_invariants. Vui lòng chạy migration 00073 trước.",
      );
    }
    handleError(error, "verifyStockInvariants");
  }

  if (!data) {
    throw new Error("Server không trả kết quả verify hợp lệ.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    verifiedAt: raw.verified_at,
    tenantId: raw.tenant_id,
    tolerance: Number(raw.tolerance ?? 0.01),
    allOk: Boolean(raw.all_ok),
    invariant1: {
      description: raw.invariant_1?.description ?? "",
      violationsCount: Number(raw.invariant_1?.violations_count ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      violations: (raw.invariant_1?.violations ?? []).map((v: any) => ({
        productId: v.product_id,
        code: v.code,
        name: v.name,
        productStock: Number(v.product_stock ?? 0),
        branchStockSum: Number(v.branch_stock_sum ?? 0),
        drift: Number(v.drift ?? 0),
      })),
    },
    invariant2: {
      description: raw.invariant_2?.description ?? "",
      violationsCount: Number(raw.invariant_2?.violations_count ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      violations: (raw.invariant_2?.violations ?? []).map((v: any) => ({
        branchId: v.branch_id,
        branchName: v.branch_name,
        productId: v.product_id,
        productCode: v.product_code,
        productName: v.product_name,
        branchStockQty: Number(v.branch_stock_qty ?? 0),
        movementSum: Number(v.stock_movements_net ?? 0),
        drift: Number(v.drift ?? 0),
      })),
    },
    invariant3: {
      description: raw.invariant_3?.description ?? "",
      violationsCount: Number(raw.invariant_3?.violations_count ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      violations: (raw.invariant_3?.violations ?? []).map((v: any) => ({
        branchId: v.branch_id,
        branchName: v.branch_name,
        productId: v.product_id,
        productCode: v.product_code,
        productName: v.product_name,
        branchStockQty: Number(v.branch_stock_qty ?? 0),
        lotSum: Number(v.product_lots_sum ?? 0),
        drift: Number(v.drift ?? 0),
      })),
    },
  };
}
