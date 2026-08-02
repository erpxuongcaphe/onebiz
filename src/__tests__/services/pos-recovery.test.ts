import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POS-RECOVERY-1 (CEO 04/05/2026) — Auto-save & idempotency tests.
 *
 * Verify 2 luồng critical chống KiotViet "duplicate invoice" bug:
 *
 * 1. saveDraftOrder upsert by client_session_id:
 *    - Lần đầu (sessionId mới) → INSERT
 *    - Lần kế (sessionId đã có row status='draft') → UPDATE in-place
 *    - Lần kế (sessionId đã có row status='completed') → return existing
 *      (idempotent safety net khi auto-save race với manual submit)
 *
 * 2. posCheckout idempotency check:
 *    - sessionId đã có invoice 'completed' → return existing, KHÔNG insert
 *    - sessionId chưa có → INSERT bình thường
 *    - Race UNIQUE 23505 → catch + retry SELECT, return winner
 */

// ──────────────────────────────────────────────
// Mock infrastructure
// ──────────────────────────────────────────────

interface MockResult {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

interface ChainState {
  table?: string;
  filters: Record<string, unknown>;
  insertedData?: unknown;
  updatedData?: unknown;
  deleted?: boolean;
}

const insertCalls: Array<{ table: string; data: Record<string, unknown> }> = [];
const updateCalls: Array<{ table: string; data: Record<string, unknown>; filters: Record<string, unknown> }> = [];
const deleteCalls: Array<{ table: string; filters: Record<string, unknown> }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

let mockNextCode = "HD-00001";
// Map (filter key for lookup) → resolved data
let mockSelectByFilter: Map<string, MockResult> = new Map();
// Insert default response
let mockInsertResponse: MockResult = { data: { id: "inv-new", code: "HD-00001" }, error: null };
// RPC default response
let mockRpcResponse: Map<string, MockResult> = new Map();

function makeChain(table: string): unknown {
  const state: ChainState = { table, filters: {} };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;

  chain.select = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);

  chain.eq = vi.fn((col: string, val: unknown) => {
    state.filters[col] = val;
    return chain;
  });
  chain.in = vi.fn((col: string, vals: unknown[]) => {
    state.filters[col] = vals;
    return chain;
  });
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  // 00173: soft-delete filter + source guard dùng .is()/.or() → mock trả self.
  chain.is = vi.fn(self);
  chain.or = vi.fn(self);

  // Resolve helper — lookup mockSelectByFilter by filter signature
  function resolve(): MockResult {
    // Try lookup by client_session_id first (recovery test scenario)
    const sid = state.filters["client_session_id"];
    if (sid && typeof sid === "string") {
      const hit = mockSelectByFilter.get(`session:${sid}`);
      if (hit) return hit;
    }
    return { data: null, error: null };
  }

  chain.single = vi.fn(() => resolve());
  chain.maybeSingle = vi.fn(() => resolve());
  chain.then = (cb: (v: MockResult) => void) => cb(resolve());

  chain.insert = vi.fn((data: unknown) => {
    state.insertedData = data;
    if (Array.isArray(data)) {
      data.forEach((d) => insertCalls.push({ table, data: d as Record<string, unknown> }));
    } else {
      insertCalls.push({ table, data: data as Record<string, unknown> });
    }
    // Allow chain.insert(...).select(...).single() pattern
    chain.select = vi.fn(() => ({
      single: vi.fn(() => mockInsertResponse),
      maybeSingle: vi.fn(() => mockInsertResponse),
    }));
    return chain;
  });

  chain.update = vi.fn((data: unknown) => {
    state.updatedData = data;
    return chain;
  });

  chain.delete = vi.fn(() => {
    state.deleted = true;
    return chain;
  });

  // Override select to handle .single() / .maybeSingle() after update
  // (UPDATE ... SELECT ... single pattern)
  const originalUpdate = chain.update;
  chain.update = vi.fn((data: unknown) => {
    state.updatedData = data;
    updateCalls.push({ table, data: data as Record<string, unknown>, filters: { ...state.filters } });
    // Support .update(...).eq(...).eq(...).select(...).single()/maybeSingle()
    chain.select = vi.fn(() => ({
      single: vi.fn(() => ({
        data: { id: state.filters["id"] ?? "inv-existing", code: "HD-EXISTING" },
        error: null,
      })),
      maybeSingle: vi.fn(() => ({
        data: { id: state.filters["id"] ?? "inv-existing", code: "HD-EXISTING" },
        error: null,
      })),
    }));
    return chain;
  });
  void originalUpdate;

  // Track delete with filters
  const originalDelete = chain.delete;
  chain.delete = vi.fn(() => {
    state.deleted = true;
    deleteCalls.push({ table, filters: { ...state.filters } });
    return chain;
  });
  void originalDelete;

