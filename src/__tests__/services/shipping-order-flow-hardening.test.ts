import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 04/08/2026 — Đợt A (hoàn thiện giao hàng Retail).
 *
 * Khóa 3 hành vi để không ai vô tình mở lại đường cũ:
 *  1. Dialog "Tạo vận đơn" ở trang vận đơn phải đi qua RPC nguyên tử
 *     (createShipmentForInvoice) — bản cũ ghi thẳng bảng shipping_orders nên
 *     tiền hóa đơn không đổi, COD gõ tay lệch hóa đơn, không chặn 1 hóa đơn
 *     2 vận đơn, và lấy mã từ bộ đếm 'shipping' trùng tiền tố VD với bộ đếm
 *     'shipping_order' của RPC.
 *  2. Trang vận đơn không còn bộ lọc giả (khu vực 3 miền, thời gian hoàn
 *     thành) và cột "Mã KH" gắn cứng "—"; lọc thời gian tạo phải truyền
 *     xuống truy vấn thật.
 *  3. Thẻ KPI đếm trên toàn bộ vận đơn (getShippingStatusCounts), không đếm
 *     15 dòng của trang hiện tại.
 */

const dialog = readFileSync(
  "src/components/shared/dialogs/create-shipping-order-dialog.tsx",
  "utf8",
);
const shippingService = readFileSync(
  "src/lib/services/supabase/shipping.ts",
  "utf8",
);
const vanDonPage = readFileSync(
  "src/app/(main)/don-hang/van-don/page.tsx",
  "utf8",
);
const partnerDialog = readFileSync(
  "src/components/shared/dialogs/create-delivery-partner-dialog.tsx",
  "utf8",
);

describe("Shipping order creation goes through the atomic RPC", () => {
  it("creates the shipment via createShipmentForInvoice, never raw insert", () => {
    expect(dialog).toContain("createShipmentForInvoice({");
    expect(dialog).not.toMatch(/\.from\("shipping_orders"\)[\s\S]{0,160}\.insert\(/);
  });

  it("does not mint codes from the duplicate 'shipping' sequence", () => {
    // Mã vận đơn do RPC cấp từ bộ đếm 'shipping_order'; bộ đếm 'shipping'
    // (00003:89) cùng tiền tố VD nên client không được tự sinh mã nữa.
    expect(dialog).not.toContain('nextEntityCode("shipping")');
    expect(dialog).not.toContain("VD${Date.now()}");
  });

  it("computes COD from the invoice instead of a hand-typed amount", () => {
    expect(dialog).not.toContain("setCodAmount");
    expect(dialog).toContain("codPreview");
    // Đúng công thức RPC: tổng mới = tổng cũ + (phí mới − phí giao cũ)
    expect(dialog).toContain("shippingFee - selectedInvoice.deliveryFee");
    // Không cho gắn vận đơn vào hóa đơn đã hủy ngay từ ô tìm kiếm
    expect(dialog).toContain('.neq("status", "cancelled")');
  });

  it("service layer exposes the atomic path used by the dialog", () => {
    expect(shippingService).toContain('"attach_invoice_shipment_atomic"');
    expect(shippingService).toContain("export async function createShipmentForInvoice");
  });
});

describe("Van don list shows real filters and whole-dataset KPIs", () => {
  it("dropped the fake filters and hardcoded customer-code column", () => {
    expect(vanDonPage).not.toContain("deliveryRegionOptions");
    expect(vanDonPage).not.toContain("completedDatePreset");
    expect(vanDonPage).not.toContain('header: "Mã KH"');
  });

  it("passes the created-at range down to the query", () => {
    expect(vanDonPage).toContain("computeListPresetRange(createdDatePreset)");
    expect(vanDonPage).toContain("dateFrom");
    expect(shippingService).toContain("applyCreatedAtRangeFilter(query, params.filters)");
  });

  it("KPI cards read status counts for the whole tenant", () => {
    expect(vanDonPage).toContain("getShippingStatusCounts()");
    expect(shippingService).toContain("export async function getShippingStatusCounts");
    // Không còn đếm KPI từ trang dữ liệu hiện tại
    expect(vanDonPage).not.toMatch(/data\.filter\(\(r\) => r\.status ===/);
  });

  it("shows the money columns that were missing", () => {
    expect(vanDonPage).toContain('header: "Phí giao"');
    expect(vanDonPage).toContain('header: "Thu hộ (COD)"');
    expect(vanDonPage).toContain('header: "Địa chỉ giao"');
  });
});

describe("Delivery partner codes come from the shared sequence", () => {
  it("partner dialog asks the server for the code instead of random DTGH", () => {
    expect(partnerDialog).toContain('nextEntityCode("delivery_partner"');
    expect(partnerDialog).not.toContain("generatePartnerCode");
    expect(partnerDialog).not.toContain("Math.random()");
  });
});

describe("POS delivery hands the partner to the shipment", () => {
  const posPage = readFileSync("src/app/pos/page.tsx", "utf8");
  const posState = readFileSync("src/app/pos/hooks/use-pos-state.ts", "utf8");

  it("checkout passes partnerId (was always null before 04/08)", () => {
    expect(posPage).toContain("partnerId: di.partnerId || null");
    expect(posState).toMatch(/partnerId\?: string/);
  });

  it("COD option is real: Thu COD khi giao vs Khách đã thanh toán trước", () => {
    // CEO 04/08: từ ô tick trang trí → lựa chọn thật, phải có đủ 2 trạng thái
    expect(posPage).toContain("Thu COD khi giao");
    expect(posPage).toContain("Khách đã thanh toán trước");
    expect(posPage).toContain('update("codEnabled"');
  });

  it("chosen COD-on-delivery suppresses the forgot-to-type-money warning", () => {
    // Đã chọn thu COD → tiền khách đưa 0 là chủ đích, không dọa ghi nợ nữa;
    // chọn "đã thanh toán trước" mà để 0 thì cảnh báo vẫn phải nổ.
    expect(posPage).toContain(
      'state.sellingMode === "delivery" && state.deliveryInfo.codEnabled',
    );
    expect(posPage).toContain("!intentionalCod");
    expect(posPage).toContain("ĐƠN NÀY KHÔNG CÓ TIỀN");
  });
});
