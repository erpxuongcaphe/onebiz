import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  getCurrentContext: vi.fn(),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));
vi.mock("@/lib/services/supabase/audit", () => ({
  recordAuditLog: vi.fn(),
}));

import { updateTenantBusinessInfo } from "@/lib/services/supabase/tenant-settings";
import {
  saveDiscountPresets,
  updateDeliveryPlatformSettings,
} from "@/lib/services/supabase/fnb-platform-settings";
import { setBranchPrintBrand } from "@/lib/services/supabase/print-templates-engine";

const migration = readFileSync(
  "supabase/migrations/00278_atomic_operational_settings.sql",
  "utf8",
);
const tenantService = readFileSync(
  "src/lib/services/supabase/tenant-settings.ts",
  "utf8",
);
const fnbService = readFileSync(
  "src/lib/services/supabase/fnb-platform-settings.ts",
  "utf8",
);
const printService = readFileSync(
  "src/lib/services/supabase/print-templates-engine.ts",
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe("atomic operational settings", () => {
  it("patches business info without browser read-modify-write", async () => {
    await updateTenantBusinessInfo({ businessName: "OneBiz", taxCode: "031" });
    expect(rpc).toHaveBeenCalledWith("patch_tenant_settings_atomic", {
      p_section: "business_info",
      p_value: { business_name: "OneBiz", tax_code: "031" },
      p_replace: false,
    });
    const implementation = tenantService.slice(
      tenantService.indexOf("export async function updateTenantBusinessInfo("),
      tenantService.indexOf("// Day 18/05/2026"),
    );
    expect(implementation).not.toContain('.from("tenants")');
    expect(implementation).not.toContain("recordAuditLog");
  });

  it("patches platforms and replaces discount presets through the guarded RPC", async () => {
    await updateDeliveryPlatformSettings({
      direct: { active: true, commissionPercent: 0 },
    });
    expect(rpc).toHaveBeenCalledWith("patch_tenant_settings_atomic", {
      p_section: "fnb_delivery_platforms",
      p_value: { direct: { active: true, commissionPercent: 0 } },
      p_replace: false,
    });

    await saveDiscountPresets([
      { id: "p1", name: "Giảm 10%", mode: "percent", value: 10, active: true },
    ]);
    expect(rpc).toHaveBeenCalledWith("patch_tenant_settings_atomic", {
      p_section: "fnb_discount_presets",
      p_value: [
        { id: "p1", name: "Giảm 10%", mode: "percent", value: 10, active: true },
      ],
      p_replace: true,
    });
    expect(fnbService).not.toContain('.update({ settings:');
  });

  it("updates branch print overrides through a tenant-scoped server transaction", async () => {
    await setBranchPrintBrand("branch-1", { address: "Địa chỉ mới" });
    expect(rpc).toHaveBeenCalledWith("set_branch_print_brand_atomic", {
      p_branch_id: "branch-1",
      p_brand: { address: "Địa chỉ mới" },
    });
    const implementation = printService.slice(
      printService.indexOf("export async function setBranchPrintBrand("),
      printService.indexOf("/** Brand đã merge"),
    );
    expect(implementation).not.toContain('.from("branches")');
  });

  it("derives actor and tenant, uses effective permissions, locks rows and audits", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("system.manage_roles");
    expect(migration).toContain("pos_fnb.manage_tables");
    expect(migration).toContain("system.manage_branches");
    expect(migration).toContain("for update");
    expect(migration).toContain("SETTINGS_REPLACE_MODE_INVALID");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("'atomic', true");
  });
});
