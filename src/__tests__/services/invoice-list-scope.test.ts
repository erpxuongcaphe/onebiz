import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * PHẠM VI CHI NHÁNH — ĐẾM LỜI GỌI getInvoices THẬT
 *
 * Lỗi được sửa (CEO phát hiện): hàm cũ trả `branchId: undefined` cho CẢ hai ý
 * nghĩa trái ngược — "xem toàn chuỗi" và "chưa có chi nhánh". Người chưa được
 * gán chi nhánh, hoặc chi nhánh chưa tải xong, vô tình chạy truy vấn toàn
 * tenant.
 *
 * Tệp này KHÔNG kiểm giá trị hàm thuần và KHÔNG quét chuỗi mã nguồn — nó giả
 * lập `getInvoices` rồi ĐẾM số lời gọi và soi tham số từng lời gọi.
 */

const goiGetInvoices: Array<Record<string, unknown>> = [];
const goiRpcChiSo: Array<Record<string, unknown>> = [];

vi.mock("@/lib/services/supabase/invoices", () => ({
  getInvoices: async (p: Record<string, unknown>) => {
    goiGetInvoices.push(p);
    return { data: [], total: 0 };
  },
  getInvoiceListSummary: async (p: Record<string, unknown>) => {
    goiRpcChiSo.push(p);
    return {
      tatCaHoaDon: 0,
      hoanThanh: 0,
      daHuy: 0,
      giaTriHoanThanh: 0,
      giamGiaApDung: 0,
      soDongTheoBoLoc: 0,
    };
  },
}));

const {
  phamViChiNhanhHoaDon,
  getInvoicesTheoPhamVi,
  demHoaDonChiNhanhKhac,
  getChiSoTheoPhamVi,
} = await import("@/lib/services/supabase/invoice-list-scope");

const LOC = { page: 0, pageSize: 15, filters: {} };
const CN = "cn-1";

beforeEach(() => {
  goiGetInvoices.length = 0;
  goiRpcChiSo.length = 0;
});

describe("Không quyền + chưa có chi nhánh thì KHÔNG truy vấn", () => {
  it("getInvoices không được gọi lần nào", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    expect(pv.mode).toBe("none");
    const kq = await getInvoicesTheoPhamVi(pv, LOC);
    expect(goiGetInvoices).toHaveLength(0);
    expect(kq).toEqual({ data: [], total: 0 });
  });

  it("RPC chỉ số cũng không được gọi", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    expect(await getChiSoTheoPhamVi(pv, {})).toBeNull();
    expect(goiRpcChiSo).toHaveLength(0);
  });

  it("cờ xem toàn chuỗi còn sót mà không quyền, không chi nhánh vẫn im", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: undefined,
      viewAllBranches: true,
      duocXemToanChuoi: false,
    });
    expect(pv.mode).toBe("none");
    await getInvoicesTheoPhamVi(pv, LOC);
    await getChiSoTheoPhamVi(pv, {});
    expect(goiGetInvoices).toHaveLength(0);
    expect(goiRpcChiSo).toHaveLength(0);
  });
});

describe("Có quyền nhưng chưa bật toàn chuỗi + chưa có chi nhánh thì vẫn KHÔNG truy vấn", () => {
  it("getInvoices không được gọi", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: true,
    });
    expect(pv.mode).toBe("none");
    await getInvoicesTheoPhamVi(pv, LOC);
    expect(goiGetInvoices).toHaveLength(0);
  });

  it("cũng không được đếm chi nhánh khác", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: undefined,
      viewAllBranches: false,
      duocXemToanChuoi: true,
    });
    expect(await demHoaDonChiNhanhKhac(pv, { filters: {} })).toBe(0);
    expect(goiGetInvoices).toHaveLength(0);
  });
});

describe("Có chi nhánh thì mọi lời gọi PHẢI kèm chi nhánh đó", () => {
  it("không quyền: lời gọi duy nhất mang branchId đúng chi nhánh", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: CN,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    await getInvoicesTheoPhamVi(pv, LOC);
    expect(goiGetInvoices).toHaveLength(1);
    expect(goiGetInvoices[0].branchId).toBe(CN);
  });

  it("không quyền: KHÔNG phát sinh lời gọi đếm chi nhánh khác", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: CN,
      viewAllBranches: false,
      duocXemToanChuoi: false,
    });
    await getInvoicesTheoPhamVi(pv, LOC);
    await demHoaDonChiNhanhKhac(pv, { filters: {} });
    expect(goiGetInvoices).toHaveLength(1);
    expect(goiGetInvoices.every((g) => g.branchId === CN)).toBe(true);
  });

  it("có quyền nhưng chưa bật toàn chuỗi: danh sách vẫn kèm chi nhánh", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: CN,
      viewAllBranches: false,
      duocXemToanChuoi: true,
    });
    await getInvoicesTheoPhamVi(pv, LOC);
    expect(goiGetInvoices[0].branchId).toBe(CN);
  });

  it("có quyền: đếm chi nhánh khác là lời gọi RIÊNG, không kèm chi nhánh", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: CN,
      viewAllBranches: false,
      duocXemToanChuoi: true,
    });
    await getInvoicesTheoPhamVi(pv, LOC);
    await demHoaDonChiNhanhKhac(pv, { filters: {} });
    expect(goiGetInvoices).toHaveLength(2);
    expect(goiGetInvoices[0].branchId).toBe(CN);
    expect(goiGetInvoices[1].branchId).toBeUndefined();
    expect(goiGetInvoices[1].pageSize).toBe(1);
  });
});

