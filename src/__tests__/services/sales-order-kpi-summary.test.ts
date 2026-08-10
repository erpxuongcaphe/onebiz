import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const queryCalls: Array<{ method: string; args: unknown[] }> = [];
let rpcRow: Record<string, unknown> | null = null;

function makeQuery() {
  const result = { data: [], count: 0, error: null };
  const query = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: typeof result) => void) => resolve(result);
        }
        return (...args: unknown[]) => {
          queryCalls.push({ method: String(prop), args });
          return query;
        };
      },
    },
  );
  return query;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: [rpcRow], error: null };
    },
    from: () => makeQuery(),
  }),
  getCurrentTenantId: async () => "tenant-1",
  getCurrentContext: async () => ({ tenantId: "tenant-1", userId: "user-1" }),
  getPaginationRange: () => ({ from: 0, to: 14 }),
  handleError: (error: unknown) => {
    throw error;
  },
}));

vi.mock("@/lib/services/supabase/audit", () => ({
  recordAuditLog: vi.fn(),
}));

const {
  getOrders,
  getSalesOrderListSummary,
  khoaChiSoDonDatHang,
  taoBoNhoChiSoDonDatHang,
} = await import("@/lib/services/supabase/orders");

beforeEach(() => {
  rpcCalls.length = 0;
  queryCalls.length = 0;
  rpcRow = {
    tong_don: 37,
    tong_tien_hang: "12500000.25",
    tong_phi_giao: "450000",
    tong_can_thu: "3200000",
  };
});

describe("chỉ số Đơn đặt hàng từ RPC 00306", () => {
  it("ánh xạ đủ bốn chỉ số và chuyển tiền về kiểu số", async () => {
    await expect(getSalesOrderListSummary({})).resolves.toEqual({
      tongDon: 37,
      tongTienHang: 12_500_000.25,
      tongPhiGiao: 450_000,
      tongCanThu: 3_200_000,
    });
    expect(rpcCalls[0].name).toBe("get_sales_order_list_summary");
  });

  it("truyền đủ bộ lọc đơn và vận đơn, dùng mốc kết thúc đầu ngày kế tiếp", async () => {
    await getSalesOrderListSummary({
      branchId: "branch-1",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      statuses: ["draft", "completed"],
      search: " DH001 ",
      searchField: "code",
      deliveryPartnerId: "partner-1",
      shippingDateFrom: "2026-08-03",
      shippingDateTo: "2026-08-05",
      deliveryArea: " Bình Dương ",
      fulfillmentState: "pending",
      debtState: "outstanding",
      shippingState: "delivered",
      amountMin: 100_000,
      amountMax: 9_000_000,
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_branch_id: "branch-1",
      p_statuses: ["draft", "completed"],
      p_search: "DH001",
      p_search_field: "code",
      p_delivery_partner_id: "partner-1",
      p_delivery_area: "Bình Dương",
      p_fulfillment_state: "pending",
      p_debt_state: "outstanding",
      p_shipping_state: "delivered",
      p_amount_min: 100_000,
      p_amount_max: 9_000_000,
    });
    expect(rpcCalls[0].args.p_date_to_exclusive).toBe(
      "2026-08-10T17:00:00.000Z",
    );
    expect(rpcCalls[0].args.p_shipping_date_to_exclusive).toBe(
      "2026-08-05T17:00:00.000Z",
    );
  });

  it("lựa chọn Tất cả và chuỗi rỗng phải về null", async () => {
    await getSalesOrderListSummary({
      statuses: [],
      deliveryPartnerId: "all",
      deliveryArea: "   ",
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_statuses: null,
      p_delivery_partner_id: null,
      p_delivery_area: null,
    });
  });
});

