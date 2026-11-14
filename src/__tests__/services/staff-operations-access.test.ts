import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => fake }));
import { getStaffOperationsAccess } from "@/lib/services/supabase/staff-operations-access";
const item = { branchId: "a", branchName: "Quán A", branchActive: true, role: "manager", capabilities: ["verify", "legacy_capability"], active: true };
const payload = { version: 1, userId: "u", fingerprint: "a".repeat(32), memberships: [item], qualityGrants: [] };
beforeEach(() => fake.rpc.mockReset());
describe("Hub staff snapshot", () => {
  it("retains legacy capabilities instead of silently dropping them", async () => {
    fake.rpc.mockResolvedValue({ data: payload, error: null });
    expect((await getStaffOperationsAccess("u")).memberships[0].capabilities).toEqual(["verify", "legacy_capability"]);
    expect(fake.rpc).toHaveBeenCalledWith("get_staff_operations_access", { p_user_id: "u" });
  });
  it("rejects the wrong user, repeated branches, or incomplete data", async () => {
    for (const data of [{ ...payload, userId: "another" }, { ...payload, memberships: [item, item] }, { ...payload, fingerprint: "bad" }]) {
      fake.rpc.mockResolvedValue({ data, error: null });
      await expect(getStaffOperationsAccess("u")).rejects.toThrow("chưa đầy đủ");
    }
  });
  it("reports an unavailable snapshot without claiming there are no assignments", async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await expect(getStaffOperationsAccess("u")).rejects.toThrow("Chưa tải được");
  });
});
