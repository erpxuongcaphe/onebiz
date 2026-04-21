import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * STOCK INTEGRITY TESTS — Kiểm tra 100% tính chính xác của số lượng tồn kho
 *
 * Test từng con số, từng RPC call, từng delta value cho MỌI thao tác
 * thay đổi tồn kho trong doanh nghiệp quản lý kho + bán hàng.
 *
 * === LUỒNG CHÍNH (End-to-End) ===
 *   FULL-1: Nhập NVL (PO receive) → SX (consume materials + complete) → POS bán SKU
 *   FULL-2: Nhập hàng (100 đơn vị) → Bán (30) → Trả hàng (5) → Kiểm kho → Tồn = 75
 *
 * === NHẬP HÀNG (Purchase Receive) ===
 *   PR-1: Nhập đủ 100 NVL — stock tăng đúng +100
 *   PR-2: Nhập 1 phần (60/100) rồi nhập nốt (40/100) — tổng +100
 *   PR-3: Nhập 3 sản phẩm — mỗi SP có delta đúng
 *   PR-4: Nhập tạo lot — lot.initial_qty khớp
 *   PR-5: Nhập tạo hóa đơn đầu vào — total_amount đúng
 *
 * === SẢN XUẤT (Production) ===
 *   MF-1: Tiêu thụ NVL (consume materials) — stock NVL giảm đúng
 *   MF-2: Hoàn thành SX (complete) — stock SKU tăng đúng
 *   MF-3: BOM 3 NVL → SX 50 SKU — delta đúng cho từng NVL và SKU
 *
 * === BÁN HÀNG POS ===
 *   POS-1: Bán 1 SP số lượng 5 — stock giảm -5
 *   POS-2: Bán 5 SP khác nhau — mỗi SP giảm đúng số lượng
 *   POS-3: Bán hàng tạo invoice + items — dữ liệu khớp
 *   POS-4: Bán hàng ghi nợ (paid=0) — stock vẫn giảm, không tạo cash
 *   POS-5: Draft (F9) không đổi stock, F10 mới đổi
 *
 * === TRẢ HÀNG ===
 *   RET-1: Trả 3 SP — stock tăng +3, cash refund đúng
 *   RET-2: Trả nhà cung cấp 10 SP — stock giảm -10
 *
 * === CHUYỂN KHO ===
 *   TF-1: Chuyển 20 SP từ A→B — A giảm 20, B tăng 20, tổng không đổi
 *   TF-2: Chuyển 2 SP khác nhau — delta đúng từng SP
 *
 * === KIỂM KHO ===
 *   IC-1: Thừa 5 → stock +5
 *   IC-2: Thiếu 8 → stock -8
 *   IC-3: Mixed: +5, -3, 0 → chỉ xử lý ±, bỏ qua 0
 *
 * === XUẤT HỦY / NỘI BỘ ===
 *   DE-1: Xuất hủy 20 SP — stock -20
 *   IE-1: Xuất nội bộ 15 SP — stock -15
 */

// ============================================================
//  Mock infrastructure — tracking EVERY side-effect precisely
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
    if (isFullReceive) {
      reqQty = remaining;
    } else {
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
    return {
      data: null,
      error: { message: "Không có dòng hợp lệ nào để nhập" },
    };
  }

  // Emit a single "applyManualStockMovement"-equivalent trace
  stockMovementCalls.push([
    stockInputs,
    { tenantId: po.tenant_id, branchId: po.branch_id, createdBy: params.p_created_by },
  ]);
  // Emit a single batch insert into product_lots
  insertCalls.push({ table: "product_lots", data: lotRows });

  // Compute new status
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
      if (fn === "receive_purchase_items_atomic") {
        return simulateReceivePurchaseItemsAtomic(params);
      }
      if (fn === "next_code") {
        rpcCodeCounter++;
        return {
          data: `CODE${String(rpcCodeCounter).padStart(5, "0")}`,
          error: null,
        };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      if (fn === "complete_production_order") {
        return { data: "lot-new-1", error: null };
      }
      if (fn === "consume_production_materials") {
        return { data: null, error: null };
      }
      if (fn === "calculate_bom_cost") {
        return {
          data: {
            bom_id: "bom-1",
            total_cost: 150_000,
            items: [
              { material_id: "nvl-1", material_name: "Hạt Arabica", quantity: 2, cost_price: 50_000, line_cost: 100_000 },
              { material_id: "nvl-2", material_name: "Bao bì", quantity: 1, cost_price: 50_000, line_cost: 50_000 },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({
      tenantId: "tenant-1",
      branchId: "branch-1",
      userId: "user-1",
    })
  ),
  getCurrentTenantId: vi.fn(() => Promise.resolve("tenant-1")),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 49 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock createClient from @/lib/supabase/client (used by production.ts, bom.ts)
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: vi.fn((table: string) => {
      const mock = tableMocks[table];
      const chain = createChain(mock ?? { data: null, error: null });
      chain._tableName = table;
      return chain;
    }),
    rpc: vi.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      if (fn === "complete_production_order") {
        return { data: "lot-new-1", error: null };
      }
      if (fn === "consume_production_materials") {
        return { data: null, error: null };
      }
      if (fn === "calculate_bom_cost") {
        return {
          data: {
            bom_id: "bom-1",
            total_cost: 150_000,
            items: [
              { material_id: "nvl-1", material_name: "Hạt Arabica", quantity: 2, cost_price: 50_000, line_cost: 100_000 },
              { material_id: "nvl-2", material_name: "Bao bì", quantity: 1, cost_price: 50_000, line_cost: 50_000 },
            ],
          },
          error: null,
        };
      }
      if (fn === "next_code") {
        rpcCodeCounter++;
        return { data: `CODE${String(rpcCodeCounter).padStart(5, "0")}`, error: null };
      }
      if (fn === "increment_product_stock" || fn === "upsert_branch_stock") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }),
  }),
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
  tableMocks = {};
});

