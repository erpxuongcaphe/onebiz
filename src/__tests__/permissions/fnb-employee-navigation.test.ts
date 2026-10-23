import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_TEMPLATES,
  PERMISSIONS,
} from "@/lib/permissions/constants";

const topNav = readFileSync("src/components/shared/top-nav.tsx", "utf8");
const mobileNav = readFileSync(
  "src/components/shared/mobile-bottom-nav.tsx",
  "utf8",
);
const fnbDrawer = readFileSync(
  "src/app/pos/fnb/components/fnb-sidenav-drawer.tsx",
  "utf8",
);
const navConfig = readFileSync("src/components/shared/nav-config.ts", "utf8");

describe("FnB employee navigation permissions", () => {
  it("keeps cashier operations without granting cashbook access by default", () => {
    const role = DEFAULT_ROLE_TEMPLATES.find((item) => item.legacyRole === "cashier");

    expect(role).toBeDefined();
    expect(role?.permissions).not.toContain(PERMISSIONS.FINANCE_VIEW_CASH_BOOK);
    expect(role?.permissions).toEqual(expect.arrayContaining([
      PERMISSIONS.POS_FNB_CHECKOUT,
      PERMISSIONS.POS_FNB_SEND_KITCHEN,
      PERMISSIONS.POS_FNB_VIEW_ORDERS,
      PERMISSIONS.POS_FNB_SPLIT_BILL,
      PERMISSIONS.POS_FNB_TRANSFER_TABLE,
    ]));
  });

  it("provides a least-privilege kitchen and bar role template", () => {
    const role = DEFAULT_ROLE_TEMPLATES.find((item) => item.name === "Bếp / Bar");

    expect(role).toBeDefined();
    expect(role?.permissions).toEqual([PERMISSIONS.POS_FNB_VIEW_ORDERS]);
  });

  it("shows KDS independently from cashier POS permission", () => {
    expect(topNav).toContain(
      "const canSeeKds = hasPermission(PERMISSIONS.POS_FNB_VIEW_ORDERS)",
    );
    expect(topNav).toMatch(/\{canSeeKds && \(\s*<DropdownMenuItem[\s\S]*?posFnbUrl\("\/kds"\)/);
    expect(mobileNav).toContain("{canSeeKds && <a");
    expect(mobileNav).toContain('href={posFnbUrl("/kds")}');
  });

  it("filters mobile shortcuts and the FnB drawer by effective permissions", () => {
    expect(mobileNav).toContain(
      "if (tab.permission && !hasPermission(tab.permission)) return null",
    );
    expect(mobileNav).toContain("if (isB2B && !canSeeAnyPos) return null");
    expect(fnbDrawer).toContain("it.permissions.some(hasPermission)");
  });

  it("hides warehouse navigation from employees without inventory access", () => {
    for (const href of [
      "/hang-hoa/ton-kho",
      "/hang-hoa/lich-su-kho",
      "/hang-hoa/kiem-kho",
      "/hang-hoa/hsd",
      "/hang-hoa/chuyen-kho",
      "/hang-hoa/xuat-dung-noi-bo",
      "/hang-hoa/xuat-huy",
    ]) {
      expect(navConfig).toMatch(
        new RegExp(`href: "${href.replaceAll("/", "\\/")}"[^\\n]+permission: "inventory\\.view"`),
      );
    }
  });
});
