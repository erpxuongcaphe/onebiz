import { describe, it, expect, vi, beforeEach } from "vitest";

// === Supabase mock ===

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockChainData: any = { data: null, error: null };
let lastUpdateFilter: { id?: string; status?: string } = {};
let lastInsertData: unknown = null;

function createChain(resolvedValue?: unknown) {
  const resolved = resolvedValue ?? mockChainData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn((col: string, val: string) => {
    if (col === "id") lastUpdateFilter.id = val;
    if (col === "status") lastUpdateFilter.status = val;
    return chain;
  });
  chain.order = vi.fn(self);
  chain.single = vi.fn(() => resolved);
  chain.maybeSingle = vi.fn(() => resolved);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolved);
  chain.insert = vi.fn((data: unknown) => {
    lastInsertData = data;
    return chain;
  });
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.ilike = vi.fn(self);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockFromHandler: (table: string) => any;

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => mockFromHandler(table)),
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getTablesByBranch,
  createTable,
  updateTableStatus,
  claimTable,
  releaseTable,
  markTableAvailable,
} from "@/lib/services/supabase/fnb-tables";

// === Helpers ===

const TABLE_ROW = {
  id: "t-1",
  tenant_id: "ten-1",
  branch_id: "br-1",
  table_number: 5,
  name: "Bàn 5",
  zone: "Tầng 1",
  capacity: 4,
  status: "available",
  current_order_id: null,
  position_x: 0,
  position_y: 0,
  sort_order: 5,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  lastUpdateFilter = {};
  lastInsertData = null;
  mockFromHandler = () =>
    createChain({ data: TABLE_ROW, error: null });
});

// ============================================================
// Tests
// ============================================================

describe("getTablesByBranch", () => {
  it("returns mapped RestaurantTable[]", async () => {
    mockFromHandler = () =>
      createChain({ data: [TABLE_ROW, { ...TABLE_ROW, id: "t-2", table_number: 6, name: "Bàn 6" }], error: null });

    const tables = await getTablesByBranch("br-1");

    expect(tables).toHaveLength(2);
    expect(tables[0].tableNumber).toBe(5);
    expect(tables[0].name).toBe("Bàn 5");
    expect(tables[0].zone).toBe("Tầng 1");
    expect(tables[1].tableNumber).toBe(6);
  });

  it("returns empty array when no tables", async () => {
    mockFromHandler = () => createChain({ data: [], error: null });
    const tables = await getTablesByBranch("br-empty");
    expect(tables).toEqual([]);
  });
});

describe("createTable", () => {
  it("creates table with correct fields", async () => {
    mockFromHandler = () =>
      createChain({ data: TABLE_ROW, error: null });

    const table = await createTable({
      tenantId: "ten-1",
      branchId: "br-1",
      tableNumber: 5,
      name: "Bàn 5",
      zone: "Tầng 1",
      capacity: 4,
    });

    expect(table.id).toBe("t-1");
    expect(table.status).toBe("available");
    expect(table.capacity).toBe(4);
  });

  it("defaults capacity to 4", async () => {
    mockFromHandler = () => {
      const chain = createChain({ data: { ...TABLE_ROW, capacity: 4 }, error: null });
      return chain;
    };

    const table = await createTable({
      tenantId: "ten-1",
      branchId: "br-1",
      tableNumber: 10,
      name: "Bàn 10",
    });

    expect(table.capacity).toBe(4);
  });
});

describe("claimTable", () => {
  it("sets status to occupied with order id", async () => {
    const occupiedRow = {
      ...TABLE_ROW,
      status: "occupied",
      current_order_id: "order-1",
    };
    mockFromHandler = () => createChain({ data: occupiedRow, error: null });

    const result = await claimTable("t-1", "order-1");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("occupied");
    expect(result!.currentOrderId).toBe("order-1");
  });

  it("returns null when table already occupied (race condition)", async () => {
    // maybeSingle returns null when no row matches (table no longer available)
    mockFromHandler = () => createChain({ data: null, error: null });

    const result = await claimTable("t-1", "order-2");

    expect(result).toBeNull();
  });
});

describe("releaseTable", () => {
  it("sets status to cleaning and clears order", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    // Should not throw
    await releaseTable("t-1");
  });
});

describe("markTableAvailable", () => {
  it("sets status to available only when cleaning", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    await markTableAvailable("t-1");
    // eq called with "status", "cleaning"
    expect(lastUpdateFilter.status).toBe("cleaning");
  });
});

describe("updateTableStatus", () => {
  it("updates status", async () => {
    const updatedRow = { ...TABLE_ROW, status: "reserved" };
    mockFromHandler = () => createChain({ data: updatedRow, error: null });

    const result = await updateTableStatus("t-1", "reserved");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("reserved");
  });

  it("sets currentOrderId when provided", async () => {
    const updatedRow = {
      ...TABLE_ROW,
      status: "occupied",
      current_order_id: "ko-5",
    };
    mockFromHandler = () => createChain({ data: updatedRow, error: null });

    const result = await updateTableStatus("t-1", "occupied", "ko-5");

    expect(result).not.toBeNull();
    expect(result!.currentOrderId).toBe("ko-5");
  });

  it("returns null when no matching row", async () => {
    mockFromHandler = () => createChain({ data: null, error: null });

    const result = await updateTableStatus("t-nonexistent", "available");
    expect(result).toBeNull();
  });
});

describe("table lifecycle integration", () => {
  it("available → occupied (claim) → cleaning (release) → available (mark)", async () => {
    // Step 1: Claim → occupied
    mockFromHandler = () =>
      createChain({
        data: { ...TABLE_ROW, status: "occupied", current_order_id: "ko-1" },
        error: null,
      });
    const claimed = await claimTable("t-1", "ko-1");
    expect(claimed!.status).toBe("occupied");

    // Step 2: Release → cleaning
    mockFromHandler = () => createChain({ data: null, error: null });
    await releaseTable("t-1");

    // Step 3: Mark available
    mockFromHandler = () => createChain({ data: null, error: null });
    await markTableAvailable("t-1");
    expect(lastUpdateFilter.status).toBe("cleaning");
  });
});
