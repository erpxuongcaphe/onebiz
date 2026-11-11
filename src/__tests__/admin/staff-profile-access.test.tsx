import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { StaffProfileEditor } from "@/components/shared/staff-profile-editor";
import {
  draftFromStaffProfile,
  projectedStaffPermission,
  setStaffException,
  setStaffBranchAccess,
  staffProfileChanges,
  type StaffProfileSnapshot,
} from "@/lib/admin/staff-profile-access";
import { permissionsForBranch } from "@/lib/permissions/branch-permissions";
vi.mock("@/lib/hooks/use-unsaved-work", () => ({ useUnsavedWork: vi.fn() }));
const snapshot: StaffProfileSnapshot = {
  fingerprint: "v1",
  user: {
    id: "u",
    fullName: "Thư",
    roleId: "r",
    isActive: true,
    branchIds: ["premium", "tubua"],
  },
  hierarchy: {
    version: 1,
    document: {
      positions: [
        {
          id: "manager",
          name: "Cửa hàng trưởng",
          parentId: null,
          scope: "assigned",
          depth: "all",
          roleId: "r",
          permissions: { create: true, edit: true, password: true },
        },
      ],
      departments: [],
      assignments: [],
      globalAdminIds: [],
    },
  },
  roles: [
    { id: "r", name: "Mẫu quản lý", permissions: ["pos_fnb.split_bill"] },
  ],
  branches: [
    { id: "premium", name: "Premium" },
    { id: "tubua", name: "Tư Búa" },
  ],
  exceptions: [
    { branchId: null, permissionCode: "products.view_cost", choice: "revoke" },
  ],
  branchPermissionCodes: ["pos_fnb.split_bill", "pos_fnb.transfer_table"],
};
describe("staff profile scope", () => {
  it("does not misrepresent an explicit company-wide right as limited by branch access", () => {
    const company = {
      ...snapshot,
      roles: [
        {
          id: "r",
          name: "Company finance",
          permissions: ["finance.view_cash_journal_company"],
        },
      ],
    };
    const draft = draftFromStaffProfile(company);
    draft.branchIds = ["premium"];
    const projected = projectedStaffPermission(
      company,
      draft,
      "tubua",
      "finance.view_cash_journal_company",
    );
    expect(projected.allowed).toBe(true);
    expect(projected.source).toContain("Phạm vi toàn công ty");
    const denied = setStaffException(
      draft,
      null,
      "finance.view_cash_journal_company",
      "revoke",
    );
    expect(
      projectedStaffPermission(
        company,
        denied,
        "tubua",
        "finance.view_cash_journal_company",
      ).allowed,
    ).toBe(false);
  });
  it("selects active branches without silently granting a closed branch", () => {
    const data = {
      ...snapshot,
      branches: [
        ...snapshot.branches,
        { id: "new", name: "New branch", isActive: true },
        { id: "closed", name: "Closed branch", isActive: false },
      ],
    };
    render(
      <StaffProfileEditor
        snapshot={data}
        onSave={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Chọn mọi chi nhánh hiện có" }),
    );
    expect(screen.getByRole("checkbox", { name: "New branch" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Closed branch · Ngừng hoạt động" }),
    ).not.toBeChecked();
  });
  it("explains the old cancellation alias but keeps local and global denials authoritative", () => {
    const oldRole = {
      ...snapshot,
      roles: [{ id: "r", name: "Old role", permissions: ["pos_fnb.void"] }],
    };
    const draft = draftFromStaffProfile(oldRole);
    expect(
      projectedStaffPermission(
        oldRole,
        draft,
        "premium",
        "pos_fnb.cancel_unpaid_order",
      ).allowed,
    ).toBe(true);
    const local = setStaffException(
      draft,
      "premium",
      "pos_fnb.cancel_unpaid_order",
      "revoke",
    );
    expect(
      projectedStaffPermission(
        oldRole,
        local,
        "premium",
        "pos_fnb.cancel_unpaid_order",
      ).allowed,
    ).toBe(false);
    expect(
      projectedStaffPermission(
        oldRole,
        local,
        "tubua",
        "pos_fnb.cancel_unpaid_order",
      ).allowed,
    ).toBe(true);
    const common = setStaffException(
      draft,
      null,
      "pos_fnb.cancel_unpaid_order",
      "revoke",
    );
    expect(
      projectedStaffPermission(
        oldRole,
        common,
        "tubua",
        "pos_fnb.cancel_unpaid_order",
      ).allowed,
    ).toBe(false);
  });
  it("removes branch management together with access, preserving dormant exceptions and the original draft", () => {
    const draft = draftFromStaffProfile(snapshot);
    draft.assignments = [
      {
        userId: "u",
        positionId: "manager",
        departmentId: null,
        managedBranchIds: ["premium", "tubua"],
      },
    ];
    draft.exceptions.push({
      branchId: "premium",
      permissionCode: "pos_fnb.split_bill",
      choice: "revoke",
    });
    const next = setStaffBranchAccess(draft, "premium", false);
    expect(next.branchIds).toEqual(["tubua"]);
    expect(next.assignments[0].managedBranchIds).toEqual(["tubua"]);
    expect(next.exceptions).toEqual(draft.exceptions);
    expect(draft.assignments[0].managedBranchIds).toEqual(["premium", "tubua"]);
    expect(
      projectedStaffPermission(snapshot, next, "premium", "pos_fnb.split_bill")
        .allowed,
    ).toBe(false);
    const restored = setStaffBranchAccess(next, "premium", true);
    expect(
      projectedStaffPermission(
        snapshot,
        restored,
        "premium",
        "pos_fnb.split_bill",
      ).allowed,
    ).toBe(false);
    expect(setStaffBranchAccess(restored, "premium", true).branchIds).toEqual([
      "tubua",
      "premium",
    ]);
  });
  it("does not show inactive staff as allowed even when their template grants the action", () => {
    const inactive = {
      ...snapshot,
      user: { ...snapshot.user, isActive: false },
    };
    expect(
      projectedStaffPermission(
        inactive,
        draftFromStaffProfile(inactive),
        "premium",
        "pos_fnb.split_bill",
      ).allowed,
    ).toBe(false);
  });
  it("includes personnel management inherited from position without ignoring an explicit deny", () => {
    const draft = draftFromStaffProfile(snapshot);
    draft.assignments = [
      {
        userId: "u",
        positionId: "manager",
        departmentId: null,
        managedBranchIds: ["premium"],
      },
    ];
    expect(
      projectedStaffPermission(snapshot, draft, "premium", "system.create_user")
        .allowed,
    ).toBe(true);
    const denied = setStaffException(
      draft,
      null,
      "system.create_user",
      "revoke",
    );
    expect(
      projectedStaffPermission(
        snapshot,
        denied,
        "premium",
        "system.create_user",
      ).allowed,
    ).toBe(false);
    expect(
      projectedStaffPermission(
        snapshot,
        draft,
        "premium",
        "system.manage_roles",
      ).allowed,
    ).toBe(false);
  });
  it("preserves existing exceptions and does not mutate input", () => {
    const draft = draftFromStaffProfile(snapshot);
    draft.exceptions.length = 0;
    expect(snapshot.exceptions).toHaveLength(1);
    expect(
      staffProfileChanges(snapshot, draftFromStaffProfile(snapshot)),
    ).toEqual([]);
  });
  it("local revoke does not change the other branch or common role", () => {
    const draft = setStaffException(
      draftFromStaffProfile(snapshot),
      "premium",
      "pos_fnb.split_bill",
      "revoke",
    );
    expect(
      projectedStaffPermission(snapshot, draft, "premium", "pos_fnb.split_bill")
        .allowed,
    ).toBe(false);
    expect(
      projectedStaffPermission(snapshot, draft, "tubua", "pos_fnb.split_bill")
        .allowed,
    ).toBe(true);
    expect(draft.exceptions).toHaveLength(2);
  });
  it("branch grant cannot cancel an existing global deny", () => {
    const draft = setStaffException(
      draftFromStaffProfile(snapshot),
      "premium",
      "products.view_cost",
      "grant",
    );
    expect(
      projectedStaffPermission(snapshot, draft, "premium", "products.view_cost")
        .allowed,
    ).toBe(false);
  });
  it("removing one exception returns to the template without touching other exceptions", () => {
    let draft = setStaffException(
      draftFromStaffProfile(snapshot),
      "premium",
      "pos_fnb.split_bill",
      "revoke",
    );
    draft = setStaffException(
      draft,
      "premium",
      "pos_fnb.split_bill",
      "inherit",
    );
    expect(draft.exceptions).toEqual(snapshot.exceptions);
    expect(
      projectedStaffPermission(snapshot, draft, "premium", "pos_fnb.split_bill")
        .allowed,
    ).toBe(true);
  });
  it("access boundary is evaluated before business grants", () => {
    const draft = draftFromStaffProfile(snapshot);
    draft.branchIds = ["tubua"];
    expect(
      projectedStaffPermission(snapshot, draft, "premium", "pos_fnb.split_bill")
        .source,
    ).toMatch(/Ngoài/);
  });
  it("switching branch changes cached effective rights synchronously", () => {
    const base = new Set(["pos_fnb.split_bill"]);
    const changes = [
      { branchId: "premium", code: "pos_fnb.split_bill", allowed: false },
      { branchId: "tubua", code: "pos_fnb.transfer_table", allowed: true },
    ];
    expect(permissionsForBranch(base, changes, "premium").size).toBe(0);
    expect([...permissionsForBranch(base, changes, "tubua")]).toEqual([
      "pos_fnb.split_bill",
      "pos_fnb.transfer_table",
    ]);
    expect(permissionsForBranch(base, changes, null).size).toBe(0);
    expect(base.size).toBe(1);
  });
  it("saves access and exceptions in one request; keeps draft after rejection", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Xung đột phiên bản"));
    render(
      <StaffProfileEditor
        snapshot={snapshot}
        onSave={onSave}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Tư Búa" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu phân công" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].branchIds).toEqual(["premium"]);
    expect(onSave.mock.calls[0][0].exceptions).toEqual(snapshot.exceptions);
    await screen.findByText("Xung đột phiên bản");
    expect(screen.getByRole("checkbox", { name: "Tư Búa" })).not.toBeChecked();
  });
  it("shows the saved access separately from an unsaved branch removal", () => {
    render(
      <StaffProfileEditor
        snapshot={snapshot}
        onSave={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Chi nhánh kiểm tra" }),
      { target: { value: "premium" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Quyền kiểm tra" }), {
      target: { value: "pos_fnb.split_bill" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Premium" }));
    expect(
      screen.getByText("Đang lưu trên hệ thống").parentElement,
    ).toHaveTextContent("Được cấp quyền");
    expect(
      within(screen.getByRole("status")).getByText("Chưa được cấp quyền"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ngoài chi nhánh được truy cập",
    );
  });
});
