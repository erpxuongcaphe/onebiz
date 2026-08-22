import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 00335 Pha B — ô chỉnh NGÀY HOÁ ĐƠN trên POS Retail.
 *
 * Bất biến khoá:
 *   • Đường THƯỜNG không gửi ngày → máy chủ tự lấy giờ lúc thanh toán.
 *   • Chỉ gửi issuedAt khi người dùng CHỦ ĐỘNG chỉnh; kèm lý do.
 *   • Nút Sửa chỉ hiện khi có quyền invoices.adjust_issued_at.
 *   • Sau khi thanh toán xong phải TRẢ VỀ tự động (không dính hoá đơn sau).
 *   • Hàng đợi OFFLINE đóng dấu giờ bấm NGAY lúc enqueue, nằm trong payload
 *     để replay giữ nguyên; KHÔNG sinh timestamp mới lúc đồng bộ.
 *   • Client gọi v4/v6; máy chủ chưa có thì lùi v3/v5 nhưng phải BÁO LỖI RÕ
 *     nếu người dùng đang chỉnh ngày (không im lặng bỏ qua).
 *
 * Đọc tệp chuẩn hoá CRLF→LF (bài học 00329).
 */

const doc = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

describe("00335 POS — gọi RPC đúng phiên bản", () => {
  const checkout = doc("src/lib/services/supabase/pos-checkout.ts");
  const orders = doc("src/lib/services/supabase/orders.ts");

  it("giỏ mới gọi v4 trước, lùi v3 khi máy chủ chưa có", () => {
    expect(checkout).toContain('"pos_complete_checkout_atomic_v4"');
    expect(checkout).toContain('"pos_complete_checkout_atomic_v3"');
    expect(checkout).toContain("isRpcUnavailable(atomicError)");
  });

  it("hoàn tất nháp gọi v6 trước, lùi v5 khi máy chủ chưa có", () => {
    expect(orders).toContain('"complete_draft_atomic_v6"');
    expect(orders).toContain('"complete_draft_atomic_v5"');
    expect(orders).toContain("isRpcUnavailable(error)");
  });

  it("KHÔNG im lặng bỏ qua ngày người dùng nhập khi phải lùi bản cũ", () => {
    for (const s of [checkout, orders]) {
      // tìm LỜI GỌI (có dấu ngoặc), không phải dòng import
      const i = s.search(/isRpcUnavailable\(/);
      const khoi = s.slice(i, i + 700);
      expect(khoi).toContain("issuedAt");
      expect(khoi).toContain("chưa bật tính năng chỉnh Ngày hoá đơn");
    }
  });

  it("3 tham số mới có trong lời gọi RPC", () => {
    expect(checkout).toContain("p_issued_at: input.issuedAt ?? null");
    expect(checkout).toContain("p_issued_reason: input.issuedReason ?? null");
    expect(checkout).toContain("p_checkout_client_at: input.checkoutClientAt ?? null");
    expect(orders).toContain("p_issued_at: payment.issuedAt ?? null");
  });
});

describe("00335 POS — màn hình", () => {
  const pos = doc("src/app/pos/page.tsx");
  const row = doc("src/app/pos/components/invoice-date-row.tsx");

  it("mặc định KHÔNG gửi ngày (null = máy chủ tự lấy giờ)", () => {
    expect(pos).toContain("useState<string | null>(null)");
    expect(pos).toContain("issuedAt: ngayHoaDon");
    // lý do chỉ đi kèm khi thực sự có chỉnh
    expect(pos).toContain("issuedReason: ngayHoaDon ? lyDoNgayHoaDon : null");
  });

  it("nút sửa gate theo quyền invoices.adjust_issued_at", () => {
    // Quyền lấy từ danh mục chung, KHÔNG viết chuỗi rời — tránh gõ sai mã
    // quyền mà vẫn xanh, và để quyền tồn tại cho tenant mới (không phụ thuộc
    // bản seed role_id production).
    expect(pos).toContain("PERMISSIONS.INVOICES_ADJUST_ISSUED_AT");
    expect(pos).toContain("canEdit={coQuyenChinhNgay}");
    expect(row).toContain("canEdit &&");
  });

  it("thanh toán xong TRẢ VỀ tự động", () => {
    const i = pos.indexOf("state.clearCart();\n      // 00335");
    expect(i).toBeGreaterThan(-1);
    const khoi = pos.slice(i, i + 420);
    // Phải đi qua datNgayHoaDon để ref của tab cũng sạch — nếu chỉ setState
    // thì lần chuyển tab kế tiếp sẽ cất nhầm ngày đã dùng xong vào tab.
    expect(khoi).toContain('datNgayHoaDon(null, "")');
  });

  it("KHÔNG đọc đồng hồ lúc dựng — tránh lệch hydrate (#418 nổ prod 20/08)", () => {
    // Trạng thái khởi tạo phải là null, đồng hồ chỉ đọc trong useEffect.
    expect(row).toContain("useState<string | null>(null)");
    expect(row).not.toMatch(/useState\(\(\)\s*=>\s*new Date\(\)/);
    const i = row.indexOf("useEffect(() => {");
    expect(row.slice(i, i + 220)).toContain("setGioHienTai(new Date().toISOString())");
    // Lần dựng đầu hiển thị chuỗi CỐ ĐỊNH, không phụ thuộc giờ máy
    expect(row).toContain('gioHienTai ? hienThi(gioHienTai) : "—"');
  });

  it("hộp thoại bắt buộc lý do + chặn tương lai + trong tháng", () => {
    expect(row).toContain("Bắt buộc nhập lý do");
    expect(row).toContain("tương lai quá 5 phút");
    expect(row).toContain("trong tháng hiện tại");
  });
});

describe("00335 — hàng đợi offline giữ nguyên giờ bấm", () => {
  const off = doc("src/lib/offline/offline-checkout.ts");

  it("đóng dấu checkoutClientAt NGAY lúc enqueue", () => {
    expect(off).toMatch(/checkoutClientAt: input\.checkoutClientAt \?\? new Date\(\)\.toISOString\(\)/);
  });

  it("payload đưa vào hàng đợi là payload ĐÃ có dấu giờ", () => {
    const i = off.indexOf('action: "posCheckout"');
    expect(off.slice(i, i + 200)).toContain("payload: payloadCoDauGio");
  });

  it("bản ghi chờ trong IndexedDB cũng giữ dấu giờ", () => {
    expect(off).toContain("paymentData: payloadCoDauGio");
  });
});
