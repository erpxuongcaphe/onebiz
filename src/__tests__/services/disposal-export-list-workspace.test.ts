import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentContext: vi.fn(), getCurrentTenantId: vi.fn(), getPaginationRange: vi.fn(),
  handleError: (error: { message?: string }, context: string) => {
    throw new Error(`[${context}] ${error.message ?? "unknown"}`);
  },
}));

const { getDisposalExportListWorkspace, getDisposalExportsForExport } =
  await import("@/lib/services/supabase/inventory");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [{
        id: "de-1", code: "XH000001", created_at: "2026-08-11T01:00:00Z",
        total_products: 3, total_amount: "1250000", reason: "Het han", note: "Lo A",
        status: "cancelled", created_by: "user-1", branch_id: "branch-1",
        profiles: { full_name: "Nhan vien A" }, branches: { name: "Chi nhanh A" },
      }],
      total: 31,
      summary: { completedCount: 12, draftCount: 8, cancelledCount: 11, completedValue: "18500000" },
    },
    error: null,
  });
});

describe("getDisposalExportListWorkspace", () => {
  it("maps cancelled documents, branch and whole-filter metrics", async () => {
    const result = await getDisposalExportListWorkspace({ page: 0, pageSize: 20 });
    expect(result.data[0]).toMatchObject({
      code: "XH000001", status: "cancelled", totalProducts: 3,
      branchId: "branch-1", branchName: "Chi nhanh A", createdByName: "Nhan vien A",
    });
    expect(result.total).toBe(31);
    expect(result.summary).toEqual({ completedCount: 12, draftCount: 8, cancelledCount: 11, completedValue: 18500000 });
  });

  it("passes every filter and the Vietnam date window to the RPC", async () => {
    await getDisposalExportListWorkspace({
      page: 2, pageSize: 50, search: " NVL-001 ", searchField: "product",
      statuses: ["completed", "cancelled"], dateFrom: "2026-08-01", dateTo: "2026-08-10",
      amountMin: 100000, amountMax: 9000000, branchId: "branch-1",
    });
    expect(rpc).toHaveBeenCalledWith("get_disposal_export_list_workspace", expect.objectContaining({
      p_page: 2, p_page_size: 50, p_search: "NVL-001", p_search_field: "product",
      p_statuses: ["completed", "cancelled"], p_date_from: "2026-07-31T17:00:00.000Z",
      p_date_to_exclusive: "2026-08-10T17:00:00.000Z", p_amount_min: 100000,
      p_amount_max: 9000000, p_branch_id: "branch-1",
    }));
  });

  it("exports every page from the same filtered workspace", async () => {
    rpc
      .mockResolvedValueOnce({ data: { items: [{ id: "1", code: "A", status: "completed" }], total: 2, summary: {} }, error: null })
      .mockResolvedValueOnce({ data: { items: [{ id: "2", code: "B", status: "completed" }], total: 2, summary: {} }, error: null });
    const rows = await getDisposalExportsForExport({ statuses: ["completed"] });
    expect(rows.map((row) => row.code)).toEqual(["A", "B"]);
    expect(rpc).toHaveBeenNthCalledWith(2, "get_disposal_export_list_workspace", expect.objectContaining({ p_page: 1, p_page_size: 200 }));
  });
});

describe("disposal-export workspace contract", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/00315_disposal_export_list_workspace.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(root, "supabase/migrations/00315_rollback_disposal_export_list_workspace.sql"), "utf8");
  const page = fs.readFileSync(path.join(root, "src/app/(main)/hang-hoa/xuat-huy/page.tsx"), "utf8");

  it("keeps the RPC read-only, tenant-scoped and permission-scoped", () => {
    const sql = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("stable security invoker");
    expect(migration).toContain("inventory.view");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("d.tenant_id=v_tenant");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });

  it("uses one workspace for list, metrics, filters and complete exports", () => {
    expect(page).toContain("getDisposalExportListWorkspace");
    expect(page).toContain("getDisposalExportsForExport");
    expect(page).toContain("summary.completedValue");
    expect(page).toContain('searchField={searchField}');
    expect(page).toContain("<RangeFilter");
    expect(page).not.toContain("trang này");
    expect(page).not.toMatch(/data\.reduce\(/);
  });

  it("provides an exact rollback without touching business rows", () => {
    expect(rollback).toContain("drop function if exists public.get_disposal_export_list_workspace");
    expect(rollback).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });
});
