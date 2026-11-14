import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMktAccess } from "@/lib/mkt/use-mkt-access";

const state = vi.hoisted(() => ({ global: false, assigned: new Set<string>(), grants: new Set<string>() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({
    branches: [{ id: "a" }, { id: "b" }],
    hasPermission: () => state.global,
    hasAssignedBranchAccess: (id: string) => state.assigned.has(id),
    hasPermissionAtBranch: (_code: string, id: string) => state.grants.has(id),
  }),
}));

describe("MKT navigation access", () => {
  beforeEach(() => { state.global = false; state.assigned.clear(); state.grants.clear(); });
  it("shows the entry for a grant in any assigned branch", () => {
    state.assigned.add("b"); state.grants.add("b");
    expect(renderHook(() => useMktAccess()).result.current).toBe(true);
  });
  it("does not show the entry for an unassigned branch grant", () => {
    state.grants.add("b");
    expect(renderHook(() => useMktAccess()).result.current).toBe(false);
  });
  it("preserves access granted globally", () => {
    state.global = true;
    expect(renderHook(() => useMktAccess()).result.current).toBe(true);
  });
});
