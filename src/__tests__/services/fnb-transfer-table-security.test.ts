import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTransferTableErrorMessage } from "@/lib/services/supabase/kitchen-orders";

const migration = readFileSync(
  "supabase/migrations/00321_harden_fnb_transfer_table.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/migrations/00321_rollback_harden_fnb_transfer_table.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/kitchen-orders.ts",
  "utf8",
);
const audit = readFileSync("src/lib/services/supabase/audit.ts", "utf8");

describe("FnB table transfer security contract", () => {
  it("derives actor scope and verifies the legacy tenant argument", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("coalesce(p.is_active, true)");
    expect(migration).toContain("p_tenant_id is distinct from v_tenant_id");
    expect(migration).toContain("pos_fnb.transfer_table");
    expect(migration).toContain("user_has_branch_access");
  });

  it("locks the order and both tables before changing ownership", () => {
    expect(migration.match(/for update/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    );
    expect(migration).toContain("order by rt.id");
    expect(migration).toContain("FNB_TRANSFER_SOURCE_STALE");
    expect(migration).toContain("FNB_TRANSFER_DESTINATION_UNAVAILABLE");
    expect(migration).toContain("v_to_table.branch_id <> v_order.branch_id");
  });

  it("keeps the deployed client signature and records a Vietnamese audit action", () => {
    expect(service).toContain('"fnb_transfer_table_atomic"');
    expect(service).toContain("p_tenant_id: tenantId");
    expect(migration).toContain(
      "fnb_transfer_table_atomic(uuid, uuid, uuid, uuid)",
    );
    expect(migration).toContain("'fnb_transfer_table'");
    expect(audit).toContain('fnb_transfer_table: "Chuyển bàn FnB"');
  });

  it.each([
    ["FNB_TRANSFER_SAME_TABLE", "Vui lòng chọn một bàn khác."],
    [
      "FNB_TRANSFER_DESTINATION_UNAVAILABLE",
      "Bàn đích vừa có khách hoặc không còn trống. Vui lòng chọn bàn khác.",
    ],
    [
      "FNB_TRANSFER_SOURCE_STALE",
      "Đơn đã chuyển hoặc bàn nguồn vừa thay đổi. Vui lòng tải lại sơ đồ bàn.",
    ],
    [
      "FNB_TRANSFER_PERMISSION_REQUIRED",
      "Anh/chị không có quyền chuyển đơn sang bàn này.",
    ],
  ])(
    "translates %s into an actionable Vietnamese message",
    (code, expected) => {
      expect(
        getTransferTableErrorMessage({ message: `${code} (code: 42501)` }),
      ).toBe(expected);
    },
  );

  it("leaves unknown server failures to the shared error handler", () => {
    expect(
      getTransferTableErrorMessage({ message: "UNKNOWN_DATABASE_ERROR" }),
    ).toBeNull();
  });

  it("rollback fails closed instead of restoring the unsafe legacy function", () => {
    expect(rollback).toContain("revoke all");
    expect(rollback).toContain("drop function if exists");
    expect(rollback).not.toContain("create or replace function");
  });
});
