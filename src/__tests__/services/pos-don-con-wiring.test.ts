import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 17/08/2026 — PR3 luồng đơn bán con: POS "Xử lý đặt hàng" + cách ly tab.
 *
 * TRƯỚC: onPick nạp THẲNG đơn gốc vào giỏ → thanh toán biến đơn gốc thành
 * hoá đơn; 2 tab mở cùng đơn dùng chung client session, lưu sau đè lưu trước.
 *
 * SAU: mỗi lần chọn → máy chủ tạo MỘT đơn con mới (id/mã/session riêng) và
 * POS nạp ĐƠN CON. Cách ly tab tự nhiên: mỗi lần bấm là session mới, không
 * còn hai tab chung session.
 */

const POS = readFileSync("src/app/pos/page.tsx", "utf8").replace(/\r\n/g, "\n");

/** Khoanh đúng khối onPick của ProcessOrderModal. */
function khoiOnPick(): string {
  const dau = POS.indexOf("onPick={async (orderId) => {");
  expect(dau).toBeGreaterThan(-1);
  const cuoi = POS.indexOf("Xác nhận hành động huỷ", dau);
  return POS.slice(dau, cuoi > dau ? cuoi : dau + 3000);
}

describe("POS Xử lý đặt hàng — tạo đơn con, không nạp đơn gốc", () => {
  it("onPick gọi createChildSaleFromOrder rồi nạp ĐƠN CON (childId)", () => {
    const khoi = khoiOnPick();
    expect(khoi).toContain("createChildSaleFromOrder(orderId)");
    expect(khoi).toContain("getDraftOrderById(child.childId)");
  });

  it("KHÔNG còn đường nạp thẳng đơn gốc trong onPick", () => {
    const khoi = khoiOnPick();
    expect(khoi).not.toContain("getDraftOrderById(orderId)");
  });

  it("lỗi tạo đơn con → báo lỗi, KHÔNG rơi về nạp đơn gốc (đường cũ là lỗi đang sửa)", () => {
    const khoi = khoiOnPick();
    const sauCatch = khoi.slice(khoi.indexOf("} catch (err)"));
    expect(sauCatch).toContain("Không tạo được đơn bán");
    expect(sauCatch).not.toContain("getDraftOrderById(orderId)");
    expect(sauCatch).not.toContain("applyDraftToActiveTab");
  });

  it("toast nói rõ: đơn bán mới + đơn đặt gốc giữ nguyên", () => {
    const khoi = khoiOnPick();
    expect(khoi).toContain("Đã tạo đơn bán");
    expect(khoi).toContain("Đơn đặt gốc giữ nguyên");
  });

  it("import service qua barrel — không import lậu đường khác", () => {
    expect(POS).toContain("createChildSaleFromOrder,");
  });
});

describe("cách ly tab/session — cơ chế sẵn có vẫn nguyên", () => {
  it("applyDraftToActiveTab chỉ cấp session mới khi nháp CHƯA có (đơn con luôn có sẵn)", () => {
    const dau = POS.indexOf("const applyDraftToActiveTab");
    const khoi = POS.slice(dau, POS.indexOf("const switchTab", dau));
    // Đơn con sinh từ RPC luôn mang client_session_id riêng → nhánh adopt
    // (cấp session vào bản ghi) không chạy trên đơn con.
    expect(khoi).toContain("let sessionId = detail.clientSessionId;");
    expect(khoi).toContain("if (!sessionId) {");
    // Token chống kết quả cũ đè giữa các tab vẫn phải đứng.
    expect(khoi).toContain("isCartLoadCurrent(token)");
  });
});
