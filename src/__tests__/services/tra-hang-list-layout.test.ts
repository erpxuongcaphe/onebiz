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
  getCurrentTenantId: async () => "tenant-1",
  getPaginationRange: ({ page, pageSize }: { page: number; pageSize: number }) => ({
    from: page * pageSize,
    to: page * pageSize + pageSize - 1,
  }),
  handleError: (error: unknown) => {
    throw error;
  },
}));

const { getReturns } = await import("@/lib/services/supabase/returns");
const { phamViTraHang, getReturnsTheoPhamVi } = await import(
  "@/lib/services/supabase/return-list-scope"
);

beforeEach(() => {
  queryCalls.length = 0;
  queryResult = { data: [], count: 0, error: null };
});

describe("dịch vụ danh sách Trả hàng", () => {
  it("áp dụng đúng ngày, trạng thái, người tạo, số tiền và hoàn tiền", async () => {
    await getReturns({
      page: 0,
      pageSize: 15,
      filters: {
        status: ["completed", "cancelled", "khong-hop-le"],
        dateFrom: "2026-08-01",
        dateTo: "2026-08-10",
        createdBy: "user-1",
        amountMin: "100000",
        amountMax: "9000000",
        refundState: "recorded",
      },
    });

    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "in",
      args: ["status", ["completed", "cancelled"]],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "gte",
      args: ["created_at", "2026-07-31T17:00:00.000Z"],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "lt",
      args: ["created_at", "2026-08-10T17:00:00.000Z"],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "eq",
      args: ["created_by", "user-1"],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "gte",
      args: ["total", 100000],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "lte",
      args: ["total", 9000000],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "gt",
      args: ["refunded", 0],
    });
  });

  it("tìm mã hóa đơn qua quan hệ inner và khóa tenant", async () => {
    await getReturns({
      page: 0,
      pageSize: 15,
      search: "HD001",
      searchField: "invoice_code",
    });
    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "invoices!sales_returns_invoice_id_fkey!inner(code, tenant_id)",
    );
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "eq",
      args: ["invoice.tenant_id", "tenant-1"],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "ilike",
      args: ["invoice.code", "%HD001%"],
    });
  });

  it("tìm mã và số điện thoại khách qua bảng customers", async () => {
    await getReturns({
      page: 0,
      pageSize: 15,
      search: "0909",
      searchField: "customer_phone",
    });
    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "customers!sales_returns_customer_id_fkey!inner(code, phone, tenant_id)",
    );
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "eq",
      args: ["customer.tenant_id", "tenant-1"],
    });
    expect(queryCalls).toContainEqual({
      table: "sales_returns",
      method: "ilike",
      args: ["customer.phone", "%0909%"],
    });
  });

  it("giữ nguyên trạng thái thật và ánh xạ đủ dữ liệu xuất file", async () => {
    queryResult = {
      count: 1,
      error: null,
      data: [
        {
          id: "return-1",
          code: "TH0001",
          invoice_id: "invoice-1",
          created_at: "2026-08-10T01:00:00Z",
          customer_name: "Anh Tín",
          total: "125000",
          refunded: "100000",
          status: "cancelled",
          created_by: "user-1",
          branch_id: "branch-1",
          reason: "Sai hàng",
          note: "Đã kiểm",
          invoice: { code: "HD0001" },
          customer: { code: "KHA-KLE-064", phone: "0909000000" },
          creator: { full_name: "Nhân viên A" },
          branch: { name: "Kho tổng" },
        },
      ],
    };

    const result = await getReturns({ page: 0, pageSize: 15 });
    expect(result.data[0]).toMatchObject({
      invoiceCode: "HD0001",
      customerCode: "KHA-KLE-064",
      customerPhone: "0909000000",
      totalAmount: 125000,
      refundedAmount: 100000,
      status: "cancelled",
      createdById: "user-1",
      createdBy: "Nhân viên A",
      branchName: "Kho tổng",
      reason: "Sai hàng",
      note: "Đã kiểm",
    });
  });
});

describe("phạm vi chi nhánh Trả hàng", () => {
  it("không có chi nhánh và không bật toàn chuỗi thì không truy vấn", async () => {
    const scope = phamViTraHang({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    await expect(
      getReturnsTheoPhamVi(scope, { page: 0, pageSize: 15 }),
    ).resolves.toEqual({ data: [], total: 0 });
    expect(queryCalls).toHaveLength(0);
  });

  it("cờ toàn chuỗi không có quyền vẫn bị ép về chi nhánh", () => {
    expect(
      phamViTraHang({
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
});

describe("giao diện danh sách Trả hàng", () => {
  const page = readFileSync(
    "src/app/(main)/don-hang/tra-hang/page.tsx",
    "utf8",
  );

  it("dùng bố cục gọn và panel lọc phủ", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('title="Bộ lọc trả hàng"');
    expect(page).not.toContain("<FilterSidebar>");
    expect(page).not.toContain("<SummaryCard");
  });

  it("chỉ hiển thị bộ lọc có dữ liệu thật và có ngày tùy chỉnh", () => {
    for (const label of [
      "Thời gian tạo",
      "Trạng thái",
      "Người tạo",
      "Giá trị phiếu",
      "Tình trạng hoàn tiền",
    ]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).toContain("onFromChange={setDateFrom}");
    expect(page).toContain("onToChange={setDateTo}");
    expect(page).not.toContain('label="Loại trả hàng"');
    expect(page).not.toContain('label="Người nhận trả"');
  });

  it("phân biệt chỉ số toàn bộ với số tiền của trang hiện tại", () => {
    expect(page).toContain('label="Kết quả"');
    expect(page).toContain('label="Giá trị trang này"');
    expect(page).toContain('label="Đã hoàn trang này"');
    expect(page).toContain('label="Còn hoàn trang này"');
    expect(page).not.toContain('label="Tổng tiền trả khách"');
  });

  it("xuất đủ thông tin và không chỉ xuất mảng 15 dòng đang xem", () => {
    for (const header of [
      "Mã hóa đơn",
      "Chi nhánh",
      "Mã khách hàng",
      "Số điện thoại",
      "Đã hoàn khách",
      "Lý do trả",
      "Người tạo",
      "Ghi chú",
    ]) {
      expect(page).toContain(`header: "${header}"`);
    }
    expect(page).toContain("pageSize: 500");
    expect(page).toContain("getReturnsTheoPhamVi(phamVi");
    expect(page).not.toContain("exportToExcel(data,");
  });
});
