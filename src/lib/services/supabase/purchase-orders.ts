/**
 * Supabase service: Purchase Orders (Đặt hàng / Nhập hàng)
 *
 * State machine — khớp DB enum (draft, ordered, partial, completed, cancelled).
 *
 * Stock effects:
 *   - draft/ordered/partial/cancelled → NO stock change (informational statuses)
 *   - ordered|partial → completed    → `receivePurchaseOrder` commits the full
 *     receipt: +stock for each line item, +branch_stock, stock_movements ledger,
 *     and a new `product_lots` row for FIFO tracking.
 *
 * Phase 3 fix (G6): the legacy `updatePurchaseOrderStatus` only flipped the
 * status column, so marking a PO completed never affected inventory. The
 * page now routes "completed" transitions through `receivePurchaseOrder`
 * which performs the atomic stock + lot write via `applyManualStockMovement`.
 */

import type {
  PurchaseOrder,
  PurchaseOrderStatus,
  QueryParams,
  QueryResult,
} from "@/lib/types";
import {
  getClient,
  getCurrentContext,
  getPaginationRange,
  handleError,
} from "./base";
import { applyManualStockMovement } from "./stock-adjustments";

/* ------------------------------------------------------------------ */
/*  State machine                                                      */
/* ------------------------------------------------------------------ */

const VALID_PURCHASE_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["partial", "completed", "cancelled"],
  partial: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionPurchaseStatus(from: string, to: string): boolean {
  const allowed = VALID_PURCHASE_TRANSITIONS[from as PurchaseOrderStatus];
  if (!allowed) return false;
  return allowed.includes(to as PurchaseOrderStatus);
}

export function getPurchaseOrderStatusMeta(): Record<
  PurchaseOrderStatus,
  { label: string; color: string }
