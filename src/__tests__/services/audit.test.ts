import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Audit Log Tests — Sprint 7 "Toàn Cảnh"
 *
 * Tests:
 *   - getAuditLogs: pagination, filters, label mapping
 *   - getAuditStats: counting, top action/entity
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tableDataMap: Record<string, any> = {};
let countValue = 0;

function createChain(resolvedValue: unknown = { data: null, error: null, count: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(() => {
    // If count was set, include it
    if (countValue > 0) {
      chain._resolvedValue = { ...resolvedValue as object, count: countValue };
    }
    return chain;
  });
  chain.eq = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.in = vi.fn(self);
  chain.or = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.range = vi.fn(self);
  chain.single = vi.fn(() => chain._resolvedValue ?? resolvedValue);
  chain.maybeSingle = vi.fn(() => chain._resolvedValue ?? resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(chain._resolvedValue ?? resolvedValue);
  return chain;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => {
      const mock = tableDataMap[table];
      return createChain(mock ?? { data: [], error: null, count: 0 });
    }),
    rpc: vi.fn(() => ({ data: null, error: null })),
  }),
  getCurrentContext: vi.fn(() =>
    Promise.resolve({ tenantId: "t1", branchId: "b1", userId: "u1" })
  ),
  getPaginationRange: vi.fn(() => ({ from: 0, to: 24 })),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getAuditLogs,
  getAuditStats,
  getActionOptions,
  getEntityTypeOptions,
} from "@/lib/services/supabase/audit";

beforeEach(() => {
  tableDataMap = {};
  countValue = 0;
});

// ========================================
// getActionOptions / getEntityTypeOptions
// ========================================

describe("option helpers", () => {
  it("returns action options with Vietnamese labels", () => {
    const options = getActionOptions();
    expect(options.length).toBeGreaterThan(0);
    const create = options.find((o) => o.value === "create");
    expect(create?.label).toBe("Tạo mới");
  });

  it("returns entity type options with Vietnamese labels", () => {
    const options = getEntityTypeOptions();
    expect(options.length).toBeGreaterThan(0);
    const invoice = options.find((o) => o.value === "invoice");
    expect(invoice?.label).toBe("Hóa đơn");
  });
});

// ========================================
// getAuditLogs
// ========================================

describe("getAuditLogs", () => {
  it("maps audit log entries with labels", async () => {
    tableDataMap = {
      audit_log: {
        data: [
          {
            id: "a1",
            user_id: "u1",
            action: "create",
            entity_type: "invoice",
            entity_id: "HD001",
            old_data: null,
            new_data: { total: 1000 },
            ip_address: "192.168.1.1",
            created_at: new Date().toISOString(),
            profiles: { full_name: "Nguyễn Văn A" },
          },
          {
            id: "a2",
            user_id: "u2",
            action: "update",
            entity_type: "product",
            entity_id: "SP001",
            old_data: { stock: 10 },
            new_data: { stock: 15 },
            ip_address: null,
            created_at: new Date().toISOString(),
            profiles: null,
          },
        ],
        error: null,
        count: 2,
      },
    };

    const result = await getAuditLogs({ page: 0, pageSize: 25 });

    expect(result.data).toHaveLength(2);

    // First entry
    expect(result.data[0].userName).toBe("Nguyễn Văn A");
    expect(result.data[0].actionLabel).toBe("Tạo mới");
    expect(result.data[0].entityTypeLabel).toBe("Hóa đơn");
    expect(result.data[0].entityId).toBe("HD001");
    expect(result.data[0].ipAddress).toBe("192.168.1.1");
    expect(result.data[0].newData).toEqual({ total: 1000 });

    // Second entry — null profile fallback
    expect(result.data[1].userName).toBe("Hệ thống");
    expect(result.data[1].actionLabel).toBe("Cập nhật");
    expect(result.data[1].entityTypeLabel).toBe("Sản phẩm");
  });

  it("returns empty when audit_log has error (graceful fallback)", async () => {
    tableDataMap = {
      audit_log: { data: null, error: { message: "relation not found" }, count: 0 },
    };

    const result = await getAuditLogs({ page: 0, pageSize: 25 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ========================================
// getAuditStats
// ========================================

describe("getAuditStats", () => {
  it("counts today and week stats", async () => {
    tableDataMap = {
      audit_log: {
        data: [
          { action: "create", entity_type: "invoice" },
          { action: "create", entity_type: "invoice" },
          { action: "update", entity_type: "product" },
          { action: "create", entity_type: "product" },
        ],
        error: null,
        count: 5,
      },
    };

    const result = await getAuditStats();

    // totalToday comes from count query
    expect(result.totalToday).toBe(5);
    expect(result.totalWeek).toBe(4);

    // Most common action: "create" (3 times)
    expect(result.topAction).toBe("Tạo mới");
    // Most common entity: "invoice" (2) and "product" (2) — either could be top
    expect(["Hóa đơn", "Sản phẩm"]).toContain(result.topEntity);
  });

  it("returns dashes when no data", async () => {
    tableDataMap = {
      audit_log: { data: [], error: null, count: 0 },
    };

    const result = await getAuditStats();
    expect(result.totalToday).toBe(0);
    expect(result.totalWeek).toBe(0);
    expect(result.topAction).toBe("—");
    expect(result.topEntity).toBe("—");
  });
});
