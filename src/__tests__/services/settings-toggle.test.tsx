import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsToggle } from "@/components/shared/settings-toggle";

describe("công tắc cài đặt", () => {
  it("nhấn nhãn thay đổi trạng thái qua callback", () => {
    const change = vi.fn();
    render(<SettingsToggle label="Tích điểm" description="Áp dụng cho khách hàng" checked={false} onCheckedChange={change} />);
    const control = screen.getByRole("switch", { name: "Tích điểm" });
    expect(control).toHaveAccessibleDescription("Áp dụng cho khách hàng");
    fireEvent.click(screen.getByText("Tích điểm"));
    expect(change).toHaveBeenCalledWith(true);
  });
  it("giữ tên truy cập được khi ẩn chữ và không đổi khi bị khóa", () => {
    const change = vi.fn();
    render(<SettingsToggle label="Bật khuyến mãi" hideLabel checked disabled onCheckedChange={change} />);
    const control = screen.getByRole("switch", { name: "Bật khuyến mãi" });
    expect(control).toHaveAttribute("aria-checked", "true");
    fireEvent.click(control);
    expect(change).not.toHaveBeenCalled();
  });
});
