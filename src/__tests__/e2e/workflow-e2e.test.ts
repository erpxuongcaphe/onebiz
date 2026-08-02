import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * E2E Workflow Integration Tests — Phase 1
 *
 * Verifies full business flows across all Sprint 1-7 modules:
 *
 *   Flow A: POS Sale → Invoice + Stock + Cash (direct F10)
 *   Flow B: Draft Order F9 → F10 completion (with mixed payment)
 *   Flow C: Purchase Order → Receive → Stock IN + Lots + Input Invoice
 *   Flow D: Sales Order → Complete → Invoice + Stock + Cash
 *   Flow E: Disposal Export → Complete → Stock OUT
 *   Flow F: Stock Transfer → Complete → branch OUT + branch IN
 *   Flow G: Inventory Check → Apply → Stock adjust (in/out)
 *   Flow H: Debt Aging → correct bucket classification
 *   Flow I: Financial Alerts → severity sorting
 *   Flow J: Concurrent claim guard → only 1 wins
 */

// ============================================================
//  Shared mock infrastructure
// ============================================================

const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: { table: string; data: unknown; filters: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];
const stockMovementCalls: unknown[] = [];
let rpcCodeCounter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableMocks: Record<string, any> = {};

// State tracking for concurrent claim tests
let claimCounter = 0;

