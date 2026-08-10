import { beforeEach, describe, expect, it, vi } from "vitest";

const orderCalls: Array<Record<string, unknown>> = [];
const summaryCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/services/supabase/orders", () => ({
  getOrders: async (params: Record<string, unknown>) => {
    orderCalls.push(params);
    return { data: [], total: 0 };
  },
  getSalesOrderListSummary: async (params: Record<string, unknown>) => {
    summaryCalls.push(params);
    return { tongDon: 0, tongTienHang: 0, tongPhiGiao: 0, tongCanThu: 0 };
  },
}));

const {
  phamViDonDatHang,
  getOrdersTheoPhamVi,
  demDonDatHangChiNhanhKhac,
  getChiSoDonDatHangTheoPhamVi,
} = await import("@/lib/services/supabase/sales-order-list-scope");

const LOC = { page: 0, pageSize: 15, filters: {} };

beforeEach(() => {
  orderCalls.length = 0;
  summaryCalls.length = 0;
});

describe("phạm vi chi nhánh Đơn đặt hàng", () => {
  it("chưa có chi nhánh và không bật toàn chuỗi thì không gọi dữ liệu", async () => {
    const scope = phamViDonDatHang({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    expect(scope.mode).toBe("none");
    expect(await getOrdersTheoPhamVi(scope, LOC)).toEqual({ data: [], total: 0 });
    expect(await getChiSoDonDatHangTheoPhamVi(scope, {})).toBeNull();
    expect(orderCalls).toHaveLength(0);
    expect(summaryCalls).toHaveLength(0);
  });

  it("cờ toàn chuỗi còn sót nhưng đã mất quyền vẫn bị ép về chi nhánh", async () => {
    const scope = phamViDonDatHang({
      activeBranchId: "branch-1",
      viewAllBranches: true,
      duocXemToanChuoi: false,
    });
    await getOrdersTheoPhamVi(scope, LOC);
    await getChiSoDonDatHangTheoPhamVi(scope, {});
    expect(orderCalls[0].branchId).toBe("branch-1");
    expect(summaryCalls[0].branchId).toBe("branch-1");
  });

  it("chỉ khi vừa có quyền vừa bật mới bỏ branchId", async () => {
    const scope = phamViDonDatHang({
      activeBranchId: "branch-1",
      viewAllBranches: true,
      duocXemToanChuoi: true,
    });
    await getOrdersTheoPhamVi(scope, LOC);
    await getChiSoDonDatHangTheoPhamVi(scope, {});
    expect(scope.mode).toBe("all");
    expect(orderCalls[0].branchId).toBeUndefined();
    expect(summaryCalls[0].branchId).toBeUndefined();
  });

  it("global switcher chọn tất cả và có quyền thì xem toàn chuỗi", async () => {
    const scope = phamViDonDatHang({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: true,
    });
    await getOrdersTheoPhamVi(scope, LOC);
    await getChiSoDonDatHangTheoPhamVi(scope, {});
    expect(scope.mode).toBe("all");
    expect(orderCalls[0].branchId).toBeUndefined();
    expect(summaryCalls[0].branchId).toBeUndefined();
  });

  it("không có quyền thì tuyệt đối không đếm chi nhánh khác", async () => {
    const scope = phamViDonDatHang({
      activeBranchId: "branch-1",
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    expect(await demDonDatHangChiNhanhKhac(scope, { filters: {} })).toBe(0);
    expect(orderCalls).toHaveLength(0);
  });

  it("có quyền mới được chạy lời gọi đếm không kèm chi nhánh", async () => {
    const scope = phamViDonDatHang({
      activeBranchId: "branch-1",
      viewAllBranches: false,
      duocXemToanChuoi: true,
    });
    await demDonDatHangChiNhanhKhac(scope, { filters: {} });
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0].branchId).toBeUndefined();
    expect(orderCalls[0].pageSize).toBe(1);
  });
});