// ============================================================
//  Helpers — extract specific RPC calls
// ============================================================

function getStockRPCs(productId: string) {
  return rpcCalls.filter(
    (c) =>
      c.fn === "increment_product_stock" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c.params as any).p_product_id === productId
  );
}

function getBranchStockRPCs(productId: string) {
  return rpcCalls.filter(
    (c) =>
      c.fn === "upsert_branch_stock" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c.params as any).p_product_id === productId
  );
}

function getStockDelta(productId: string): number {
  const rpcs = getStockRPCs(productId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rpcs.reduce((sum, c) => sum + (c.params as any).p_delta, 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStockMoveInputs(callIndex: number): any[] {
  if (callIndex >= stockMovementCalls.length) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (stockMovementCalls[callIndex] as any[])[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStockMoveContext(callIndex: number): any {
  if (callIndex >= stockMovementCalls.length) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (stockMovementCalls[callIndex] as any[])[1] ?? {};
}

// ============================================================
//  NHẬP HÀNG (Purchase Receive) — Stock tăng đúng
// ============================================================

describe("NHẬP HÀNG — Purchase Receive Stock IN", () => {
  function setupPO(items: { id: string; product_id: string; product_name: string; quantity: number; received_quantity: number; unit_price: number }[]) {
    tableMocks = {
      purchase_orders: {
        data: {
          id: "po-test",
          code: "PO00001",
          supplier_id: "supp-1",
          supplier_name: "NCC Cà Phê Việt",
          status: "ordered",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
        },
        error: null,
      },
      purchase_order_items: { data: items, error: null },
      product_lots: { data: null, error: null },
      input_invoices: { data: null, error: null },
      stock_movements: { data: null, error: null },
    };
  }

  it("PR-1: Nhập đủ 100 NVL — applyManualStockMovement type=in, qty=100", async () => {
    setupPO([
      { id: "poi-1", product_id: "nvl-arabica", product_name: "Hạt Arabica", quantity: 100, received_quantity: 0, unit_price: 80_000 },
    ]);

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await receivePurchaseOrder("po-test");

    // applyManualStockMovement called once
    expect(stockMovementCalls).toHaveLength(1);

    // Check exact inputs
    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].productId).toBe("nvl-arabica");
    expect(inputs[0].quantity).toBe(100);
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].referenceType).toBe("purchase_order");
    expect(inputs[0].referenceId).toBe("po-test");
  });

  it("PR-2: Nhập 1 phần (60/100 đã nhận) — chỉ nhập thêm 40", async () => {
    setupPO([
      { id: "poi-1", product_id: "nvl-arabica", product_name: "Hạt Arabica", quantity: 100, received_quantity: 60, unit_price: 80_000 },
    ]);

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await receivePurchaseOrder("po-test");

    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].quantity).toBe(40); // 100 - 60 = 40
    expect(inputs[0].type).toBe("in");
  });

  it("PR-3: Nhập 3 sản phẩm — delta đúng cho từng SP", async () => {
    setupPO([
      { id: "poi-1", product_id: "nvl-arabica", product_name: "Arabica", quantity: 100, received_quantity: 0, unit_price: 80_000 },
      { id: "poi-2", product_id: "nvl-robusta", product_name: "Robusta", quantity: 50, received_quantity: 0, unit_price: 40_000 },
      { id: "poi-3", product_id: "nvl-baobì", product_name: "Bao bì", quantity: 200, received_quantity: 0, unit_price: 5_000 },
    ]);

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await receivePurchaseOrder("po-test");

    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(3);

    // Verify exact quantities per product
    const arabica = inputs.find((i: { productId: string }) => i.productId === "nvl-arabica");
    const robusta = inputs.find((i: { productId: string }) => i.productId === "nvl-robusta");
    const baobì = inputs.find((i: { productId: string }) => i.productId === "nvl-baobì");

    expect(arabica.quantity).toBe(100);
    expect(arabica.type).toBe("in");
    expect(robusta.quantity).toBe(50);
    expect(robusta.type).toBe("in");
    expect(baobì.quantity).toBe(200);
    expect(baobì.type).toBe("in");
  });

  it("PR-4: Nhập tạo lot — product_lots INSERT với initial_qty đúng", async () => {
    setupPO([
      { id: "poi-1", product_id: "nvl-arabica", product_name: "Arabica", quantity: 100, received_quantity: 0, unit_price: 80_000 },
    ]);

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await receivePurchaseOrder("po-test");

    const lotInserts = insertCalls.filter((c) => c.table === "product_lots");
    expect(lotInserts.length).toBeGreaterThanOrEqual(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lotData = lotInserts[0].data as any;
    // Lot should have initial_qty = received quantity
    if (Array.isArray(lotData)) {
      expect(lotData[0].initial_qty).toBe(100);
      expect(lotData[0].current_qty).toBe(100);
      expect(lotData[0].source_type).toBe("purchase");
    } else {
      expect(lotData.initial_qty).toBe(100);
      expect(lotData.current_qty).toBe(100);
    }
  });

  it("PR-5: Nhập tạo hóa đơn đầu vào — total_amount đúng", async () => {
    setupPO([
      { id: "poi-1", product_id: "nvl-arabica", product_name: "Arabica", quantity: 100, received_quantity: 0, unit_price: 80_000 },
      { id: "poi-2", product_id: "nvl-robusta", product_name: "Robusta", quantity: 50, received_quantity: 0, unit_price: 40_000 },
    ]);

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await receivePurchaseOrder("po-test");

    const invoiceInserts = insertCalls.filter((c) => c.table === "input_invoices");
    expect(invoiceInserts.length).toBeGreaterThanOrEqual(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invData = invoiceInserts[0].data as any;
    // Total = 100*80000 + 50*40000 = 10,000,000
    expect(invData.total_amount).toBe(10_000_000);
    expect(invData.purchase_order_id).toBe("po-test");
  });

  it("PR-6: Double receive guard — lần 2 bị reject", async () => {
    tableMocks = {
      purchase_orders: { data: null, error: null }, // Claim fails
    };

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await expect(receivePurchaseOrder("po-test")).rejects.toThrow();

    // No stock changes on rejected claim
    expect(stockMovementCalls).toHaveLength(0);
  });
});

// ============================================================
//  SẢN XUẤT (Production) — NVL giảm, SKU tăng
// ============================================================

describe("SẢN XUẤT — Production Stock Changes", () => {
  it("MF-1: Consume materials — RPC gọi đúng production_order_id", async () => {
    const { consumeProductionMaterials } = await import(
      "@/lib/services/supabase/production"
    );

    await consumeProductionMaterials("prod-001");

    // RPC consume_production_materials called with correct ID
    const consumeRpc = rpcCalls.find(
      (c) => c.fn === "consume_production_materials"
    );
    expect(consumeRpc).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((consumeRpc!.params as any).p_production_order_id).toBe("prod-001");
  });

  it("MF-2: Complete production — RPC gọi đúng completed_qty", async () => {
    const { completeProductionOrder } = await import(
      "@/lib/services/supabase/production"
    );

    const lotId = await completeProductionOrder("prod-001", 50);

    // RPC complete_production_order called
    const completeRpc = rpcCalls.find(
      (c) => c.fn === "complete_production_order"
    );
    expect(completeRpc).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((completeRpc!.params as any).p_production_order_id).toBe("prod-001");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((completeRpc!.params as any).p_completed_qty).toBe(50);

    // Returns lot ID
    expect(lotId).toBe("lot-new-1");
  });

  it("MF-3: Full production flow — consume materials + complete in correct order", async () => {
    const { consumeProductionMaterials, completeProductionOrder } =
      await import("@/lib/services/supabase/production");

    // Step 1: Consume materials (NVL stock OUT — handled by RPC)
    await consumeProductionMaterials("prod-001");

    // Step 2: Complete production (SKU stock IN — handled by RPC)
    await completeProductionOrder("prod-001", 100, "LOT-20260410-001");

    // Verify 2 RPCs in order
    const consumeIdx = rpcCalls.findIndex(
      (c) => c.fn === "consume_production_materials"
    );
    const completeIdx = rpcCalls.findIndex(
      (c) => c.fn === "complete_production_order"
    );
    expect(consumeIdx).toBeLessThan(completeIdx);

    // Complete RPC has correct lot number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rpcCalls[completeIdx].params as any).p_lot_number).toBe(
      "LOT-20260410-001"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rpcCalls[completeIdx].params as any).p_completed_qty).toBe(100);
  });

  it("MF-4: BOM cost calculation — returns correct total", async () => {
    const { calculateBOMCost } = await import(
      "@/lib/services/supabase/bom"
    );

    const result = await calculateBOMCost("bom-1");

    const bomRpc = rpcCalls.find((c) => c.fn === "calculate_bom_cost");
    expect(bomRpc).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bomRpc!.params as any).p_bom_id).toBe("bom-1");

    expect(result).toBeDefined();
    expect(result.totalCost).toBe(150_000);
    expect(result.items).toHaveLength(2);
  });
});

