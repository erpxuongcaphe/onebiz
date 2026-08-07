/**
 * PR-D — shiftState một nguồn + catalogStatus + lọc nhóm rỗng (06/08/2026).
 *
 * TEST HÀNH VI: cho đầu vào → kiểm đầu ra. Không đọc chuỗi class trong mã
 * nguồn (CEO đã yêu cầu rõ). Hai quy tắc được kiểm ở đây chính là hai quy
 * tắc trang POS FnB gọi — không có bản sao logic thứ hai.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  quyetDinhThanhToan,
  duocPhepLocNhomRong,
  locNhomRong,
  giuDuocCaDaBiet,
  type CatalogStatus,
  type ShiftStatus,
} from "@/app/pos/fnb/shift-catalog-guards";

const MOI_TRANG_THAI_CA: ShiftStatus[] = ["loading", "open", "none", "error"];
const MOI_TRANG_THAI_CATALOG: CatalogStatus[] = [
  "loading",
  "cache_ready",
  "fresh_ready",
  "error",
];

describe("PR-D · quyết định thanh toán (một cửa cho cả 3 lối vào)", () => {
  it("ca đang mở + có món → mở màn thanh toán", () => {
    expect(
      quyetDinhThanhToan({ lineCount: 2, isOnline: true, shiftStatus: "open" }),
    ).toBe("mo_thanh_toan");
  });

  it("giỏ RỖNG → không làm gì, dù ca ở bất kỳ trạng thái nào", () => {
    for (const shiftStatus of MOI_TRANG_THAI_CA) {
      expect(
        quyetDinhThanhToan({ lineCount: 0, isOnline: true, shiftStatus }),
      ).toBe("khong_lam_gi");
    }
  });

  it("đang kiểm tra ca → BÁO CHỜ, không kết luận chưa mở ca", () => {
    const qd = quyetDinhThanhToan({
      lineCount: 1,
      isOnline: true,
      shiftStatus: "loading",
    });
    expect(qd).toBe("cho_kiem_tra_ca");
    expect(qd).not.toBe("yeu_cau_mo_ca");
  });

  it("chắc chắn chưa mở ca → yêu cầu mở ca", () => {
    expect(
      quyetDinhThanhToan({ lineCount: 1, isOnline: true, shiftStatus: "none" }),
    ).toBe("yeu_cau_mo_ca");
  });

  it("LỖI KHÔNG PHẢI CHƯA MỞ CA — lỗi thì thử lại, không bắt mở ca chồng", () => {
    const qd = quyetDinhThanhToan({
      lineCount: 1,
      isOnline: true,
      shiftStatus: "error",
    });
    expect(qd).toBe("thu_lai_kiem_ca");
    // Đây chính là lỗi cũ: `.catch(() => null)` biến lỗi mạng thành "chưa
    // mở ca" → nhân viên bị bắt mở ca thứ hai chồng lên ca đang mở thật.
    expect(qd).not.toBe("yeu_cau_mo_ca");
  });

  it("OFFLINE + ca ĐÃ BIẾT CHẮC đang mở → vẫn bán được", () => {
    expect(
      quyetDinhThanhToan({ lineCount: 3, isOnline: false, shiftStatus: "open" }),
    ).toBe("mo_thanh_toan");
  });

  it("OFFLINE + chưa biết chắc ca → GIỮ GIỎ, KHÔNG cho thu tiền", () => {
    // CEO chốt 07/08. Bản trước cho bán offline ở mọi trạng thái → tiền có
    // thể không vào ca nào. Kể cả `none` cũng giữ giỏ: offline không mở ca được.
    for (const shiftStatus of ["loading", "none", "error"] as const) {
      expect(
        quyetDinhThanhToan({ lineCount: 3, isOnline: false, shiftStatus }),
      ).toBe("giu_gio_cho_ket_noi");
    }
  });

  it("offline chỉ ĐÚNG MỘT trạng thái được thu tiền", () => {
    const choMo = MOI_TRANG_THAI_CA.filter(
      (shiftStatus) =>
        quyetDinhThanhToan({ lineCount: 1, isOnline: false, shiftStatus }) ===
        "mo_thanh_toan",
    );
    expect(choMo).toEqual(["open"]);
  });

  it("offline + giỏ rỗng vẫn không mở màn thanh toán", () => {
    expect(
      quyetDinhThanhToan({ lineCount: 0, isOnline: false, shiftStatus: "error" }),
    ).toBe("khong_lam_gi");
  });

  it("chỉ có ĐÚNG MỘT trạng thái ca cho mở thanh toán khi đang online", () => {
    const choMo = MOI_TRANG_THAI_CA.filter(
      (shiftStatus) =>
        quyetDinhThanhToan({ lineCount: 1, isOnline: true, shiftStatus }) ===
        "mo_thanh_toan",
    );
    expect(choMo).toEqual(["open"]);
  });
});

describe("PR-D · giữ ca đã biết khi kiểm tra lại", () => {
  const CA = { branchId: "quan-1", cashierId: "nv-an" };

  it("cùng chi nhánh + cùng người → GIỮ, không rơi về null giữa chừng", () => {
    // Nếu không giữ, `currentShift` thành null trong lúc kiểm lại, mà thanh
    // toán ghi `shiftId: currentShift?.id` → phiếu thu mất liên kết ca.
    expect(giuDuocCaDaBiet(CA, "quan-1", "nv-an")).toBe(true);
  });

  it("ĐỔI CHI NHÁNH → KHÔNG giữ (không ghi tiền quán này vào ca quán kia)", () => {
    expect(giuDuocCaDaBiet(CA, "quan-2", "nv-an")).toBe(false);
  });

  it("đổi tài khoản → KHÔNG giữ", () => {
    expect(giuDuocCaDaBiet(CA, "quan-1", "nv-binh")).toBe(false);
  });

  it("chưa có ca / chưa biết chi nhánh / chưa biết người → KHÔNG giữ", () => {
    expect(giuDuocCaDaBiet(null, "quan-1", "nv-an")).toBe(false);
    expect(giuDuocCaDaBiet(undefined, "quan-1", "nv-an")).toBe(false);
    expect(giuDuocCaDaBiet(CA, "", "nv-an")).toBe(false);
    expect(giuDuocCaDaBiet(CA, "quan-1", "")).toBe(false);
  });
});

describe("PR-D · lọc nhóm hàng rỗng", () => {
  const NHOM = [
    { id: "ca-phe", count: 12 },
    { id: "tra-sua", count: 0 },
    { id: "banh", count: 3 },
  ];

  it("chỉ được lọc khi danh sách món đã đáng tin (cache/fresh)", () => {
    expect(duocPhepLocNhomRong("cache_ready")).toBe(true);
    expect(duocPhepLocNhomRong("fresh_ready")).toBe(true);
    expect(duocPhepLocNhomRong("loading")).toBe(false);
    expect(duocPhepLocNhomRong("error")).toBe(false);
  });

  it("cache_ready → ẩn nhóm 0 món", () => {
    expect(locNhomRong(NHOM, "cache_ready", null).map((c) => c.id)).toEqual([
      "ca-phe",
      "banh",
    ]);
  });

  it("fresh_ready → ẩn nhóm 0 món", () => {
    expect(locNhomRong(NHOM, "fresh_ready", null).map((c) => c.id)).toEqual([
      "ca-phe",
      "banh",
    ]);
  });

  it("ĐANG TẢI → KHÔNG lọc (products còn rỗng, lọc sẽ xoá sạch danh mục)", () => {
    const dangTai = [
      { id: "ca-phe", count: 0 },
      { id: "tra-sua", count: 0 },
    ];
    expect(locNhomRong(dangTai, "loading", null)).toHaveLength(2);
  });

  it("LỖI TẢI → KHÔNG lọc, thà hiện nhóm rỗng còn hơn giấu nhóm thật", () => {
    expect(locNhomRong(NHOM, "error", null).map((c) => c.id)).toEqual([
      "ca-phe",
      "tra-sua",
      "banh",
    ]);
  });

  it("LUÔN giữ nhóm đang chọn kể cả 0 món", () => {
    const ket_qua = locNhomRong(NHOM, "fresh_ready", "tra-sua");
    expect(ket_qua.map((c) => c.id)).toEqual(["ca-phe", "tra-sua", "banh"]);
  });

  it("không nhóm nào bị đổi thứ tự hay đổi count", () => {
    for (const trangThai of MOI_TRANG_THAI_CATALOG) {
      const ket_qua = locNhomRong(NHOM, trangThai, null);
      const goc = NHOM.filter((c) => ket_qua.some((k) => k.id === c.id));
      expect(ket_qua).toEqual(goc);
    }
  });
});

/**
 * Bỏ chú thích trước khi soi mã.
 *
 * Bẫy đã dính nhiều lần: chính chú thích giải thích lỗi cũ lại chứa đúng
 * chuỗi đang đi tìm (`.catch(() => null)`, `setPaymentOpen(true)`), làm test
 * hoặc báo đỏ oan, hoặc TỆ HƠN là xanh nhầm vì đếm cả chú thích.
 */
