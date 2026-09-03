import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_TEMPLATES, PERMISSIONS } from "@/lib/permissions/constants";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/00370_fnb_checkout_permission.sql"),
  "utf8",
);
const posPage = readFileSync(join(root, "src/app/pos/fnb/page.tsx"), "utf8");
const menuCache = readFileSync(
  join(root, "src/lib/offline/cache-manager.ts"),
  "utf8",
);
const itemDialog = readFileSync(
  join(root, "src/app/pos/fnb/components/fnb-item-dialog.tsx"),
  "utf8",
);

describe("FnB checkout permission", () => {
  it("grants checkout to cashier but not waiter or kitchen", () => {
    const cashier = DEFAULT_ROLE_TEMPLATES.find((role) => role.name === "Thu ngân F&B");
    const waiter = DEFAULT_ROLE_TEMPLATES.find((role) => role.name === "Phục vụ");
    const kitchen = DEFAULT_ROLE_TEMPLATES.find((role) => role.name === "Bếp / Bar");

    expect(cashier?.permissions).toContain(PERMISSIONS.POS_FNB_CHECKOUT);
    expect(waiter?.permissions).not.toContain(PERMISSIONS.POS_FNB_CHECKOUT);
    expect(kitchen?.permissions).not.toContain(PERMISSIONS.POS_FNB_CHECKOUT);
  });

  it("guards payment and shift opening on the server", () => {
    expect(migration.match(/user_has_permission\(v_actor, 'pos_fnb\.checkout'\)/g)).toHaveLength(2);
    expect(migration).toContain("FNB_CHECKOUT_DENIED");
    expect(migration).toContain("FNB_OPEN_SHIFT_DENIED");
    expect(migration).toContain("revoke all on function public._fnb_complete_payment_checkout_impl_00345");
    expect(migration).toContain("revoke all on function public._open_shift_checkout_impl_00298");
  });

  it("hides unfinished products and gates both desktop and mobile payment", () => {
    expect(posPage).toContain('.eq("allow_sale", true)');
    expect(posPage).toContain('.gt("sell_price", 0)');
    expect(posPage.match(/canCheckout=\{canCheckout\}/g)).toHaveLength(2);
    expect(posPage).toContain("hasPermission(PERMISSIONS.POS_FNB_CHECKOUT)");
  });

  it("does not restore unfinished products from offline cache", () => {
    expect(posPage).toContain("mustRefreshCatalog");
    expect(posPage).toContain("cachedProducts.length !== cached.products.length");
    expect(menuCache).toContain('.eq("allow_sale", true)');
    expect(menuCache).toContain('.gt("sell_price", 0)');
  });

  it("keeps variants without a selling price visible but unavailable", () => {
    expect(itemDialog).toContain('disabled={chuaCoGia}');
    expect(itemDialog).toContain('"Chưa có giá"');
    expect(itemDialog).toContain("v.is_default && v.sell_price > 0");
  });
});