  return chain;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => makeChain(table)),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "next_code") {
        return { data: mockNextCode, error: null };
      }
      const hit = mockRpcResponse.get(fn);
      if (hit) return hit;
      if (fn === "adopt_pos_draft_session_atomic_v2") {
        return { data: { invoice_id: "inv-draft", invoice_code: "NH-00001", revision: 3 }, error: null };
      }
      if (fn === "soft_delete_pos_draft_atomic") {
        return { data: { invoice_id: "inv-draft", deleted: true }, error: null };
      }
      if (fn === "save_pos_draft_atomic_v3") {
        return {
          data: { invoice_id: "inv-draft", invoice_code: "NH-00001", status: "draft", revision: 1 },
          error: null,
        };
      }
      if (fn === "pos_complete_checkout_atomic_v3") {
        const data = mockInsertResponse.data as Record<string, unknown> | undefined;
        return {
          data: {
            invoice_id: data?.id ?? "inv-new",
            invoice_code: data?.code ?? "HD-00001",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  }),
  getCurrentTenantId: () => Promise.resolve("tenant-1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  rpcCalls.length = 0;
  mockNextCode = "HD-00001";
  mockSelectByFilter = new Map();
  mockInsertResponse = { data: { id: "inv-new", code: "HD-00001" }, error: null };
  mockRpcResponse = new Map();
});

// ──────────────────────────────────────────────
// Imports under test
// ──────────────────────────────────────────────

import { adoptDraftSession, deleteDraftOrder, saveDraftOrder } from "@/lib/services/supabase/orders";
import { posCheckout } from "@/lib/services/supabase/pos-checkout";

const baseInput = {
  tenantId: "tenant-1",
  branchId: "branch-1",
  createdBy: "user-1",
  customerId: null,
  customerName: "Khách lẻ",
  items: [
    {
      productId: "p1",
      productName: "Cà phê",
      unit: "gói",
      quantity: 2,
      unitPrice: 145000,
      discount: 0,
    },
  ],
  paymentMethod: "cash" as const,
  subtotal: 290000,
  discountAmount: 0,
  orderDiscountAmount: 0,
  shippingFee: 0,
  orderVatRate: 0,
  total: 290000,
  paid: 0,
};

// ══════════════════════════════════════════════
// Test 1: saveDraftOrder upsert flow
// ══════════════════════════════════════════════

const draftMigration = readFileSync(
  "supabase/migrations/00264_atomic_pos_draft_save.sql",
  "utf8",
);
const draftTotalsMigration = readFileSync(
  "supabase/migrations/00291_harden_pos_draft_totals.sql",
  "utf8",
);
const draftRevisionMigration = readFileSync(
  "supabase/migrations/00292_pos_draft_revision_guard.sql",
  "utf8",
);

describe("saveDraftOrder — atomic by client_session_id", () => {
  it("sends the full draft to one server transaction", async () => {
    const result = await saveDraftOrder(baseInput, {
      sessionId: "31e9d753-0c76-45af-a509-d4dce67c042f",
      autoSaved: true,
    });

    expect(result).toEqual({
      invoiceId: "inv-draft",
      invoiceCode: "NH-00001",
      revision: 1,
      status: "draft",
    });
    const call = rpcCalls.find((entry) => entry.fn === "save_pos_draft_atomic_v3");
    expect(call?.args).toMatchObject({
      p_branch_id: "branch-1",
      p_client_session_id: "31e9d753-0c76-45af-a509-d4dce67c042f",
      p_auto_saved: true,
      p_items: baseInput.items,
      p_order_discount: 0,
      p_shipping_fee: 0,
      p_order_vat_rate: 0,
      p_invoice_id: null,
      p_expected_revision: null,
    });
    expect(call?.args).not.toHaveProperty("p_tenant_id");
    expect(call?.args).not.toHaveProperty("p_created_by");
    expect(insertCalls.find((entry) => entry.table === "invoices")).toBeUndefined();
    expect(deleteCalls.find((entry) => entry.table === "invoice_items")).toBeUndefined();
  });

  it("fails closed when the draft transaction fails", async () => {
    mockRpcResponse.set("save_pos_draft_atomic_v3", {
      data: null,
      error: { message: "POS_DRAFT_ITEM_INVALID" },
    });

    await expect(saveDraftOrder(baseInput, { sessionId: "31e9d753-0c76-45af-a509-d4dce67c042f" })).rejects.toThrow("POS_DRAFT_ITEM_INVALID");
  });

  it("derives draft header totals from the same item snapshot on the server", () => {
    expect(draftTotalsMigration).toContain("v_subtotal := v_subtotal + v_quantity * v_unit_price");
    expect(draftTotalsMigration).toContain("v_line_discount_total + v_order_discount");
    expect(draftTotalsMigration).toContain("v_total := greatest");
    expect(draftTotalsMigration).toContain("return public.save_pos_draft_atomic");
  });

  it("locks the session and validates permission, branch and products in SQL", () => {
    expect(draftMigration).toContain("pg_advisory_xact_lock");
    expect(draftMigration).toContain("pos_retail.save_draft");
    expect(draftMigration).toContain("user_has_branch_access");
    expect(draftMigration).toContain("POS_PRODUCT_INVALID");
    expect(draftMigration).toContain("delete from public.invoice_items");
  });

  it("adopts and soft-deletes drafts only through guarded RPCs", async () => {
    const sessionId = "31e9d753-0c76-45af-a509-d4dce67c042f";
    await expect(adoptDraftSession("inv-draft", sessionId, 2)).resolves.toBe(3);
    await deleteDraftOrder("inv-draft", { onlyAutoSaved: true });

    expect(rpcCalls).toContainEqual({
      fn: "adopt_pos_draft_session_atomic_v2",
      args: {
        p_invoice_id: "inv-draft",
        p_client_session_id: sessionId,
        p_expected_revision: 2,
      },
    });
    expect(rpcCalls).toContainEqual({
      fn: "soft_delete_pos_draft_atomic",
      args: { p_invoice_id: "inv-draft", p_only_auto_saved: true },
    });
    expect(draftMigration).toContain("coalesce(v_invoice.source, 'pos') = 'order'");
    expect(draftRevisionMigration).toContain("POS_DRAFT_CONFLICT");
    expect(draftRevisionMigration).toContain("draft_revision = draft_revision + 1");
  });
});

