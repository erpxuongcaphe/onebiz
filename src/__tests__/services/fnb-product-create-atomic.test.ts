import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("atomic FnB product creation", () => {
  it("creates the parent, modifier override and size setup in one RPC transaction", () => {
    const migration = readFileSync(
      join(root, "supabase/migrations/00365_create_fnb_product_with_size_setup_atomic.sql"),
      "utf8",
    );

    expect(migration).toContain("insert into public.products");
    expect(migration).toContain("save_product_modifier_groups_atomic");
    expect(migration).toContain("save_fnb_size_setup_atomic");
    expect(migration).toContain("FNB_PRODUCT_CREATE_REQUIRED_FIELDS");
    expect(migration).toContain("revoke all on function");
    expect(migration).toContain("to authenticated");
  });

  it("routes new FnB products with per-size recipes through the atomic RPC", () => {
    const dialog = readFileSync(
      join(root, "src/components/shared/dialogs/create-product-dialog.tsx"),
      "utf8",
    );
    const service = readFileSync(
      join(root, "src/lib/services/supabase/variants.ts"),
      "utf8",
    );

    expect(dialog).toContain("createAtomicallyWithFnbSizes");
    expect(dialog).toContain("createFnbProductWithSizeSetupAtomic");
    expect(dialog).toContain("buildFnbSizeSetupPayload(code)");
    expect(service).toContain("create_fnb_product_with_size_setup_atomic");
  });
});
