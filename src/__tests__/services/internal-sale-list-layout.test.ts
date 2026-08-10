import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryCalls: Array<{
  table: string;
  method: string;
  args: unknown[];
}> = [];
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
  getCurrentContext: async () => ({
    tenantId: "tenant-1",
    branchId: "branch-1",
    userId: "user-1",
  }),
  handleError: (error: unknown) => {
    throw error;
  },
}));

const { getInternalSales } = await import(
  "@/lib/services/supabase/internal-sales"
);
const {
  phamViBanNoiBo,
  getInternalSalesTheoPhamVi,
  demBanNoiBoChiNhanhKhac,
} = await import("@/lib/services/supabase/internal-sale-list-scope");

beforeEach(() => {
  queryCalls.length = 0;
  queryResult = { data: [], count: 0, error: null };
});

describe("dịch vụ danh sách Bán nội bộ", () => {
  it("áp dụng đủ trạng thái, ngày, chi nhánh, người tạo và khoảng tiền", async () => {
    await getInternalSales({
      page: 1,
      pageSize: 15,
      filters: {
        status: ["completed", "cancelled", "khong-hop-le"],
        dateFrom: "2026-08-01",
        dateTo: "2026-08-10",
        fromBranchId: "branch-from",
        toBranchId: "branch-to",
        createdBy: "user-2",
        amountMin: "100000",
        amountMax: "9000000",
      },
    });

    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "in",
      args: ["status", ["completed", "cancelled"]],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "gte",
      args: ["created_at", "2026-07-31T17:00:00.000Z"],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "lt",
      args: ["created_at", "2026-08-10T17:00:00.000Z"],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "eq",
      args: ["from_branch_id", "branch-from"],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "eq",
      args: ["to_branch_id", "branch-to"],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "eq",
      args: ["created_by", "user-2"],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "gte",
      args: ["total", 100000],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "lte",
      args: ["total", 9000000],
    });
  });

  it("tìm chi nhánh qua quan hệ inner và khóa đúng tenant", async () => {
    await getInternalSales({
      page: 1,
      pageSize: 15,
      search: "Kho Tổng",
      searchField: "from_branch_name",
    });

    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "branches!internal_sales_from_branch_id_fkey!inner(code, name, tenant_id)",
    );
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "eq",
      args: ["from_branch.tenant_id", "tenant-1"],
    });
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "ilike",
      args: ["from_branch.name", "%Kho Tổng%"],
    });
  });

  it("tìm sản phẩm qua dòng hàng thay vì tải rồi lọc ở trình duyệt", async () => {
    await getInternalSales({
      page: 1,
      pageSize: 15,
      search: "CF-001",
      searchField: "product_code",
    });

    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "item_match:internal_sale_items!inner(product_code, product_name)",
    );
    expect(queryCalls).toContainEqual({
      table: "internal_sales",
      method: "ilike",
      args: ["item_match.product_code", "%CF-001%"],
    });
  });

  it("ánh xạ đủ mã và tên hai chi nhánh", async () => {
    queryResult = {
      count: 1,
      error: null,
      data: [
        {
          id: "sale-1",
          code: "BNB0001",
          from_branch_id: "branch-from",
          to_branch_id: "branch-to",
          from_branch: { code: "CN-X", name: "Xưởng" },
          to_branch: { code: "CN-Q", name: "Quán" },
          creator: { full_name: "Nhân viên A" },
          status: "completed",
          subtotal: 100000,
          tax_amount: 8000,
          total: 108000,
          note: "Giao buổi sáng",
          created_by: "user-1",
          created_at: "2026-08-10T01:00:00Z",
          updated_at: "2026-08-10T01:00:00Z",
        },
      ],
    };

    const result = await getInternalSales({ page: 1, pageSize: 15 });
    expect(result.data[0]).toMatchObject({
      fromBranchCode: "CN-X",
      fromBranchName: "Xưởng",
      toBranchCode: "CN-Q",
      toBranchName: "Quán",
      createdByName: "Nhân viên A",
      total: 108000,
    });
  });
});

describe("phạm vi chi nhánh Bán nội bộ", () => {
  it("không có chi nhánh và không có quyền toàn chuỗi thì không truy vấn", async () => {
    const scope = phamViBanNoiBo({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });

    await expect(
      getInternalSalesTheoPhamVi(scope, { page: 1, pageSize: 15 }),
    ).resolves.toEqual({ data: [], total: 0 });
    expect(queryCalls).toHaveLength(0);
  });

  it("cờ toàn chuỗi còn bật nhưng mất quyền vẫn bị ép về chi nhánh", () => {
    expect(
      phamViBanNoiBo({
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

  it("người không có quyền toàn chuỗi không phát sinh truy vấn đếm ngoài chi nhánh", async () => {
    const scope = phamViBanNoiBo({
      activeBranchId: "branch-1",
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    await expect(demBanNoiBoChiNhanhKhac(scope, {})).resolves.toBe(0);
    expect(queryCalls).toHaveLength(0);
  });
});

describe("giao diện danh sách Bán nội bộ", () => {
  const page = readFileSync(
    "src/app/(main)/hang-hoa/ban-noi-bo/page.tsx",
    "utf8",
  );

  it("dùng bố cục gọn và panel lọc phủ", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('title="Bộ lọc bán nội bộ"');
    expect(page).not.toContain("<FilterSidebar>");
    expect(page).not.toContain("<Card");
  });

  it("có đủ bộ lọc nghiệp vụ và ngày tùy chỉnh", () => {
    for (const label of [
      "Thời gian tạo",
      "Trạng thái",
      "Chi nhánh bán",
      "Chi nhánh mua",
      "Người tạo",
      "Tổng tiền",
    ]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).toContain("onFromChange={setDateFrom}");
    expect(page).toContain("onToChange={setDateTo}");
  });

  it("tìm theo mã, chi nhánh, sản phẩm, người tạo và ghi chú", () => {
    for (const label of [
      "Mã phiếu nội bộ",
      "Tên chi nhánh bán",
      "Mã chi nhánh mua",
      "Tên sản phẩm",
      "Mã sản phẩm",
      "Người tạo",
      "Ghi chú",
    ]) {
      expect(page).toContain(`label: "${label}"`);
    }
  });

  it("phân biệt chỉ số toàn bộ với số tiền của trang hiện tại", () => {
    expect(page).toContain('label="Kết quả"');
    expect(page).toContain('label="Giá trị trang này"');
    expect(page).toContain('label="Hoàn thành trang này"');
    expect(page).toContain('label="VAT trang này"');
  });

  it("xuất file theo đúng phạm vi, tìm kiếm và toàn bộ bộ lọc", () => {
    expect(page).toContain("getInternalSalesForExport({");
    expect(page).toContain("search: debouncedSearch || undefined");
    expect(page).toContain("searchField,");
    expect(page).toContain("filters: commonFilters");
    expect(page).toContain(
      'phamVi.mode === "branch" ? phamVi.branchId : undefined',
    );
    expect(page).not.toContain("exportToExcel(data,");
  });
});
