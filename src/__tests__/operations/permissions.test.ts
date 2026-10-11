import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PERMISSION_CODES, DEFAULT_ROLE_TEMPLATES, PERMISSION_GROUPS } from "@/lib/permissions/constants";
import { hasOperationsPermission, operationsPermissionByCapability } from "@/lib/operations/permissions";

describe("Hub uses OneBiz permissions and branch scope", () => {
  it("exposes seven clear permissions in the shared permission screen", () => {
    const codes = Object.values(operationsPermissionByCapability);
    expect(new Set(codes).size).toBe(7);
    for (const code of codes) {
      expect(ALL_PERMISSION_CODES).toContain(code);
      expect(PERMISSION_GROUPS.flatMap(group => group.permissions).filter(item => item.code === code)).toHaveLength(1);
    }
  });
  it("does not silently expand non-owner role templates", () => {
    for (const role of DEFAULT_ROLE_TEMPLATES.filter(role => role.legacyRole !== "owner"))
      expect(role.permissions.some(code => code.startsWith("ops."))).toBe(false);
  });
  it("requires view and action permissions together", () => {
    expect(hasOperationsPermission(["ops.verify"], "verify")).toBe(false);
    expect(hasOperationsPermission(["ops.view"], "verify")).toBe(false);
    expect(hasOperationsPermission(["ops.view", "ops.verify"], "verify")).toBe(true);
  });
  it("maps the same codes in SQL without auto-granting production roles", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/00301_operations_hub.sql"), "utf8");
    for (const [capability, code] of Object.entries(operationsPermissionByCapability))
      expect(sql).toContain(`when '${capability}' then '${code}'`);
    expect(sql).not.toMatch(/insert\s+into\s+(?:public\.)?(role_permissions|user_permission_overrides)/i);
    expect(sql).toContain("public.user_has_permission(p.id,p_code)");
  });
});
