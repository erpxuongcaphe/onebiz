import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  getPaginationRange: () => ({ from: 0, to: 19 }),
  handleError: (error: { message?: string }, context: string) => {
    throw new Error(`[${context}] ${error.message ?? "unknown"}`);
  },
}));

vi.mock("@/lib/services/supabase/purchase-orders", () => ({
  updatePurchaseOrderStatus: vi.fn(),
}));

const { getSupplierReturnListWorkspace, getSupplierReturnsForExport } =
  await import("@/lib/services/supabase/purchase-entries");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [{
        id: "sr-1",
        code: "THN000001",
        created_at: "2026-08-11T01:00:00Z",
        import_code: "PN000123",
        supplier_name: "Nha cung cap A",
        supplier_code: "NCC-001",
        total: "1250000",
        status: "draft",
        created_by: "user-1",
        branch_id: "branch-1",
        note: "Tra hang loi",
        profiles: { full_name: "Nhan vien A" },
        branches: { name: "Chi nhanh A" },
      }],
      total: 31,
      summary: { completedCount: 12, draftCount: 19, totalValue: "18500000" },
    },
    error: null,
  });
});

describe("getSupplierReturnListWorkspace", () => {
  it("maps supplier, branch and whole-filter metrics", async () => {
    const result = await getSupplierReturnListWorkspace({ page: 0, pageSize: 20 });

    expect(result.data[0]).toMatchObject({
      code: "THN000001",
      importCode: "PN000123",
      supplierCode: "NCC-001",
      supplierName: "Nha cung cap A",
      branchId: "branch-1",
      branchName: "Chi nhanh A",
      note: "Tra hang loi",
    });
    expect(result.total).toBe(31);
    expect(result.summary).toEqual({ completedCount: 12, draftCount: 19, totalValue: 18500000 });
  });

  it("passes every filter and the Vietnam date window to the RPC", async () => {
    await getSupplierReturnListWorkspace({
      page: 2,
      pageSize: 50,
      search: " PN000123 ",
      searchField: "import_code",
      status: "draft",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      amountMin: 100000,
      amountMax: 9000000,
      branchId: "branch-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "get_supplier_return_list_workspace",
      expect.objectContaining({
        p_page: 2,
        p_page_size: 50,
        p_search: "PN000123",
        p_search_field: "import_code",
        p_status: "draft",
        p_date_from: "2026-07-31T17:00:00.000Z",
        p_date_to_exclusive: "2026-08-10T17:00:00.000Z",
        p_amount_min: 100000,
        p_amount_max: 9000000,
        p_branch_id: "branch-1",
      }),
    );
  });

  it("exports every page from the same filtered workspace", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { items: [{ id: "sr-1", code: "A", status: "completed" }], total: 2, summary: {} },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: "sr-2", code: "B", status: "completed" }], total: 2, summary: {} },
        error: null,
      });

    const rows = await getSupplierReturnsForExport({ status: "completed" });
    expect(rows.map((row) => row.code)).toEqual(["A", "B"]);
    expect(rpc).toHaveBeenNthCalledWith(2, "get_supplier_return_list_workspace", expect.objectContaining({ p_page: 1, p_page_size: 200 }));
  });
});

describe("supplier-return workspace contract", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/00314_supplier_return_list_workspace.sql"),
    "utf8",
  );
  const rollback = fs.readFileSync(
    path.join(root, "supabase/migrations/00314_rollback_supplier_return_list_workspace.sql"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(root, "src/app/(main)/hang-hoa/tra-hang-nhap/page.tsx"),
    "utf8",
  );

  it("keeps the RPC read-only, tenant-scoped and permission-scoped", () => {
    const sql = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("stable");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("inventory.view");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("sr.tenant_id=v_tenant");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });

  it("uses one workspace for list, metrics, filters and complete exports", () => {
    expect(page).toContain("getSupplierReturnListWorkspace");
    expect(page).toContain("getSupplierReturnsForExport");
    expect(page).toContain("summary.draftCount");
    expect(page).toContain('searchField={searchField}');
    expect(page).toContain("<RangeFilter");
    expect(page).not.toContain("Phiếu tạm trang này");
    expect(page).not.toMatch(/const pageCompleted = data\.filter/);
  });

  it("provides an exact rollback without touching business rows", () => {
    expect(rollback).toContain("drop function if exists public.get_supplier_return_list_workspace");
    expect(rollback).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });
});
