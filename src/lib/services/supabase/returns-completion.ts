/**
 * Returns Completion Service
 *
 * Complete a sales return — handle stock and cash side-effects.
 *
 * Called AFTER the return record + items are already inserted.
 *
 * 1. Increment stock for each returned item via applyManualStockMovement(type='in')
 * 2. Create auto cash payment (phiếu chi hoàn tiền) in cash_transactions
 *    — only for the cash refund portion
 * 3. If partial refund (refundAmount < totalAmount), the remainder becomes a
 *    debt credit — reduces customer.debt by the offset amount
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { applyManualStockMovement, nextEntityCode } from "./stock-adjustments";
import type { ManualStockMovementInput } from "./stock-adjustments";
import type { Database } from "@/lib/supabase/types";

type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];
type RefundPaymentMethod = "cash" | "transfer" | "card";

interface ReturnItem {
  productId: string;
  productName: string;
  quantity: number;  // always positive
  unitPrice: number;
  /** BATCH 3R: id của invoice_items gốc → update returned_qty chính xác per line. */
  invoiceItemId?: string;
}

interface CompleteReturnInput {
  returnId: string;
  returnCode: string;
  invoiceCode: string;
  /** BATCH 3R: id HĐ gốc → fallback update returned_qty theo invoice+product nếu thiếu invoiceItemId. */
  invoiceId?: string;
  customerId?: string | null;
  customerName: string;
  items: ReturnItem[];
  /** Cashback amount paid back to customer. May be less than totalAmount. */
  refundAmount: number;
  refundPaymentMethod?: RefundPaymentMethod;
  /** Grand total being returned — items × unitPrice sum. Used to derive debt credit. */
  totalAmount?: number;
  /**
   * P1-3A 12/06/2026 — shift_id để close_shift_atomic match được phiếu chi refund.
   * Trước đây null → expected_cash của ca KHÔNG trừ refund → cashier báo "thừa tiền"
   * (cùng pattern P0 kết-ca-0đ ở orders.ts).
   */
  shiftId?: string | null;
}

