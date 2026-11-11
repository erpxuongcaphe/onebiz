import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStaffProfileAccess,
  saveStaffProfileAccess,
} from "@/lib/services/supabase/staff-profile-access";
import {
  draftFromStaffProfile,
  type StaffProfileSnapshot,
} from "@/lib/admin/staff-profile-access";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }) }));
const snapshot: StaffProfileSnapshot = {
  fingerprint: "saved-version",
  user: {
    id: "person",
    fullName: "Staff",
    roleId: null,
    isActive: true,
    branchIds: ["premium"],
  },
  hierarchy: {
    version: 1,
    document: {
      positions: [],
      departments: [],
      assignments: [],
      globalAdminIds: [],
    },
  },
  roles: [],
  branches: [{ id: "premium", name: "Premium" }],
  exceptions: [],
  branchPermissionCodes: [],
};
beforeEach(() => rpc.mockReset());
describe("staff profile service", () => {
  it("rejects incomplete server snapshots rather than constructing an empty permission draft", async () => {
    rpc.mockResolvedValue({ data: { user: snapshot.user }, error: null });
    await expect(getStaffProfileAccess("person")).rejects.toThrow(
      "Chưa tải đủ dữ liệu quyền",
    );
  });
  it("submits access, assignments and exceptions with one versioned RPC", async () => {
    rpc.mockResolvedValue({ data: snapshot, error: null });
    const draft = draftFromStaffProfile(snapshot);
    await expect(saveStaffProfileAccess(snapshot, draft)).resolves.toEqual(
      snapshot,
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_staff_profile_access", {
      p_user_id: "person",
      p_expected_fingerprint: "saved-version",
      p_draft: draft,
    });
  });
  it.each([
    [
      { code: "55P03", message: "canceling statement due to lock timeout" },
      "Bản nháp",
    ],
    [{ message: "STAFF_PROFILE_STALE" }, "đã được sửa ở nơi khác"],
    [
      { message: "HIERARCHY_BRANCH_INVALID" },
      "nằm trong chi nhánh được truy cập",
    ],
    [{ message: "HIERARCHY_DUPLICATE_ASSIGNMENT" }, "hai phân công trùng"],
  ])(
    "keeps the draft untouched on rejected saves: %j",
    async (error, message) => {
      rpc.mockResolvedValue({ data: null, error });
      const draft = draftFromStaffProfile(snapshot);
      const before = structuredClone(draft);
      await expect(saveStaffProfileAccess(snapshot, draft)).rejects.toThrow(
        message,
      );
      expect(draft).toEqual(before);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
});
