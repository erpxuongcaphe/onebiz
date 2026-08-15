import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F1a 15/08/2026: mọi đường GHI cấu hình bàn đi qua RPC 00323
 * `fnb_table_config_atomic` — tenant/quyền chốt phía máy chủ. Tệp này khoá
 * hợp đồng client→RPC: đúng tên hàm, đúng action, đúng payload, và TUYỆT ĐỐI
 * không gửi tenant_id từ client.
 */

// === Supabase mock ===

function createChain(resolvedValue: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.order = vi.fn(self);
  chain.single = vi.fn(() => resolvedValue);
  chain.maybeSingle = vi.fn(() => resolvedValue);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockFromHandler: (table: string) => any;
const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    from: vi.fn((table: string) => mockFromHandler(table)),
    rpc: mockRpc,
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  getTablesByBranch,
  createTable,
  updateTable,
  deleteTable,
  bulkCreateTables,
  renameZone,
  deleteZone,
  markTableAvailable,
} from "@/lib/services/supabase/fnb-tables";

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
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({
    data: { ok: true, table: TABLE_ROW },
    error: null,
  });
  mockFromHandler = () => createChain({ data: [TABLE_ROW], error: null });
});

// ============================================================
// Đọc — vẫn qua PostgREST
// ============================================================

describe("getTablesByBranch", () => {
  it("returns mapped RestaurantTable[]", async () => {
    mockFromHandler = () =>
      createChain({
        data: [TABLE_ROW, { ...TABLE_ROW, id: "t-2", table_number: 6, name: "Bàn 6" }],
        error: null,
      });

    const tables = await getTablesByBranch("br-1");

    expect(tables).toHaveLength(2);
    expect(tables[0].tableNumber).toBe(5);
    expect(tables[0].zone).toBe("Tầng 1");
    expect(tables[1].tableNumber).toBe(6);
  });

  it("returns empty array when no tables", async () => {
    mockFromHandler = () => createChain({ data: [], error: null });
    const tables = await getTablesByBranch("br-empty");
    expect(tables).toEqual([]);
  });
});

// ============================================================
// Ghi — MỌI hàm phải đi qua fnb_table_config_atomic
// ============================================================

describe("createTable → RPC", () => {
  it("gọi đúng action create, KHÔNG gửi tenant_id từ client", async () => {
    const table = await createTable({
      branchId: "br-1",
      tableNumber: 5,
      name: "Bàn 5",
      zone: "Tầng 1",
      capacity: 4,
    });

    expect(mockRpc).toHaveBeenCalledWith("fnb_table_config_atomic", {
      p_action: "create",
      p_branch_id: "br-1",
      p_payload: { table_number: 5, name: "Bàn 5", zone: "Tầng 1", capacity: 4 },
    });
    // Bất biến bảo mật: payload không bao giờ chứa tenant.
    const args = mockRpc.mock.calls[0][1];
    expect(JSON.stringify(args)).not.toContain("tenant");
    expect(table.id).toBe("t-1");
  });

  it("tạo bàn kèm luôn sơ đồ (khu + hình + vị trí) trong MỘT lời gọi", async () => {
    await createTable({
      branchId: "br-1",
      tableNumber: 7,
      name: "Bàn 7",
      zoneId: "z-1",
      shape: "rect",
      positionX: 120,
      positionY: 80,
    });
    expect(mockRpc.mock.calls[0][1].p_payload).toEqual({
      table_number: 7,
      name: "Bàn 7",
      zone_id: "z-1",
      shape: "rect",
      position_x: 120,
      position_y: 80,
    });
  });
});

describe("updateTable / deleteTable → RPC", () => {
  it("update gửi đúng table_id + chỉ các trường đổi", async () => {
    await updateTable("br-1", "t-1", { name: "VIP 1", capacity: 8 });
    expect(mockRpc).toHaveBeenCalledWith("fnb_table_config_atomic", {
      p_action: "update",
      p_branch_id: "br-1",
      p_payload: { table_id: "t-1", name: "VIP 1", capacity: 8 },
    });
  });

  it("delete chỉ gửi table_id — guard bàn bận nằm ở máy chủ", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await deleteTable("br-1", "t-1");
    expect(mockRpc).toHaveBeenCalledWith("fnb_table_config_atomic", {
      p_action: "delete",
      p_branch_id: "br-1",
      p_payload: { table_id: "t-1" },
    });
  });

  it("máy chủ chặn xoá bàn bận → lỗi tiếng Việt nổi lên nguyên văn", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Bàn "Bàn 5" đang phục vụ hoặc còn đơn — không thể xoá. Hãy thanh toán hoặc chuyển đơn trước.' },
    });
    await expect(deleteTable("br-1", "t-1")).rejects.toThrow(/đang phục vụ hoặc còn đơn/);
  });
});

describe("bulk / zone → RPC", () => {
  it("bulk_create không gửi tenant_id", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, created: 6 }, error: null });
    await bulkCreateTables({
      branchId: "br-1",
      zone: "Tầng 1",
      count: 6,
      startNumber: 1,
      capacity: 4,
    });
    expect(mockRpc).toHaveBeenCalledWith("fnb_table_config_atomic", {
      p_action: "bulk_create",
      p_branch_id: "br-1",
      p_payload: { zone: "Tầng 1", count: 6, start_number: 1, capacity: 4 },
    });
  });

  it("zone_rename mang đủ tên cũ + mới", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, renamed: 3 }, error: null });
    await renameZone("br-1", "Tầng 1", "Sân vườn");
    expect(mockRpc).toHaveBeenCalledWith("fnb_table_config_atomic", {
      p_action: "zone_rename",
      p_branch_id: "br-1",
      p_payload: { old_zone: "Tầng 1", new_zone: "Sân vườn" },
    });
  });

  it("zone_delete chỉ gửi tên khu — chặn-toàn-bộ nằm ở máy chủ", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, deleted: 4 }, error: null });
    await deleteZone("br-1", "Tầng 1");
    expect(mockRpc).toHaveBeenCalledWith("fnb_table_config_atomic", {
      p_action: "zone_delete",
      p_branch_id: "br-1",
      p_payload: { zone: "Tầng 1" },
    });
  });
});

describe("markTableAvailable (RPC vận hành 00275 — giữ nguyên)", () => {
  it("gọi mark_fnb_table_available_atomic", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await markTableAvailable("t-1");
    expect(mockRpc).toHaveBeenCalledWith(
      "mark_fnb_table_available_atomic",
      { p_table_id: "t-1" },
    );
  });
});