function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((dong) => !dong.trim().startsWith("//"))
    .join("\n");
}

describe("PR-D · trang POS FnB dùng đúng nguồn chung", () => {
  const ma = boChuThich(
    readFileSync(join(process.cwd(), "src/app/pos/fnb/page.tsx"), "utf8"),
  );

  it("chỉ requestPayment được mở màn thanh toán — 3 lối vào đều qua nó", () => {
    expect((ma.match(/setPaymentOpen\(true\)/g) ?? []).length).toBe(1);
    expect(ma).toContain("onPayment={requestPayment}");
    expect(ma).toContain("if (requestPayment()) setMobileCartOpen(false)");
  });

  it("F9 gọi requestPayment chứ không mở thẳng màn thanh toán", () => {
    const f9 = ma.slice(ma.indexOf('e.key === "F9"'));
    const than = f9.slice(0, f9.indexOf("}"));
    expect(than).toContain("requestPayment()");
    expect(than).not.toContain("setPaymentOpen");
  });

  it("gửi bếp (F10) KHÔNG bị chặn bởi trạng thái ca", () => {
    const f10 = ma.slice(ma.indexOf('e.key === "F10"'));
    const than = f10.slice(0, f10.indexOf("}"));
    expect(than).toContain("handleSendToKitchen()");
    expect(than).not.toContain("requestPayment");
  });

  it("giữ nguyên chuỗi markOverdueShiftsForBranch → getOpenShift", () => {
    const viTriMark = ma.indexOf("markOverdueShiftsForBranch(branchId)");
    const viTriGet = ma.indexOf("getOpenShift(branchId, userId)");
    expect(viTriMark).toBeGreaterThan(0);
    expect(viTriGet).toBeGreaterThan(viTriMark);
  });

  it("KHÔNG còn .catch(() => null) nuốt lỗi tải ca", () => {
    expect(ma).not.toContain(".catch(() => null)");
  });

  it("setCurrentShift đã bị thay hoàn toàn bằng setShiftState", () => {
    expect(ma).not.toContain("setCurrentShift");
    expect(ma).toContain('setShiftState({ status: "open", shift })');
    expect(ma).toContain('setShiftState({ status: "none" })');
  });

  it("effect tải ca có cờ huỷ chống kết quả cũ đè chi nhánh mới", () => {
    const viTri = ma.indexOf("markOverdueShiftsForBranch(branchId)");
    const khoi = ma.slice(viTri - 900, viTri + 900);
    expect(khoi).toContain("let cancelled = false");
    expect(khoi).toContain("if (cancelled) return");
    expect(khoi).toContain("cancelled = true");
  });

  it("mọi nhánh loading/error đều đi qua datNeuChuaBiet (giữ ca đã biết)", () => {
    // Không nhánh nào được setShiftState thẳng về loading/error — làm vậy là
    // xoá `currentShift` giữa chừng và phiếu thu mất liên kết ca.
    expect(ma).not.toContain('setShiftState({ status: "loading" })');
    expect(ma).not.toContain('setShiftState({ status: "error" })');
    expect((ma.match(/datNeuChuaBiet\(\{ status: "loading" \}\)/g) ?? []).length)
      .toBe(2);
    expect((ma.match(/datNeuChuaBiet\(\{ status: "error" \}\)/g) ?? []).length)
      .toBe(2);
  });

  it("lọc nhóm rỗng chỉ làm ở MỘT chỗ (categoriesWithCount)", () => {
    expect((ma.match(/locNhomRong\(/g) ?? []).length).toBe(1);
  });
});
