import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
let queryResult: {
  data: Record<string, unknown>[];
  count: number;
  error: unknown;
};

function makeQuery(table: string) {
  const query = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: typeof queryResult) => void) =>
            resolve(queryResult);
        }
        return (...args: unknown[]) => {
          queryCalls.push({ table, method: String(prop), args });
          return query;
        };
      },
    },
  );
  return query;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: (table: string) => makeQuery(table) }),
  getCurrentTenantId: async () => "tenant-1",
  getCurrentContext: async () => ({
    tenantId: "tenant-1",
    branchId: "branch-1",
    userId: "user-1",
  }),
  getPaginationRange: ({ page, pageSize }: { page: number; pageSize: number }) => ({
    from: page * pageSize,
    to: page * pageSize + pageSize - 1,
  }),
  handleError: (error: unknown) => {
    throw error;
  },
}));

const { getStockTransfers } = await import(
  "@/lib/services/supabase/transfers"
);
const {
  phamViChuyenKho,
  getStockTransfersTheoPhamVi,
  demChuyenKhoChiNhanhKhac,
} = await import("@/lib/services/supabase/stock-transfer-list-scope");

beforeEach(() => {
  queryCalls.length = 0;
  queryResult = { data: [], count: 0, error: null };
});

describe("dich vu danh sach Chuyen kho", () => {
  it("ap dung trang thai, ngay, hai kho, nguoi tao va so mat hang", async () => {
    await getStockTransfers({
      page: 0,
      pageSize: 15,
      filters: {
        status: ["in_transit", "completed", "khong-hop-le"],
        dateFrom: "2026-08-01",
        dateTo: "2026-08-10",
        fromBranchId: "branch-from",
        toBranchId: "branch-to",
        createdBy: "user-2",
        itemCountMin: "2",
        itemCountMax: "30",
      },
    });

    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "in",
      args: ["status", ["in_transit", "completed"]],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "gte",
      args: ["created_at", "2026-07-31T17:00:00.000Z"],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "lt",
      args: ["created_at", "2026-08-10T17:00:00.000Z"],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "eq",
      args: ["from_branch_id", "branch-from"],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "eq",
      args: ["to_branch_id", "branch-to"],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "eq",
      args: ["created_by", "user-2"],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "gte",
      args: ["total_items", 2],
    });
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "lte",
      args: ["total_items", 30],
    });
  });

  it("tim san pham qua dong hang phia may chu", async () => {
    await getStockTransfers({
      page: 0,
      pageSize: 15,
      search: "CF-001",
      searchField: "product_code",
    });

    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "item_match:stock_transfer_items!inner(product_code, product_name)",
    );
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "ilike",
      args: ["item_match.product_code", "%CF-001%"],
    });
  });

  it("tim kho qua quan he inner va khoa dung tenant", async () => {
    await getStockTransfers({
      page: 0,
      pageSize: 15,
      search: "Kho Tong",
      searchField: "from_branch_name",
    });

    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "branches!stock_transfers_from_branch_id_fkey!inner(code, name, tenant_id)",
    );
    expect(queryCalls).toContainEqual({
      table: "stock_transfers",
      method: "eq",
      args: ["from_branch.tenant_id", "tenant-1"],
    });
  });

  it("anh xa du ma kho, ten kho va nguoi tao", async () => {
    queryResult = {
      count: 1,
      error: null,
      data: [
        {
          id: "transfer-1",
          code: "CK0001",
          from_branch_id: "branch-from",
          to_branch_id: "branch-to",
          from_branch: { code: "KHO", name: "Kho Tong" },
          to_branch: { code: "CN01", name: "Chi nhanh 1" },
          creator: { full_name: "Nhan vien A" },
          status: "completed",
          total_items: 4,
          note: "Chuyen buoi sang",
          created_by: "user-1",
          created_at: "2026-08-10T01:00:00Z",
          updated_at: "2026-08-10T02:00:00Z",
          completed_at: "2026-08-10T02:00:00Z",
        },
      ],
    };

    const result = await getStockTransfers({ page: 0, pageSize: 15 });
    expect(result.data[0]).toMatchObject({
      fromBranchCode: "KHO",
      fromBranchName: "Kho Tong",
      toBranchCode: "CN01",
      toBranchName: "Chi nhanh 1",
      createdByName: "Nhan vien A",
      totalItems: 4,
    });
  });
});

describe("pham vi chi nhanh Chuyen kho", () => {
  it("khong co chi nhanh va khong co quyen toan chuoi thi khong truy van", async () => {
    const scope = phamViChuyenKho({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    await expect(
      getStockTransfersTheoPhamVi(scope, { page: 0, pageSize: 15 }),
    ).resolves.toEqual({ data: [], total: 0 });
    expect(queryCalls).toHaveLength(0);
  });

  it("co xem toan chuoi con bat nhung mat quyen van bi ep ve chi nhanh", () => {
    expect(
      phamViChuyenKho({
        activeBranchId: "branch-1",
        viewAllBranches: true,
        duocXemToanChuoi: false,
      }),
    ).toEqual({
      mode: "branch",
      branchId: "branch-1",
      duocDemChiNhanhKhac: false,
    });
  });

  it("nguoi khong co quyen toan chuoi khong dem ngoai chi nhanh", async () => {
    const scope = phamViChuyenKho({
      activeBranchId: "branch-1",
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    await expect(demChuyenKhoChiNhanhKhac(scope, {})).resolves.toBe(0);
    expect(queryCalls).toHaveLength(0);
  });
});

describe("giao dien danh sach Chuyen kho", () => {
  const page = readFileSync(
    "src/app/(main)/hang-hoa/chuyen-kho/page.tsx",
    "utf8",
  );

  it("dung bo cuc gon va panel loc phu", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('title="Bộ lọc chuyển kho"');
    expect(page).not.toContain("<FilterSidebar>");
    expect(page).not.toContain("<SummaryCard");
  });

  it("co du bo loc nghiep vu va ngay tuy chinh", () => {
    for (const label of [
      "Thời gian tạo",
      "Trạng thái",
      "Kho xuất",
      "Kho nhận",
      "Người tạo",
      "Số mặt hàng",
    ]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).toContain("onFromChange={setDateFrom}");
    expect(page).toContain("onToChange={setDateTo}");
  });

  it("tim theo phieu, kho, san pham, nguoi tao va ghi chu", () => {
    for (const label of [
      "Mã phiếu",
      "Tên kho xuất",
      "Mã kho nhận",
      "Tên sản phẩm",
      "Mã sản phẩm",
      "Người tạo",
      "Ghi chú",
    ]) {
      expect(page).toContain(`label: "${label}"`);
    }
  });

  it("phan biet ket qua toan bo voi chi so trang hien tai", () => {
    expect(page).toContain('label="Kết quả"');
    expect(page).toContain('label="Mặt hàng trang này"');
    expect(page).toContain('label="Đang chuyển trang này"');
    expect(page).toContain('label="Hoàn thành trang này"');
  });

  it("xuat file theo dung pham vi, tim kiem va bo loc", () => {
    expect(page).toContain("getStockTransfersForExport({");
    expect(page).toContain("search: debouncedSearch || undefined");
    expect(page).toContain("searchField,");
    expect(page).toContain("filters: commonFilters");
    expect(page).toContain(
      'phamVi.mode === "branch" ? phamVi.branchId : undefined',
    );
  });
});
