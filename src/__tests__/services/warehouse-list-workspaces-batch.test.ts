import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/00316_warehouse_list_workspaces_batch.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/migrations/00316_rollback_warehouse_list_workspaces_batch.sql",
  "utf8",
);

const workspaces = [
  ["get_internal_export_list_workspace", "src/app/(main)/hang-hoa/xuat-dung-noi-bo/page.tsx"],
  ["get_inventory_check_list_workspace", "src/app/(main)/hang-hoa/kiem-kho/page.tsx"],
  ["get_stock_transfer_list_workspace", "src/app/(main)/hang-hoa/chuyen-kho/page.tsx"],
  ["get_production_order_list_workspace", "src/app/(main)/hang-hoa/san-xuat/page.tsx"],
  ["get_internal_sale_list_workspace", "src/app/(main)/hang-hoa/ban-noi-bo/page.tsx"],
] as const;

describe("00316 warehouse list workspaces", () => {
  it("is read-only and locks tenant, active profile, permission and branch scope", () => {
    const executableSql = migration.replace(/^--.*$/gm, "");
    expect(migration.match(/stable security invoker/gi)).toHaveLength(5);
    expect(migration.match(/get_user_tenant_id\(\)/g)).toHaveLength(5);
    expect(migration.match(/coalesce\(p\.is_active,true\)/g)).toHaveLength(5);
    expect(migration.match(/get_user_accessible_branches/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration.match(/user_has_branch_access/g)).toHaveLength(5);
    expect(executableSql).not.toMatch(/\b(insert|update|delete|truncate|alter table|create index|create trigger)\b/i);
  });

  for (const [rpc, pagePath] of workspaces) {
    it(`${rpc} is the single list source and has an exact rollback`, () => {
      const page = readFileSync(pagePath, "utf8");
      const serviceName = rpc
        .replace(/^get_/, "get_")
        .split("_")
        .map((part, index) => index === 0 ? part : part[0].toUpperCase() + part.slice(1))
        .join("")
        .replace(/^get_/, "get");
      expect(migration).toContain(`create or replace function public.${rpc}`);
      expect(migration).toContain(`revoke all on function public.${rpc}`);
      expect(migration).toContain(`grant execute on function public.${rpc}`);
      expect(rollback).toContain(`drop function if exists public.${rpc}`);
      expect(page.toLowerCase()).toContain(serviceName.toLowerCase());
      expect(page).toContain("summary.");
    });
  }

  it("keeps rollbacks limited to dropping the five read-only functions", () => {
    expect(rollback.match(/drop function if exists/g)).toHaveLength(5);
    expect(rollback).not.toMatch(/\b(insert|update|delete|truncate|alter table)\b/i);
  });

  it("exports all filtered rows and never labels page-only metrics as totals", () => {
    const files = workspaces.map(([, page]) => readFileSync(page, "utf8")).join("\n");
    expect(files).not.toContain("trang này");
    expect(files).toContain("getProductionOrdersForExport");
    expect(files).toContain("getInventoryChecksForExport");
    expect(files).toContain("getInternalExportsForExport");
    expect(files).toContain("getStockTransfersForExport");
    expect(files).toContain("getInternalSalesForExport");
  });
});
