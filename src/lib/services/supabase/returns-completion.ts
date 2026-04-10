/**
 * Returns Completion Service
 *
 * Complete a sales return — handle stock and cash side-effects.
 *
 * Called AFTER the return record + items are already inserted.
 *
 * 1. Increment stock for each returned item via applyManualStockMovement(type='in')
 * 2. Create auto cash payment (phiếu chi hoàn tiền) in cash_transactions
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
  customerName: string;
  items: ReturnItem[];
  refundAmount: number;
}

export async function completeReturn(input: CompleteReturnInput): Promise<void> {
  const ctx = await getCurrentContext();

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

  // 2. Auto cash payment (phiếu chi hoàn tiền)
  if (input.refundAmount > 0) {
    const supabase = getClient();

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
}
