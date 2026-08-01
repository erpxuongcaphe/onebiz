import { describe, it, expect, vi, beforeEach } from "vitest";

// === Mock data ===

const TENANT_ID = "tenant-001";
const USER_ID = "user-001";
const FROM_BRANCH = "branch-factory";
const TO_BRANCH = "branch-store";

const mockInternalCustomer = {
  id: "int-cust-01",
  name: "NB: Quán 1",
};
const mockInternalSupplier = {
  id: "int-supp-01",
  name: "NB: Xưởng Rang",
};

let codeCounter = 0;
let stockOutRpcCalls: Array<{ productId: string; quantity: number; branchId: string }> = [];
let internalSaleRpcCalls: Array<Record<string, unknown>> = [];
let internalSaleRpcError: { message: string; code?: string } | null = null;
let cancelRpcCalls: Array<Record<string, unknown>> = [];
let cancelRpcError: { message: string; code?: string } | null = null;

// === Chain mock builder ===

function createChain(resolvedValue: unknown = { data: [], error: null }) {
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.not = vi.fn(self);
  chain.in = vi.fn(self);
  chain.or = vi.fn(self);
  chain.ilike = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.order = vi.fn(self);
  chain.range = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.insert = vi.fn((rows: unknown) => {
    // Track inserts
    return createChain({ data: Array.isArray(rows) ? rows[0] : rows, error: null });
  });
  chain.update = vi.fn(() => createChain({ data: null, error: null }));
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  return chain;
}

// Table-specific mock data
let tableHandlers: Record<string, (chain: any) => any> = {};

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      if (tableHandlers[table]) {
        return tableHandlers[table](createChain());
      }
      return createChain({ data: [], error: null });
    }),
    rpc: vi.fn((funcName: string, params?: any) => {
      if (funcName === "create_internal_sale_atomic") {
        internalSaleRpcCalls.push(params ?? {});
        if (internalSaleRpcError) {
          return Promise.resolve({ data: null, error: internalSaleRpcError });
        }
        return Promise.resolve({
          data: {
            internal_sale_id: "is-001",
            code: "BNB-001",
            invoice_id: "inv-001",
            invoice_code: "HD-001",
            input_invoice_id: "iinv-001",
            input_invoice_code: "HDV-001",
            total: 2_430_000,
          },
          error: null,
        });
      }
      if (funcName === "cancel_internal_sale_atomic") {
        cancelRpcCalls.push(params ?? {});
        if (cancelRpcError) {
          return Promise.resolve({ data: null, error: cancelRpcError });
        }
        return Promise.resolve({
          data: {
            id: params?.p_internal_sale_id,
            status: "cancelled",
            idempotent: true,
          },
          error: null,
        });
      }
      if (funcName === "next_code") {
        codeCounter++;
        return Promise.resolve({ data: `CODE-${codeCounter}`, error: null });
      }
      if (funcName === "seed_internal_entities") {
        return Promise.resolve({ data: null, error: null });
      }
      if (funcName === "increment_product_stock") {
        return Promise.resolve({ data: null, error: null });
      }
      if (funcName === "upsert_branch_stock") {
        return Promise.resolve({ data: null, error: null });
      }
      if (funcName === "internal_sale_apply_stock_out") {
        stockOutRpcCalls.push({
          productId: params?.p_product_id,
          quantity: params?.p_quantity,
          branchId: params?.p_branch_id,
        });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({
      tenantId: TENANT_ID,
      branchId: FROM_BRANCH,
      userId: USER_ID,
    }),
  ),
  getCurrentTenantId: () => Promise.resolve(TENANT_ID),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));


import {
  createInternalSale,
  getInternalSales,
  cancelInternalSale,
} from "@/lib/services/supabase/internal-sales";

beforeEach(() => {
  codeCounter = 0;
  stockOutRpcCalls = [];
  internalSaleRpcCalls = [];
  internalSaleRpcError = null;
  vi.clearAllMocks();

  // Setup table handlers
  cancelRpcCalls = [];
  cancelRpcError = null;
  tableHandlers = {
    customers: (() => {
      const chain = createChain({ data: mockInternalCustomer, error: null });
      return () => chain;
    })(),
    suppliers: (() => {
      const chain = createChain({ data: mockInternalSupplier, error: null });
      return () => chain;
    })(),
    invoices: (() => {
      const chain = createChain({
        data: { id: "inv-001", code: "HD-001" },
        error: null,
      });
      return () => chain;
    })(),
    invoice_items: (() => {
      return () => createChain({ data: null, error: null });
    })(),
    input_invoices: (() => {
      return () =>
        createChain({
          data: { id: "iinv-001", code: "HDV-001" },
          error: null,
        });
    })(),
    cash_transactions: (() => {
      return () => createChain({ data: null, error: null });
    })(),
    internal_sales: (() => {
      return () => createChain({ data: { id: "is-001" }, error: null });
    })(),
    internal_sale_items: (() => {
      return () => createChain({ data: null, error: null });
    })(),
  };
});

