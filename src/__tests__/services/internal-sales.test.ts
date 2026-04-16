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
let insertedTables: Record<string, unknown[]> = {};
let stockMovements: Array<{ type: string; productId: string; quantity: number; branchId: string }> = [];

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
    rpc: vi.fn((funcName: string) => {
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
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

// Mock stock adjustments
vi.mock("@/lib/services/supabase/stock-adjustments", () => ({
  applyManualStockMovement: vi.fn(async (inputs: any[], ctx: any) => {
    for (const input of inputs) {
      stockMovements.push({
        type: input.type,
        productId: input.productId,
        quantity: input.quantity,
        branchId: ctx.branchId,
      });
    }
  }),
  nextEntityCode: vi.fn(async () => "NEXT-CODE"),
}));

import {
  createInternalSale,
  getInternalSales,
  cancelInternalSale,
} from "@/lib/services/supabase/internal-sales";
import { applyManualStockMovement } from "@/lib/services/supabase/stock-adjustments";

beforeEach(() => {
  codeCounter = 0;
  insertedTables = {};
  stockMovements = [];
  vi.clearAllMocks();

  // Setup table handlers
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

  it("calls applyManualStockMovement for both branches", async () => {
    await createInternalSale(validInput);

    expect(applyManualStockMovement).toHaveBeenCalledTimes(2);

    // First call: stock OUT for seller
    const call1 = (applyManualStockMovement as any).mock.calls[0];
    expect(call1[0]).toHaveLength(2);
    expect(call1[0][0].type).toBe("out");
    expect(call1[0][0].quantity).toBe(10);
    expect(call1[1].branchId).toBe(FROM_BRANCH);

    // Second call: stock IN for buyer
    const call2 = (applyManualStockMovement as any).mock.calls[1];
    expect(call2[0][0].type).toBe("in");
    expect(call2[0][0].quantity).toBe(10);
    expect(call2[1].branchId).toBe(TO_BRANCH);
  });

  it("returns result with total matching calculation", async () => {
    const result = await createInternalSale(validInput);

    // Total = subtotal + tax
    // Subtotal: (10*200k) + (5*50k) = 2M + 250k = 2.25M
    // Tax: 2M*8% + 250k*8% = 160k + 20k = 180k
    // Total: 2.43M
    expect(result.total).toBe(2_430_000);
    expect(typeof result.code).toBe("string");
  });

  it("tracks stock movements correctly per branch", async () => {
    await createInternalSale(validInput);

    // Should have 4 movements: 2 out (from seller), 2 in (to buyer)
    const outMoves = stockMovements.filter((m) => m.type === "out");
    const inMoves = stockMovements.filter((m) => m.type === "in");

    expect(outMoves).toHaveLength(2);
    expect(inMoves).toHaveLength(2);

    // All OUTs from seller branch
    expect(outMoves.every((m) => m.branchId === FROM_BRANCH)).toBe(true);
    // All INs to buyer branch
    expect(inMoves.every((m) => m.branchId === TO_BRANCH)).toBe(true);

    // Quantities match
    expect(outMoves[0].quantity).toBe(10);
    expect(outMoves[1].quantity).toBe(5);
    expect(inMoves[0].quantity).toBe(10);
    expect(inMoves[1].quantity).toBe(5);
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
  it("rejects cancel of completed/cancelled sale", async () => {
    tableHandlers.internal_sales = () =>
      createChain({ data: null, error: null });

    await expect(cancelInternalSale("is-001")).rejects.toThrow(
      "Không thể huỷ",
    );
  });
});
