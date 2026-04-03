/**
 * POS Checkout Service
 * Creates invoice + invoice_items + stock_movements atomically
 */

import { getClient, handleError } from "./base";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];
type StockMovementInsert = Database["public"]["Tables"]["stock_movements"]["Insert"];

export interface PosCheckoutInput {
  tenantId: string;
  branchId: string;
  createdBy: string;
  customerId?: string | null;
  customerName: string;
  items: {
    productId: string;
    productName: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
    discount: number;
  }[];
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  subtotal: number;
  discountAmount: number;
  total: number;
  paid: number;
  note?: string;
}

export interface PosCheckoutResult {
  invoiceId: string;
  invoiceCode: string;
}

export async function posCheckout(input: PosCheckoutInput): Promise<PosCheckoutResult> {
  const supabase = getClient();

  // 1. Generate invoice code via RPC
  const { data: code, error: codeError } = await supabase.rpc("next_code", {
    p_tenant_id: input.tenantId,
    p_entity_type: "invoice",
  });

  if (codeError) handleError(codeError, "posCheckout:next_code");
  const invoiceCode = code ?? `HD${Date.now()}`;

  // 2. Insert invoice
  const invoiceData = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    code: invoiceCode,
    customer_id: input.customerId ?? null,
    customer_name: input.customerName,
    status: "completed" as const,
    subtotal: input.subtotal,
    discount_amount: input.discountAmount,
    total: input.total,
    paid: input.paid,
    debt: Math.max(0, input.total - input.paid),
    payment_method: input.paymentMethod,
    note: input.note ?? null,
    created_by: input.createdBy,
  } satisfies InvoiceInsert;

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert(invoiceData)
    .select("id, code")
    .single();

  if (invoiceError) handleError(invoiceError, "posCheckout:invoice");
  if (!invoice) throw new Error("Không tạo được hóa đơn");

  // 3. Insert invoice items
  const itemsData: InvoiceItemInsert[] = input.items.map((item) => ({
    invoice_id: invoice.id,
    product_id: item.productId,
    product_name: item.productName,
    unit: item.unit ?? "Cái",
    quantity: item.quantity,
    unit_price: item.unitPrice,
    discount: item.discount,
    total: item.quantity * item.unitPrice - item.discount,
  }));

  const { error: itemsError } = await supabase
    .from("invoice_items")
    .insert(itemsData);

  if (itemsError) handleError(itemsError, "posCheckout:items");

  // 4. Insert stock movements (deduct stock)
  const stockMovements: StockMovementInsert[] = input.items.map((item) => ({
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    product_id: item.productId,
    type: "out" as const,
    quantity: -item.quantity,
    reference_type: "invoice",
    reference_id: invoice.id,
    note: `POS bán hàng - ${invoiceCode}`,
    created_by: input.createdBy,
  }));

  const { error: stockError } = await supabase
    .from("stock_movements")
    .insert(stockMovements);

  if (stockError) handleError(stockError, "posCheckout:stock");

  // 5. Update product stock (decrement) — manual update since no RPC
  for (const item of input.items) {
    const { data: product } = await supabase
      .from("products")
      .select("stock")
      .eq("id", item.productId)
      .single();
    if (product) {
      await supabase
        .from("products")
        .update({ stock: Math.max(0, (product.stock ?? 0) - item.quantity) } as never)
        .eq("id", item.productId);
    }
  }

  return {
    invoiceId: invoice.id,
    invoiceCode: invoice.code,
  };
}