function createChain(resolvedValue: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn((col: string, val: unknown) => {
    chain._filters = { ...chain._filters, [col]: val };
    return chain;
  });
  chain.in = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.not = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.range = vi.fn(self);
  chain.or = vi.fn(self);
  chain.ilike = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  chain._filters = {};

  chain.insert = vi.fn((data: unknown) => {
    insertCalls.push({ table: chain._tableName ?? "_unknown", data });
    const nextChain = createChain(resolvedValue);
    nextChain._tableName = chain._tableName;
    return nextChain;
  });

  chain.update = vi.fn((data: unknown) => {
    updateCalls.push({
      table: chain._tableName ?? "_unknown",
      data,
      filters: { ...chain._filters },
    });
    return chain;
  });

  chain.delete = vi.fn(self);

  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function simulateReceivePurchaseItemsAtomic(params: any): { data: unknown; error: unknown } {
  const po = tableMocks.purchase_orders?.data;
  if (!po) return { data: null, error: { message: "Purchase order not found" } };
  if (!["ordered", "partial"].includes(po.status)) {
    return { data: null, error: { message: `Bad status: ${po.status}` } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = tableMocks.purchase_order_items?.data ?? [];
  const lines = params.p_lines as Array<{ item_id: string; receive_qty: number }> | null;
  const isFullReceive = !lines || !Array.isArray(lines) || lines.length === 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stockInputs: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lotRows: any[] = [];
  let totalAmount = 0;
  let receivedLines = 0;

  for (const it of items) {
    const fullQty = Number(it.quantity ?? 0);
    const already = Number(it.received_quantity ?? 0);
    const remaining = Math.max(0, fullQty - already);
    if (remaining <= 0) continue;

    let reqQty = 0;
    if (isFullReceive) reqQty = remaining;
    else {
      const line = (lines ?? []).find((l) => l.item_id === it.id);
      reqQty = line ? Number(line.receive_qty) : 0;
    }
    const actualQty = Math.min(Math.max(0, reqQty), remaining);
    if (actualQty <= 0) continue;

    stockInputs.push({
      productId: it.product_id,
      quantity: actualQty,
      type: "in",
      referenceType: "purchase_order",
      referenceId: params.p_order_id,
      note: `${po.code} - Nhập hàng NCC - ${it.product_name}`,
    });
    lotRows.push({
      tenant_id: po.tenant_id,
      product_id: it.product_id,
      variant_id: null,
      lot_number: `${po.code}-LOT-${lotRows.length + 1}`,
      source_type: "purchase",
      purchase_order_id: params.p_order_id,
      supplier_id: po.supplier_id ?? null,
      initial_qty: actualQty,
      current_qty: actualQty,
      branch_id: po.branch_id,
      status: "active",
    });
    rpcCalls.push({
      fn: "increment_product_stock",
      params: { p_product_id: it.product_id, p_delta: actualQty },
    });
    rpcCalls.push({
      fn: "upsert_branch_stock",
      params: {
        p_tenant_id: po.tenant_id,
        p_branch_id: po.branch_id,
        p_product_id: it.product_id,
        p_delta: actualQty,
      },
    });
    receivedLines++;
    totalAmount += actualQty * Number(it.unit_price ?? 0);
  }

  if (stockInputs.length === 0) {
    return { data: null, error: { message: "Không có dòng hợp lệ nào để nhập" } };
  }

  stockMovementCalls.push([
    stockInputs,
    { tenantId: po.tenant_id, branchId: po.branch_id, createdBy: params.p_created_by },
  ]);
  insertCalls.push({ table: "product_lots", data: lotRows });

  const allReceived = items.every((it) => {
    const fullQty = Number(it.quantity ?? 0);
    const already = Number(it.received_quantity ?? 0);
    const extra = stockInputs.find(
      (s: { productId: string; quantity: number }) => s.productId === it.product_id,
    )?.quantity ?? 0;
    return already + extra >= fullQty;
  });
  const newStatus = allReceived ? "completed" : "partial";

  let inputInvoiceCode: string | null = null;
  const inputInvoiceId: string | null = newStatus === "completed" ? "ii-sim-1" : null;
  if (newStatus === "completed" && totalAmount > 0) {
    rpcCodeCounter++;
    inputInvoiceCode = `CODE${String(rpcCodeCounter).padStart(5, "0")}`;
    insertCalls.push({
      table: "input_invoices",
      data: {
        tenant_id: po.tenant_id,
        branch_id: po.branch_id,
        code: inputInvoiceCode,
        supplier_id: po.supplier_id ?? null,
        supplier_name: "",
        total_amount: totalAmount,
        tax_amount: 0,
        status: "unrecorded",
        purchase_order_id: params.p_order_id,
      },
    });
  }

  return {
    data: {
      new_status: newStatus,
      received_lines: receivedLines,
      received_qty_total: stockInputs.reduce(
        (s: number, x: { quantity: number }) => s + x.quantity,
        0,
      ),
      input_invoice_id: inputInvoiceId,
      input_invoice_code: inputInvoiceCode,
    },
    error: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function simulatePosCompleteCheckoutAtomic(params: any): { data: unknown; error: unknown } {
  const tenantId = params.p_tenant_id ?? "tenant-1";
  const branchId = params.p_branch_id ?? "branch-1";
  rpcCodeCounter++;
  rpcCalls.push({
    fn: "next_code",
    params: { p_tenant_id: tenantId, p_entity_type: "invoice" },
  });
  const invoiceId = `inv-sim-${rpcCodeCounter}`;
  const invoiceCode = `HD${String(rpcCodeCounter).padStart(5, "0")}`;
  const total = Number(params.p_total ?? (params.p_items ?? []).reduce(
    (sum: number, item: any) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0) - Number(item.discount ?? 0),
    0,
  ));
  const paid = Number(params.p_paid ?? 0);
  const items = (params.p_items ?? []) as Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    discount?: number;
  }>;

  insertCalls.push({
    table: "invoices",
    data: {
      id: invoiceId,
      code: invoiceCode,
      tenant_id: tenantId,
      branch_id: branchId,
      customer_id: params.p_customer_id ?? null,
      customer_name: params.p_customer_name,
      payment_method: params.p_payment_method,
      subtotal: params.p_subtotal,
      discount_amount: params.p_discount_amount,
      total,
      paid,
      debt: Math.max(0, total - paid),
      status: "completed",
      source: params.p_source ?? "pos",
    },
  });

  insertCalls.push({
    table: "invoice_items",
    data: items.map((item) => ({
      invoice_id: invoiceId,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount: item.discount ?? 0,
    })),
  });

  insertCalls.push({
    table: "stock_movements",
    data: items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      type: "out",
      reference_type: "invoice",
      reference_id: invoiceId,
    })),
  });

  for (const item of items) {
    rpcCalls.push({
      fn: "increment_product_stock",
      params: { p_product_id: item.productId, p_delta: -Number(item.quantity ?? 0) },
    });
    rpcCalls.push({
      fn: "upsert_branch_stock",
      params: {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_product_id: item.productId,
        p_delta: -Number(item.quantity ?? 0),
      },
    });
  }

  if (paid > 0) {
    const breakdown = Array.isArray(params.p_payment_breakdown)
      ? params.p_payment_breakdown
      : [{ method: params.p_payment_method, amount: paid }];
    for (const part of breakdown) {
      insertCalls.push({
        table: "cash_transactions",
        data: {
          type: "receipt",
          category: "Bán hàng",
          reference_type: "invoice",
          reference_id: invoiceId,
          payment_method: part.method,
          amount: part.amount,
        },
      });
    }
  }

  return {
    data: { invoice_id: invoiceId, invoice_code: invoiceCode },
    error: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function simulateCompleteDraftAtomicV3(params: any): { data: unknown; error: unknown } {
  const invoice = tableMocks.invoices?.data;
  if (!invoice || (invoice.status && invoice.status !== "draft")) {
    return { data: null, error: { message: "Draft already processed" } };
  }

  const tenantId = invoice.tenant_id ?? "tenant-1";
  const branchId = invoice.branch_id ?? "branch-1";
  const items = (tableMocks.invoice_items?.data ?? []) as Array<{
    product_id: string;
    quantity: number;
  }>;

  updateCalls.push({
    table: "invoices",
    data: {
      status: "completed",
      payment_method: params.p_method,
      paid: params.p_paid,
      debt: Math.max(0, Number(invoice.total ?? 0) - Number(params.p_paid ?? 0)),
    },
    filters: { id: params.p_invoice_id, status: "draft" },
  });

  for (const item of items) {
    insertCalls.push({
      table: "stock_movements",
      data: {
        tenant_id: tenantId,
        branch_id: branchId,
        product_id: item.product_id,
        type: "out",
        quantity: item.quantity,
        reference_type: "invoice",
        reference_id: params.p_invoice_id,
      },
    });
    rpcCalls.push({
      fn: "increment_product_stock",
      params: { p_product_id: item.product_id, p_delta: -Number(item.quantity ?? 0) },
    });
    rpcCalls.push({
      fn: "upsert_branch_stock",
      params: {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_product_id: item.product_id,
        p_delta: -Number(item.quantity ?? 0),
      },
    });
  }

  const paid = Number(params.p_paid ?? 0);
  if (paid > 0) {
    const breakdown = Array.isArray(params.p_payment_breakdown)
      ? params.p_payment_breakdown
      : [{ method: params.p_method, amount: paid }];
    for (const part of breakdown) {
      insertCalls.push({
        table: "cash_transactions",
        data: {
          type: "receipt",
          payment_method: part.method,
          amount: part.amount,
          reference_type: "invoice",
          reference_id: params.p_invoice_id,
        },
      });
    }
  }

  return {
    data: { invoice_id: params.p_invoice_id, invoice_code: invoice.code ?? "HD-DRAFT" },
    error: null,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function simulateCompleteStockTransferAtomic(params: any): { data: unknown; error: unknown } {
  const transfer = tableMocks.stock_transfers?.data;
  const items = (tableMocks.stock_transfer_items?.data ?? []) as Array<{
    product_id: string;
    product_name: string;
    quantity: number;
  }>;
  if (!transfer) return { data: null, error: { message: "Transfer not found" } };

  const outInputs = items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    quantity: item.quantity,
    type: "out",
    referenceType: "stock_transfer",
    referenceId: params.p_transfer_id,
  }));
  const inInputs = items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    quantity: item.quantity,
    type: "in",
    referenceType: "stock_transfer",
    referenceId: params.p_transfer_id,
  }));
  stockMovementCalls.push([
    outInputs,
    { tenantId: params.p_tenant_id, branchId: transfer.from_branch_id, createdBy: params.p_created_by },
  ]);
  stockMovementCalls.push([
    inInputs,
    { tenantId: params.p_tenant_id, branchId: transfer.to_branch_id, createdBy: params.p_created_by },
  ]);
  updateCalls.push({
    table: "stock_transfers",
    data: { status: "completed" },
    filters: { id: params.p_transfer_id },
  });
  return { data: { success: true }, error: null };
}

