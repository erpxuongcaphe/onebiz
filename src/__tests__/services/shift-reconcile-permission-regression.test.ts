import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const permissionPage = readFileSync(
  "src/components/shared/permission-page.tsx",
  "utf8",
);
const shiftPage = readFileSync(
  "src/app/(main)/he-thong/ca-cho-doi-soat/page.tsx",
  "utf8",
);
const navConfig = readFileSync("src/components/shared/nav-config.ts", "utf8");
const mobileNav = readFileSync(
  "src/components/shared/mobile-bottom-nav.tsx",
  "utf8",
);

describe("shift reconcile permission contract", () => {
  it("lets a guarded page accept any one of several permissions", () => {
    expect(permissionPage).toContain("string | readonly string[]");
    expect(permissionPage).toContain("requiredPermissions.some");
  });

  it("accepts both global and own-branch reconcile permissions", () => {
    expect(shiftPage).toContain("PERMISSIONS.SHIFTS_RECONCILE_ANY");
    expect(shiftPage).toContain("PERMISSIONS.SHIFTS_RECONCILE_OWN_BRANCH");
    expect(navConfig).toContain(
      'permissions: ["shifts.reconcile_any", "shifts.reconcile_own_branch"]',
    );
  });

  it("uses the same any-permission rule in mobile navigation", () => {
    expect(mobileNav).toContain("permissions.some(hasPermission)");
  });
});
