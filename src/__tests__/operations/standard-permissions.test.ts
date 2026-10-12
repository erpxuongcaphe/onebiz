import { describe, expect, it } from "vitest";
import { canProposeStandard, canProposeRevision, initialMineFilters } from "@/lib/operations/standard-permissions";
import { commandSchema, type Standard, type Workspace } from "@/lib/operations/contracts";
const workspace = { userId: "manager", isCeo: false, branches: [{ id: "branch", capabilities: ["work"] }], members: [{ user_id: "manager", member_role: "manager", active: true }] } as Workspace;
describe("Standard proposals and independent mine filters", () => {
  it("allows an active assigned manager, not a collaborator or unassigned user", () => {
    expect(canProposeStandard(workspace, "branch")).toBe(true);
    expect(canProposeStandard(workspace, "other")).toBe(false);
    expect(canProposeStandard({ ...workspace, members: [] }, "branch")).toBe(false);
    expect(canProposeStandard({ ...workspace, members: [{ ...workspace.members[0], active: false }] }, "branch")).toBe(false);
    expect(canProposeStandard({ ...workspace, members: [{ ...workspace.members[0], member_role: "reviewer" }] }, "branch")).toBe(false);
    expect(canProposeStandard({ ...workspace, branches: [{ ...workspace.branches[0], capabilities: ["view"] }] }, "branch")).toBe(false);
    expect(canProposeStandard({ ...workspace, isCeo: true }, "branch")).toBe(false);
  });
  it("limits revision proposals to branch standards and the author's returned proposal", () => {
    const standard = { scope: "branch", status: "approved", created_by: "other" } as Standard;
    expect(canProposeRevision(standard, "manager")).toBe(true);
    expect(canProposeRevision({ ...standard, scope: "common" }, "manager")).toBe(false);
    expect(canProposeRevision({ ...standard, status: "pending" }, "manager")).toBe(false);
    expect(canProposeRevision({ ...standard, status: "changes_requested" }, "manager")).toBe(false);
    expect(canProposeRevision({ ...standard, status: "changes_requested", created_by: "manager" }, "manager")).toBe(true);
  });
  it("defaults To-do to the entire permitted branch independently of Work", () => {
    expect(initialMineFilters).toEqual({ work: true, todo: false, review: false });
    const changedWork = { ...initialMineFilters, work: false };
    expect(changedWork.todo).toBe(false);
    expect({ ...changedWork, todo: true }.work).toBe(false);
  });
  it("accepts the two new commands but still requires a valid branch and request id", () => {
    for (const action of ["propose_standard", "request_standard_changes"]) {
      expect(commandSchema.safeParse({ action, requestId: "11111111-1111-4111-8111-111111111111", payload: { branchId: "22222222-2222-4222-8222-222222222222" } }).success).toBe(true);
      expect(commandSchema.safeParse({ action, requestId: "bad", payload: {} }).success).toBe(false);
    }
  });
});
