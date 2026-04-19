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

interface ReturnItem {
  productId: string;
  productName: string;
  quantity: number;  // always positive
  unitPrice: number;
}

interface CompleteReturnInput {
  returnId: string;
  returnCode: string;
  invoiceCode: string;
  customerId?: string | null;
  customerName: string;
  items: ReturnItem[];
  /** Cashback amount paid back to customer. May be less than totalAmount. */
  refundAmount: number;
  /** Grand total being returned — items × unitPrice sum. Used to derive debt credit. */
  totalAmount?: number;
}

export async function completeReturn(input: CompleteReturnInput): Promise<void> {
  const ctx = await getCurrentContext();
  const supabase = getClient();

  // 1. Stock increment — type='in' adds stock back
  const stockInputs: ManualStockMovementInput[] = input.items.map(item => ({
    productId: item.productId,
    quantity: item.quantity,
    type: "in" as const,
    referenceType: "sales_return",
    referenceId: input.returnId,
    note: `${input.returnCode} - Trả hàng - ${item.productName} (+${item.quantity})`,
  }));

  await applyManualStockMovement(stockInputs, {
    tenantId: ctx.tenantId,
    branchId: ctx.branchId,
    createdBy: ctx.userId,
  });

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
      payment_method: "cash",
      reference_type: "sales_return",
      reference_id: input.returnId,
      note: `Hoàn tiền phiếu trả hàng ${input.returnCode} (HĐ gốc: ${input.invoiceCode})`,
      created_by: ctx.userId,
    };

    const { error } = await supabase.from("cash_transactions").insert(cashData);
    if (error) handleError(error, "completeReturn:cash_payment");
  }

  // 3. Partial-refund: credit the delta against customer debt
  const totalAmount = input.totalAmount ?? input.refundAmount;
  const debtCredit = totalAmount - input.refundAmount;
  if (debtCredit > 0 && input.customerId) {
    // Best-effort: read current debt, decrement by debtCredit (floor at 0).
    // Not wrapped in RPC — single-cashier workflow, race risk is negligible
    // for sales returns and this matches the existing invoices.paid pattern.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: cust, error: readErr } = await sb
      .from("customers")
      .select("debt")
      .eq("id", input.customerId)
      .single();
    if (!readErr && cust) {
      const currentDebt = Number(cust.debt ?? 0);
      const newDebt = Math.max(0, currentDebt - debtCredit);
      const { error: updateErr } = await sb
        .from("customers")
        .update({ debt: newDebt })
        .eq("id", input.customerId);
      if (updateErr) handleError(updateErr, "completeReturn:customer_debt_credit");
    }
  }
}
