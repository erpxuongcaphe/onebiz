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
  //   A2 08/07/2026 (Cách B): thêm inventory_role để tách MÓN MENU F&B ra khỏi
  //   nhánh Retail 2-mã. Phân nhánh theo vai trò:
  //     - MÓN MENU F&B (inventory_role='fnb_menu_item'): KHÔNG BAO GIỜ giữ tồn.
  //       Trả hàng → chỉ hồi THÀNH PHẦN theo công thức qua restore_bom_for_return.
  //       Nếu bom_found=false (chưa gắn công thức) → TUYỆT ĐỐI KHÔNG cộng tồn SKU
  //       (mã món không có kho — cộng vào là tồn ảo). Chỉ bỏ qua + log cảnh báo.
  //       Đây là điểm khác biệt mấu chốt với nhánh Retail has_bom bên dưới.
  //     - SKU Retail 2-mã (has_bom nhưng KHÔNG phải menu F&B):
  //       restore_bom_for_return (hồi NVL theo BOM, KHÔNG cộng tồn ảo SKU). Nếu
  //       has_bom nhưng chưa setup BOM tại branch (bom_found=false) → fallback
  //       cộng tồn SKU để không mất hàng (ĐÚNG cho Retail — SKU này có giữ tồn).
  //     - SKU thường (Retail không BOM) → cộng tồn SKU như cũ (hàng lên kệ lại).
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const hasBomMap = new Map<string, boolean>();
  const roleMap = new Map<string, string | null>();
  if (productIds.length > 0) {
    const { data: prodRows, error: prodErr } = await supabase
      .from("products")
      .select("id, has_bom, inventory_role")
      .eq("tenant_id", ctx.tenantId)
      .in("id", productIds);
    if (prodErr) handleError(prodErr, "completeReturn:has_bom");
    for (const p of prodRows ?? []) {
      hasBomMap.set(p.id as string, Boolean((p as { has_bom?: boolean }).has_bom));
      roleMap.set(
        p.id as string,
        ((p as { inventory_role?: string | null }).inventory_role) ?? null,
      );
    }
  }

  const normalStockInputs: ManualStockMovementInput[] = [];
  for (const item of input.items) {
    const isFnbMenu = roleMap.get(item.productId) === "fnb_menu_item";
    if (isFnbMenu) {
      // MÓN MENU F&B → chỉ hồi thành phần theo công thức, KHÔNG giữ tồn mã món.
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
        // Cách B: mã món menu KHÔNG có tồn → KHÔNG fallback cộng tồn SKU (tránh
        // tồn ảo). Chỉ cảnh báo — thành phần sẽ được đối soát khi món gắn công thức.
        console.warn(
          `[completeReturn] Món menu F&B chưa có công thức (bom_found=false) → ` +
            `bỏ qua hồi kho, KHÔNG cộng tồn ảo: ${item.productName} (${item.productId})`,
        );
      }
    } else if (hasBomMap.get(item.productId)) {
      // SKU Retail 2-mã (has_bom, không phải menu) → hồi NVL theo BOM (mirror consume).
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
        // (giữ hàng, không mất). Đúng cho Retail vì SKU này CÓ giữ tồn. Hiếm gặp.
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

  // ── 3. Phần KHÔNG hoàn tiền mặt → cấn vào công nợ hoá đơn gốc.
  //
  //    Nguyên tắc giữ nguyên từ 06/06: KHÔNG đụng customers.debt ở đây.
  //    Nguồn sự thật là invoices.debt, trigger 00130 tự tính lại tổng nợ
  //    khách = SUM(invoices.debt). Ghi tay hai nơi sẽ chạy đua với trigger
  //    (đã từng làm sai 280k của Xưởng Premium BL).
  //
  //    NHƯNG 28/07 rà lại thì phần "đường khác sẽ cập nhật invoices.debt"
  //    mà ghi chú cũ nhắc tới THỰC RA KHÔNG TỒN TẠI — không chỗ nào trong
  //    luồng trả hàng đụng tới hoá đơn gốc. Hệ quả: thu ngân chọn "cấn trừ
  //    công nợ" thì hàng về kho, phiếu trả ghi nhận, mà nợ khách y nguyên.
  //    Giờ giảm nợ ngay tại đây — vẫn chỉ ghi invoices.debt, để trigger lo
  //    phần khách.
  const debtCredit = Math.max(
    0,
    (input.totalAmount ?? 0) - (input.refundAmount ?? 0),
  );
  if (debtCredit > 0 && input.invoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("debt, paid, total")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", input.invoiceId)
      .maybeSingle();

    if (inv) {
      const currentDebt = Number(inv.debt ?? 0);
      // Chỉ cấn được tối đa phần đang còn nợ. Khách đã trả đủ (nợ 0) mà chọn
      // cấn nợ là thao tác sai — không tự ý biến thành nợ âm.
      const applied = Math.min(debtCredit, currentDebt);
      if (applied > 0) {
        const { error } = await supabase
          .from("invoices")
          .update({ debt: currentDebt - applied })
          .eq("tenant_id", ctx.tenantId)
          .eq("id", input.invoiceId);
        if (error) handleError(error, "completeReturn:debt_credit");
      }
    }
  }
}
