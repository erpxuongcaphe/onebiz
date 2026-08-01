import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, eq, order } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}));

const query = {
  data: [],
  error: null,
  select: vi.fn(() => query),
  eq,
  order,
};
eq.mockImplementation(() => query);
order.mockImplementation(() => query);
from.mockImplementation(() => query);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc, from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
}));

import {
  getBranches,
  setBranchDefault,
  updateBranch,
  updateBranchSettings,
} from "@/lib/services/supabase/branches";

const migration = readFileSync(
  "supabase/migrations/00277_atomic_branch_management.sql",
  "utf8",
);
const service = readFileSync("src/lib/services/supabase/branches.ts", "utf8");
const page = readFileSync(
  "src/app/(main)/cai-dat/chi-nhanh/page.tsx",
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  from.mockClear();
  eq.mockClear();
  order.mockClear();
});

describe("atomic branch management", () => {
  it("keeps operational lists active-only but lets the admin page recover inactive branches", async () => {
    await getBranches();
    expect(eq).toHaveBeenCalledWith("is_active", true);

    eq.mockClear();
    await getBranches({ includeInactive: true });
    expect(eq).not.toHaveBeenCalledWith("is_active", true);
    expect(page).toContain("getBranches({ includeInactive: true })");
  });

  it("saves branch fields and default state through one server transaction", async () => {
    await updateBranch("branch-1", {
      name: "Chi nhánh 1",
      isDefault: true,
    });
    expect(rpc).toHaveBeenCalledWith("save_branch_atomic", {
      p_branch_id: "branch-1",
      p_payload: { name: "Chi nhánh 1", is_default: true },
    });
    expect(page).toContain("isDefault: form.isDefault");
    expect(page).not.toContain("const current = branches.find");
  });

  it("uses guarded RPCs for default and POS layout settings", async () => {
    await setBranchDefault("branch-1", "tenant-1");
    expect(rpc).toHaveBeenCalledWith("save_branch_atomic", {
      p_branch_id: "branch-1",
      p_payload: { is_default: true },
    });

    await updateBranchSettings("branch-1", { posLayoutMode: "manual" });
    expect(rpc).toHaveBeenCalledWith("update_branch_settings_atomic", {
      p_branch_id: "branch-1",
      p_patch: { pos_layout_mode: "manual" },
    });
  });

  it("derives tenant and actor, serializes defaults, validates references and audits", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("system.manage_branches");
    expect(migration).toContain("from public.tenants t where t.id = v_tenant_id for update");
    expect(migration).toContain("PRICE_TIER_NOT_FOUND");
    expect(migration).toContain("DEFAULT_BRANCH_CANNOT_DEACTIVATE");
    expect(migration).toContain("INACTIVE_BRANCH_CANNOT_BE_DEFAULT");
    expect(migration).toContain("pos_fnb.manage_tables");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("insert into public.audit_log");
    expect(service).not.toContain('.from("audit_log")');
  });
});
