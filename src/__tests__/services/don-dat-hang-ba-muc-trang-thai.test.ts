import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  trangThaiXuLyDon,
  NHAN_TRANG_THAI_XU_LY,
} from "@/lib/services/supabase/orders";

/**
 * BA MỨC XỬ LÝ ĐƠN ĐẶT HÀNG (CEO 21/08/2026).
 *
 * Một đơn đặt hàng được phép tạo KHÔNG GIỚI HẠN đơn bán con, nên không được tự
 * hoàn tất đơn ngay khi đơn con đầu tiên thanh toán xong, và cũng KHÔNG được
 * gọi đơn đã có hóa đơn completed là "Chờ xử lý".
 *
 *   cho_xu_ly  — chưa gắn hóa đơn VÀ chưa có đơn con nào đã thanh toán
 *   dang_xu_ly — đã có ≥1 đơn con đã thanh toán nhưng CHƯA gắn
 *   hoan_tat   — đã gắn hóa đơn (fulfilled_by_id khác null)
 */

describe("trangThaiXuLyDon — ba mức", () => {
  it("chưa gắn, không có đơn con đã thanh toán → Chờ xử lý", () => {
    expect(trangThaiXuLyDon({ completedChildCount: 0 })).toBe("cho_xu_ly");
  });

  it("chưa gắn, có 1 đơn con đã thanh toán → Đang xử lý (KHÔNG phải chờ xử lý)", () => {
    expect(trangThaiXuLyDon({ completedChildCount: 1 })).toBe("dang_xu_ly");
  });

  it("chưa gắn, có nhiều đơn con đã thanh toán → vẫn Đang xử lý", () => {
    expect(trangThaiXuLyDon({ completedChildCount: 5 })).toBe("dang_xu_ly");
  });

  it("đã gắn hóa đơn → Hoàn tất, bất kể số đơn con", () => {
    expect(trangThaiXuLyDon({ fulfilledById: "hd-1", completedChildCount: 0 })).toBe("hoan_tat");
    expect(trangThaiXuLyDon({ fulfilledById: "hd-1", completedChildCount: 9 })).toBe("hoan_tat");
  });

  it("KHÔNG tự hoàn tất khi đơn con đầu tiên thanh toán xong", () => {
    // Đây là chốt nghiệp vụ: có hóa đơn ≠ hoàn tất xử lý.
    expect(trangThaiXuLyDon({ completedChildCount: 1 })).not.toBe("hoan_tat");
  });

  it("máy chủ chưa trả số đếm (undefined) → giữ hành vi cũ, không đoán bừa", () => {
    expect(trangThaiXuLyDon({})).toBe("cho_xu_ly");
    expect(trangThaiXuLyDon({ fulfilledById: "hd-1" })).toBe("hoan_tat");
  });

  it("có đủ ba nhãn tiếng Việt", () => {
    expect(NHAN_TRANG_THAI_XU_LY.cho_xu_ly.nhan).toBe("Chờ xử lý");
    expect(NHAN_TRANG_THAI_XU_LY.dang_xu_ly.nhan).toBe("Đang xử lý");
    expect(NHAN_TRANG_THAI_XU_LY.hoan_tat.nhan).toBe("Hoàn tất");
  });
});

describe("Đếm đơn con chỉ tính hóa đơn CÒN HIỆU LỰC", () => {
  const svc = readFileSync(
    join(process.cwd(), "src/lib/services/supabase/orders.ts"),
    "utf8",
  );
  const ham = svc.slice(
    svc.indexOf("export async function demDonConHoanTat"),
    svc.indexOf("export interface OrderReconRow"),
  );

  it("lọc status completed và loại nháp/huỷ/void/xoá mềm", () => {
    expect(ham).toContain('.eq("status", "completed")');
    expect(ham).toContain('.is("deleted_at", null)');
    expect(ham).toContain('.is("voided_at", null)');
    expect(ham).toContain('.is("cancelled_at", null)');
  });

  it("máy chủ chưa có cột → trả null, KHÔNG trả 0", () => {
    expect(ham).toContain("if (error.code === MA_LOI_CHUA_CO_COT) return null");
  });

  it("giới hạn danh sách id có BÁO LỖI RÕ, không âm thầm cắt", () => {
    const loc = svc.slice(
      svc.indexOf("async function layIdDonCoConHoanTat"),
      svc.indexOf("export async function demDonConHoanTat"),
    );
    expect(loc).toContain("TRAN_ID_LOC_BA_MUC");
    expect(loc).toContain("throw new Error");
    expect(loc).toContain("thu hẹp bớt");
  });
});

describe("Bộ lọc phân biệt đủ ba mức", () => {
  const trang = readFileSync(
    join(process.cwd(), "src/app/(main)/don-hang/dat-hang/page.tsx"),
    "utf8",
  );
  const svc = readFileSync(
    join(process.cwd(), "src/lib/services/supabase/orders.ts"),
    "utf8",
  );

  it("màn danh sách có đủ ba lựa chọn lọc", () => {
    const khoi = trang.slice(
      trang.indexOf("const fulfillmentOptions"),
      trang.indexOf("const debtStateOptions"),
    );
    expect(khoi).toContain('{ label: "Chờ xử lý", value: "pending" }');
    expect(khoi).toContain('{ label: "Đang xử lý", value: "processing" }');
    expect(khoi).toContain('{ label: "Hoàn tất", value: "fulfilled" }');
    // Nhãn cũ hai mức phải biến mất.
    expect(khoi).not.toContain("Chưa xuất hóa đơn");
  });

  it("máy chủ lọc đúng: pending loại đơn đã có hóa đơn, processing chỉ lấy đơn đó", () => {
    const khoi = svc.slice(
      svc.indexOf('if (fulfillmentState === "fulfilled")'),
      svc.indexOf('if (debtState === "outstanding")'),
    );
    expect(khoi).toContain("layIdDonCoConHoanTat");
    expect(khoi).toContain('query.not("id", "in"');
    expect(khoi).toContain('query.in("id", coCon)');
  });

  it("danh sách hiện 'Đang xử lý · N hóa đơn', không gọi là Chờ xử lý", () => {
    expect(trang).toContain("Đang xử lý · {n} hóa đơn");
    expect(trang).toContain('trangThaiXuLyDon(row.original)');
  });
});

describe("Modal POS vẫn chọn được đơn Đang xử lý", () => {
  const pos = readFileSync(join(process.cwd(), "src/app/pos/page.tsx"), "utf8");

  it("chỉ loại đơn ĐÃ GẮN hóa đơn, không loại đơn đang xử lý", () => {
    expect(pos).toContain("r.data.filter((o) => !o.fulfilledById)");
  });

  it("có dấu hiệu 'Đã có N hóa đơn' để thu ngân biết", () => {
    expect(pos).toContain('trangThaiXuLyDon(o) === "dang_xu_ly"');
    expect(pos).toContain("Đã có {o.completedChildCount} hóa đơn");
  });
});