describe("createInternalSale", () => {
  const validInput = {
    fromBranchId: FROM_BRANCH,
    toBranchId: TO_BRANCH,
    items: [
      {
        productId: "prod-001",
        productCode: "SP001",
        productName: "Cà phê rang xay",
        unit: "kg",
        quantity: 10,
        unitPrice: 200_000,
        vatRate: 8,
      },
      {
        productId: "prod-002",
        productCode: "SP002",
        productName: "Đường",
        unit: "kg",
        quantity: 5,
        unitPrice: 50_000,
        vatRate: 8,
      },
    ],
    paymentMethod: "transfer" as const,
    note: "Xuất hàng cho quán tháng 4",
  };

  it("rejects same branch for seller and buyer", async () => {
    await expect(
      createInternalSale({
        ...validInput,
        fromBranchId: FROM_BRANCH,
        toBranchId: FROM_BRANCH,
      }),
    ).rejects.toThrow("Chi nhánh bán và chi nhánh mua không được giống nhau");
  });

  it("rejects empty items", async () => {
    await expect(
      createInternalSale({
        ...validInput,
        items: [],
      }),
    ).rejects.toThrow("Cần ít nhất 1 sản phẩm");
  });

  it("calculates totals correctly", async () => {
    const result = await createInternalSale(validInput);

    // Line 1: 10 * 200k = 2M, tax = 2M * 8% = 160k
    // Line 2: 5 * 50k = 250k, tax = 250k * 8% = 20k
    // Subtotal = 2.25M, Tax = 180k, Total = 2.43M
    expect(result.total).toBe(2_250_000 + 180_000);
  });

  it("chỉ dùng một RPC nguyên tử cho toàn bộ chứng từ, tồn và sổ quỹ", async () => {
    const result = await createInternalSale(validInput);

    expect(internalSaleRpcCalls).toHaveLength(1);
    expect(internalSaleRpcCalls[0]).toEqual(
      expect.objectContaining({
        p_tenant_id: TENANT_ID,
        p_from_branch_id: FROM_BRANCH,
        p_to_branch_id: TO_BRANCH,
        p_created_by: USER_ID,
        p_items: validInput.items,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        internalSaleId: "is-001",
        code: "BNB-001",
        invoiceId: "inv-001",
        total: 2_430_000,
      }),
    );
  });

  it("dừng an toàn khi RPC lỗi, không chạy lại luồng nhiều bước", async () => {
    internalSaleRpcError = {
      message: "create_internal_sale_atomic failed",
      code: "P0001",
    };

    await expect(createInternalSale(validInput)).rejects.toThrow(
      "createInternalSale:atomic_rpc",
    );
    expect(internalSaleRpcCalls).toHaveLength(1);
    expect(stockOutRpcCalls).toHaveLength(0);
  });

  it("returns result with total matching calculation", async () => {
    const result = await createInternalSale(validInput);

    expect(result.total).toBe(2_430_000);
    expect(typeof result.code).toBe("string");
  });

});

describe("getInternalSales", () => {
  it("returns paginated list", async () => {
    // Override handler for listing
    tableHandlers.internal_sales = () =>
      createChain({
        data: [
          {
            id: "is-001",
            code: "BNB-001",
            from_branch_id: FROM_BRANCH,
            to_branch_id: TO_BRANCH,
            from_branch: { name: "Xưởng Rang" },
            to_branch: { name: "Quán 1" },
            creator: { full_name: "Admin" },
            status: "completed",
            subtotal: 2_000_000,
            tax_amount: 160_000,
            total: 2_160_000,
            note: null,
            created_by: USER_ID,
            created_at: "2026-04-12T00:00:00Z",
            updated_at: "2026-04-12T00:00:00Z",
          },
        ],
        count: 1,
        error: null,
      });

    const result = await getInternalSales({ page: 1, pageSize: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].code).toBe("BNB-001");
    expect(result.data[0].fromBranchName).toBe("Xưởng Rang");
    expect(result.data[0].toBranchName).toBe("Quán 1");
    expect(result.data[0].total).toBe(2_160_000);
  });
});

describe("cancelInternalSale", () => {
  it("delegates state validation to the atomic RPC and accepts idempotent cancel", async () => {
    await expect(
      cancelInternalSale("is-001", "Yêu cầu hủy lặp lại"),
    ).resolves.toBeUndefined();

    expect(cancelRpcCalls).toEqual([
      {
        p_internal_sale_id: "is-001",
        p_reason: "Yêu cầu hủy lặp lại",
      },
    ]);
  });

  it("surfaces the server rejection when a completed sale cannot be cancelled", async () => {
    cancelRpcError = {
      message: "INTERNAL_SALE_NOT_CANCELLABLE",
      code: "22023",
    };

    await expect(
      cancelInternalSale("is-001", "Không còn nhu cầu"),
    ).rejects.toThrow(
      "[cancelInternalSale.atomic_rpc] INTERNAL_SALE_NOT_CANCELLABLE",
    );
  });
});