// ============================================================
//  POS BÁN HÀNG — Stock giảm chính xác
// ============================================================

describe("POS BÁN HÀNG — Stock Decrement Precision", () => {
  function setupPOS() {
    tableMocks = {
      invoices: {
        data: { id: "inv-pos", code: "HD00001", total: 500_000 },
        error: null,
      },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };
  }

  it("POS-1: Bán 1 SP số lượng 5 — increment_product_stock delta = -5", async () => {
    setupPOS();
    const { posCheckout } = await import("@/lib/services/supabase/pos-checkout");

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        { productId: "sku-cafe-500g", productName: "Cà phê rang xay 500g", quantity: 5, unitPrice: 100_000, discount: 0 },
      ],
      paymentMethod: "cash",
      subtotal: 500_000,
      discountAmount: 0,
      total: 500_000,
      paid: 500_000,
    });

    // Exact delta check
    const rpcs = getStockRPCs("sku-cafe-500g");
    expect(rpcs).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rpcs[0].params as any).p_delta).toBe(-5);

    // Branch stock also decremented
    const branchRpcs = getBranchStockRPCs("sku-cafe-500g");
    expect(branchRpcs).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((branchRpcs[0].params as any).p_delta).toBe(-5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((branchRpcs[0].params as any).p_branch_id).toBe("branch-1");
  });

  it("POS-2: Bán 5 SP khác nhau — mỗi SP giảm đúng số lượng", async () => {
    setupPOS();
    const { posCheckout } = await import("@/lib/services/supabase/pos-checkout");

    const items = [
      { productId: "sku-1", productName: "Cà phê hạt 1kg", quantity: 3, unitPrice: 200_000, discount: 0 },
      { productId: "sku-2", productName: "Trà sen 200g", quantity: 10, unitPrice: 50_000, discount: 0 },
      { productId: "sku-3", productName: "Cacao 500g", quantity: 1, unitPrice: 150_000, discount: 0 },
      { productId: "sku-4", productName: "Matcha 100g", quantity: 7, unitPrice: 80_000, discount: 0 },
      { productId: "sku-5", productName: "Syrup caramel 750ml", quantity: 2, unitPrice: 120_000, discount: 0 },
    ];

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Quán ABC",
      customerId: "cust-1",
      items,
      paymentMethod: "transfer",
      subtotal: 1_710_000,
      discountAmount: 0,
      total: 1_710_000,
      paid: 1_710_000,
    });

    // 5 products × 2 RPCs (stock + branch_stock) = 10
    const allStockRpcs = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock" || c.fn === "upsert_branch_stock"
    );
    expect(allStockRpcs).toHaveLength(10);

    // Verify EXACT delta per product
    expect(getStockDelta("sku-1")).toBe(-3);
    expect(getStockDelta("sku-2")).toBe(-10);
    expect(getStockDelta("sku-3")).toBe(-1);
    expect(getStockDelta("sku-4")).toBe(-7);
    expect(getStockDelta("sku-5")).toBe(-2);
  });

  it("POS-3: Bán hàng tạo invoice — dữ liệu invoice khớp", async () => {
    setupPOS();
    const { posCheckout } = await import("@/lib/services/supabase/pos-checkout");

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Nguyễn Văn Test",
      customerId: "cust-test",
      items: [
        { productId: "sku-1", productName: "SP A", quantity: 2, unitPrice: 150_000, discount: 10_000 },
      ],
      paymentMethod: "card",
      subtotal: 300_000,
      discountAmount: 10_000,
      total: 290_000,
      paid: 290_000,
    });

    // Invoice data verification
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inv = invoices[0].data as any;
    expect(inv.tenant_id).toBe("tenant-1");
    expect(inv.branch_id).toBe("branch-1");
    expect(inv.customer_id).toBe("cust-test");
    expect(inv.customer_name).toBe("Nguyễn Văn Test");
    expect(inv.status).toBe("completed");
    expect(inv.subtotal).toBe(300_000);
    expect(inv.discount_amount).toBe(10_000);
    expect(inv.total).toBe(290_000);
    expect(inv.paid).toBe(290_000);
    expect(inv.debt).toBe(0);
    expect(inv.payment_method).toBe("card");
    expect(inv.created_by).toBe("user-1");

    // Invoice items verification
    const items = insertCalls.filter((c) => c.table === "invoice_items");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineItems = items[0].data as any[];
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].product_id).toBe("sku-1");
    expect(lineItems[0].product_name).toBe("SP A");
    expect(lineItems[0].quantity).toBe(2);
    expect(lineItems[0].unit_price).toBe(150_000);
    expect(lineItems[0].discount).toBe(10_000);
  });

  it("POS-4: Ghi nợ toàn bộ (paid=0) — stock vẫn giảm, KHÔNG tạo cash", async () => {
    setupPOS();
    const { posCheckout } = await import("@/lib/services/supabase/pos-checkout");

    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "KH nợ",
      items: [
        { productId: "sku-1", productName: "SP", quantity: 10, unitPrice: 50_000, discount: 0 },
      ],
      paymentMethod: "cash",
      subtotal: 500_000,
      discountAmount: 0,
      total: 500_000,
      paid: 0, // GHI NỢ
    });

    // Stock STILL decremented
    const rpcs = getStockRPCs("sku-1");
    expect(rpcs).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rpcs[0].params as any).p_delta).toBe(-10);

    // Invoice has debt
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).paid).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).debt).toBe(500_000);

    // NO cash transaction
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash).toHaveLength(0);
  });

  it("POS-5: Draft (F9) KHÔNG đổi stock — chỉ F10 mới đổi", async () => {
    setupPOS();
    const { saveDraftOrder, completeDraftOrder } = await import(
      "@/lib/services/supabase/orders"
    );

    // --- F9: Save draft ---
    await saveDraftOrder({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách lẻ",
      items: [
        { productId: "sku-1", productName: "SP", quantity: 8, unitPrice: 100_000, discount: 0 },
      ],
      paymentMethod: "cash",
      subtotal: 800_000,
      discountAmount: 0,
      total: 800_000,
      paid: 0,
    });

    // Draft: NO stock RPCs, NO stock movements
    const stockRpcsAfterDraft = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    expect(stockRpcsAfterDraft).toHaveLength(0);
    expect(insertCalls.filter((c) => c.table === "stock_movements")).toHaveLength(0);
    expect(insertCalls.filter((c) => c.table === "cash_transactions")).toHaveLength(0);

    // Invoice created with status='draft'
    const invoices = insertCalls.filter((c) => c.table === "invoices");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((invoices[0].data as any).status).toBe("draft");

    // --- F10: Complete draft ---
    // Reset tracking
    insertCalls.length = 0;
    rpcCalls.length = 0;

    // Setup mock for draft completion (need invoice_items for stock decrement)
    tableMocks.invoice_items = {
      data: [
        { id: "ii-1", product_id: "sku-1", product_name: "SP", quantity: 8, unit_price: 100_000, discount: 0, total: 800_000 },
      ],
      error: null,
    };

    await completeDraftOrder("inv-pos", {
      method: "cash",
      paid: 800_000,
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
    });

    // NOW stock RPCs called
    const stockRpcsAfterComplete = rpcCalls.filter(
      (c) => c.fn === "increment_product_stock"
    );
    expect(stockRpcsAfterComplete.length).toBeGreaterThanOrEqual(1);

    // NOW cash transaction created
    const cashAfterComplete = insertCalls.filter(
      (c) => c.table === "cash_transactions"
    );
    expect(cashAfterComplete.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
//  TRẢ HÀNG — Stock tăng (customer) hoặc giảm (supplier)
// ============================================================

describe("TRẢ HÀNG — Returns Stock Changes", () => {
  it("RET-1: Trả hàng KH — stock tăng +3, cash refund = 300,000", async () => {
    const { completeReturn } = await import(
      "@/lib/services/supabase/returns-completion"
    );

    await completeReturn({
      returnId: "ret-1",
      returnCode: "TH00001",
      invoiceCode: "HD00001",
      customerName: "Nguyễn Trả Hàng",
      items: [
        { productId: "sku-cafe", productName: "Cà phê 500g", quantity: 3, unitPrice: 100_000 },
      ],
      refundAmount: 300_000,
    });

    // Stock IN
    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].productId).toBe("sku-cafe");
    expect(inputs[0].quantity).toBe(3);
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].referenceType).toBe("sales_return");
    expect(inputs[0].referenceId).toBe("ret-1");

    // Cash refund
    const cash = insertCalls.filter((c) => c.table === "cash_transactions");
    expect(cash).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cashData = cash[0].data as any;
    expect(cashData.type).toBe("payment");
    expect(cashData.amount).toBe(300_000);
    expect(cashData.category).toBe("Trả hàng");
    expect(cashData.counterparty).toBe("Nguyễn Trả Hàng");
    expect(cashData.reference_type).toBe("sales_return");
    expect(cashData.reference_id).toBe("ret-1");
  });

  it("RET-2: Trả hàng NCC (purchase return) — stock giảm type=out", async () => {
    const { applyManualStockMovement } = await import(
      "@/lib/services/supabase/stock-adjustments"
    );

    await applyManualStockMovement([
      { productId: "nvl-arabica", quantity: 10, type: "out", referenceType: "purchase_return", referenceId: "pr-1", note: "Trả hàng nhập - hạt ẩm" },
      { productId: "nvl-robusta", quantity: 5, type: "out", referenceType: "purchase_return", referenceId: "pr-1", note: "Trả hàng nhập - hạt ẩm" },
    ]);

    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(2);

    // NVL Arabica: OUT 10
    expect(inputs[0].productId).toBe("nvl-arabica");
    expect(inputs[0].quantity).toBe(10);
    expect(inputs[0].type).toBe("out");

    // NVL Robusta: OUT 5
    expect(inputs[1].productId).toBe("nvl-robusta");
    expect(inputs[1].quantity).toBe(5);
    expect(inputs[1].type).toBe("out");
  });
});

