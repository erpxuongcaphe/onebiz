import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => fake }));
import { getStaffOperationsAccess, saveStaffProfileOperations } from "@/lib/services/supabase/staff-operations-access";
import type { StaffProfileSnapshot, StaffProfileDraft } from "@/lib/admin/staff-profile-access";
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
describe('atomic Hub save', () => {
  const profile: StaffProfileSnapshot = { fingerprint: 'v1', user: { id: 'u', fullName: 'Người thử', roleId: null, isActive: true, branchIds: ['a'] }, hierarchy: { version: 1, document: { positions: [], departments: [], assignments: [], globalAdminIds: [] } }, roles: [], branches: [{ id: 'a', name: 'Quán A' }], exceptions: [], branchPermissionCodes: [] };
  const draft: StaffProfileDraft = { roleId: null, branchIds: ['a'], assignments: [], exceptions: [] };
  const operations = { ...payload, version: 1 as const, memberships: [{ ...item, role: 'manager' as const }] };
  it('sends profile, Hub and QC changes as one request', async () => {
    fake.rpc.mockResolvedValue({ data: { profile, operations }, error: null });
    await expect(saveStaffProfileOperations(profile, draft, operations, [], ['a'])).resolves.toEqual({ profile, operations });
    expect(fake.rpc).toHaveBeenCalledOnce();
    expect(fake.rpc).toHaveBeenCalledWith('save_staff_profile_operations', expect.objectContaining({ p_user_id: 'u', p_draft: draft, p_deactivate_qc: ['a'] }));
  });
  it('does not claim that a save failed when its response cannot be verified', async () => {
    fake.rpc.mockResolvedValue({ data: { profile: null, operations }, error: null });
    await expect(saveStaffProfileOperations(profile, draft, operations, [], [])).rejects.toThrow('chưa xác nhận được kết quả');
  });
});
