import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedPages = [
  "src/app/(main)/hang-hoa/page.tsx",
  "src/app/(main)/hang-hoa/nhap-hang/page.tsx",
  "src/app/(main)/hang-hoa/kiem-kho/page.tsx",
  "src/app/(main)/hang-hoa/xuat-huy/page.tsx",
  "src/app/(main)/hang-hoa/xuat-dung-noi-bo/page.tsx",
  "src/app/(main)/hang-hoa/san-xuat/page.tsx",
];

describe("phạm vi Tất cả chi nhánh của các danh sách kho", () => {
  for (const file of guardedPages) {
    it(`${file} chỉ bỏ lọc chi nhánh khi có quyền hiệu lực`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('"reports.view_all_branches"');
      expect(source).toContain('"system.manage_branches"');
      expect(source).toContain("duocXemToanChuoi");
      expect(source).toContain("if (!activeBranchId && !duocXemToanChuoi)");
      expect(source).not.toMatch(/(?<!duocXemToanChuoi && )viewAllBranches \? undefined/);
    });
  }

  it("Hóa đơn đầu vào chốt phạm vi chi nhánh trong RPC workspace", () => {
    const page = readFileSync(
      "src/app/(main)/hang-hoa/hoa-don-dau-vao/page.tsx",
      "utf8",
    );
    const migration = readFileSync(
      "supabase/migrations/00313_input_invoice_list_workspace.sql",
      "utf8",
    );

    expect(page).toContain("getInputInvoiceListWorkspace");
    expect(migration).toContain("reports.view_all_branches");
    expect(migration).toContain("system.manage_branches");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("ii.tenant_id = v_tenant");
  });

  it("supplier returns lock branch scope in the server workspace", () => {
    const page = readFileSync(
      "src/app/(main)/hang-hoa/tra-hang-nhap/page.tsx",
      "utf8",
    );
    const migration = readFileSync(
      "supabase/migrations/00314_supplier_return_list_workspace.sql",
      "utf8",
    );

    expect(page).toContain("getSupplierReturnListWorkspace");
    expect(migration).toContain("reports.view_all_branches");
    expect(migration).toContain("system.manage_branches");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("sr.tenant_id=v_tenant");
  });

  it("disposal exports lock branch scope in the server workspace", () => {
    const page = readFileSync(
      "src/app/(main)/hang-hoa/xuat-huy/page.tsx",
      "utf8",
    );
    const migration = readFileSync(
      "supabase/migrations/00315_disposal_export_list_workspace.sql",
      "utf8",
    );

    expect(page).toContain("getDisposalExportListWorkspace");
    expect(migration).toContain("reports.view_all_branches");
    expect(migration).toContain("system.manage_branches");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("d.tenant_id=v_tenant");
  });

  it("the remaining five warehouse lists lock branch scope in server workspaces", () => {
    const migration = readFileSync(
      "supabase/migrations/00316_warehouse_list_workspaces_batch.sql",
      "utf8",
    );
    for (const rpc of [
      "get_internal_export_list_workspace",
      "get_inventory_check_list_workspace",
      "get_stock_transfer_list_workspace",
      "get_production_order_list_workspace",
      "get_internal_sale_list_workspace",
    ]) {
      expect(migration).toContain(`create or replace function public.${rpc}`);
    }
    expect(migration.match(/reports\.view_all_branches/g)).toHaveLength(5);
    expect(migration.match(/system\.manage_branches/g)).toHaveLength(5);
    expect(migration.match(/user_has_branch_access/g)).toHaveLength(5);
  });
});