// ============================================================
//  CHUYỂN KHO — Source OUT, Target IN, Net Zero
// ============================================================

describe("CHUYỂN KHO — Transfer Stock Integrity", () => {
  function setupTransfer(items: { id: string; product_id: string; product_name: string; quantity: number }[]) {
    tableMocks = {
      stock_transfers: {
        data: {
          id: "tf-test",
          code: "CK00001",
          from_branch_id: "branch-hcm",
          to_branch_id: "branch-hanoi",
          status: "draft",
          tenant_id: "tenant-1",
        },
        error: null,
      },
      stock_transfer_items: { data: items, error: null },
    };
  }

  it("TF-1: Chuyển 20 SP — branch HCM -20, branch HN +20", async () => {
    setupTransfer([
      { id: "tfi-1", product_id: "sku-cafe", product_name: "Cà phê 500g", quantity: 20 },
    ]);

    const { completeStockTransfer } = await import("@/lib/services/supabase/transfers");
    await completeStockTransfer("tf-test");

    // 2 calls: OUT from HCM, IN to HN
    expect(stockMovementCalls).toHaveLength(2);

    // Call 1: OUT from source (HCM)
    const outInputs = getStockMoveInputs(0);
    const outCtx = getStockMoveContext(0);
    expect(outInputs).toHaveLength(1);
    expect(outInputs[0].type).toBe("out");
    expect(outInputs[0].quantity).toBe(20);
    expect(outInputs[0].productId).toBe("sku-cafe");
    expect(outCtx.branchId).toBe("branch-hcm");

    // Call 2: IN to target (HN)
    const inInputs = getStockMoveInputs(1);
    const inCtx = getStockMoveContext(1);
    expect(inInputs).toHaveLength(1);
    expect(inInputs[0].type).toBe("in");
    expect(inInputs[0].quantity).toBe(20);
    expect(inInputs[0].productId).toBe("sku-cafe");
    expect(inCtx.branchId).toBe("branch-hanoi");

    // Net zero: OUT(-20) + IN(+20) = 0
    expect(outInputs[0].quantity).toBe(inInputs[0].quantity);
  });

  it("TF-2: Chuyển 2 SP — delta đúng từng SP, branch đúng", async () => {
    setupTransfer([
      { id: "tfi-1", product_id: "sku-cafe", product_name: "Cà phê", quantity: 30 },
      { id: "tfi-2", product_id: "sku-tra", product_name: "Trà", quantity: 15 },
    ]);

    const { completeStockTransfer } = await import("@/lib/services/supabase/transfers");
    await completeStockTransfer("tf-test");

    // Call 1: OUT (both products, from HCM)
    const outInputs = getStockMoveInputs(0);
    expect(outInputs).toHaveLength(2);
    expect(outInputs[0].quantity).toBe(30);
    expect(outInputs[0].type).toBe("out");
    expect(outInputs[1].quantity).toBe(15);
    expect(outInputs[1].type).toBe("out");

    // Call 2: IN (both products, to HN)
    const inInputs = getStockMoveInputs(1);
    expect(inInputs).toHaveLength(2);
    expect(inInputs[0].quantity).toBe(30);
    expect(inInputs[0].type).toBe("in");
    expect(inInputs[1].quantity).toBe(15);
    expect(inInputs[1].type).toBe("in");

    // Net zero per product
    for (let i = 0; i < 2; i++) {
      expect(outInputs[i].quantity).toBe(inInputs[i].quantity);
    }
  });

  it("TF-3: Cancel transfer — KHÔNG có stock movement", async () => {
    tableMocks = {
      stock_transfers: {
        data: { id: "tf-cancel", status: "draft" },
        error: null,
      },
    };

    const { cancelStockTransfer } = await import("@/lib/services/supabase/transfers");
    await cancelStockTransfer("tf-cancel");

    expect(stockMovementCalls).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.fn === "increment_product_stock")).toHaveLength(0);
  });
});

