import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InvoiceDateRow } from "../../app/pos/components/invoice-date-row";

/**
 * 00335 — YÊU CẦU GIAO DIỆN CỦA CEO cho dòng "Ngày hóa đơn" (21/08/2026).
 *
 * Kiểm bằng HÀNH VI: dựng thật, bấm thật, đọc thật. Riêng vùng chạm 44px và
 * cỡ chữ phải đọc qua className vì jsdom không tính layout — nhưng vẫn đọc từ
 * phần tử ĐÃ DỰNG, không phải quét tệp nguồn.
 */

afterEach(() => cleanup());

const propsMacDinh = {
  value: null as string | null,
  reason: "",
  onChange: () => {},
  canEdit: true,
};

function nutSua() {
  return screen.getByRole("button", { name: "Sửa ngày hóa đơn" });
}

describe("Dòng Ngày hóa đơn — trình bày", () => {
  it("gọn trong một hàng: nhãn · ngày giờ · nút bút chì", () => {
    render(<InvoiceDateRow {...propsMacDinh} />);

    const nhan = screen.getByText("Ngày hóa đơn");
    const hang = nhan.parentElement!;
    // Cùng một hàng flex chứa cả nhãn lẫn nút sửa.
    expect(hang.className).toContain("flex");
    expect(hang.className).toContain("items-center");
    expect(hang).toContainElement(nutSua());
  });

  it("KHÔNG có chữ '(tự động)' và KHÔNG có nhãn 'Đã chỉnh' khi chưa chỉnh tay", () => {
    render(<InvoiceDateRow {...propsMacDinh} />);
    expect(screen.queryByText(/tự động/)).toBeNull();
    expect(screen.queryByText("Đã chỉnh")).toBeNull();
  });

  it("chỉ khi đã chỉnh tay mới hiện nhãn 'Đã chỉnh', kèm lý do ở tooltip", () => {
    render(
      <InvoiceDateRow {...propsMacDinh} value="2026-08-17T06:12:00.000Z" reason="Máy treo" />,
    );
    const nhan = screen.getByText("Đã chỉnh");
    expect(nhan.getAttribute("title")).toBe("Máy treo");
  });

  it("ngày giờ dùng tabular-nums, không xuống dòng, không bị co", () => {
    render(<InvoiceDateRow {...propsMacDinh} value="2026-08-17T06:12:00.000Z" reason="x" />);
    const o = screen.getByText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(o.className).toContain("tabular-nums");
    expect(o.className).toContain("whitespace-nowrap");
    expect(o.className).toContain("shrink-0");
  });

  it("cỡ chữ của hàng không dưới 12px", () => {
    render(<InvoiceDateRow {...propsMacDinh} />);
    const hang = screen.getByText("Ngày hóa đơn").parentElement!;
    expect(hang.className).toContain("text-xs"); // 12px
    expect(hang.className).not.toMatch(/text-\[(?:[0-9]|10|11)px\]/);
  });

  it("nút sửa là icon bút chì, có tooltip, vùng chạm nở 44px trên thiết bị chạm", () => {
    render(<InvoiceDateRow {...propsMacDinh} />);
    const nut = nutSua();
    expect(nut.getAttribute("title")).toBe("Sửa ngày hóa đơn");
    // 44px khi ngón tay chạm (pointer-coarse:size-11 = 2.75rem).
    expect(nut.className).toContain("pointer-coarse:size-11");
    // Là icon, không phải chữ "Sửa".
    expect(nut.textContent).not.toContain("Sửa");
    expect(nut.querySelector("span,i,svg")).not.toBeNull();
  });

  it("không có quyền: vẫn thấy ngày nhưng KHÔNG có nút sửa", () => {
    render(<InvoiceDateRow {...propsMacDinh} canEdit={false} />);
    expect(screen.getByText("Ngày hóa đơn")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sửa ngày hóa đơn" })).toBeNull();
  });
});

describe("Hộp thoại sửa ngày hóa đơn", () => {
  it("chỉ có 2 trường: ngày giờ và lý do — không có đoạn hướng dẫn dài", () => {
    render(<InvoiceDateRow {...propsMacDinh} />);
    fireEvent.click(nutSua());

    expect(screen.getByText("Ngày và giờ")).toBeTruthy();
    expect(screen.getByText(/Lý do điều chỉnh/)).toBeTruthy();
    // Không nhồi giải thích kỹ thuật vào giao diện.
    expect(screen.queryByText(/ghi nhật ký/)).toBeNull();
    expect(screen.queryByText(/Chỉ dùng khi cần/)).toBeNull();
  });

  it("'Về giờ hiện tại' CHỈ hiện khi đang chỉnh tay", () => {
    const { unmount } = render(<InvoiceDateRow {...propsMacDinh} />);
    fireEvent.click(nutSua());
    expect(screen.queryByRole("button", { name: "Về giờ hiện tại" })).toBeNull();
    unmount();

    render(<InvoiceDateRow {...propsMacDinh} value="2026-08-17T06:12:00.000Z" reason="Máy treo" />);
    fireEvent.click(nutSua());
    expect(screen.getByRole("button", { name: "Về giờ hiện tại" })).toBeTruthy();
  });

  it("thiếu lý do: báo lỗi NGAY DƯỚI ô lý do, KHÔNG gọi onChange", () => {
    const onChange = vi.fn();
    render(<InvoiceDateRow {...propsMacDinh} onChange={onChange} />);
    fireEvent.click(nutSua());
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

    const loi = screen.getByText("Bắt buộc nhập lý do điều chỉnh.");
    const oLyDo = screen.getByText(/Lý do điều chỉnh/).parentElement!;
    expect(oLyDo).toContainElement(loi);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ngày ở tương lai quá 5 phút: báo lỗi DƯỚI Ô NGÀY, không gọi onChange", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00"));
    const onChange = vi.fn();
    render(<InvoiceDateRow {...propsMacDinh} onChange={onChange} />);
    fireEvent.click(nutSua());

    const o = document.querySelector('input[type="datetime-local"]')!;
    fireEvent.change(o, { target: { value: "2026-08-20T23:59" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Có lý do" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

    const loi = screen.getByText("Không được chọn thời điểm ở tương lai quá 5 phút.");
    expect(screen.getByText("Ngày và giờ").parentElement!).toContainElement(loi);
    expect(onChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("hợp lệ: gọi onChange với ISO + lý do đã cắt khoảng trắng", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00"));
    const onChange = vi.fn();
    render(<InvoiceDateRow {...propsMacDinh} onChange={onChange} />);
    fireEvent.click(nutSua());

    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, {
      target: { value: "2026-08-17T13:12" },
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Máy treo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [iso, lyDo] = onChange.mock.calls[0];
    expect(new Date(iso as string).getFullYear()).toBe(2026);
    expect(lyDo).toBe("Máy treo");
    vi.useRealTimers();
  });

  it("'Về giờ hiện tại' trả ngày về tự động (null) và xoá lý do", () => {
    const onChange = vi.fn();
    render(
      <InvoiceDateRow
        {...propsMacDinh}
        value="2026-08-17T06:12:00.000Z"
        reason="Máy treo"
        onChange={onChange}
      />,
    );
    fireEvent.click(nutSua());
    fireEvent.click(screen.getByRole("button", { name: "Về giờ hiện tại" }));
    expect(onChange).toHaveBeenCalledWith(null, "");
  });
});
