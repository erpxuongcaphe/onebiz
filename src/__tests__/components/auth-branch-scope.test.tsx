import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assigned: [{ branch_id: "premium" }], scopeError: null as null | { message: string },
  permissions: [] as string[], callback: undefined as undefined | ((event: string, session: unknown) => void),
  binding: null as null | { branchId: string },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/services/supabase/permission-overrides", () => ({ getUserEffectivePermissions: async () => state.permissions }));
vi.mock("@/lib/services/supabase/base", () => ({ _seedProfileCache: vi.fn(), _clearProfileCache: vi.fn() }));
vi.mock("@/lib/hooks/use-device-binding", () => ({ readDeviceBinding: () => state.binding }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "manager" } } } }),
    onAuthStateChange: (callback: typeof state.callback) => { state.callback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
    signOut: async () => undefined,
  },
  rpc: async () => ({ data: state.assigned, error: state.scopeError }),
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query,
      single: async () => ({ data: table === "profiles"
        ? { id: "manager", tenant_id: "tenant", branch_id: "premium", role: "staff", is_active: true, full_name: "Manager", created_at: "2026-01-01" }
        : { id: "tenant", name: "Tenant", settings: {} }, error: null }),
      order: async () => ({ data: [{ id: "warehouse", tenant_id: "tenant", name: "Warehouse", is_default: true }, { id: "premium", tenant_id: "tenant", name: "Premium" }], error: null }),
    };
    return query;
  },
}) }));
import { AuthProvider, useAuth } from "@/lib/contexts/auth-context";

function Probe() {
  const auth = useAuth();
  return <><output aria-label="scope">{JSON.stringify({ branches: auth.branches.map(b => b.id), current: auth.activeBranchId, ready: !auth.isLoading, tenant: auth.tenant?.id })}</output><button onClick={() => auth.switchBranch("warehouse")}>Warehouse</button><button onClick={() => auth.switchBranch(null)}>All</button></>;
}
beforeEach(() => { localStorage.clear(); state.assigned = [{ branch_id: "premium" }]; state.scopeError = null; state.permissions = []; state.binding = null; });
afterEach(cleanup);
const read = () => JSON.parse(screen.getByLabelText("scope").textContent!);

describe("authenticated branch restoration", () => {
  it("does not restore an administrator's cached warehouse for a manager", async () => {
    localStorage.setItem("active_branch_id", "warehouse");
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(read().current).toBe("premium"));
    expect(read().branches).toEqual(["premium"]);
    act(() => screen.getByRole("button", { name: "Warehouse" }).click());
    expect(read().current).toBe("premium");
    act(() => screen.getByRole("button", { name: "All" }).click());
    expect(read().current).toBe("premium");
  });
  it("does not use a device binding to escape assigned branches", async () => {
    state.binding = { branchId: "warehouse" };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(read().current).toBe("premium"));
    expect(read().branches).toEqual(["premium"]);
  });
  it("fails closed if the branch scope cannot be loaded", async () => {
    state.scopeError = { message: "denied" };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(read().ready).toBe(true));
    expect(read().branches).toEqual([]);
    expect(read().current).toBeUndefined();
    expect(read().tenant).toBeUndefined();
  });
  it("retains explicitly granted company-wide reading", async () => {
    state.permissions = ["reports.view_all_branches"];
    localStorage.setItem("active_branch_id", "__all__");
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(read().branches).toEqual(["warehouse", "premium"]));
    expect(read().current).toBeUndefined();
  });
});
