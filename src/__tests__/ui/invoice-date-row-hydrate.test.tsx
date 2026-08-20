import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { InvoiceDateRow } from "../../app/pos/components/invoice-date-row";

/**
 * Lỗi thật trên production 20/08: dòng "Ngày hoá đơn" làm POS báo React #418
 * (lệch hydrate) vì đọc đồng hồ NGAY lúc dựng — trang được dựng sẵn trên máy
 * chủ rồi mới hydrate ở trình duyệt, hai lần cho giờ khác nhau.
 *
 * PHÉP KIỂM: dựng THẬT bằng renderToString (đúng thứ máy chủ gửi xuống) rồi
 * soi xem HTML có nhúng giờ hay không. Có giờ ⇒ chắc chắn lệch khi hydrate.
 *
 * Đã kiểm ngược: khôi phục bản lỗi (`useState(() => new Date())`) thì ca đầu
 * ĐỎ với đúng thông báo "Hydration failed because the server rendered text
 * didn't match the client" — nên đây KHÔNG phải test rỗng.
 *
 * (Bản nháp còn có ca bắt cảnh báo qua console.error nhưng ĐÃ BỎ: React phát
 * cảnh báo bất đồng bộ nên ca đó không bao giờ đỏ — test rỗng còn tệ hơn
 * không có test.)
 */

afterEach(() => {
  vi.useRealTimers();
});

function dungTrenMayChu(props: Parameters<typeof InvoiceDateRow>[0]) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T10:00:00+07:00"));
  const html = renderToString(<InvoiceDateRow {...props} />);
  vi.useRealTimers();
  return html;
}

const propsMacDinh = {
  value: null,
  reason: "",
  onChange: () => {},
  canEdit: true,
};

describe("InvoiceDateRow — không được lệch hydrate", () => {
  it("chế độ tự động: HTML máy chủ KHÔNG nhúng giờ", () => {
    const html = dungTrenMayChu(propsMacDinh);
    expect(html).toContain("Ngày hoá đơn");
    expect(html).toContain("(tự động)");
    // Không được có dd/MM/yyyy HH:mm — đó chính là thứ gây lệch.
    expect(html).not.toMatch(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/);
  });

  it("dựng hai lần cách nhau 10 phút vẫn ra CÙNG một chuỗi", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00+07:00"));
    const lan1 = renderToString(<InvoiceDateRow {...propsMacDinh} />);
    vi.setSystemTime(new Date("2026-08-20T10:10:00+07:00"));
    const lan2 = renderToString(<InvoiceDateRow {...propsMacDinh} />);
    vi.useRealTimers();
    expect(lan1).toBe(lan2);
  });

  it("ngày ĐÃ CHỈNH là giá trị cố định → hiện ngay từ máy chủ (không phụ thuộc đồng hồ)", () => {
    const html = dungTrenMayChu({
      ...propsMacDinh,
      value: "2026-08-17T06:12:00.000Z",
      reason: "Máy treo",
    });
    expect(html).toContain("(đã chỉnh)");
    expect(html).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