describe("Chỉ có quyền VÀ đã bật mới được truy vấn toàn chuỗi", () => {
  it("branchId undefined chỉ xảy ra ở mode all", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: CN,
      viewAllBranches: true,
      duocXemToanChuoi: true,
    });
    expect(pv.mode).toBe("all");
    await getInvoicesTheoPhamVi(pv, LOC);
    await getChiSoTheoPhamVi(pv, {});
    expect(goiGetInvoices).toHaveLength(1);
    expect(goiGetInvoices[0].branchId).toBeUndefined();
    expect(goiRpcChiSo).toHaveLength(1);
    expect(goiRpcChiSo[0].branchId).toBeUndefined();
  });
});

describe("Mất quyền giữa chừng", () => {
  it("đang xem toàn chuỗi mà mất quyền thì quay về chi nhánh", async () => {
    // Trang tự tắt cờ; kể cả cờ còn sót thì hàm vẫn ép về chi nhánh.
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: CN,
      viewAllBranches: true,
      duocXemToanChuoi: false,
    });
    expect(pv.mode).toBe("branch");
    await getInvoicesTheoPhamVi(pv, LOC);
    await getChiSoTheoPhamVi(pv, {});
    expect(goiGetInvoices.every((g) => g.branchId === CN)).toBe(true);
    expect(goiRpcChiSo.every((g) => g.branchId === CN)).toBe(true);
  });

  it("mất quyền mà chưa có chi nhánh thì không truy vấn gì cả", async () => {
    const pv = phamViChiNhanhHoaDon({
      activeBranchId: undefined,
      viewAllBranches: true,
      duocXemToanChuoi: false,
    });
    await getInvoicesTheoPhamVi(pv, LOC);
    await getChiSoTheoPhamVi(pv, {});
    await demHoaDonChiNhanhKhac(pv, { filters: {} });
    expect(goiGetInvoices).toHaveLength(0);
    expect(goiRpcChiSo).toHaveLength(0);
  });
});

describe("Quét toàn bộ tổ hợp", () => {
  it("chỉ 2 tổ hợp được sinh lời gọi thiếu chi nhánh, cả hai đều đòi quyền", async () => {
    const toHop = [false, true].flatMap((viewAll) =>
      [false, true].flatMap((quyen) =>
        [undefined, CN].map((cn) => ({ viewAll, quyen, cn })),
      ),
    );
    const choPhep: string[] = [];
    for (const t of toHop) {
      goiGetInvoices.length = 0;
      const pv = phamViChiNhanhHoaDon({
        activeBranchId: t.cn,
        viewAllBranches: t.viewAll,
        duocXemToanChuoi: t.quyen,
      });
      await getInvoicesTheoPhamVi(pv, LOC);
      await demHoaDonChiNhanhKhac(pv, { filters: {} });
      if (goiGetInvoices.some((g) => g.branchId === undefined)) {
        choPhep.push(`viewAll=${t.viewAll} quyen=${t.quyen} cn=${t.cn ?? "khong"}`);
      }
    }
    // BẤT BIẾN quan trọng nhất: KHÔNG tổ hợp nào thiếu quyền mà vẫn sinh
    // được lời gọi không kèm chi nhánh.
    expect(choPhep.every((s) => s.includes("quyen=true"))).toBe(true);

    // Ba trường hợp, cả ba đều đòi quyền:
    //   • bật xem toàn chuỗi + có quyền (có hay chưa chọn chi nhánh) → "all"
    //   • có quyền + có chi nhánh → truy vấn ĐẾM ở chi nhánh khác
    expect(choPhep.sort()).toEqual([
      "viewAll=false quyen=true cn=cn-1",
      "viewAll=true quyen=true cn=cn-1",
      "viewAll=true quyen=true cn=khong",
    ]);
  });
});
