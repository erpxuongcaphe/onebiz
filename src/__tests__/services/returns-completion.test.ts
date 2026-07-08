import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock stock-adjustments ──
const mockApplyManualStockMovement = vi.fn().mockResolvedValue(undefined);
const mockNextEntityCode = vi.fn().mockResolvedValue("PC000001");

vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: (...args: unknown[]) => mockApplyManualStockMovement(...args),
  nextEntityCode: (...args: unknown[]) => mockNextEntityCode(...args),
}));

// ── Mock base (chainable query builder + rpc) ──
// BATCH 3R: completeReturn nay gọi thêm:
//   - from("products").select().eq().in()  → map has_bom
//   - rpc("restore_bom_for_return", …)      → hồi NVL cho SKU has_bom
//   - rpc("increment_returned_qty", …)      → cộng dồn returned_qty
//   - from("cash_transactions").insert()    → phiếu chi hoàn tiền
// Mock cũ chỉ có insert → vỡ. Mock mới mô phỏng đủ chain.

// Kết quả products (has_bom + inventory_role map) — set per test.
// A2 08/07 (Cách B): thêm inventory_role để test tách MÓN MENU F&B khỏi Retail.
let productsResult: {
  data: Array<{ id: string; has_bom: boolean; inventory_role?: string | null }>;
  error: unknown;
} = {
  data: [],
  error: null,
};
// Lỗi insert cash — set per test.
let cashInsertError: unknown = null;
// RPC handlers — set per test (mặc định thành công).
const mockRestoreBom = vi.fn(
  async (
    _args?: unknown,
  ): Promise<{ data: { bom_found: boolean; restored: unknown[] } | null; error: unknown }> => ({
    data: { bom_found: true, restored: [] },
    error: null,
  }),
);
const mockIncReturnedQty = vi.fn(
  async (_args?: unknown): Promise<{ error: unknown }> => ({ error: null }),
);

function makeChain(result: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    // thenable → await chain trả result
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return chain;
}

const mockFrom = vi.fn((table: string) => {
  if (table === "products") return makeChain(productsResult);
  if (table === "cash_transactions") return makeChain({ error: cashInsertError });
  return makeChain({ data: [], error: null });
});

