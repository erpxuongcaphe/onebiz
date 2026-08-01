import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();
const mockUpdateResult = vi.fn();
const mockInsertResult = vi.fn();
const mockRpc = vi.fn();

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.update = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn((table: string) => {
  if (table === "audit_log") {
    return { insert: vi.fn(() => mockInsertResult()) };
  }
  return mockChain;
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom, rpc: mockRpc }),
  getCurrentContext: async () => ({
    tenantId: "tenant-1",
    branchId: "branch-1",
    userId: "user-1",
  }),
  getCurrentTenantId: () => Promise.resolve("t1"),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  updateDeliveryPartner,
  deactivateDeliveryPartner,
  getShippingStatuses,
  getPartnerOptions,
  canTransitionShippingStatus,
  getNextShippingStatuses,
  SHIPPING_STATUS_LABEL,
  updateShippingOrderStatus,
} from "@/lib/services/supabase/shipping";

describe("updateDeliveryPartner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns mapped partner", async () => {
    mockResult.mockResolvedValueOnce({
      data: { id: "dp-1", name: "GHN Updated", phone: "0900000000", is_active: true },
      error: null,
    });

    const result = await updateDeliveryPartner("dp-1", { name: "GHN Updated" });

    expect(mockFrom).toHaveBeenCalledWith("delivery_partners");
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ name: "GHN Updated" }));
    expect(result.name).toBe("GHN Updated");
  });
});

describe("deactivateDeliveryPartner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets is_active to false", async () => {
    // Now chain has 2 .eq() — first for tenant_id, second for id (returns terminal)
    (mockChain.eq as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockChain);
    (mockChain.eq as ReturnType<typeof vi.fn>).mockReturnValueOnce({ error: null });

    await deactivateDeliveryPartner("dp-1");

    expect(mockFrom).toHaveBeenCalledWith("delivery_partners");
    expect(mockChain.update).toHaveBeenCalledWith({ is_active: false });
    expect(mockChain.eq).toHaveBeenCalledWith("id", "dp-1");
  });
});

describe("getShippingStatuses", () => {
  it("returns lifecycle status list with picked_up + in_transit + delivered", () => {
    const statuses = getShippingStatuses();
    const values = statuses.map((s) => s.value);
    // 4 mốc chính + returned/cancelled + "all"
    expect(values).toEqual(
      expect.arrayContaining([
        "all",
        "pending",
        "picked_up",
        "in_transit",
        "delivered",
        "returned",
        "cancelled",
      ]),
    );
  });
});

describe("getPartnerOptions", () => {
  it("returns sync fallback array", () => {
    const opts = getPartnerOptions();
    expect(Array.isArray(opts)).toBe(true);
  });
});

describe("shipping status labels (Vietnamese)", () => {
  it("has Vietnamese labels with full diacritics for every state", () => {
    expect(SHIPPING_STATUS_LABEL.pending).toBe("Chờ lấy hàng");
    expect(SHIPPING_STATUS_LABEL.picked_up).toBe("Đã lấy hàng");
    expect(SHIPPING_STATUS_LABEL.in_transit).toBe("Đang giao");
    expect(SHIPPING_STATUS_LABEL.delivered).toBe("Đã giao");
    expect(SHIPPING_STATUS_LABEL.returned).toBe("Đã hoàn");
    expect(SHIPPING_STATUS_LABEL.cancelled).toBe("Đã hủy");
  });
});

describe("canTransitionShippingStatus (state machine)", () => {
  it("allows happy path pending → picked_up → in_transit → delivered", () => {
    expect(canTransitionShippingStatus("pending", "picked_up")).toBe(true);
    expect(canTransitionShippingStatus("picked_up", "in_transit")).toBe(true);
    expect(canTransitionShippingStatus("in_transit", "delivered")).toBe(true);
  });

  it("allows pending → cancelled before pickup", () => {
    expect(canTransitionShippingStatus("pending", "cancelled")).toBe(true);
  });

  it("allows picked_up/in_transit → returned when delivery fails", () => {
    expect(canTransitionShippingStatus("picked_up", "returned")).toBe(true);
    expect(canTransitionShippingStatus("in_transit", "returned")).toBe(true);
  });

  it("blocks skipping stages (pending → delivered)", () => {
    expect(canTransitionShippingStatus("pending", "delivered")).toBe(false);
    expect(canTransitionShippingStatus("pending", "in_transit")).toBe(false);
  });

  it("blocks reopening terminal states (delivered → anything)", () => {
    expect(canTransitionShippingStatus("delivered", "pending")).toBe(false);
    expect(canTransitionShippingStatus("delivered", "returned")).toBe(false);
    expect(canTransitionShippingStatus("returned", "delivered")).toBe(false);
    expect(canTransitionShippingStatus("cancelled", "pending")).toBe(false);
  });

  it("blocks cancelling after pickup (must go through returned)", () => {
    expect(canTransitionShippingStatus("picked_up", "cancelled")).toBe(false);
    expect(canTransitionShippingStatus("in_transit", "cancelled")).toBe(false);
  });
});

describe("getNextShippingStatuses", () => {
  it("returns [] for terminal states", () => {
    expect(getNextShippingStatuses("delivered")).toEqual([]);
    expect(getNextShippingStatuses("returned")).toEqual([]);
    expect(getNextShippingStatuses("cancelled")).toEqual([]);
  });

  it("returns pickup + cancel options when pending", () => {
    expect(getNextShippingStatuses("pending")).toEqual(["picked_up", "cancelled"]);
  });
});

describe("updateShippingOrderStatus", () => {
  const updatedOrder = {
    id: "so-1",
    code: "VD001",
    status: "picked_up",
    shipping_fee: 30000,
    cod_amount: 200000,
    receiver_name: "Nguyễn Văn A",
    receiver_phone: "0900000000",
    receiver_address: "123 Lê Duẩn",
    created_at: "2026-04-21T00:00:00Z",
    updated_at: "2026-04-21T01:00:00Z",
    invoices: { code: "HD001" },
    delivery_partners: { name: "GHN" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: updatedOrder, error: null });
  });

  it("lets the server reject an invalid transition without a client UPDATE", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Không thể chuyển vận đơn từ delivered sang pending" },
    });

    await expect(
      updateShippingOrderStatus("so-1", "pending"),
    ).rejects.toThrow(/Không thể chuyển vận đơn/);

    expect(mockChain.update).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("audit_log");
  });

  it("updates status and writes audit in one server transaction", async () => {
    const result = await updateShippingOrderStatus(
      "so-1",
      "picked_up",
      "Đã bàn giao",
    );

    expect(mockRpc).toHaveBeenCalledWith(
      "update_shipping_order_status_atomic",
      {
        p_shipping_order_id: "so-1",
        p_next_status: "picked_up",
        p_note: "Đã bàn giao",
      },
    );
    expect(mockChain.update).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("audit_log");
    expect(result.status).toBe("picked_up");
    expect(result.statusName).toBe("Đã lấy hàng");
  });

  it("surfaces a race conflict returned by the server", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Trạng thái đã bị thay đổi, vui lòng tải lại" },
    });

    await expect(
      updateShippingOrderStatus("so-1", "picked_up"),
    ).rejects.toThrow(/đã bị thay đổi|tải lại/i);
    expect(mockChain.update).not.toHaveBeenCalled();
  });
});
