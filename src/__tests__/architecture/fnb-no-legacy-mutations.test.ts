import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LEGACY_MUTATIONS = [
  "createKitchenOrder",
  "linkInvoiceToOrder",
  "updateOrderItemQty",
  "removeOrderItem",
  "cancelKitchenOrder",
  "applyOrderDiscount",
] as const;

const PRODUCTION_ROOTS = ["app", "components", "hooks", "lib"].map((folder) =>
  path.join(process.cwd(), "src", folder),
);

function listSourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe("FnB does not reopen legacy browser-side mutations", () => {
  it("keeps unsafe legacy helpers out of the public Supabase facade", () => {
    const facade = fs.readFileSync(
      path.join(process.cwd(), "src/lib/services/supabase/index.ts"),
      "utf8",
    );

    for (const helper of LEGACY_MUTATIONS) {
      expect(facade).not.toMatch(new RegExp(`\\b${helper}\\b`));
    }
  });

  it("prevents production modules from importing legacy mutation helpers", () => {
    const servicePath = path.normalize(
      path.join(process.cwd(), "src/lib/services/supabase/kitchen-orders.ts"),
    );
    const violations: string[] = [];

    for (const file of PRODUCTION_ROOTS.flatMap(listSourceFiles)) {
      if (path.normalize(file) === servicePath) continue;

      const source = fs.readFileSync(file, "utf8");
      for (const helper of LEGACY_MUTATIONS) {
        if (new RegExp(`\\b${helper}\\b`).test(source)) {
          violations.push(`${path.relative(process.cwd(), file)}: ${helper}`);
        }
      }
    }

    expect(violations).toEqual([]);
  }, 15_000);

  it("removes the legacy helpers instead of leaving a callable back door", () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), "src/lib/services/supabase/kitchen-orders.ts"),
      "utf8",
    );

    for (const helper of LEGACY_MUTATIONS) {
      expect(service).not.toMatch(
        new RegExp(`export\\s+async\\s+function\\s+${helper}\\b`),
      );
    }
  });

  it("does not keep browser-side writes to kitchen orders or their items", () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), "src/lib/services/supabase/kitchen-orders.ts"),
      "utf8",
    );

    for (const table of ["kitchen_orders", "kitchen_order_items"]) {
      expect(service).not.toMatch(
        new RegExp(
          `\\.from\\("${table}"\\)[\\s\\S]{0,320}?\\.(?:insert|update|delete)\\(`,
        ),
      );
    }
  });
});
