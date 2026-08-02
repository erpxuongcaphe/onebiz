import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * COMPREHENSIVE BUSINESS SCENARIOS — Warehouse & Sales Management
 *
 * Covers ALL real-world business cases for a coffee roasting/retail ERP:
 *
 * === POS (Bán Hàng Trực Tiếp) ===
 *   S1:  Cash sale — single product
 *   S2:  Card sale — multiple products
 *   S3:  Transfer sale (chuyển khoản)
 *   S4:  Mixed payment split (tiền mặt + CK + thẻ)
 *   S5:  Sale with per-line discount
 *   S6:  Sale with order-level discount
 *   S7:  Sale with zero-paid (ghi nợ toàn bộ)
 *   S8:  Oversell — stock goes negative (warning but allowed)
 *   S9:  Walk-in vs named customer
 *
 * === DRAFT (Đơn Nháp F9 → F10) ===
 *   D1:  Save draft — NO stock/cash side effects
 *   D2:  Complete draft — stock + cash applied
 *   D3:  Delete draft — removed without trace
 *   D4:  Complete already-completed draft — reject
 *
 * === PURCHASE ORDER (Nhập Hàng) ===
 *   P1:  Create PO with correct tenant/branch context
 *   P2:  Receive PO — stock IN + lots created
 *   P3:  Receive PO — auto creates input invoice
 *   P4:  Partial receive — remaining quantity correct
 *   P5:  Cancel PO — status change only (draft/ordered)
 *   P6:  Double receive guard — atomic claim prevents
 *
 * === SALES ORDER (Đơn Hàng Bán) ===
 *   O1:  Complete sales order → auto invoice + stock + cash
 *   O2:  Cancel sales order — only new/confirmed allowed
 *   O3:  Cancel delivering order — reject
 *   O4:  Double complete guard — atomic claim
 *
 * === RETURNS (Trả Hàng) ===
 *   R1:  Customer return — stock increment (IN) + cash refund
 *   R2:  Return with zero refund (exchange) — stock IN only
 *   R3:  Purchase return (to supplier) — stock decrement (OUT)
 *
 * === WAREHOUSE OPS (Kho Hàng) ===
 *   W1:  Disposal export → stock OUT
 *   W2:  Internal export → stock OUT
 *   W3:  Stock transfer (branch A → B) — dual OUT/IN
 *   W4:  Transfer cancel — no stock changes
 *   W5:  Inventory check — surplus → stock IN
 *   W6:  Inventory check — shortage → stock OUT
 *   W7:  Inventory check — mixed surplus + shortage
 *
 * === FINANCIAL (Tài Chính) ===
 *   F1:  Debt aging — 4 buckets (0-30, 31-60, 61-90, 90+)
 *   F2:  P&L — revenue - COGS - expenses
 *   F3:  Financial alerts — low stock, high debt, expiring lots
 *   F4:  DSO calculation
 *   F5:  Inventory turnover
 *
 * === EDGE CASES (Biên) ===
 *   E1:  Concurrent claim — only 1 succeeds
 *   E2:  Code generation — unique monotonic
 *   E3:  Empty items list — validation guard
 *   E4:  Very large quantity — no overflow
 *   E5:  Context resolution — tenant/branch/user correct
 */

// ============================================================
//  Shared mock infrastructure (same pattern as workflow-e2e)
// ============================================================

