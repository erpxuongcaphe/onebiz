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

import { saveDraftOrder } from "@/lib/services/supabase/orders";
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
  total: 290000,
  paid: 0,
};

// ══════════════════════════════════════════════
// Test 1: saveDraftOrder upsert flow
// ══════════════════════════════════════════════

describe("saveDraftOrder — upsert by client_session_id", () => {
  it("INSERT khi sessionId mới (chưa có row trong DB)", async () => {
    // Mock: SELECT by session_id trả null (chưa có)
    mockSelectByFilter.set("session:sid-new", { data: null, error: null });
    mockInsertResponse = {
      data: { id: "inv-fresh", code: "HD-00001" },
      error: null,
    };

    const result = await saveDraftOrder(baseInput, {
      sessionId: "sid-new",
      autoSaved: true,
    });

    expect(result.invoiceId).toBe("inv-fresh");
    expect(result.invoiceCode).toBe("HD-00001");
    // Đã INSERT vào invoices
    const invoiceInsert = insertCalls.find((c) => c.table === "invoices");
    expect(invoiceInsert).toBeDefined();
    // Có client_session_id + auto_saved trong payload
    expect(invoiceInsert?.data).toMatchObject({
      client_session_id: "sid-new",
      auto_saved: true,
      status: "draft",
    });
    // Không có UPDATE
    const invoiceUpdate = updateCalls.find((c) => c.table === "invoices");
    expect(invoiceUpdate).toBeUndefined();
  });

  it("UPDATE khi sessionId đã có row status='draft'", async () => {
    // Mock: SELECT trả existing draft
    mockSelectByFilter.set("session:sid-existing", {
      data: { id: "inv-old", code: "HD-EXISTING", status: "draft" },
      error: null,
    });

    const result = await saveDraftOrder(baseInput, {
      sessionId: "sid-existing",
      autoSaved: true,
    });

    expect(result.invoiceId).toBe("inv-old");
    // Phải UPDATE invoices, không INSERT
    const invoiceUpdate = updateCalls.find((c) => c.table === "invoices");
    expect(invoiceUpdate).toBeDefined();
    expect(invoiceUpdate?.data).toMatchObject({
      auto_saved: true,
    });
    // Không có invoice INSERT mới
    const invoiceInsert = insertCalls.find((c) => c.table === "invoices");
    expect(invoiceInsert).toBeUndefined();
    // Items: DELETE cũ + INSERT mới
    expect(deleteCalls.find((c) => c.table === "invoice_items")).toBeDefined();
    expect(insertCalls.find((c) => c.table === "invoice_items")).toBeDefined();
  });

  it("Idempotent — return existing khi sessionId có row đã 'completed'", async () => {
    // Race case: auto-save chậm hơn manual submit. Sau khi user ấn Thanh
    // toán, invoice đã flip 'completed'. Auto-save lần kế phải KHÔNG update,
    // chỉ return existing để client cleanup gracefully.
    mockSelectByFilter.set("session:sid-completed", {
      data: { id: "inv-paid", code: "HD-PAID", status: "completed" },
      error: null,
    });

    const result = await saveDraftOrder(baseInput, {
      sessionId: "sid-completed",
      autoSaved: true,
    });

    expect(result.invoiceId).toBe("inv-paid");
    expect(result.invoiceCode).toBe("HD-PAID");
    // KHÔNG insert, KHÔNG update — pure idempotent return
    expect(insertCalls.find((c) => c.table === "invoices")).toBeUndefined();
    expect(updateCalls.find((c) => c.table === "invoices")).toBeUndefined();
  });

  it("INSERT bình thường khi không truyền sessionId (backward compat F9 cũ)", async () => {
    // Không pass sessionId → behavior cũ, INSERT mỗi lần
    mockInsertResponse = {
      data: { id: "inv-no-session", code: "HD-00099" },
      error: null,
    };

    const result = await saveDraftOrder(baseInput);

    expect(result.invoiceId).toBe("inv-no-session");
    const invoiceInsert = insertCalls.find((c) => c.table === "invoices");
    expect(invoiceInsert).toBeDefined();
    // client_session_id = null + auto_saved = false default
    expect(invoiceInsert?.data).toMatchObject({
      client_session_id: null,
      auto_saved: false,
    });
  });
});

// ══════════════════════════════════════════════
// Test 2: posCheckout idempotency
// ══════════════════════════════════════════════

describe("posCheckout — idempotency by client_session_id", () => {
  it("Return existing khi sessionId đã có invoice 'completed'", async () => {
    // Mô phỏng: cashier ấn Thanh toán 2 lần. Lần 1 thành công, tạo invoice
    // 'completed'. Lần 2 vào posCheckout với cùng sessionId → check qua RPC
    // find_invoice_by_session_id → trả existing → return ngay, KHÔNG insert.
    mockRpcResponse.set("find_invoice_by_session_id", {
      data: [
        {
          id: "inv-already",
          code: "HD-ALREADY",
          status: "completed",
          total: 290000,
          paid: 290000,
        },
      ],
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
    // RPC find_invoice_by_session_id đã được gọi
    expect(rpcCalls.find((c) => c.fn === "find_invoice_by_session_id")).toBeDefined();
  });

  it("Throw khi sessionId đã có invoice 'draft' (chưa hoàn tất)", async () => {
    mockRpcResponse.set("find_invoice_by_session_id", {
      data: [
        {
          id: "inv-draft",
          code: "HD-DRAFT",
          status: "draft",
          total: 290000,
          paid: 0,
        },
      ],
      error: null,
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
    // sessionId mới — RPC trả mảng rỗng → POSTcontinue insert
    mockRpcResponse.set("find_invoice_by_session_id", {
      data: [],
      error: null,
    });
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
    // Có insert invoice mới với client_session_id
    const invoiceInsert = insertCalls.find((c) => c.table === "invoices");
    expect(invoiceInsert).toBeDefined();
    expect(invoiceInsert?.data).toMatchObject({
      client_session_id: "sid-fresh",
      status: "completed",
    });
  });

  it("INSERT bình thường khi không truyền sessionId (backward compat)", async () => {
    // Không pass clientSessionId → KHÔNG check RPC, INSERT thẳng
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
    // client_session_id = null trong payload
    const invoiceInsert = insertCalls.find((c) => c.table === "invoices");
    expect(invoiceInsert?.data).toMatchObject({
      client_session_id: null,
    });
  });
});
