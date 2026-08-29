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
    expect(NHAN_TRANG_THAI_XU_LY.dang_xu_ly.nhan).toBe("Đã có hóa đơn");
    expect(NHAN_TRANG_THAI_XU_LY.hoan_tat.nhan).toBe("Đã có hóa đơn");
  });
});

describe("Đếm đơn con chỉ tính hóa đơn CÒN HIỆU LỰC", () => {
  const svc = readFileSync(
    join(process.cwd(), "src/lib/services/supabase/orders.ts"),
    "utf8",
  );
  const ham = svc.slice(
    svc.indexOf("export async function layTomTatDonConHoanTat"),
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

  it("đọc theo trang cho tới hết, KHÔNG đặt trần rồi thôi", () => {
    // Một đơn có rất nhiều hóa đơn con sẽ ăn hết quota và làm những đơn sau
    // đếm thiếu — số sai mà nhìn vẫn hợp lý là kiểu lỗi khó phát hiện nhất.
    expect(ham).toContain("for (let tu = 0; ; tu += CO_TRANG)");
    expect(ham).toContain("if (rows.length < CO_TRANG) break");
  });

  it("KHÔNG còn cách tải danh sách id rồi khử trùng", () => {
    expect(svc).not.toContain("layIdDonCoConHoanTat");
    expect(svc).not.toContain("TRAN_ID_LOC_BA_MUC");
    expect(svc).not.toContain("KHONG_BAO_GIO_KHOP");
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
    expect(khoi).toContain(
      '{ label: "Đã có hóa đơn - chưa xác nhận xử lý", value: "processing" }',
    );
    expect(khoi).toContain(
      '{ label: "Đã có hóa đơn - đã xác nhận xử lý", value: "fulfilled" }',
    );
    // Nhãn cũ hai mức phải biến mất.
    expect(khoi).not.toContain("Chưa xuất hóa đơn");
  });

  it("lọc bằng QUAN HỆ NHÚNG, không truyền danh sách UUID qua URL", () => {
    const khoi = svc.slice(
      svc.indexOf('if (fulfillmentState === "fulfilled")'),
      svc.indexOf('if (debtState === "outstanding")'),
    );
    // processing = `!inner` (phải có dòng con khớp); pending = `.is(<quan hệ>, null)`
    // (không có dòng nào khớp). Cùng mẫu trang này đã dùng cho vận đơn.
    expect(svc).toContain("invoices!invoices_source_order_id_fkey!inner(id)");
    expect(khoi).toContain('query.is("con_hoan_tat", null)');
    expect(khoi).toContain('.eq("con_hoan_tat.status", "completed")');
    expect(khoi).toContain('.is("con_hoan_tat.voided_at", null)');
    expect(khoi).toContain('.is("con_hoan_tat.cancelled_at", null)');
    // Tuyệt đối không quay lại cách truyền danh sách id.
    expect(khoi).not.toMatch(/\.in\("id"/);
    expect(khoi).not.toMatch(/\.not\("id", "in"/);
  });

  it("KPI và bảng dùng CHUNG điều kiện — RPC nhận đủ ba trạng thái", () => {
    const rpc = readFileSync(
      join(process.cwd(), "supabase/migrations/00341_order_summary_three_states.sql"),
      "utf8",
    );
    expect(rpc).toContain("'processing'");
    // Cùng bộ điều kiện "hóa đơn con còn hiệu lực" như phía client.
    expect(rpc).toContain("c.status = ''completed''");
    expect(rpc).toContain("c.deleted_at is null");
    expect(rpc).toContain("c.voided_at is null");
    expect(rpc).toContain("c.cancelled_at is null");
    // EXISTS tương quan ⇒ đơn có bao nhiêu hóa đơn con cũng chỉ tính MỘT lần.
    expect(rpc).toContain("exists (select 1 from public.invoices c");
  });

  it("fingerprint của 00341 khớp TỪNG DÒNG ĐƠN (thân hàm prod có CRLF)", () => {
    const rpc = readFileSync(
      join(process.cwd(), "supabase/migrations/00341_order_summary_three_states.sql"),
      "utf8",
    );
    // Đã đo thật: pg_get_functiondef trên bản cài trả về CRLF, nên mọi chuỗi
    // fingerprint bắc qua nhiều dòng đều trượt. Chỉ được khớp trong một dòng.
    for (const bien of ["c_wl_cu", "c_loc_cu"]) {
      const m = new RegExp(`${bien}\\s+constant text :=([^;]*);`).exec(rpc);
      expect(m, `thiếu ${bien}`).not.toBeNull();
      // Giá trị phải nằm gọn trên MỘT dòng với khai báo.
      expect(m![1], `${bien} không được bắc qua nhiều dòng`).not.toContain("\n");
    }
  });

  it("danh sách thống nhất theo việc có mã hóa đơn", () => {
    expect(trang).toContain("getOrderInvoiceCodes(row.original)");
    expect(trang).toContain('<FulfilledOrderStatus invoiceCodes={codes} />');
    expect(trang).not.toContain("Đã có {n} hóa đơn · Chưa chốt");
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