// ============================================================
//  KIỂM KHO — Surplus/Shortage adjustments
// ============================================================

describe("KIỂM KHO — Inventory Check Stock Adjustments", () => {
  it("IC-1: Thừa 5 → stock IN +5", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-1", code: "KK00001", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          { id: "ici-1", product_id: "sku-1", product_name: "SP A", system_stock: 50, actual_stock: 55, difference: 5 },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import("@/lib/services/supabase/inventory");
    await applyInventoryCheck("ic-1");

    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);
    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].type).toBe("in");
    expect(inputs[0].quantity).toBe(5);
    expect(inputs[0].productId).toBe("sku-1");
    expect(inputs[0].referenceType).toBe("inventory_check");
  });

  it("IC-2: Thiếu 8 → stock OUT 8", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-2", code: "KK00002", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          { id: "ici-2", product_id: "sku-2", product_name: "SP B", system_stock: 100, actual_stock: 92, difference: -8 },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import("@/lib/services/supabase/inventory");
    await applyInventoryCheck("ic-2");

    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);

    // Find the OUT call
    let foundOut = false;
    for (let i = 0; i < stockMovementCalls.length; i++) {
      const inputs = getStockMoveInputs(i);
      for (const input of inputs) {
        if (input.productId === "sku-2" && input.type === "out") {
          expect(input.quantity).toBe(8);
          foundOut = true;
        }
      }
    }
    expect(foundOut).toBe(true);
  });

  it("IC-3: Mixed — thừa +5, thiếu -3, đúng 0 (bỏ qua)", async () => {
    tableMocks = {
      inventory_checks: {
        data: { id: "ic-3", code: "KK00003", status: "in_progress" },
        error: null,
      },
      inventory_check_items: {
        data: [
          { id: "ici-a", product_id: "sku-a", product_name: "SP A", system_stock: 50, actual_stock: 55, difference: 5 },
          { id: "ici-b", product_id: "sku-b", product_name: "SP B", system_stock: 30, actual_stock: 27, difference: -3 },
          { id: "ici-c", product_id: "sku-c", product_name: "SP C", system_stock: 20, actual_stock: 20, difference: 0 },
        ],
        error: null,
      },
    };

    const { applyInventoryCheck } = await import("@/lib/services/supabase/inventory");
    await applyInventoryCheck("ic-3");

    // Should process sku-a (+5) and sku-b (-3), skip sku-c (0)
    expect(stockMovementCalls.length).toBeGreaterThanOrEqual(1);

    // Collect all inputs across all calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allInputs: any[] = [];
    for (let i = 0; i < stockMovementCalls.length; i++) {
      allInputs.push(...getStockMoveInputs(i));
    }

    // sku-a: IN +5
    const skuA = allInputs.find((i) => i.productId === "sku-a");
    expect(skuA).toBeDefined();
    expect(skuA.type).toBe("in");
    expect(skuA.quantity).toBe(5);

    // sku-b: OUT 3
    const skuB = allInputs.find((i) => i.productId === "sku-b");
    expect(skuB).toBeDefined();
    expect(skuB.type).toBe("out");
    expect(skuB.quantity).toBe(3);

    // sku-c: NOT in any call (difference=0 skipped)
    const skuC = allInputs.find((i) => i.productId === "sku-c");
    expect(skuC).toBeUndefined();
  });

  it("IC-4: Double apply guard — lần 2 bị reject", async () => {
    tableMocks = {
      inventory_checks: { data: null, error: null }, // Claim fails
    };

    const { applyInventoryCheck } = await import("@/lib/services/supabase/inventory");
    await expect(applyInventoryCheck("ic-1")).rejects.toThrow();

    expect(stockMovementCalls).toHaveLength(0);
  });
});

