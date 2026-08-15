import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F1a 15/08/2026: đường ghi sơ đồ bàn (khu + layout + trang trí) đi qua 3 RPC
 * của 00323. Tệp này khoá hợp đồng client→RPC — đúng tên hàm, đúng payload,
 * không gửi tenant_id — và bất biến an toàn của wrapper lô.
 */

const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mockRpc }),
  getCurrentContext: () => Promise.resolve({ tenantId: "t1", userId: "u1" }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  createFloorPlanZone,
  updateFloorPlanZone,
  deleteFloorPlanZone,
  updateTableLayout,
  updateTableLayouts,
} from "@/lib/services/supabase/floor-plan";
import {
  createDecoration,
  updateDecoration,
  deleteDecoration,
} from "@/lib/services/supabase/floor-plan-decorations";

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
});

// ============================================================
// Khu sơ đồ → fnb_floor_zone_config_atomic
// ============================================================

describe("floor plan zones → RPC", () => {
  it("create gửi đúng action + payload, KHÔNG chứa tenant", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, zone: { id: "z-1", tenant_id: "t1", branch_id: "br-1", name: "Tầng 2" } },
      error: null,
    });
    const zone = await createFloorPlanZone({
      branchId: "br-1",
      name: "Tầng 2",
      canvasWidth: 1200,
      floorLevel: 2,
    });
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_zone_config_atomic", {
      p_action: "create",
      p_branch_id: "br-1",
      p_payload: { name: "Tầng 2", canvas_width: 1200, floor_level: 2 },
    });
    expect(JSON.stringify(mockRpc.mock.calls[0][1].p_payload)).not.toContain("tenant");
    expect(zone.id).toBe("z-1");
  });

  it("update (đổi tên) mang zone_id + name — sync sang restaurant_tables ở máy chủ", async () => {
    await updateFloorPlanZone("br-1", "z-1", { name: "Sân vườn" });
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_zone_config_atomic", {
      p_action: "update",
      p_branch_id: "br-1",
      p_payload: { zone_id: "z-1", name: "Sân vườn" },
    });
  });

  it("delete chỉ gửi zone_id — guard 'khu còn bàn' nằm ở máy chủ", async () => {
    await deleteFloorPlanZone("br-1", "z-1");
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_zone_config_atomic", {
      p_action: "delete",
      p_branch_id: "br-1",
      p_payload: { zone_id: "z-1" },
    });
  });

  it("máy chủ chặn xoá khu còn bàn → lỗi tiếng Việt nổi nguyên văn", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Khu vực còn 3 bàn — chuyển bàn sang khu khác trước khi xoá." },
    });
    await expect(deleteFloorPlanZone("br-1", "z-1")).rejects.toThrow(
      /chuyển bàn sang khu khác/,
    );
  });
});

// ============================================================
// Layout bàn → fnb_floor_layout_update_atomic (lô, 1 giao dịch)
// ============================================================

describe("table layout → RPC lô", () => {
  it("updateTableLayout (1 bàn) là wrapper của RPC lô với 1 phần tử", async () => {
    await updateTableLayout("tb-1", { positionX: 120.6, positionY: 80.2, rotation: 45 });
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_layout_update_atomic", {
      p_items: [{ table_id: "tb-1", position_x: 121, position_y: 80, rotation: 45 }],
    });
  });

  it("updateTableLayouts gửi NHIỀU bàn trong MỘT lời gọi", async () => {
    await updateTableLayouts([
      { id: "tb-1", positionX: 10, positionY: 20 },
      { id: "tb-2", shape: "rect", width: 120, height: 60 },
      { id: "tb-3", zoneId: "z-2", locked: true },
    ]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const items = mockRpc.mock.calls[0][1].p_items;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ table_id: "tb-1", position_x: 10, position_y: 20 });
    expect(items[1]).toEqual({ table_id: "tb-2", shape: "rect", width: 120, height: 60 });
    expect(items[2]).toEqual({ table_id: "tb-3", zone_id: "z-2", locked: true });
  });

  it("mảng rỗng → KHÔNG gọi RPC", async () => {
    await updateTableLayouts([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ============================================================
// Trang trí → fnb_floor_decoration_config_atomic
// ============================================================

describe("decorations → RPC", () => {
  it("create suy chi nhánh từ zone ở máy chủ — payload không có branch/tenant", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, decoration: { id: "d-1", zone_id: "z-1", kind: "plant" } },
      error: null,
    });
    const deco = await createDecoration({
      branchId: "br-1",
      zoneId: "z-1",
      kind: "plant",
      positionX: 50.4,
      positionY: 60.7,
      width: 40,
    });
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_decoration_config_atomic", {
      p_action: "create",
      p_payload: { zone_id: "z-1", kind: "plant", position_x: 50, position_y: 61, width: 40 },
    });
    const sent = JSON.stringify(mockRpc.mock.calls[0][1].p_payload);
    expect(sent).not.toContain("tenant");
    expect(sent).not.toContain("branch");
    expect(deco.id).toBe("d-1");
  });

  it("update mang decoration_id + chỉ các trường đổi", async () => {
    await updateDecoration("d-1", { positionX: 99, locked: true });
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_decoration_config_atomic", {
      p_action: "update",
      p_payload: { decoration_id: "d-1", position_x: 99, locked: true },
    });
  });

  it("delete chỉ gửi decoration_id (xoá cứng — audit trước ở máy chủ)", async () => {
    await deleteDecoration("d-1");
    expect(mockRpc).toHaveBeenCalledWith("fnb_floor_decoration_config_atomic", {
      p_action: "delete",
      p_payload: { decoration_id: "d-1" },
    });
  });
});