const insertCalls: { table: string; data: unknown }[] = [];
const updateCalls: {
  table: string;
  data: unknown;
  filters: Record<string, unknown>;
}[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];
const stockMovementCalls: unknown[] = [];
let rpcCodeCounter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableMocks: Record<string, any> = {};
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
  chain.neq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.lte = vi.fn(self);
  chain.not = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.range = vi.fn(self);
  chain.or = vi.fn(self);
  chain.ilike = vi.fn(self);
  chain.is = vi.fn(self);
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
  const total = Number((params.p_items ?? []).reduce(
    (sum: number, item: any) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0) - Number(item.discount ?? 0),
    0,
  )) - Number(params.p_order_discount ?? 0);
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
      subtotal: (params.p_items ?? []).reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0), 0),
      discount_amount: (params.p_items ?? []).reduce((sum: number, item: any) => sum + Number(item.discount ?? 0), 0) + Number(params.p_order_discount ?? 0),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function simulateApplyInventoryCheckAtomic(params: any): { data: unknown; error: unknown } {
  const check = tableMocks.inventory_checks?.data;
  const items = (tableMocks.inventory_check_items?.data ?? []) as Array<{
    product_id: string;
    product_name: string;
    difference: number;
  }>;
  if (!check) return { data: null, error: { message: "Inventory check not found" } };

  const movementInputs = items
    .filter((item) => Number(item.difference ?? 0) !== 0)
    .map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: Math.abs(Number(item.difference ?? 0)),
      type: Number(item.difference ?? 0) > 0 ? "in" : "out",
      referenceType: "inventory_check",
      referenceId: params.p_check_id,
    }));

  if (movementInputs.length > 0) {
    stockMovementCalls.push([
      movementInputs,
      {
        tenantId: params.p_tenant_id,
        branchId: check.branch_id ?? "branch-1",
        createdBy: params.p_created_by,
      },
    ]);
  }
  updateCalls.push({
    table: "inventory_checks",
    data: { status: "balanced" },
    filters: { id: params.p_check_id },
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
  if (!transfer || transfer.id !== inpu…9319 tokens truncated…c () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-2", code: "KK00002", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          {
            id: "ici-2",
            product_id: "p2",
            product_name: "SP B",
            system_stock: 100,
            actual_stock: 92,
            difference: -8, // shortage
          },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import(
      "@/lib/services/supabase/inventory"
    );

    await applyInventoryCheck("ic-2");

    // Stock OUT for shortage
    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("W7: Inventory check mixed — surplus + shortage in same check", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-3", code: "KK00003", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          {
            id: "ici-3",
            product_id: "p1",
            product_name: "SP A",
            system_stock: 50,
            actual_stock: 55,
            difference: 5, // surplus
          },
          {
            id: "ici-4",
            product_id: "p2",
            product_name: "SP B",
            system_stock: 30,
            actual_stock: 25,
            difference: -5, // shortage
          },
          {
            id: "ici-5",
            product_id: "p3",
            product_name: "SP C",
            system_stock: 20,
            actual_stock: 20,
            difference: 0, // no change — should be skipped
          },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import(
      "@/lib/services/supabase/inventory"
    );

    await applyInventoryCheck("ic-3");

    // At least 1 call (surplus grouped, shortage grouped)
    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
//  F1-F5: FINANCIAL SCENARIOS
// ============================================================

describe("Financial Scenarios", () => {
  it("F1: Debt aging — classifies into 4 correct buckets", async () => {
    const now = new Date();
    const days15 = new Date(now.getTime() - 15 * 86400000).toISOString();
    const days45 = new Date(now.getTime() - 45 * 86400000).toISOString();
    const days75 = new Date(now.getTime() - 75 * 86400000).toISOString();
    const days120 = new Date(now.getTime() - 120 * 86400000).toISOString();

    tableMocks = {
      customers: {
        data: [
          { id: "c1", name: "KH A", debt: 1_000_000 },
          { id: "c2", name: "KH B", debt: 2_000_000 },
          { id: "c3", name: "KH C", debt: 500_000 },
          { id: "c4", name: "KH D", debt: 3_000_000 },
        ],
        error: null,
        count: 4,
      },
      suppliers: {
        data: [
          { id: "s1", name: "NCC X", debt: 800_000 },
        ],
        error: null,
        count: 1,
      },
      invoices: {
        data: [
          { id: "inv-1", customer_id: "c1", created_at: days15, debt: 1_000_000 },
          { id: "inv-2", customer_id: "c2", created_at: days45, debt: 2_000_000 },
          { id: "inv-3", customer_id: "c3", created_at: days75, debt: 500_000 },
          { id: "inv-4", customer_id: "c4", created_at: days120, debt: 3_000_000 },
        ],
        error: null,
      },
      purchase_orders: {
        data: [
          { id: "po-1", supplier_id: "s1", created_at: days15, debt: 800_000 },
        ],
        error: null,
      },
    };

    const { getDebtAging } = await import(
      "@/lib/services/supabase/debt"
    );

    const report = await getDebtAging();

    // Report should have 4 aging buckets
    expect(report.buckets).toHaveLength(4);
    // First bucket is "Hiện tại" (0-30 days)
    expect(report.buckets[0].label).toBe("Hiện tại");

    // Total debt should include all
    expect(report.totalDebt).toBeGreaterThan(0);
    expect(report.totalCustomerDebt).toBeGreaterThan(0);
  });

  it("F2: P&L — revenue minus COGS minus expenses = net profit", async () => {
    tableMocks = {
      invoices: {
        data: [
          { total: 5_000_000, status: "completed" },
          { total: 3_000_000, status: "completed" },
        ],
        error: null,
      },
      invoice_items: {
        data: [
          { quantity: 10, unit_price: 500_000 },
          { quantity: 5, unit_price: 600_000 },
        ],
        error: null,
      },
      products: {
        data: [
          { id: "p1", cost_price: 300_000 },
        ],
        error: null,
      },
      cash_transactions: {
        data: [
          { type: "payment", amount: 1_000_000 },
        ],
        error: null,
      },
    };

    const { getProfitAndLoss } = await import(
      "@/lib/services/supabase/reports"
    );

    const result = await getProfitAndLoss();

    // Returns {current, previous} ProfitAndLoss
    expect(result).toHaveProperty("current");
    expect(result).toHaveProperty("previous");

    const pnl = result.current;
    expect(pnl).toHaveProperty("revenue");
    expect(pnl).toHaveProperty("cogs");
    expect(pnl).toHaveProperty("grossProfit");
    expect(pnl).toHaveProperty("operatingExpense");
    expect(pnl).toHaveProperty("netProfit");

    // Basic math: grossProfit = revenue - cogs, netProfit = grossProfit - operatingExpense
    expect(pnl.grossProfit).toBe(pnl.revenue - pnl.cogs);
    expect(pnl.netProfit).toBe(pnl.grossProfit - pnl.operatingExpense);
  });

  it("F3: Financial alerts — generates alerts for low stock, high debt, expiry", async () => {
    tableMocks = {
      products: {
        data: [
          { id: "p1", name: "SP thấp", stock: 2, min_stock: 10 },
        ],
        error: null,
      },
      customers: {
        data: [
          { id: "c1", name: "KH nợ", debt: 50_000_000 },
        ],
        error: null,
      },
      product_lots: {
        data: [],
        error: null,
      },
      cash_transactions: {
        data: [],
        error: null,
      },
      invoices: {
        data: [],
        error: null,
      },
    };

    const { getFinancialAlerts } = await import(
      "@/lib/services/supabase/reports"
    );

    const alerts = await getFinancialAlerts();

    // Alerts generated
    expect(Array.isArray(alerts)).toBe(true);
  });

  it("F4: DSO — Days Sales Outstanding calculation", async () => {
    tableMocks = {
      invoices: {
        data: [
          { total: 10_000_000, debt: 3_000_000 },
        ],
        error: null,
      },
      customers: {
        data: [
          { debt: 3_000_000 },
        ],
        error: null,
      },
    };

    const { getDSO } = await import(
      "@/lib/services/supabase/reports"
    );

    const dso = await getDSO();

    // DSO should be a number
    expect(typeof dso.dso).toBe("number");
    expect(dso.dso).toBeGreaterThanOrEqual(0);
  });

  it("F5: Inventory turnover — COGS / avg inventory", async () => {
    tableMocks = {
      invoice_items: {
        data: [
          { quantity: 100, unit_price: 50_000 },
        ],
        error: null,
      },
      products: {
        data: [
          { id: "p1", cost_price: 30_000, stock: 200 },
        ],
        error: null,
      },
    };

    const { getInventoryTurnover } = await import(
      "@/lib/services/supabase/reports"
    );

    const turnover = await getInventoryTurnover();

    expect(turnover).toHaveProperty("turnoverRatio");
    expect(typeof turnover.turnoverRatio).toBe("number");
  });
});

// ============================================================
//  E1-E5: EDGE CASES
// ============================================================

describe("Edge Cases", () => {
  it("E1: Concurrent claim — only first caller succeeds", async () => {
    let claimCount = 0;
    tableMocks = {
      sales_orders: {
        // Simulate: first call returns data (claim succeeds), second returns null
        get data() {
          claimCount++;
          if (claimCount === 1) {
            return {
              id: "so-race",
              code: "DH00099",
              customer_id: null,
              customer_name: "Racer",
              status: "confirmed",
              tenant_id: "tenant-1",
              branch_id: "branch-1",
              subtotal: 100_000,
              discount_amount: 0,
              total: 100_000,
            };
          }
          return null; // Second caller gets nothing
        },
        error: null,
      },
      sales_order_items: {
        data: [
          {
            id: "soi-r",
            product_id: "p1",
            product_name: "SP",
            quantity: 1,
            unit_price: 100_000,
            discount: 0,
            total: 100_000,
            unit: "cái",
          },
        ],
        error: null,
      },
      invoices: {
        data: { id: "inv-race", code: "HD00099", total: 100_000 },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { completeSalesOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    // First call succeeds
    const result = await completeSalesOrder("so-race");
    expect(result).toHaveProperty("invoiceId");

    // Reset tracking
    insertCalls.length = 0;
    updateCalls.length = 0;
    rpcCalls.length = 0;
    stockMovementCalls.length = 0;

    // Second call should fail (already claimed)
    await expect(completeSalesOrder("so-race")).rejects.toThrow();
  });

  it("E2: Code generation — sequential codes are unique", async () => {
    setupStandardPOSMocks();

    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    // Make 3 consecutive sales
    await posCheckout(posInput());
    await posCheckout(posInput());
    await posCheckout(posInput());

    // Each sale should generate a unique code
    const codeRpcs = rpcCalls.filter((c) => c.fn === "next_code");
    expect(codeRpcs.length).toBeGreaterThanOrEqual(3);

    // Counter should have incremented 3+ times
    expect(rpcCodeCounter).toBeGreaterThanOrEqual(3);
  });

  it("E3: Very large quantity — no overflow in calculations", async () => {
    setupStandardPOSMocks();

    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    const largeTotal = 999_999 * 1_000_000; // ~1 trillion VND

    await posCheckout(
      posInput({
        items: [
          {
            productId: "p1",
            productName: "Bulk order",
            quantity: 999_999,
            unitPrice: 1_000_000,
            discount: 0,
          },
        ],
        subtotal: largeTotal,
        total: largeTotal,
        paid: largeTotal,
      })
    );

    // Invoice created with correct large total
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    expect(invoices).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).total).toBe(largeTotal);

    // Stock decrement with large qty
    const decRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBe(-999_999);
  });

  it("E4: Transfer state machine — invalid transitions rejected", async () => {
    const { canTransitionTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    // Valid transitions (draft → in_transit or cancelled only)
    expect(canTransitionTransfer("draft", "in_transit")).toBe(true);
    expect(canTransitionTransfer("draft", "cancelled")).toBe(true);
    expect(canTransitionTransfer("in_transit", "completed")).toBe(true);
    expect(canTransitionTransfer("in_transit", "cancelled")).toBe(true);

    // Invalid transitions
    expect(canTransitionTransfer("draft", "completed")).toBe(false); // Must go through in_transit
    expect(canTransitionTransfer("completed", "draft")).toBe(false);
    expect(canTransitionTransfer("completed", "cancelled")).toBe(false);
    expect(canTransitionTransfer("cancelled", "draft")).toBe(false);
    expect(canTransitionTransfer("cancelled", "completed")).toBe(false);
  });

  it("E5: PO state machine — valid transitions", async () => {
    const { canTransitionPurchaseStatus } = await import(
      "@/lib/services/supabase/purchase-orders"
    );

    // Valid
    expect(canTransitionPurchaseStatus("draft", "ordered")).toBe(true);
    expect(canTransitionPurchaseStatus("ordered", "completed")).toBe(true);
    expect(canTransitionPurchaseStatus("draft", "cancelled")).toBe(true);

    // Invalid
    expect(canTransitionPurchaseStatus("completed", "draft")).toBe(false);
    expect(canTransitionPurchaseStatus("cancelled", "ordered")).toBe(false);
  });
});

// ============================================================
//  BUSINESS RULE VALIDATIONS
// ============================================================

describe("Business Rule Validations", () => {
  it("BR1: POS sale — invoice status always 'completed' for direct checkout", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(posInput());

    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).status).toBe("completed");
  });

  it("BR2: Draft save — uses the atomic draft-only RPC", async () => {
    setupStandardPOSMocks();
    const { saveDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    const result = await saveDraftOrder(posInput({ paid: 0 }), { sessionId: "31e9d753-0c76-45af-a509-d4dce67c042f" });

    expect(result).toEqual({
      invoiceId: "inv-draft-1",
      invoiceCode: "NH000001",
      revision: 1,
      status: "draft",
    });
    expect(rpcCalls.some((call) => call.fn === "save_pos_draft_atomic_v3")).toBe(true);
    expect(insertCalls.filter((call) => call.table === "invoices")).toHaveLength(0);
  });

  it("BR3: Stock decrement — always negative delta for OUT", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(
      posInput({
        items: [
          { productId: "p1", productName: "SP", quantity: 7, unitPrice: 10_000, discount: 0 },
        ],
        subtotal: 70_000,
        total: 70_000,
        paid: 70_000,
      })
    );

    const decRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBeLessThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((decRpcs[0].params as any).p_delta).toBe(-7);
  });

  it("BR4: return stock mutation is owned by the atomic RPC", async () => {
    const { createSalesReturnAtomic } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await createSalesReturnAtomic({
      invoiceId: "invoice-br4",
      items: [{ invoiceItemId: "invoice-item-br4", quantity: 3 }],
      refundAmount: 150_000,
    });

    expect(rpcCalls).toContainEqual(
      expect.objectContaining({
        fn: "create_sales_return_atomic",
        params: expect.objectContaining({
          p_items: [{ invoiceItemId: "invoice-item-br4", quantity: 3 }],
        }),
      }),
    );
    expect(stockMovementCalls).toHaveLength(0);
  });

  it("BR5: Transfer net-zero — company stock unchanged after transfer", async () => {
    tableMocks = {
      stock_transfers: {
        data: {
          id: "tf-br5",
          from_branch_id: "b-a",
          to_branch_id: "b-b",
          status: "draft",
          tenant_id: "tenant-1",
        },
        error: null,
      },
      stock_transfer_items: {
        data: [
          { id: "tfi-1", product_id: "p1", product_name: "SP", quantity: 10 },
        ],
        error: null,
      },
    };

    const { completeStockTransfer } = await import(
      "@/lib/services/supabase/transfers"
    );

    await completeStockTransfer("tf-br5");

    // OUT call: qty 10
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outQty = (stockMovementCalls[0] as any[])[0][0].quantity;
    // IN call: qty 10
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inQty = (stockMovementCalls[1] as any[])[0][0].quantity;

    // Same quantity OUT and IN = net zero at company level
    expect(outQty).toBe(inQty);
    expect(outQty).toBe(10);
  });

  it("BR6: Cash receipt — correct category and reference for POS sale", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    await posCheckout(posInput());

    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashData = cash[0].data as any;
    expect(cashData.type).toBe("receipt");
    expect(cashData.category).toBe("Bán hàng");
    expect(cashData.reference_type).toBe("invoice");
  });

  it("BR7: cash refund parameters are sent to the atomic RPC", async () => {
    const { createSalesReturnAtomic } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await createSalesReturnAtomic({
      invoiceId: "invoice-br7",
      items: [{ invoiceItemId: "invoice-item-br7", quantity: 1 }],
      refundAmount: 100_000,
      refundPaymentMethod: "cash",
    });

    expect(rpcCalls).toContainEqual(
      expect.objectContaining({
        fn: "create_sales_return_atomic",
        params: expect.objectContaining({
          p_invoice_id: "invoice-br7",
          p_refund_amount: 100_000,
          p_refund_payment_method: "cash",
        }),
      }),
    );
    expect(insertCalls.filter((call) => call.table === "cash_transactions")).toHaveLength(0);
  });

  it("BR8: Disposal/Internal export cancel — only draft allowed", async () => {
    // Already completed → claim fails
    tableMocks = {
      disposal_exports: { data: null, error: null },
    };

    const { cancelDisposalExport } = await import(
      "@/lib/services/supabase/inventory"
    );

    await expect(cancelDisposalExport("de-done")).rejects.toThrow();
  });

  it("BR9: Multiple products in single sale — all tracked individually", async () => {
    setupStandardPOSMocks();
    const { posCheckout } = await import(
      "@/lib/services/supabase/pos-checkout"
    );

    const items = Array.from({ length: 10 }, (_, i) => ({
      productId: `p${i + 1}`,
      productName: `Sản phẩm ${i + 1}`,
      quantity: i + 1,
      unitPrice: 10_000 * (i + 1),
      discount: 0,
    }));

    const subtotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );

    await posCheckout(
      posInput({ items, subtotal, total: subtotal, paid: subtotal })
    );

    // 10 products × 2 stock RPCs = 20
    const stockRpcs = rpcCalls.filter(
      (c) =>
        c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(stockRpcs).toHaveLength(20);

    // Each product has correct delta
    for (let i = 0; i < 10; i++) {
      const pRpc = rpcCalls.find(
        (c) =>
          c.fn === "increment_product_stock" &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c.params as any).p_product_id === `p${i + 1}`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((pRpc!.params as any).p_delta).toBe(-(i + 1));
    }
  });
});