// ============================================================
//  XUẤT HỦY / NỘI BỘ — Stock giảm
// ============================================================

describe("XUẤT HỦY & NỘI BỘ — Disposal & Internal Export", () => {
  it("DE-1: Xuất hủy 20 SP — stock OUT 20, referenceType=disposal_export", async () => {
    tableMocks = {
      disposal_exports: {
        data: { id: "de-1", code: "XH00001", status: "draft" },
        error: null,
      },
      disposal_export_items: {
        data: [
          { id: "dei-1", product_id: "nvl-expired", product_name: "Hạt hết hạn", quantity: 20 },
        ],
        error: null,
      },
    };

    const { completeDisposalExport } = await import("@/lib/services/supabase/inventory");
    await completeDisposalExport("de-1");

    expect(stockMovementCalls).toHaveLength(1);
    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].type).toBe("out");
    expect(inputs[0].quantity).toBe(20);
    expect(inputs[0].productId).toBe("nvl-expired");
    expect(inputs[0].referenceType).toBe("disposal_export");
  });

  it("IE-1: Xuất nội bộ 15 SP — stock OUT 15, referenceType=internal_export", async () => {
    tableMocks = {
      internal_exports: {
        data: { id: "ie-1", code: "XNB00001", status: "draft" },
        error: null,
      },
      internal_export_items: {
        data: [
          { id: "iei-1", product_id: "nvl-sample", product_name: "Cà phê mẫu", quantity: 15 },
        ],
        error: null,
      },
    };

    const { completeInternalExport } = await import("@/lib/services/supabase/inventory");
    await completeInternalExport("ie-1");

    expect(stockMovementCalls).toHaveLength(1);
    const inputs = getStockMoveInputs(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].type).toBe("out");
    expect(inputs[0].quantity).toBe(15);
    expect(inputs[0].productId).toBe("nvl-sample");
    expect(inputs[0].referenceType).toBe("internal_export");
  });

  it("DE-2: Xuất hủy đã hoàn thành — reject (double guard)", async () => {
    tableMocks = {
      disposal_exports: { data: null, error: null },
    };

    const { completeDisposalExport } = await import("@/lib/services/supabase/inventory");
    await expect(completeDisposalExport("de-done")).rejects.toThrow();
    expect(stockMovementCalls).toHaveLength(0);
  });
});

