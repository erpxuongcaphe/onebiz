import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
  getCurrentTenantId: vi.fn(), getCurrentContext: vi.fn(), getPaginationRange: vi.fn(), handleError: vi.fn(),
}));
import { getAuditLogsByEntity } from "@/lib/services/supabase/audit";

describe("scoped entity audit history", () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.from.mockReset(); });
  it("loads only the requested entity through the scoped RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "log", user_id: "u", action: "update", entity_type: "invoice", entity_id: "inv", old_data: {}, new_data: { code: "A" }, ip_address: null, created_at: "2026-11-15", profiles: { full_name: "Nhân viên" } }], error: null });
    const rows = await getAuditLogsByEntity("invoice", "inv", 50);
    expect(mocks.rpc).toHaveBeenCalledWith("staff_audit_entity_history", { p_entity_type: "invoice", p_entity_id: "inv", p_limit: 50 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ id: "log", userName: "Nhân viên", entityId: "inv", newData: { code: "A" } });
  });
  it("caps requested history size and fails closed on denial", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getAuditLogsByEntity("invoice", "inv", 10000)).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith("staff_audit_entity_history", expect.objectContaining({ p_limit: 100 }));
    warn.mockRestore();
  });
});
