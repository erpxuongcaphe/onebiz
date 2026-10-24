import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, DEFAULT_ROLE_TEMPLATES, PERMISSION_GROUPS, PERMISSIONS } from "@/lib/permissions/constants";
describe("manager financial defaults", () => {
  it("keeps operational permissions but requires an explicit grant for sensitive financial reporting", () => {
    const manager = DEFAULT_ROLE_TEMPLATES.find(role => role.legacyRole === "manager")!;
    for (const code of [PERMISSIONS.PRODUCTS_VIEW_COST, PERMISSIONS.PRODUCTS_VIEW_PROFIT, PERMISSIONS.REPORTS_VIEW_PROFIT, PERMISSIONS.FINANCE_VIEW_REPORTS]) {
      expect(manager.permissions).not.toContain(code);
    }
    expect(manager.permissions).toContain(PERMISSIONS.FINANCE_VIEW_CASH_BOOK);
    expect(manager.permissions).toContain(PERMISSIONS.POS_FNB_CHECKOUT);
    expect(manager.permissions).toContain(PERMISSIONS.CUSTOMERS_VIEW_SALES);
    expect(manager.permissions).not.toContain(PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES);
  });
  it("exposes both activity capabilities as editable permissions and keeps cashier defaults separate", () => {
    const editable = PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission.code));
    for (const code of [PERMISSIONS.CUSTOMERS_VIEW_SALES, PERMISSIONS.SUPPLIERS_VIEW_PURCHASES]) {
      expect(ALL_PERMISSION_CODES).toContain(code); expect(editable).toContain(code);
      for (const role of DEFAULT_ROLE_TEMPLATES.filter(role => role.legacyRole === "cashier")) expect(role.permissions).not.toContain(code);
    }
  });
});
