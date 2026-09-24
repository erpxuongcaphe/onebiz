import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/00395_fnb_free_size_price_opt_in.sql"),
  "utf8",
);
const sizeSource = readFileSync(
  join(process.cwd(), "supabase/migrations/00357_atomic_fnb_size_setup.sql"),
  "utf8",
);
const createSource = readFileSync(
  join(process.cwd(), "supabase/migrations/00365_create_fnb_product_with_size_setup_atomic.sql"),
  "utf8",
);
const resolverSource = readFileSync(
  join(process.cwd(), "supabase/migrations/00363_unified_sale_pricing.sql"),
  "utf8",
);

describe("00395 free FnB sizes", () => {
  it("changes only guarded FnB size, create and resolver functions", () => {
    expect(migration).toContain("save_fnb_size_setup_atomic_00357(uuid,jsonb)");
    expect(migration).toContain("create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])");
    expect(migration).toContain("resolve_sale_price_00363");
    expect(migration).toContain("v_sell_price = 0 and not v_allow_free_sale");
    expect(migration).toContain("p_product->>''allowFreeSale''");
    expect(migration).toContain("v_unit_price = 0 and not v_product.allow_free_sale");
    expect(migration).not.toMatch(/\bupdate\s+public\.(?:products|product_variants)\b/i);
  });

  it("targets the existing function bodies without changing Retail pricing", () => {
    expect(sizeSource).toContain("select p.category_id into v_category_id");
    expect(sizeSource).toContain("v_sell_price is null or v_sell_price <= 0 or v_cost_price < 0");
    expect(createSource).toContain("sell_price, cost_price, category_id,");
    expect(createSource).toContain("v_sell_price, v_cost_price,");
    expect(resolverSource).toContain("select p.id, p.sell_price into v_product");
    expect(resolverSource).toContain("p_channel = 'fnb' and coalesce(v_unit_price, 0) <= 0");
    expect(migration).toContain("p_channel = ''fnb'' and (v_unit_price is null");
  });
});
