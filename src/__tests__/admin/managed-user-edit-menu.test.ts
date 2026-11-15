import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildManagedUserEdit, usesLegacyScopeEditor } from "@/lib/admin/managed-user-edit";

const draft = { fullName: "  Thư  ", phone: " 0123 ", branchIds: ["premium", "tu-bua"], allBranches: false };
const staff = { id: "staff", role: "staff" };

describe("managed user edit safety", () => {
  it("keeps a role shortcut for managers while removing duplicated owner menu entries", () => {
    const page = readFileSync("src/app/(main)/he-thong/users/page.tsx", "utf8");
    expect(page).toContain("{!isCurrentUserOwner && <DropdownMenuItem");
    expect(page).toContain("Gán vai trò");
    expect(page).toContain("Phân công & quyền truy cập");
    expect(page).toContain("Quyền quản trị toàn doanh nghiệp");
    expect(page).not.toContain(">Cơ cấu & phạm vi quản lý");
    expect(page).not.toContain("Quyền tuỳ chỉnh</DropdownMenuItem>");
    expect(page).not.toContain("<PermissionOverrideDialog");
  });
  it("saves only identity when an owner edits a staff member", () => {
    expect(usesLegacyScopeEditor(true, "staff")).toBe(false);
    expect(buildManagedUserEdit({ id: "owner", isOwner: true }, staff, draft)).toEqual({ payload: { userId: "staff", fullName: "Thư", phone: "0123" } });
    expect(buildManagedUserEdit({ id: "owner", isOwner: true }, staff, { ...draft, branchIds: [] })).toHaveProperty("payload");
  });

  it("keeps branch editing for managers without rewriting the separate role", () => {
    expect(usesLegacyScopeEditor(false, "staff")).toBe(true);
    expect(buildManagedUserEdit({ id: "manager", isOwner: false }, staff, draft)).toEqual({ payload: {
      userId: "staff", fullName: "Thư", phone: "0123", branchIds: ["premium", "tu-bua"], allBranches: false,
    } });
    expect(buildManagedUserEdit({ id: "manager", isOwner: false }, staff, { ...draft, branchIds: [] })).toEqual({ error: "missing_branch" });
  });

  it("never submits role or branches when editing oneself", () => {
    expect(buildManagedUserEdit({ id: "staff", isOwner: false }, staff, { ...draft, branchIds: [] })).toEqual({ payload: { userId: "staff", fullName: "Thư", phone: "0123" } });
  });

  it("preserves the legacy branch editor for a different owner without changing owner role", () => {
    expect(buildManagedUserEdit({ id: "owner-a", isOwner: true }, { id: "owner-b", role: "owner" }, draft)).toEqual({ payload: {
      userId: "owner-b", fullName: "Thư", phone: "0123", branchIds: ["premium", "tu-bua"], allBranches: false,
    } });
  });
});