describe("danh sách dùng cùng bộ lọc vận đơn", () => {
  it("tìm mã gồm cả code và order_code; tìm SĐT qua bảng customers", async () => {
    await getOrders({
      page: 0,
      pageSize: 15,
      search: "DH001",
      searchField: "code",
    });
    expect(queryCalls).toContainEqual({
      method: "or",
      args: ["code.ilike.%DH001%,order_code.ilike.%DH001%"],
    });

    queryCalls.length = 0;
    await getOrders({
      page: 0,
      pageSize: 15,
      search: "0909",
      searchField: "customer_phone",
    });
    const phoneSelect = queryCalls.find((call) => call.method === "select");
    expect(String(phoneSelect?.args[0])).toContain(
      "customers!invoices_customer_id_fkey!inner(phone, tenant_id)",
    );
    expect(queryCalls).toContainEqual({
      method: "eq",
      args: ["customer.tenant_id", "tenant-1"],
    });
    expect(queryCalls).toContainEqual({
      method: "ilike",
      args: ["customer.phone", "%0909%"],
    });
  });

  it("đối tác, ngày tạo vận đơn và địa chỉ đều đi vào quan hệ inner", async () => {
    await getOrders({
      page: 0,
      pageSize: 15,
      filters: {
        deliveryPartnerId: "partner-1",
        shippingDateFrom: "2026-08-01",
        shippingDateTo: "2026-08-10",
        deliveryArea: "Bình Dương",
      },
    });
    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain("shipping_orders_invoice_id_fkey!inner");
    expect(queryCalls).toContainEqual({
      method: "eq",
      args: ["shipments.partner_id", "partner-1"],
    });
    expect(queryCalls).toContainEqual({
      method: "ilike",
      args: ["shipments.receiver_address", "%Bình Dương%"],
    });
    expect(queryCalls.some((call) => call.method === "gte")).toBe(true);
    expect(queryCalls.some((call) => call.method === "lt")).toBe(true);
  });

  it("lọc đúng xuất hóa đơn, công nợ, khoảng tiền và trạng thái vận đơn", async () => {
    await getOrders({
      page: 0,
      pageSize: 15,
      filters: {
        fulfillmentState: "pending",
        debtState: "outstanding",
        amountMin: "100000",
        amountMax: "9000000",
        shippingState: "delivered",
      },
    });
    expect(queryCalls).toContainEqual({
      method: "is",
      args: ["fulfilled_by_id", null],
    });
    expect(queryCalls).toContainEqual({ method: "gt", args: ["debt", 0] });
    expect(queryCalls).toContainEqual({
      method: "gte",
      args: ["total", 100000],
    });
    expect(queryCalls).toContainEqual({
      method: "lte",
      args: ["total", 9000000],
    });
    expect(queryCalls).toContainEqual({
      method: "eq",
      args: ["shipments.status", "delivered"],
    });
  });

  it("chưa có vận đơn dùng anti-join, không nhân đôi hóa đơn", async () => {
    await getOrders({
      page: 0,
      pageSize: 15,
      filters: { shippingState: "none" },
    });
    const select = queryCalls.find((call) => call.method === "select");
    expect(String(select?.args[0])).toContain(
      "shipping_orders!shipping_orders_invoice_id_fkey(id)",
    );
    expect(String(select?.args[0])).not.toContain(
      "shipping_orders!shipping_orders_invoice_id_fkey!inner",
    );
    expect(queryCalls).toContainEqual({
      method: "is",
      args: ["shipments", null],
    });
  });
});

describe("nhớ tạm KPI", () => {
  const params = {
    branchId: "branch-1",
    statuses: ["completed", "draft"],
    deliveryPartnerId: "partner-1",
    deliveryArea: "Bình Dương",
  };

  it("đổi bất kỳ bộ lọc nào làm đổi khóa; thứ tự trạng thái không ảnh hưởng", () => {
    const key = khoaChiSoDonDatHang(params);
    expect(
      khoaChiSoDonDatHang({ ...params, deliveryPartnerId: "partner-2" }),
    ).not.toBe(key);
    expect(
      khoaChiSoDonDatHang({ ...params, deliveryArea: "Đồng Nai" }),
    ).not.toBe(key);
    expect(
      khoaChiSoDonDatHang({ ...params, shippingState: "delivered" }),
    ).not.toBe(key);
    expect(
      khoaChiSoDonDatHang({ ...params, amountMin: 500_000 }),
    ).not.toBe(key);
    expect(
      khoaChiSoDonDatHang({
        ...params,
        statuses: ["draft", "completed"],
      }),
    ).toBe(key);
  });

  it("kết quả bộ lọc cũ về muộn không được ghi đè bộ lọc mới", () => {
    const cache = taoBoNhoChiSoDonDatHang();
    const a = cache.batDau("A");
    const b = cache.batDau("B");
    expect(cache.conMoiNhat(a.luot)).toBe(false);
    expect(cache.conMoiNhat(b.luot)).toBe(true);
  });

  it("sau mutation phải xóa số cũ", () => {
    const cache = taoBoNhoChiSoDonDatHang();
    const summary = {
      tongDon: 1,
      tongTienHang: 100,
      tongPhiGiao: 0,
      tongCanThu: 100,
    };
    cache.luu("A", summary);
    expect(cache.batDau("A").sanCo).toEqual(summary);
    cache.xoaHet();
    expect(cache.batDau("A").sanCo).toBeUndefined();
  });
});