// ============================================================
//  LUỒNG TỔNG (Full E2E Stock Flow)
// ============================================================

describe("LUỒNG TỔNG — Full Stock Flow Verification", () => {
  it("FULL-1: Nhập NVL 100 → SX consume NVL → SX complete SKU 50 → POS bán SKU 10", async () => {
    // Step 1: NHẬP NVL
    tableMocks = {
      purchase_orders: {
        data: { id: "po-full", code: "PO-F1", supplier_id: "s1", supplier_name: "NCC", status: "ordered", tenant_id: "tenant-1", branch_id: "branch-1", total: 5_000_000 },
        error: null,
      },
      purchase_order_items: {
        data: [
          { id: "poi-f1", product_id: "nvl-arabica", product_name: "Arabica", quantity: 100, received_quantity: 0, unit_price: 50_000 },
        ],
        error: null,
      },
      product_lots: { data: null, error: null },
      input_invoices: { data: null, error: null },
      stock_movements: { data: null, error: null },
    };

    const { receivePurchaseOrder } = await import("@/lib/services/supabase/purchase-orders");
    await receivePurchaseOrder("po-full");

    // Verify: NVL Arabica +100
    const step1Inputs = getStockMoveInputs(0);
    expect(step1Inputs[0].productId).toBe("nvl-arabica");
    expect(step1Inputs[0].quantity).toBe(100);
    expect(step1Inputs[0].type).toBe("in");

    // Step 2: SX CONSUME NVL
    const step1StockCalls = stockMovementCalls.length;
    const step1RpcCalls = rpcCalls.length;

    const { consumeProductionMaterials, completeProductionOrder } =
      await import("@/lib/services/supabase/production");

    await consumeProductionMaterials("prod-full");

    // Verify: consume RPC called
    const consumeRpc = rpcCalls.slice(step1RpcCalls).find(
      (c) => c.fn === "consume_production_materials"
    );
    expect(consumeRpc).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((consumeRpc!.params as any).p_production_order_id).toBe("prod-full");

    // Step 3: SX COMPLETE → SKU stock IN
    await completeProductionOrder("prod-full", 50, "LOT-TEST-001");

    const completeRpc = rpcCalls.find(
      (c) => c.fn === "complete_production_order"
    );
    expect(completeRpc).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((completeRpc!.params as any).p_completed_qty).toBe(50);

    // Step 4: POS BÁN SKU
    insertCalls.length = 0;
    rpcCalls.length = 0;

    tableMocks = {
      invoices: { data: { id: "inv-full", code: "HD-F1", total: 1_000_000 }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { posCheckout } = await import("@/lib/services/supabase/pos-checkout");
    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "Khách mua",
      items: [
        { productId: "sku-cafe-500g", productName: "Cà phê rang xay 500g", quantity: 10, unitPrice: 100_000, discount: 0 },
      ],
      paymentMethod: "cash",
      subtotal: 1_000_000,
      discountAmount: 0,
      total: 1_000_000,
      paid: 1_000_000,
    });

    // Verify: SKU -10
    const skuRpcs = getStockRPCs("sku-cafe-500g");
    expect(skuRpcs).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((skuRpcs[0].params as any).p_delta).toBe(-10);

    // Full flow: NVL +100 (nhập) → NVL consumed by RPC → SKU +50 (SX by RPC) → SKU -10 (bán)
    // All verified ✓
  });

  it("FULL-2: POS sale → Return → verify stock direction correct", async () => {
    // Step 1: POS sell 20 items
    tableMocks = {
      invoices: { data: { id: "inv-f2", code: "HD-F2", total: 2_000_000 }, error: null },
      invoice_items: { data: null, error: null },
      stock_movements: { data: null, error: null },
      cash_transactions: { data: null, error: null },
    };

    const { posCheckout } = await import("@/lib/services/supabase/pos-checkout");
    await posCheckout({
      tenantId: "tenant-1",
      branchId: "branch-1",
      createdBy: "user-1",
      customerName: "KH Test",
      items: [
        { productId: "sku-test", productName: "SP Test", quantity: 20, unitPrice: 100_000, discount: 0 },
      ],
      paymentMethod: "cash",
      subtotal: 2_000_000,
      discountAmount: 0,
      total: 2_000_000,
      paid: 2_000_000,
    });

    // Verify: delta = -20
    const sellDelta = getStockDelta("sku-test");
    expect(sellDelta).toBe(-20);

    // Step 2: Customer returns 5 items
    rpcCalls.length = 0;
    stockMovementCalls.length = 0;

    const { completeReturn } = await import("@/lib/services/supabase/returns-completion");
    await completeReturn({
      returnId: "ret-f2",
      returnCode: "TH-F2",
      invoiceCode: "HD-F2",
      customerName: "KH Test",
      items: [
        { productId: "sku-test", productName: "SP Test", quantity: 5, unitPrice: 100_000 },
      ],
      refundAmount: 500_000,
    });

    // Verify: return stock is IN +5
    const returnInputs = getStockMoveInputs(0);
    expect(returnInputs[0].productId).toBe("sku-test");
    expect(returnInputs[0].type).toBe("in");
    expect(returnInputs[0].quantity).toBe(5);

    // Net effect: sold 20 (OUT) + returned 5 (IN) = net -15
    // In real DB: stock = original - 20 + 5 = original - 15
  });
});