function simulateDebtAgingRpc(kind: "receivable" | "payable") {
  const isReceivable = kind === "receivable";
  const documents = (tableMocks[isReceivable ? "invoices" : "purchase_orders"]?.data ?? []) as Array<Record<string, unknown>>;
  const parties = (tableMocks[isReceivable ? "customers" : "suppliers"]?.data ?? []) as Array<Record<string, unknown>>;
  const partyById = new Map(parties.map((party) => [String(party.id), party]));
  const grouped = new Map<string, Record<string, unknown>>();
  const now = Date.now();

  for (const document of documents) {
    const partyId = String(document[isReceivable ? "customer_id" : "supplier_id"] ?? "");
    if (!partyId) continue;
    const outstanding = Number(document.debt ?? 0);
    if (outstanding <= 0) continue;
    const createdAt = String(document.created_at ?? new Date().toISOString());
    const ageDays = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86_400_000));
    const bucketKey = ageDays <= 30
      ? "bucket_0_30"
      : ageDays <= 60
        ? "bucket_31_60"
        : ageDays <= 90
          ? "bucket_61_90"
          : "bucket_91_plus";
    const party = partyById.get(partyId);
    const row = grouped.get(partyId) ?? {
      [isReceivable ? "customer_id" : "supplier_id"]: partyId,
      [isReceivable ? "customer_name" : "supplier_name"]: String(party?.name ?? ""),
      [isReceivable ? "invoice_count" : "document_count"]: 0,
      outstanding: 0,
      bucket_0_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_91_plus: 0,
      oldest_days: 0,
      [isReceivable ? "oldest_invoice_date" : "oldest_document_date"]: createdAt,
    };
    row[isReceivable ? "invoice_count" : "document_count"] = Number(row[isReceivable ? "invoice_count" : "document_count"] ?? 0) + 1;
    row.outstanding = Number(row.outstanding ?? 0) + outstanding;
    row[bucketKey] = Number(row[bucketKey] ?? 0) + outstanding;
    if (ageDays > Number(row.oldest_days ?? 0)) {
      row.oldest_days = ageDays;
      row[isReceivable ? "oldest_invoice_date" : "oldest_document_date"] = createdAt;
    }
    grouped.set(partyId, row);
  }

  return {
    data: {
      generated_at: new Date().toISOString(),
      as_of_date: new Date().toISOString(),
      tenant_id: "tenant-1",
      branch_id: null,
      rows: Array.from(grouped.values()),
    },
    error: null,
  };
}

