import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00374_split_retail_fnb_open_shift_permissions.sql",
  "utf8",
);
const service = readFileSync("src/lib/services/supabase/shifts.ts", "utf8");
const retailPage = readFileSync("src/app/pos/page.tsx", "utf8");
const fnbPage = readFileSync("src/app/pos/fnb/page.tsx", "utf8");

describe("POS shift channel permissions", () => {
  it("guards Retail and FnB shift entry points independently", () => {
    expect(migration).toContain("create or replace function public.open_shift_atomic");
    expect(migration).toContain("'pos_retail.checkout'");
    expect(migration).toContain("create or replace function public.fnb_open_shift_atomic");
    expect(migration).toContain("'pos_fnb.checkout'");
    expect(
      migration.match(/return public\._open_shift_checkout_impl_00298\(/g),
    ).toHaveLength(2);
  });

  it("keeps the internal atomic implementation private", () => {
    expect(migration).toContain(
      "revoke all on function public._open_shift_checkout_impl_00298(uuid,numeric)",
    );
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("routes each POS screen to its own RPC", () => {
    expect(service).toContain('channel: "retail" | "fnb"');
    expect(service).toContain('openShiftWithRpc(input, "retail")');
    expect(service).toContain('openShiftWithRpc(input, "fnb")');
    expect(service).toContain('p_channel: channel');
    expect(retailPage).toContain("openShift({");
    expect(retailPage).not.toContain("openFnbShift({");
    expect(fnbPage).toContain("openFnbShift({");
    expect(fnbPage).not.toContain("openShift({");
  });

  it("does not fall back to legacy endpoints", () => {
    expect(service).not.toContain('openShiftWithRpc(input, "open_shift_atomic")');
    expect(service).not.toContain('openShiftWithRpc(input, "fnb_open_shift_atomic")');
  });
});
