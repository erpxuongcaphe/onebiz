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
  it("identifies the legacy sent-order edit permission as unsupported by the current approval flow", () => {
    render(<StaffProfileEditor snapshot={snapshot} onSave={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), { target: { value: "pos_fnb.edit_sent_order" } });
    expect(screen.getByText(/luồng duyệt hiện tại chưa hỗ trợ yêu cầu sửa món đã gửi bếp/)).toBeVisible();
  });
  it("explains the current server restriction on the company-wide opening-stock lock", () => {
    render(<StaffProfileEditor snapshot={snapshot} onSave={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Sửa dữ liệu dùng chung" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), { target: { value: "inventory.lock" } });
    expect(screen.getByText(/Máy chủ hiện chỉ cho chủ hoặc admin thực hiện/)).toBeVisible();
  });
  it("allows a cash-book exception for one branch while keeping unrelated rights", async () => {
    const data = structuredClone(snapshot);
    data.branchPermissionCodes.push("finance.view_cash_book");
    data.exceptions.push({ branchId: "tubua", permissionCode: "pos_fnb.transfer_table", choice: "grant" });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<StaffProfileEditor snapshot={data} onSave={onSave} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), { target: { value: "finance.view_cash_book" } });
    expect(screen.getByText(/không cho xem sổ quỹ chưa chắc ẩn được/)).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: /Quyền Xem sổ quỹ/ }), { target: { value: "revoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu phân công" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].exceptions).toEqual(expect.arrayContaining([
      { branchId: "premium", permissionCode: "finance.view_cash_book", choice: "revoke" },
      { branchId: "tubua", permissionCode: "pos_fnb.transfer_table", choice: "grant" },
    ]));
  });
  it("saves a branch inventory exception without changing other branch permissions", async () => {
    const data = structuredClone(snapshot);
    data.branchPermissionCodes.push("inventory.view");
    data.exceptions.push({ branchId: "tubua", permissionCode: "pos_fnb.transfer_table", choice: "grant" });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<StaffProfileEditor snapshot={data} onSave={onSave} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), { target: { value: "inventory.view" } });
    expect(screen.getByText(/Quyền bán lẻ vẫn cần nhận số lượng tồn/)).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Quyền Xem tồn kho" }), { target: { value: "revoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu phân công" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].exceptions).toEqual(expect.arrayContaining([
      { branchId: "premium", permissionCode: "inventory.view", choice: "revoke" },
      { branchId: "tubua", permissionCode: "pos_fnb.transfer_table", choice: "grant" },
    ]));
  });
  it("explains when independent rights permit viewing another person's order", () => {
    render(<StaffProfileEditor snapshot={snapshot} onSave={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name:"Tùy chỉnh quyền"}));
    fireEvent.change(screen.getByRole("textbox", {name:"Tìm quyền"}), {target:{value:"orders.view_own_only"}});
    expect(screen.getByText(/Quyền tạo hoặc hủy đơn không tự bỏ giới hạn này/)).toBeVisible();
  });
  it("explains stock action document access and separate cost rights", () => {
    const data = structuredClone(snapshot); data.branchPermissionCodes.push("inventory.dispose");
    render(<StaffProfileEditor snapshot={data} onSave={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name:"Tùy chỉnh quyền"}));
    fireEvent.click(screen.getByRole("button", {name:"Premium"}));
    fireEvent.change(screen.getByRole("textbox", {name:"Tìm quyền"}), {target:{value:"inventory.dispose"}});
    expect(screen.getByText(/Giá trị và giá vốn cần quyền xem giá vốn riêng/)).toBeVisible();
  });
  it("distinguishes reading a transfer from performing it at both branches", () => {
    const data = structuredClone(snapshot);
    data.branchPermissionCodes.push("inventory.transfer");
    render(<StaffProfileEditor snapshot={data} onSave={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), { target: { value: "inventory.transfer" } });
    expect(screen.getByText(/Chuyển kho cần quyền tại cả chi nhánh gửi/)).toHaveTextContent("quyền tại một chi nhánh được giao cũng cho xem phiếu");
  });
  it("shows which rights cannot yet be adjusted separately for a branch", () => {
    const onSave = vi.fn();
    render(<StaffProfileEditor snapshot={snapshot} onSave={onSave} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    fireEvent.click(screen.getByText(/quyền chưa thể chỉnh riêng theo chi nhánh/));
    expect(screen.getByText(/Không thể dùng nút chọn tất cả bên dưới/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Xem quyền chung: Xem đơn hàng" }));
    expect(screen.getByRole("textbox", { name: "Tìm quyền" })).toHaveValue("orders.view");
    expect(screen.getByText(/Quyền chung là mặc định cho tài khoản/)).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("explains that purchasing also opens its related branch documents", () => {
    const data = structuredClone(snapshot);
    data.branchPermissionCodes.push("inventory.create_po");
    render(<StaffProfileEditor snapshot={data} onSave={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), { target: { value: "inventory.create_po" } });
    expect(screen.getByText(/Quyền này cũng cho xem phiếu nhập, trả hàng nhập và hóa đơn đầu vào/)).toBeVisible();
  });
  it("applies a whole category in the selected branch and saves only after review", async () => {
    const data = structuredClone(snapshot);
    const otherBranch = {
      branchId: "tubua",
      permissionCode: "pos_fnb.transfer_table",
      choice: "revoke" as const,
    };
    data.exceptions.push(otherBranch);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <StaffProfileEditor snapshot={data} onSave={onSave} onReload={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    const search = screen.getByRole("textbox", { name: "Tìm quyền" });
    fireEvent.change(search, { target: { value: "pos_fnb.split_bill" } });
    expect(
      screen.getByText("Bao gồm 1 quyền đang ẩn bởi bộ lọc."),
    ).toBeVisible();
    const groupAction = () =>
      screen.getByRole("combobox", { name: "Áp dụng cho cả nhóm POS FnB" });
    fireEvent.change(groupAction(), { target: { value: "grant" } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "" } });
    const split = screen.getByRole("combobox", { name: "Quyền Tách bill" });
    const transfer = screen.getByRole("combobox", { name: "Quyền Chuyển bàn" });
    expect(split).toHaveValue("grant");
    expect(transfer).toHaveValue("grant");
    fireEvent.change(groupAction(), { target: { value: "inherit" } });
    expect(split).toHaveValue("inherit");
    expect(transfer).toHaveValue("inherit");
    fireEvent.change(groupAction(), { target: { value: "revoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu phân công" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].exceptions).toEqual([
      ...snapshot.exceptions,
      otherBranch,
      {
        branchId: "premium",
        permissionCode: "pos_fnb.split_bill",
        choice: "revoke",
      },
      {
        branchId: "premium",
        permissionCode: "pos_fnb.transfer_table",
        choice: "revoke",
      },
    ]);
  });

  it("separates shared writes without changing existing exceptions or branch access", () => {
    const original = {
      ...snapshot,
      exceptions: [
        ...snapshot.exceptions,
        {
          branchId: null,
          permissionCode: "products.edit",
          choice: "grant" as const,
        },
      ],
    };
    render(
      <StaffProfileEditor
        snapshot={original}
        onSave={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh quyền" }));
    expect(
      screen.queryByRole("combobox", { name: "Quyền Sửa sản phẩm" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Sửa dữ liệu dùng chung" }),
    );
    expect(
      screen.getByText(/Các quyền này không tự cấp quyền xem doanh số/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm quyền" }), {
      target: { value: "products.edit" },
    });
    expect(
      screen.getByRole("combobox", { name: "Quyền Sửa sản phẩm" }),
    ).toHaveValue("grant");
    expect(
      screen.getByText("Thay đổi áp dụng cho toàn công ty"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(
      screen.queryByText("Thay đổi áp dụng cho toàn công ty"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Sửa dữ liệu dùng chung" }),
    );
    expect(
      screen.getByRole("combobox", { name: "Quyền Sửa sản phẩm" }),
    ).toHaveValue("grant");
    expect(original.user.branchIds).toEqual(["premium", "tubua"]);
  });
  it("keeps staff-management projection inside explicitly assigned branches", () => {
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
    expect(
      projectedStaffPermission(snapshot, draft, "tubua", "system.create_user")
        .allowed,
    ).toBe(false);
    expect(
      projectedStaffPermission(
        snapshot,
        draft,
        "tubua",
        "system.reset_user_password",
      ).allowed,
    ).toBe(false);
  });
  it("explains incomplete and duplicate assignments before saving", () => {
    const onSave = vi.fn();
    render(
      <StaffProfileEditor
        snapshot={snapshot}
        onSave={onSave}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "+ Thêm chức vụ / kiêm nhiệm" }),
    );
    expect(
      screen.getByText(
        "Chọn chức vụ cho phân công còn trống, hoặc bấm Bỏ phân công này.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Lưu phân công" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Chức vụ 1"), {
      target: { value: "manager" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "+ Thêm chức vụ / kiêm nhiệm" }),
    );
    fireEvent.change(screen.getByLabelText("Chức vụ 2"), {
      target: { value: "manager" },
    });
    expect(
      screen.getByText(
        "Có phân công trùng chức vụ và bộ phận. Bỏ dòng trùng trước khi lưu.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Lưu phân công" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Bỏ phân công này" })[1],
    );
    expect(screen.getByRole("button", { name: "Lưu phân công" })).toBeEnabled();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("removes a discarded assignment's pending role without losing another decision", async () => {
    const data = structuredClone(snapshot);
    data.roles.push({ id: "r2", name: "Mẫu thu ngân", permissions: [] });
    data.hierarchy.document.positions.push({
      ...data.hierarchy.document.positions[0],
      id: "cashier",
      name: "Thu ngân",
      roleId: "r2",
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <StaffProfileEditor snapshot={data} onSave={onSave} onReload={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "+ Thêm chức vụ / kiêm nhiệm" }),
    );
    fireEvent.change(screen.getByLabelText("Chức vụ 1"), {
      target: { value: "cashier" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "+ Thêm chức vụ / kiêm nhiệm" }),
    );
    fireEvent.change(screen.getByLabelText("Chức vụ 2"), {
      target: { value: "manager" },
    });
    // Selecting a position with the current role must not discard the first decision.
    expect(
      screen.getByRole("button", { name: "Dùng mẫu của chức vụ" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Bỏ phân công này" })[0],
    );
    expect(
      screen.queryByRole("button", { name: "Dùng mẫu của chức vụ" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lưu phân công" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].roleId).toBe("r");
    expect(onSave.mock.calls[0][0].exceptions).toEqual(snapshot.exceptions);
  });
  it("uses table management only in the actual branch when explaining merge access", () => {
    const data = {
      ...snapshot,
      roles: [
        {
          id: "r",
          name: "Table manager",
          permissions: ["pos_fnb.manage_tables"],
        },
      ],
    };
    const draft = setStaffException(
      draftFromStaffProfile(data),
      "premium",
      "pos_fnb.manage_tables",
      "revoke",
    );
    expect(
      projectedStaffPermission(data, draft, "premium", "pos_fnb.merge_bills")
        .allowed,
    ).toBe(false);
    expect(
      projectedStaffPermission(data, draft, "tubua", "pos_fnb.merge_bills")
        .allowed,
    ).toBe(true);
    const denied = setStaffException(
      draft,
      "tubua",
      "pos_fnb.merge_bills",
      "revoke",
    );
    expect(
      projectedStaffPermission(data, denied, "tubua", "pos_fnb.merge_bills")
        .allowed,
    ).toBe(false);
  });
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