const mockRpc = vi.fn((name: string, args: unknown) => {
  if (name === "restore_bom_for_return") return mockRestoreBom(args);
  if (name === "increment_returned_qty") return mockIncReturnedQty(args);
  return Promise.resolve({ data: null, error: null });
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-1",
    branchId: "branch-1",
    userId: "user-1",
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import { completeReturn } from "@/lib/services/supabase/returns-completion";

const sampleInput = {
  returnId: "ret-1",
  returnCode: "TH000001",
  invoiceCode: "HD000001",
  customerName: "Nguyễn Văn A",
  items: [
    { productId: "prod-1", productName: "Sản phẩm A", quantity: 2, unitPrice: 50000 },
    { productId: "prod-2", productName: "Sản phẩm B", quantity: 1, unitPrice: 100000 },
  ],
  refundAmount: 200000,
};

describe("completeReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productsResult = { data: [], error: null }; // mặc định: không SKU nào has_bom
    cashInsertError = null;
    mockRestoreBom.mockResolvedValue({ data: { bom_found: true, restored: [] }, error: null });
    mockIncReturnedQty.mockResolvedValue({ error: null });
  });

  // ── SKU thường (has_bom=false) → cộng tồn SKU như cũ ──
  it("cộng tồn type 'in' cho SKU thường (không has_bom)", async () => {
    await completeReturn(sampleInput);

    expect(mockApplyManualStockMovement).toHaveBeenCalledTimes(1);
    const stockInputs = mockApplyManualStockMovement.mock.calls[0][0];
    expect(stockInputs).toHaveLength(2);
    expect(stockInputs[0]).toMatchObject({
      productId: "prod-1", quantity: 2, type: "in",
      referenceType: "sales_return", referenceId: "ret-1",
    });
    expect(stockInputs[1]).toMatchObject({ productId: "prod-2", quantity: 1, type: "in" });
    // KHÔNG gọi restore_bom cho SKU thường
    expect(mockRestoreBom).not.toHaveBeenCalled();
  });

  // ── SKU has_bom → hồi NVL qua RPC, KHÔNG cộng tồn ảo SKU ──
  it("SKU has_bom → gọi restore_bom_for_return, KHÔNG cộng tồn SKU", async () => {
    productsResult = {
      data: [{ id: "prod-1", has_bom: true }, { id: "prod-2", has_bom: false }],
      error: null,
    };

    await completeReturn(sampleInput);

    // prod-1 (has_bom) → restore_bom RPC với đúng qty
    expect(mockRestoreBom).toHaveBeenCalledTimes(1);
    expect(mockRestoreBom).toHaveBeenCalledWith(
      expect.objectContaining({ p_sku_id: "prod-1", p_qty: 2, p_reference_id: "ret-1" }),
    );
    // prod-2 (thường) → cộng tồn SKU; prod-1 KHÔNG có trong normalStockInputs
    const stockInputs = mockApplyManualStockMovement.mock.calls[0][0];
    expect(stockInputs).toHaveLength(1);
    expect(stockInputs[0].productId).toBe("prod-2");
  });

  // ── has_bom nhưng chưa setup BOM (bom_found=false) → fallback cộng tồn SKU ──
  // (Retail 2-mã: inventory_role='retail_stock_item' → CÓ giữ tồn → fallback đúng.)
  it("has_bom + bom_found=false → fallback cộng tồn SKU (không mất hàng)", async () => {
    productsResult = {
      data: [{ id: "prod-1", has_bom: true, inventory_role: "retail_stock_item" }],
      error: null,
    };
    mockRestoreBom.mockResolvedValue({ data: { bom_found: false, restored: [] }, error: null });
    const oneItem = { ...sampleInput, items: [sampleInput.items[0]] };

    await completeReturn(oneItem);

    expect(mockRestoreBom).toHaveBeenCalledTimes(1);
    const stockInputs = mockApplyManualStockMovement.mock.calls[0][0];
    expect(stockInputs).toHaveLength(1);
    expect(stockInputs[0]).toMatchObject({ productId: "prod-1", quantity: 2, type: "in" });
  });

  // ── Cách B: MÓN MENU F&B (fnb_menu_item) → hồi thành phần theo công thức,
  //    KHÔNG BAO GIỜ cộng tồn mã món (kể cả bom_found=false). ──
  it("MÓN MENU F&B + bom_found=false → KHÔNG cộng tồn ảo mã món", async () => {
    productsResult = {
      data: [{ id: "prod-1", has_bom: true, inventory_role: "fnb_menu_item" }],
      error: null,
    };
    // Món chưa gắn công thức tại chi nhánh → RPC báo bom_found=false.
    mockRestoreBom.mockResolvedValue({ data: { bom_found: false, restored: [] }, error: null });
    const oneItem = { ...sampleInput, items: [sampleInput.items[0]] };

    await completeReturn(oneItem);

    // Vẫn gọi restore_bom (thử hồi thành phần)...
    expect(mockRestoreBom).toHaveBeenCalledTimes(1);
    expect(mockRestoreBom).toHaveBeenCalledWith(
      expect.objectContaining({ p_sku_id: "prod-1", p_qty: 2 }),
    );
    // ...nhưng bom_found=false → TUYỆT ĐỐI không đẩy vào normalStockInputs.
    // normalStockInputs rỗng → applyManualStockMovement KHÔNG được gọi.
    expect(mockApplyManualStockMovement).not.toHaveBeenCalled();
  });

  it("MÓN MENU F&B + bom_found=true → hồi thành phần, KHÔNG cộng tồn mã món", async () => {
    productsResult = {
      data: [{ id: "prod-1", has_bom: true, inventory_role: "fnb_menu_item" }],
      error: null,
    };
    mockRestoreBom.mockResolvedValue({ data: { bom_found: true, restored: [] }, error: null });
    const oneItem = { ...sampleInput, items: [sampleInput.items[0]] };

    await completeReturn(oneItem);

    expect(mockRestoreBom).toHaveBeenCalledTimes(1);
    // Mã món menu không bao giờ giữ tồn → không cộng tồn SKU.
    expect(mockApplyManualStockMovement).not.toHaveBeenCalled();
  });

  // ── Hỗn hợp: 1 món menu F&B (bom_found=false) + 1 SKU Retail thường trong cùng
  //    phiếu trả → chỉ SKU Retail cộng tồn; món menu tuyệt đối không lọt vào. ──
  it("hỗn hợp menu F&B + SKU thường → chỉ SKU thường cộng tồn", async () => {
    productsResult = {
      data: [
        { id: "prod-1", has_bom: true, inventory_role: "fnb_menu_item" },
        { id: "prod-2", has_bom: false, inventory_role: "retail_stock_item" },
      ],
      error: null,
    };
    mockRestoreBom.mockResolvedValue({ data: { bom_found: false, restored: [] }, error: null });

    await completeReturn(sampleInput); // prod-1 + prod-2

    // Chỉ prod-2 (SKU thường) vào normalStockInputs; prod-1 (menu) bị loại.
    expect(mockApplyManualStockMovement).toHaveBeenCalledTimes(1);
    const stockInputs = mockApplyManualStockMovement.mock.calls[0][0];
    expect(stockInputs).toHaveLength(1);
    expect(stockInputs[0].productId).toBe("prod-2");
    // Không có bất kỳ input type='in' nào cho mã món prod-1.
    expect(
      stockInputs.some((s: { productId: string }) => s.productId === "prod-1"),
    ).toBe(false);
  });

  // ── Over-refund guard: increment_returned_qty per item có invoiceItemId ──
  it("gọi increment_returned_qty cho mỗi item có invoiceItemId", async () => {
    const withIds = {
      ...sampleInput,
      items: [
        { ...sampleInput.items[0], invoiceItemId: "ii-1" },
        { ...sampleInput.items[1], invoiceItemId: "ii-2" },
      ],
    };

    await completeReturn(withIds);

    expect(mockIncReturnedQty).toHaveBeenCalledTimes(2);
    expect(mockIncReturnedQty).toHaveBeenCalledWith(
      expect.objectContaining({ p_invoice_item_id: "ii-1", p_delta: 2 }),
    );
    expect(mockIncReturnedQty).toHaveBeenCalledWith(
      expect.objectContaining({ p_invoice_item_id: "ii-2", p_delta: 1 }),
    );
  });

  it("bỏ qua increment_returned_qty khi item thiếu invoiceItemId", async () => {
    await completeReturn(sampleInput); // items không có invoiceItemId
    expect(mockIncReturnedQty).not.toHaveBeenCalled();
  });

  it("increment_returned_qty lỗi KHÔNG block luồng (best-effort)", async () => {
    mockIncReturnedQty.mockResolvedValue({ error: { message: "rpc missing" } });
    const withIds = { ...sampleInput, items: [{ ...sampleInput.items[0], invoiceItemId: "ii-1" }] };
    // không throw
    await expect(completeReturn(withIds)).resolves.toBeUndefined();
  });

  // ── Cash refund ──
  it("tạo phiếu chi hoàn tiền với đúng category", async () => {
    await completeReturn(sampleInput);
    expect(mockFrom).toHaveBeenCalledWith("cash_transactions");
    expect(mockNextEntityCode).toHaveBeenCalledWith("cash_payment", { tenantId: "tenant-1" });
  });

  it("bỏ qua phiếu chi khi refundAmount = 0", async () => {
    await completeReturn({ ...sampleInput, refundAmount: 0 });
    expect(mockApplyManualStockMovement).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalledWith("cash_transactions");
  });

  it("throw khi insert cash lỗi", async () => {
    cashInsertError = { message: "insert failed" };
    await expect(completeReturn(sampleInput)).rejects.toThrow("insert failed");
  });
});