export async function completeReturn(input: CompleteReturnInput): Promise<void> {
  const ctx = await getCurrentContext();
  const supabase = getClient();

  // ── 1. Stock revert — BATCH 3R 13/06/2026: BOM-AWARE.
  //   Trước đây cộng tồn type='in' cho MỌI SKU → sai cho SKU has_bom (cộng tồn
  //   ảo + không hồi NVL). Nay phân nhánh:
  //     - SKU has_bom → restore_bom_for_return (hồi NVL theo BOM, KHÔNG cộng
  //       tồn ảo SKU). Nếu has_bom nhưng chưa setup BOM tại branch
  //       (bom_found=false) → fallback cộng tồn SKU để không mất hàng.
  //     - SKU thường → cộng tồn SKU như cũ (đúng — hàng lên kệ lại).
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const hasBomMap = new Map<string, boolean>();
  if (productIds.length > 0) {
    const { data: prodRows, error: prodErr } = await supabase
      .from("products")
      .select("id, has_bom")
      .eq("tenant_id", ctx.tenantId)
      .in("id", productIds);
    if (prodErr) handleError(prodErr, "completeReturn:has_bom");
    for (const p of prodRows ?? []) {
      hasBomMap.set(p.id as string, Boolean((p as { has_bom?: boolean }).has_bom));
    }
  }

  const normalStockInputs: ManualStockMovementInput[] = [];
  for (const item of input.items) {
    if (hasBomMap.get(item.productId)) {
      // SKU has_bom → hồi NVL theo BOM (mirror consume dấu dương).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: restoreData, error: restoreErr } = await (supabase.rpc as any)(
        "restore_bom_for_return",
        {
          p_tenant_id: ctx.tenantId,
          p_branch_id: ctx.branchId,
          p_sku_id: item.productId,
          p_qty: item.quantity,
          p_reference_id: input.returnId,
          p_created_by: ctx.userId,
          p_ref_code: input.returnCode,
        },
      );
      if (restoreErr) handleError(restoreErr, "completeReturn:restore_bom");
      const bomFound = (restoreData as { bom_found?: boolean } | null)?.bom_found;
      if (bomFound === false) {
        // has_bom nhưng chưa setup BOM tại branch → fallback cộng tồn SKU
        // (giữ hàng, không mất). Hiếm gặp.
        normalStockInputs.push({
          productId: item.productId,
          quantity: item.quantity,
          type: "in" as const,
          referenceType: "sales_return",
          referenceId: input.returnId,
          note: `${input.returnCode} - Trả hàng (SKU has_bom chưa setup BOM) - ${item.productName} (+${item.quantity})`,
        });
      }
    } else {
      // SKU thường → cộng tồn SKU như cũ.
      normalStockInputs.push({
        productId: item.productId,
        quantity: item.quantity,
        type: "in" as const,
        referenceType: "sales_return",
        referenceId: input.returnId,
        note: `${input.returnCode} - Trả hàng - ${item.productName} (+${item.quantity})`,
      });
    }
  }

  if (normalStockInputs.length > 0) {
    await applyManualStockMovement(normalStockInputs, {
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      createdBy: ctx.userId,
    });
  }

  // ── 1b. Update invoice_items.returned_qty (over-refund guard + badge).
  //   Best-effort: lỗi KHÔNG block (kho + tiền đã xử lý xong). Nếu RPC chưa
  //   apply migration 00144 → log warn, returned_qty không cộng (UI vẫn clamp
  //   theo lần sau khi migration có).
  for (const item of input.items) {
    if (!item.invoiceItemId) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: incErr } = await (supabase.rpc as any)("increment_returned_qty", {
      p_invoice_item_id: item.invoiceItemId,
      p_delta: item.quantity,
    });
    if (incErr) {
      console.warn(
        `[completeReturn] increment_returned_qty failed (item ${item.invoiceItemId}):`,
        incErr.message,
      );
    }
  }

  // 2. Cash payment (phiếu chi hoàn tiền) — only for the cashback portion
  if (input.refundAmount > 0) {
    // Generate cash payment code via next_code RPC
    const cashCode = await nextEntityCode("cash_payment", { tenantId: ctx.tenantId });

    const cashData: CashTransactionInsert = {
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      code: cashCode,
      type: "payment",
      category: "Trả hàng",
      amount: input.refundAmount,
      counterparty: input.customerName,
      payment_method: input.refundPaymentMethod ?? "cash",
      reference_type: "sales_return",
      reference_id: input.returnId,
      note: `Hoàn tiền phiếu trả hàng ${input.returnCode} (HĐ gốc: ${input.invoiceCode})`,
      created_by: ctx.userId,
      // P1-3A: link shift_id để close_shift_atomic match refund.
      ...(input.shiftId ? { shift_id: input.shiftId } : {}),
    } as CashTransactionInsert;

    const { error } = await supabase.from("cash_transactions").insert(cashData);
    if (error) handleError(error, "completeReturn:cash_payment");
  }

  // 3. Partial-refund: credit the delta against customer debt
  //    CEO 06/06/2026 Plan A research: KHÔNG còn write customers.debt
  //    trực tiếp ở đây nữa. Trigger 00130 fire khi invoices.debt update
  //    sẽ recompute customers.debt = SUM(invoices.debt). Code cũ chạy
  //    đua với trigger → bug Xưởng Premium BL 280k sai.
  //
  //    Nếu CEO refund < totalAmount → debtCredit > 0 nghĩa là KH đã trả
  //    1 phần rồi và phiếu trả hàng giảm nợ. Khoản giảm này sẽ được
  //    sales_returns flow update lên invoices.paid hoặc invoices.debt
  //    (đường khác), trigger 00130 sẽ pick up.
  //
  //    Single Source of Truth = invoices.debt → trigger. Cấm app-side
  //    write customers.debt từ đây trở đi.
}