describe("posCheckout — idempotency by client_session_id", () => {
  it("Return existing khi sessionId đã có invoice 'completed'", async () => {
    mockRpcResponse.set("pos_complete_checkout_atomic_v3", {
      data: {
        invoice_id: "inv-already",
        invoice_code: "HD-ALREADY",
        idempotent: true,
      },
      error: null,
    });

    const result = await posCheckout({
      ...baseInput,
      paid: 290000,
      clientSessionId: "sid-dup",
    });

    expect(result.invoiceId).toBe("inv-already");
    expect(result.invoiceCode).toBe("HD-ALREADY");
    // KHÔNG insert invoice mới (idempotent)
    const invoiceInsert = insertCalls.find((c) => c.table === "invoices");
    expect(invoiceInsert).toBeUndefined();
    expect(rpcCalls.find((c) => c.fn === "pos_complete_checkout_atomic_v3")).toBeDefined();
  });

  it("Throw khi sessionId đã có invoice 'draft' (chưa hoàn tất)", async () => {
    mockRpcResponse.set("pos_complete_checkout_atomic_v3", {
      data: null,
      error: { message: "Invoice HD-DRAFT đang ở trạng thái nháp; Tiếp tục đơn" },
    });

    // Phải throw — cashier chuyển hướng dùng completeDraftOrder thay vì
    // posCheckout (tránh tạo invoice mới song song với draft).
    await expect(
      posCheckout({
        ...baseInput,
        paid: 290000,
        clientSessionId: "sid-still-draft",
      }),
    ).rejects.toThrow(/đang ở trạng thái nháp|Tiếp tục đơn/i);
  });

  it("INSERT bình thường khi sessionId chưa có invoice", async () => {
    mockInsertResponse = {
      data: { id: "inv-fresh-checkout", code: "HD-00010" },
      error: null,
    };

    const result = await posCheckout({
      ...baseInput,
      paid: 290000,
      clientSessionId: "sid-fresh",
    });

    expect(result.invoiceId).toBe("inv-fresh-checkout");
    expect(result.invoiceCode).toBe("HD-00010");
    const checkoutRpc = rpcCalls.find((c) => c.fn === "pos_complete_checkout_atomic_v3");
    expect(checkoutRpc?.args).toMatchObject({
      p_client_session_id: "sid-fresh",
    });
    expect(checkoutRpc?.args).not.toHaveProperty("p_total");
    expect(insertCalls.find((c) => c.table === "invoices")).toBeUndefined();
  });

  it("INSERT bình thường khi không truyền sessionId (backward compat)", async () => {
    mockInsertResponse = {
      data: { id: "inv-legacy", code: "HD-00020" },
      error: null,
    };

    const result = await posCheckout({
      ...baseInput,
      paid: 290000,
    });

    expect(result.invoiceId).toBe("inv-legacy");
    // RPC find không được gọi
    expect(rpcCalls.find((c) => c.fn === "find_invoice_by_session_id")).toBeUndefined();
    const checkoutRpc = rpcCalls.find((c) => c.fn === "pos_complete_checkout_atomic_v3");
    expect(checkoutRpc?.args).toMatchObject({
      p_client_session_id: null,
    });
    expect(checkoutRpc?.args).not.toHaveProperty("p_total");
    expect(insertCalls.find((c) => c.table === "invoices")).toBeUndefined();
  });
});