> {
  return {
    draft: { label: "Phiếu tạm", color: "#94a3b8" },
    ordered: { label: "Đã đặt hàng", color: "#004AC6" },
    partial: { label: "Nhập một phần", color: "#f59e0b" },
    completed: { label: "Hoàn thành", color: "#10b981" },
    cancelled: { label: "Đã hủy", color: "#ef4444" },
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export async function getPurchaseOrders(
  params: QueryParams
): Promise<QueryResult<PurchaseOrder>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("purchase_orders")
    .select("*", { count: "exact" });

  if (params.search) {
    query = query.or(
      `code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`
    );
  }

  const statusFilter = params.filters?.status;
  if (Array.isArray(statusFilter) && statusFilter.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.in("status", statusFilter as any);
  } else if (typeof statusFilter === "string" && statusFilter !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", statusFilter as any);
  }

  if (params.filters?.supplier && params.filters.supplier !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("supplier_name", params.filters.supplier as any);
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getPurchaseOrders");

  const orders: PurchaseOrder[] = (data ?? []).map(mapPurchaseOrder);
  return { data: orders, total: count ?? 0 };
}

export function getPurchaseOrderStatuses() {
  const meta = getPurchaseOrderStatusMeta();
  return (Object.keys(meta) as PurchaseOrderStatus[]).map((value) => ({
    label: meta[value].label,
    value,
    count: 0,
  }));
}

/* ------------------------------------------------------------------ */
/*  Item loader (for detail panel + partial receive)                   */
/* ------------------------------------------------------------------ */

export interface PurchaseOrderItemRow {
  id: string;
  productId: string | null;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  remaining: number;
  unitPrice: number;
  lineTotal: number;
}

export async function getPurchaseOrderItems(
  orderId: string,
): Promise<PurchaseOrderItemRow[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("purchase_order_items")
    .select(
      "id, product_id, product_name, quantity, received_quantity, unit_price, unit, products(code)",
    )
    .eq("purchase_order_id", orderId)
    .order("id", { ascending: true });

  if (error) handleError(error, "getPurchaseOrderItems");

  return ((data ?? []) as unknown as Array<{
    id: string;
    product_id: string | null;
    product_name: string;
    quantity: number | string;
    received_quantity: number | string;
    unit_price: number | string;
    unit: string | null;
    products: { code: string } | null;
  }>).map((row) => {
    const qty = Number(row.quantity ?? 0);
    const received = Number(row.received_quantity ?? 0);
    const price = Number(row.unit_price ?? 0);
    return {
      id: row.id,
      productId: row.product_id,
      productCode: row.products?.code ?? "",
      productName: row.product_name ?? "",
      unit: row.unit ?? "cái",
      quantity: qty,
      receivedQuantity: received,
      remaining: Math.max(0, qty - received),
      unitPrice: price,
      lineTotal: qty * price,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Partial receive — nhập một phần với số lượng tuỳ chỉnh per-line     */
/* ------------------------------------------------------------------ */

export interface PartialReceiveLine {
  itemId: string;
  receiveQty: number; // 0 = skip, > remaining = clamped
}

/**
 * Nhập một phần: tạo stock movement + lot cho từng line với số lượng tuỳ chọn.
 * Sau khi xong, kiểm tra xem tất cả line đã received >= quantity chưa:
 *   - Nếu CHƯA đủ → status = "partial"
 *   - Nếu ĐỦ     → status = "completed"
 */
export async function receivePurchaseOrderPartial(
  orderId: string,
  lines: PartialReceiveLine[],
): Promise<{ newStatus: PurchaseOrderStatus; receivedLines: number }> {
  const supabase = getClient();
  if (!lines || lines.length === 0) {
    throw new Error("Không có dòng nào để nhập");
  }

  // Read current PO + items
  const [{ data: po, error: poErr }, { data: items, error: itemsErr }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, status, branch_id, supplier_id, code")
      .eq("id", orderId)
      .single(),
    supabase
      .from("purchase_order_items")
      .select("id, product_id, product_name, quantity, received_quantity, unit_price")
      .eq("purchase_order_id", orderId),
  ]);

  if (poErr) handleError(poErr, "receivePurchaseOrderPartial.po");
  if (itemsErr) handleError(itemsErr, "receivePurchaseOrderPartial.items");
  if (!po) throw new Error("Không tìm thấy đơn nhập hàng");
  if (!items || items.length === 0) throw new Error("Đơn không có sản phẩm");

  const status = po.status as PurchaseOrderStatus;
  if (status !== "ordered" && status !== "partial") {
    throw new Error(`Không thể nhập hàng ở trạng thái "${status}"`);
  }

  const ctx = await getCurrentContext();
  const lineMap = new Map(lines.map((l) => [l.itemId, l.receiveQty]));

  let receivedCount = 0;
  for (const it of items as Array<{
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    received_quantity: number | null;
    unit_price: number;
  }>) {
    const requestedQty = Number(lineMap.get(it.id) ?? 0);
    if (requestedQty <= 0) continue;

    const currentReceived = Number(it.received_quantity ?? 0);
    const fullQty = Number(it.quantity ?? 0);
    const remaining = Math.max(0, fullQty - currentReceived);
    const actualQty = Math.min(requestedQty, remaining);
    if (actualQty <= 0) continue;

    // Apply stock-in (dual-table sync products.stock + branch_stock + movements ledger)
    await applyManualStockMovement(
      [
        {
          productId: it.product_id,
          quantity: actualQty,
          type: "in",
          referenceType: "purchase_order",
          referenceId: orderId,
          note: `Nhập một phần từ đơn ${po.code}`,
        },
      ],
      {
        tenantId: ctx.tenantId,
        branchId: po.branch_id as string,
        createdBy: ctx.userId,
      },
    );

    // Update received_quantity
    const newReceived = currentReceived + actualQty;
    const { error: upErr } = await supabase
      .from("purchase_order_items")
      .update({ received_quantity: newReceived } as Record<string, unknown>)
      .eq("id", it.id);
    if (upErr) handleError(upErr, "receivePurchaseOrderPartial.updateItem");

    receivedCount++;
  }

  // Re-read all items to compute new status (handles lines we didn't touch this run)
  const { data: reread } = await supabase
    .from("purchase_order_items")
    .select("quantity, received_quantity")
    .eq("purchase_order_id", orderId);

  const allReceived = (reread ?? []).every(
    (r) => Number(r.received_quantity ?? 0) >= Number(r.quantity ?? 0),
  );
  const newStatus: PurchaseOrderStatus = allReceived ? "completed" : "partial";

  const { error: sErr } = await supabase
    .from("purchase_orders")
    .update({ status: newStatus } as Record<string, unknown>)
    .eq("id", orderId);
  if (sErr) handleError(sErr, "receivePurchaseOrderPartial.status");

  return { newStatus, receivedLines: receivedCount };
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export async function updatePurchaseOrderStatus(
  orderId: string,
  newStatus: PurchaseOrderStatus
): Promise<void> {
  // "completed" transitions are special: they commit real inventory, so we
  // route them through `receivePurchaseOrder` instead of a plain status flip.
  // This keeps all callers (Kanban drag, row action menu) safe by default.
  if (newStatus === "completed") {
    await receivePurchaseOrder(orderId);
    return;
  }

  const supabase = getClient();

  const { data: current, error: readErr } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (readErr) handleError(readErr, "updatePurchaseOrderStatus.read");
  if (!current) throw new Error("Không tìm thấy đơn nhập hàng");

  const fromStatus = current.status as PurchaseOrderStatus;
  if (!canTransitionPurchaseStatus(fromStatus, newStatus)) {
    throw new Error(
      `Không thể chuyển từ "${fromStatus}" sang "${newStatus}"`
    );
  }

  const { error: updateErr } = await supabase
    .from("purchase_orders")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: newStatus as any })
    .eq("id", orderId);

  if (updateErr) handleError(updateErr, "updatePurchaseOrderStatus.update");
}

/* ------------------------------------------------------------------ */
/*  Receive (G6 fix) — commits real inventory                          */
/* ------------------------------------------------------------------ */

/**
 * Mark a purchase order as fully received:
 *   1. Validate status (must be 'ordered' or 'partial')
 *   2. For each PO item:
 *      - Apply stock-in via `applyManualStockMovement` (updates
 *        products.stock + branch_stock + writes stock_movements)
 *      - Create a `product_lots` row for FIFO tracking (source='purchase')
 *      - Update `received_quantity = quantity` on the line item
 *   3. Flip `purchase_orders.status = 'completed'`
 *
 * NOT atomic (fetch-then-update loop). Acceptable for single-cashier
 * workflows; a future RPC will wrap this in a single transaction.
 *
 * Throws if the PO has no items, or if any item has `quantity <= 0`.
 */
export async function receivePurchaseOrder(orderId: string): Promise<void> {
  const supabase = getClient();

  // 1. ATOMIC status flip — claim this PO as "being received" by flipping
  //    status to 'completed' FIRST. If two concurrent calls race, only one
  //    will match the WHERE clause and succeed. The loser gets 0 rows updated
  //    and bails out, preventing double stock-in.
  const { data: claimed, error: claimErr } = await supabase
    .from("purchase_orders")
    .update({ status: "completed" as PurchaseOrderStatus } as Record<string, unknown>)
    .eq("id", orderId)
    .in("status", ["ordered", "partial"])
    .select("id, code, status, supplier_id")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "receivePurchaseOrder.claim");
  if (!claimed) {
    // Either not found, or already completed/cancelled by another call
    const { data: existing } = await supabase
      .from("purchase_orders")
      .select("status")
      .eq("id", orderId)
      .single();
    if (!existing) throw new Error("Không tìm thấy đơn nhập hàng");
    throw new Error(
      `Đơn nhập hàng đã được xử lý (trạng thái: ${existing.status}). Không thể nhập lại.`
    );
  }
  const po = claimed;

  // 2. Read PO items
  const { data: items, error: itemsErr } = await supabase
    .from("purchase_order_items")
    .select("id, product_id, product_name, quantity, received_quantity, unit_price")
    .eq("purchase_order_id", orderId);
  if (itemsErr) handleError(itemsErr, "receivePurchaseOrder.items");
  if (!items || items.length === 0) {
    throw new Error("Đơn nhập hàng không có sản phẩm nào để nhập");
  }

  // Compute remaining quantity per line (quantity - already-received)
  const pending = items
    .map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      remaining: Number(it.quantity ?? 0) - Number(it.received_quantity ?? 0),
      fullQty: Number(it.quantity ?? 0),
      unitPrice: Number(it.unit_price ?? 0),
    }))
    .filter((it) => it.remaining > 0);

  if (pending.length === 0) {
    // All items already received — status already flipped at step 1.
    return;
  }

  // 3. Apply stock-in via shared helper (writes products.stock + branch_stock + stock_movements)
  const ctx = await getCurrentContext();
  await applyManualStockMovement(
    pending.map((it) => ({
      productId: it.productId,
      quantity: it.remaining,
      type: "in" as const,
      referenceType: "purchase_order",
      referenceId: orderId,
      note: `${po.code} - Nhập hàng từ NCC - ${it.productName}`,
    })),
    {
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      createdBy: ctx.userId,
    }
  );

  // 4. Create product_lots (one lot per line item) for FIFO
  const today = new Date().toISOString().split("T")[0];
  const lotRows = pending.map((it, idx) => ({
    tenant_id: ctx.tenantId,
    product_id: it.productId,
    variant_id: null,
    lot_number: `${po.code}-${today.replace(/-/g, "")}-${String(idx + 1).padStart(2, "0")}`,
    source_type: "purchase" as const,
    purchase_order_id: orderId,
    supplier_id: po.supplier_id ?? null,
    received_date: today,
    initial_qty: it.remaining,
    current_qty: it.remaining,
    branch_id: ctx.branchId,
    status: "active" as const,
    note: `Nhập từ ${po.code}`,
  }));
  const { error: lotErr } = await supabase.from("product_lots").insert(lotRows);
  if (lotErr) handleError(lotErr, "receivePurchaseOrder.lots");

  // 5. Update received_quantity on line items
  for (const it of pending) {
    const { error: updErr } = await supabase
      .from("purchase_order_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ received_quantity: it.fullQty } as any)
      .eq("id", it.id);
    if (updErr) handleError(updErr, "receivePurchaseOrder.item_update");
  }

  // 6. Auto-create input invoice (hóa đơn đầu vào) — Sprint 6 "Cầu Nối"
  const totalPO = pending.reduce(
    (s, it) => s + it.remaining * it.unitPrice,
    0
  );
  if (totalPO > 0) {
    const { data: invCode, error: invCodeErr } = await supabase.rpc("next_code", {
      p_tenant_id: ctx.tenantId,
      p_entity_type: "input_invoice",
    });
    if (invCodeErr) handleError(invCodeErr, "receivePurchaseOrder.input_invoice_code");
    const inputInvoiceCode = invCode ?? `HDV${Date.now()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: iiErr } = await (supabase as any)
      .from("input_invoices")
      .insert({
        tenant_id: ctx.tenantId,
        branch_id: ctx.branchId,
        code: inputInvoiceCode,
        supplier_id: po.supplier_id ?? null,
        supplier_name: "", // will be filled by trigger or display logic
        total_amount: totalPO,
        tax_amount: 0,
        status: "unrecorded",
        purchase_order_id: orderId,
        note: `Tạo tự động khi nhập hàng ${po.code}`,
        created_by: ctx.userId,
      });
    if (iiErr) handleError(iiErr, "receivePurchaseOrder.input_invoice");
  }

  // 7. Status already flipped to 'completed' at step 1 (atomic claim).
  //    No further status update needed.
}

/* ------------------------------------------------------------------ */
/*  Mapper                                                             */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPurchaseOrder(row: any): PurchaseOrder {
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    supplierId: row.supplier_id,
    supplierCode: "",
    supplierName: row.supplier_name,
    amountOwed: Number(row.debt ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    status: (row.status ?? "draft") as PurchaseOrderStatus,
    createdBy: row.created_by ?? "",
  };
}