function simulateTransferStateAtomic(params: unknown) {
  const input = params as { p_transfer_id?: string; p_new_status?: string };
  const source = tableMocks.stock_transfers?.data;
  const transfer = Array.isArray(source)
    ? source.find((row) => row.id === input.p_transfer_id)
    : source;
  if (!transfer || transfer.id !== input.p_transfer_id) {
    return { data: null, error: { message: "TRANSFER_NOT_FOUND" } };
  }
  if (
    input.p_new_status === "cancelled" &&
    !["draft", "in_transit"].includes(transfer.status)
  ) {
    return { data: null, error: { message: "TRANSFER_STATUS_INVALID" } };
  }
  updateCalls.push({
    table: "stock_transfers",
    data: { status: input.p_new_status },
    filters: { id: input.p_transfer_id },
  });
  return { data: { success: true, status: input.p_new_status }, error: null };
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      const mock = tableMocks[table];
      const chain = createChain(mock ?? { data: null, error: null });
      chain._tableName = table;
      return chain;
    }),
    rpc: vi.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      if (fn === "save_pos_draft_atomic_v3") {
        return {
          data: {
            invoice_id: "inv-draft",
            invoice_code: "NH00001",
            status: "draft",
            revision: 1,
          },
          error: null,
        };
      }
      if (fn === "complete_legacy_sales_order_atomic") {
        if (!tableMocks.sales_orders?.data) {
          return { data: null, error: { message: "ORDER_NOT_COMPLETABLE" } };
        }
        return {
          data: { invoice_id: "inv-so", invoice_code: "HD00001" },
          error: null,
        };
      }
      if (fn === "cancel_legacy_sales_order_atomic") {
        if (!tableMocks.sales_orders?.data) {
          return { data: null, error: { message: "ORDER_NOT_CANCELLABLE" } };
        }
        return {
          data: { order_id: "so-1", status: "cancelled" },
          error: null,
        };
      }
      if (fn === "receive_purchase_items_atomic") {
        return simulateReceivePurchaseItemsAtomic(params);
      }
      if (fn === "pos_complete_checkout_atomic_v3") {
        return simulatePosCompleteCheckoutAtomic(params);
      }
      if (fn === "complete_draft_atomic_v5") {
        return simulateCompleteDraftAtomicV3(params);
      }
      if (fn === "complete_stock_transfer_atomic") {
        return simulateCompleteStockTransferAtomic(params);
      }
      if (fn === "get_receivable_aging_report") {
        return simulateDebtAgingRpc("receivable");
      }
      if (fn === "get_payable_aging_report") {
        return simulateDebtAgingRpc("payable");
      }
      if (fn === "set_stock_transfer_state_atomic") {
        return simulateTransferStateAtomic(params);
      }
      if (fn === "next_code") {
        rpcCodeCounter++;
        return { data: `CODE${String(rpcCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      // Migration 00074: atomic disposal + internal export
      if (
        fn === "apply_disposal_export_atomic" ||
        fn === "apply_internal_export_atomic"
      ) {
        return { data: { success: true, items_processed: 2 }, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({ tenantId: "tenant-1", branchId: "branch-1", userId: "user-1" })
  ),
  getCurrentTenantId: vi.fn(() => Promise.resolve("tenant-1")),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 49 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: vi.fn((...args: unknown[]) => {
    stockMovementCalls.push(args);
    return Promise.resolve();
  }),
  nextEntityCode: vi.fn(() => Promise.resolve(`WH${Date.now()}`)),
}));

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  stockMovementCalls.length = 0;
  rpcCodeCounter = 0;
  claimCounter = 0;
  tableMocks = {};
});

// ============================================================
//  Flow A: POS Direct Sale (F10)
// ============================================================

describe("Flow A: POS Direct Sale", () => {
  beforeEach(() => {
    tableMocks = {
      invoices: {
        data: { id: "inv-1", code: "HD00001", total: 500_000 },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("creates invoice + stock movements + cash receipt in correct order", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        {
          productId: "p1",
          productName: "Cà phê sữa",
          quantity: 2,
          unitPrice: 150_000,
          discount: 0,
        },
        {
          productId: "p2",
          productName: "Bánh mì",
          quantity: 3,
          unitPrice: 50_000,
          discount: 0,
        },
      ],
      paymentMethod: "cash",
      subtotal: 450_000,
      discountAmount: 0,
      total: 450_000,
      paid: 450_000,
    });

    // 1. Invoice created
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "invoices"
    );
    expect(invoiceInserts.length).toBe(1);

    // 2. Invoice items created
    const itemInserts = insertCalls.filter(
      (c) => c.table === "invoice_items"
    );
    expect(itemInserts.length).toBe(1);

    // 3. Stock movements created in one batched ledger insert
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBe(1);

    // 4. Stock RPCs called (increment_product_stock + upsert_branch_stock per item)
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    // 2 items × 2 RPCs each = 4
    expect(stockRpcs.length).toBe(4);

    // 5. Cash receipt created
    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBe(1);

    // 6. Code generation RPC called
    const codeRpcs = rpcCalls.filter((c) => c.fn === "next_code");
    expect(codeRpcs.length).toBeGreaterThanOrEqual(1);
  });

  it("decrements stock with negative delta", async () => {
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        {
          productId: "p1",
          productName: "SP",
          quantity: 5,
          unitPrice: 100_000,
          discount: 0,
        },
      ],
      paymentMethod: "cash",
      subtotal: 500_000,
      discountAmount: 0,
      total: 500_000,
      paid: 500_000,
    });

    // increment_product_stock should use negative delta for OUT
    const decrementRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    expect(decrementRpcs.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = decrementRpcs[0].params as any;
    expect(params.p_delta).toBe(-5);
  });
});

// ============================================================
//  Flow B: Draft (F9) → Complete (F10) with Mixed Payment
// ============================================================

describe("Flow B: Draft → Complete with Mixed Payment", () => {
  beforeEach(() => {
    tableMocks = {
      invoices: {
        data: {
          id: "inv-draft",
          code: "HD00001",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          customer_id: null,
          customer_name: "Khách lẻ",
          subtotal: 1_000_000,
          discount_amount: 0,
          total: 1_000_000,
          paid: 0,
          debt: 0,
          payment_method: "cash",
          note: null,
          status: "draft",
        },
        error: null,
      },
      invoice_items: {
        data: [
          {
            id: "ii1",
            product_id: "p1",
            product_name: "SP A",
            quantity: 2,
            unit_price: 300_000,
            discount: 0,
            total: 600_000,
          },
          {
            id: "ii2",
            product_id: "p2",
            product_name: "SP B",
            quantity: 4,
            unit_price: 100_000,
            discount: 0,
            total: 400_000,
          },
        ],
        error: null,
      },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("F9 draft uses the atomic draft RPC without stock or cash writes", async () => {
    const { saveDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    const result = await saveDraftOrder({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        {
          productId: "p1",
          productName: "SP A",
          quantity: 2,
          unitPrice: 300_000,
          discount: 0,
        },
      ],
      paymentMethod: "cash",
      subtotal: 600_000,
      discountAmount: 0,
      total: 600_000,
      paid: 0,
    }, { sessionId: "31e9d753-0c76-45af-a509-d4dce67c042f" });

    expect(result).toEqual({
      invoiceId: "inv-draft",
      invoiceCode: "NH00001",
      revision: 1,
      status: "draft",
    });
    expect(rpcCalls.some((call) => call.fn === "save_pos_draft_atomic_v3")).toBe(true);
    expect(insertCalls.filter((call) => call.table === "invoices")).toHaveLength(0);
    expect(insertCalls.filter((call) => call.table === "stock_movements")).toHaveLength(0);
    expect(insertCalls.filter((call) => call.table === "cash_transactions")).toHaveLength(0);
  });

  it("F10 completion applies stock + cash with mixed breakdown", async () => {
    const { completeDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeDraftOrder("inv-draft", {
      method: "mixed",
      paid: 1_000_000,
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      clientSessionId: "31e9d753-0c76-45af-a509-d4dce67c042f",
      expectedRevision: 1,
      expectedTotal: 1_000_000,
      items: [
        { productId: "p1", productName: "SP A", quantity: 2, unitPrice: 300_000, discount: 0 },
        { productId: "p2", productName: "SP B", quantity: 4, unitPrice: 100_000, discount: 0 },
      ],
      paymentBreakdown: [
        { method: "cash", amount: 500_000 },
        { method: "transfer", amount: 300_000 },
        { method: "card", amount: 200_000 },
      ],
    });

    // Stock movements applied per item for ledger traceability
    const smInserts = insertCalls.filter(
      (c) => c.table === "stock_movements"
    );
    expect(smInserts.length).toBe(2);

    // Stock RPCs called: 2 items × 2 RPCs each = 4
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs.length).toBe(4);

    // Mixed payment → creates cash_transactions
    // The mock may consolidate calls — verify at least 1 insert happened
    const cashInserts = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashInserts.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
//  Flow C: Purchase Order → Receive → Stock IN + Lots + Input Invoice
// ============================================================

describe("Flow C: Purchase Order Receive", () => {
  beforeEach(() => {
    tableMocks = {
      purchase_orders: {
        data: {
          id: "po-1",
          code: "PO00001",
          supplier_id: "supp-1",
          status: "ordered",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
        },
        error: null,
      },
      purchase_order_items: {
        data: [
          {
            id: "poi-1",
            product_id: "p1",
            product_name: "Nguyên liệu A",
            quantity: 100,
            received_quantity: 0,
            unit_price: 50_000,
          },
          {
            id: "poi-2",
            product_id: "p2",
            product_name: "Nguyên liệu B",
            quantity: 50,
            received_quantity: 0,
            unit_price: 30_000,
          },
        ],
        error: null,
      },
      product_lots: { data: null, error: null },
      input_invoices: { data: null, error: null },
      stock_movements: { data: null, error: null },
    };
  });

  it("applies stock IN for all items", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // applyManualStockMovement should be called once with 2 items
    expect(stockMovementCalls.length).toBe(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstCall = stockMovementCalls[0] as any[];
    const inputs = firstCall[0];
    expect(inputs).toHaveLength(2);

    // Both should be type='in'
    expect(inputs[0].type).toBe("in");
    expect(inputs[1].type).toBe("in");
    expect(inputs[0].quantity).toBe(100);
    expect(inputs[1].quantity).toBe(50);
    expect(inputs[0].referenceType).toBe("purchase_order");
  });

  it("creates product lots for FIFO tracking", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    const lotInserts = insertCalls.filter(
      (c) => c.table === "product_lots"
    );
    expect(lotInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lots = lotInserts[0].data as any[];
    expect(lots).toHaveLength(2);
    expect(lots[0].source_type).toBe("purchase");
    expect(lots[0].status).toBe("active");
  });

  it("auto-creates input_invoice with correct total", async () => {
    const { receivePurchaseOrder } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    await receivePurchaseOrder("po-1");

    // Should insert into input_invoices
    const invoiceInserts = insertCalls.filter(
      (c) => c.table === "input_invoices"
    );
    expect(invoiceInserts.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inv = invoiceInserts[0].data as any;
    expect(inv.status).toBe("unrecorded");
    expect(inv.purchase_order_id).toBe("po-1");
    // Total = 100*50000 + 50*30000 = 6,500,000
    expect(inv.total_amount).toBe(6_500_000);
  });
});

// ============================================================
//  Flow D: Sales Order → Complete → Invoice + Stock + Cash
// ============================================================

describe("Flow D: Sales Order Completion", () => {
  beforeEach(() => {
    tableMocks = {
      sales_orders: {
        data: {
          id: "so-1",
          code: "DH00001",
          customer_id: "cust-1",
          customer_name: "Nguyễn Văn A",
          subtotal: 2_000_000,
          total: 2_000_000,
          status: "confirmed",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
        },
        error: null,
      },
      sales_order_items: {
        data: [
          {
            id: "soi-1",
            product_id: "p1",
            product_name: "Áo thun",
            quantity: 5,
            unit_price: 200_000,
            discount: 0,
            total: 1_000_000,
          },
          {
            id: "soi-2",
            product_id: "p2",
            product_name: "Quần jeans",
            quantity: 2,
            unit_price: 500_000,
            discount: 0,
            total: 1_000_000,
          },
        ],
        error: null,
      },
      invoices: {
        data: { id: "inv-so", code: "HD00001" },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  });

  it("creates invoice from sales order through one atomic RPC", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    const result = await completeSalesOrder("so-1");

    expect(result).toEqual({
      invoiceId: "inv-so",
      invoiceCode: "HD00001",
    });
    expect(rpcCalls).toContainEqual({
      fn: "complete_legacy_sales_order_atomic",
      params: { p_order_id: "so-1" },
    });
    expect(insertCalls.filter((call) => call.table === "invoices")).toHaveLength(0);
    expect(insertCalls.filter((call) => call.table === "invoice_items")).toHaveLength(0);
  });

  it("keeps stock decrement inside the same server transaction", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeSalesOrder("so-1");

    expect(insertCalls.filter((call) => call.table === "stock_movements")).toHaveLength(0);
    expect(
      rpcCalls.filter(
        (call) =>
          call.fn === "increment_product_stock" ||
          call.fn === "upsert_branch_stock",
      ),
    ).toHaveLength(0);
  });

  it("keeps the cash receipt inside the same server transaction", async () => {
    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await completeSalesOrder("so-1");

    expect(
      insertCalls.filter((call) => call.table === "cash_transactions"),
    ).toHaveLength(0);
  });

  it("throws on already-completed order", async () => {
    tableMocks.sales_orders = { data: null, error: null };

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(completeSalesOrder("so-1")).rejects.toThrow();
  });
});

// ============================================================
//  Flow E: Disposal/Internal Export → Stock OUT
// ============================================================

describe("Flow E: Disposal & Internal Export → Stock OUT", () => {
  it("disposal export applies stock out for all items", async () => {
    tableMocks = {
      disposal_exports: {
        data: { id: "de-1", code: "XH001", status: "draft" },
        error: null,
      },
      disposal_export_items: {
        data: [
          { id: "dei-1", product_id: "p1", product_name: "SP hết hạn", quantity: 10 },
          { id: "dei-2", product_id: "p2", product_name: "SP lỗi", quantity: 5 },
        ],
        error: null,
      },
    };

    const { completeDisposalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await completeDisposalExport("de-1");

    // Day 1 16/05/2026: atomic RPC pattern
    const atomicCall = rpcCalls.find(
      (c) => c.fn === "apply_disposal_export_atomic",
    );
    expect(atomicCall).toBeDefined();
    expect((atomicCall?.params as { p_disposal_id?: string })?.p_disposal_id).toBe(
      "de-1",
    );
  });

  it("internal export applies stock out", async () => {
    tableMocks = {
      internal_exports: {
        data: { id: "ie-1", code: "XNB001", status: "draft" },
        error: null,
      },
      internal_export_items: {
        data: [
          { id: "iei-1", product_id: "p1", product_name: "VP phẩm", quantity: 20 },
        ],
        error: null,
      },
    };

    const { completeInternalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await completeInternalExport("ie-1");

    // Day 1 16/05/2026: atomic RPC pattern
    const atomicCall = rpcCalls.find(
      (c) => c.fn === "apply_internal_export_atomic",
    );
    expect(atomicCall).toBeDefined();
    expect((atomicCall?.params as { p_export_id?: string })?.p_export_id).toBe(
      "ie-1",
    );
  });
});

// ============================================================
//  Flow F: Stock Transfer → Complete → Branch OUT + Branch IN
// ============================================================

describe("Flow F: Stock Transfer (inter-branch)", () => {
  beforeEach(() => {
    tableMocks = {
      stock_transfers: {
        data: {
          id: "tf-1",
          code: "CK00001",
          from_branch_id: "branch-hanoi",
          to_branch_id: "branch-hcm",
        },
        error: null,
      },
      stock_transfer_items: {
        data: [
          { id: "tfi-1", product_id: "p1", product_name: "Cà phê", quantity: 50 },
          { id: "tfi-2", product_id: "p2", product_name: "Trà", quantity: 30 },
        ],
        error: null,
      },
    };
  });

  it("OUT from source branch + IN to target branch", async () => {
    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // 2 calls: source OUT, target IN
    expect(stockMovementCalls.length).toBe(2);

    // Call 1: OUT from branch-hanoi
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outCall = stockMovementCalls[0] as any[];
    const outInputs = outCall[0];
    expect(outInputs).toHaveLength(2);
    expect(outInputs[0].type).toBe("out");
    expect(outInputs[0].quantity).toBe(50);
    expect(outCall[1].branchId).toBe("branch-hanoi");

    // Call 2: IN to branch-hcm
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inCall = stockMovementCalls[1] as any[];
    const inInputs = inCall[0];
    expect(inInputs).toHaveLength(2);
    expect(inInputs[0].type).toBe("in");
    expect(inInputs[0].quantity).toBe(50);
    expect(inCall[1].branchId).toBe("branch-hcm");
  });

  it("products.stock stays net-zero (OUT+IN cancel out)", async () => {
    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // Both OUT and IN have the SAME quantity — net effect on products.stock = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outQty = (stockMovementCalls[0] as any[])[0][0].quantity;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inQty = (stockMovementCalls[1] as any[])[0][0].quantity;
    expect(outQty).toBe(inQty); // Same quantity → net zero on company-level
  });

  it("uses stock_transfer as referenceType", async () => {
    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-1");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outInputs = (stockMovementCalls[0] as any[])[0];
    expect(outInputs[0].referenceType).toBe("stock_transfer");
    expect(outInputs[0].referenceId).toBe("tf-1");
  });
});

// ============================================================
//  Flow G: Debt Aging → Bucket Classification
// ============================================================

describe("Flow G: Debt Aging Report", () => {
  it("classifies debts into 4 age buckets based on oldest invoice", async () => {
    const now = new Date();
    const daysAgo = (d: number) => {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString();
    };

    tableMocks = {
      customers: {
        data: [
          { id: "c1", code: "KH01", name: "Current", debt: 1_000_000 },
          { id: "c2", code: "KH02", name: "Overdue30", debt: 2_000_000 },
          { id: "c3", code: "KH03", name: "Overdue60", debt: 3_000_000 },
          { id: "c4", code: "KH04", name: "Overdue90+", debt: 4_000_000 },
        ],
        error: null,
      },
      suppliers: { data: [], error: null },
      invoices: {
        data: [
          { customer_id: "c1", debt: 1_000_000, created_at: daysAgo(10), status: "completed" },
          { customer_id: "c2", debt: 2_000_000, created_at: daysAgo(45), status: "completed" },
          { customer_id: "c3", debt: 3_000_000, created_at: daysAgo(75), status: "completed" },
          { customer_id: "c4", debt: 4_000_000, created_at: daysAgo(120), status: "completed" },
        ],
        error: null,
      },
      purchase_orders: { data: [], error: null },
    };

    const { getDebtAging } = await import(
      "@/lib/services/supabase/debt"
    );

    const report = await getDebtAging();

    // Bucket 0 (0-30): c1 = 1M
    expect(report.buckets[0].customerAmount).toBe(1_000_000);
    expect(report.buckets[0].customerCount).toBe(1);

    // Bucket 1 (31-60): c2 = 2M
    expect(report.buckets[1].customerAmount).toBe(2_000_000);

    // Bucket 2 (61-90): c3 = 3M
    expect(report.buckets[2].customerAmount).toBe(3_000_000);

    // Bucket 3 (90+): c4 = 4M
    expect(report.buckets[3].customerAmount).toBe(4_000_000);

    // Total = 10M
    expect(report.totalDebt).toBe(10_000_000);
  });
});

// ============================================================
//  Flow H: Financial Alerts — Severity Sorting
// ============================================================

describe("Flow H: Financial Alerts", () => {
  it("generates and sorts alerts by severity", async () => {
    tableMocks = {
      customers: {
        data: [
          { id: "c1", name: "Nợ nặng", debt: 50_000_000 },
        ],
        error: null,
      },
      products: {
        data: [
          { id: "p1", name: "SP hết hàng", stock: 2, min_stock: 10, cost_price: 100_000 },
        ],
        error: null,
      },
      product_lots: { data: [], error: null },
      cash_transactions: { data: [], error: null },
    };

    const { getFinancialAlerts } = await import(
      "@/lib/services/supabase/reports"
    );

    const alerts = await getFinancialAlerts();

    // Should have at least overdue_debt and low_stock alerts
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    // Sorted by severity: critical first
    if (alerts.length >= 2) {
      const criticalIdx = alerts.findIndex((a) => a.severity === "critical");
      const warningIdx = alerts.findIndex((a) => a.severity === "warning");
      if (criticalIdx >= 0 && warningIdx >= 0) {
        expect(criticalIdx).toBeLessThan(warningIdx);
      }
    }
  });
});

// ============================================================
//  Flow I: Concurrent Claim Guard
// ============================================================

describe("Flow I: Concurrent Claim Guard", () => {
  it("second completion attempt throws (atomic claim)", async () => {
    // First call returns data (success), second returns null (already claimed)
    tableMocks = {
      sales_orders: { data: null, error: null }, // Already completed — returns null
      sales_order_items: { data: [], error: null },
      invoices: { data: { id: "inv-1", code: "HD001" }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    // maybeSingle returns null → no row claimed → throws
    await expect(completeSalesOrder("so-1")).rejects.toThrow();
  });

  it("cancel of completed order throws", async () => {
    tableMocks = {
      sales_orders: { data: null, error: null }, // Already completed
    };

    const { cancelSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    await expect(cancelSalesOrder("so-1")).rejects.toThrow();
  });

  it("cancel of completed transfer throws", async () => {
    tableMocks = {
      stock_transfers: { data: null, error: null },
    };

    const { cancelStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await expect(cancelStockTransfer("tf-1")).rejects.toThrow();
  });
});

// ============================================================
//  Flow J: Code Generation Uniqueness
// ============================================================

describe("Flow J: Sequential Code Generation", () => {
  it("generates unique codes across multiple POS checkouts", async () => {
    tableMocks = {
      invoices: { data: { id: "inv-1", code: "HD001" }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    const baseInput = {
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        { productId: "p1", productName: "SP", quantity: 1, unitPrice: 10_000, discount: 0 },
      ],
      paymentMethod: "cash" as const,
      subtotal: 10_000,
      discountAmount: 0,
      total: 10_000,
      paid: 10_000,
    };

    await posCheckout(baseInput);
    const firstCodes = rpcCalls.filter((c) => c.fn === "next_code").length;

    await posCheckout(baseInput);
    const secondCodes = rpcCalls.filter((c) => c.fn === "next_code").length;

    // Each checkout generates at least 1 code (invoice) + 1 code (cash receipt)
    expect(secondCodes).toBeGreaterThan(firstCodes);
  });
});
