import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

describe("nhãn danh sách chọn khi popup chưa mở", () => {
  it("hiện nhãn tiếng Việt trước lần mở đầu và vẫn trả đúng giá trị khi đổi", async () => {
    const onChange = vi.fn();
    function Field() {
      const [value, setValue] = useState("discount_percent");
      return <Select value={value} onValueChange={next => { setValue(next ?? ""); onChange(next); }}>
        <SelectTrigger aria-label="Loại khuyến mãi"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="discount_percent">Giảm theo %</SelectItem>
          <SelectItem value="discount_fixed">Giảm số tiền cố định</SelectItem>
        </SelectGroup></SelectContent>
      </Select>;
    }
    render(<Field />);
    expect(screen.getByRole("combobox", { name: "Loại khuyến mãi" })).toHaveTextContent("Giảm theo %");
    expect(screen.queryByText("discount_percent")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Loại khuyến mãi" }));
    const option = await screen.findByRole("option", { name: "Giảm số tiền cố định" });
    fireEvent.mouseMove(option);
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("discount_fixed"));
    expect(screen.getByRole("combobox", { name: "Loại khuyến mãi" })).toHaveTextContent("Giảm số tiền cố định");
  });
  it("giữ nhãn items được truyền rõ thay vì tự thay bằng nội dung con", () => {
    render(<Select value="fnb" items={[{ value: "fnb", label: "POS quán" }]}>
      <SelectTrigger aria-label="Kênh"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="fnb">Nhà hàng</SelectItem></SelectContent>
    </Select>);
    expect(screen.getByRole("combobox", { name: "Kênh" })).toHaveTextContent("POS quán");
  });
  it("cập nhật nhãn khi danh sách bất đồng bộ có dữ liệu", () => {
    const field = (loaded: boolean) => <Select value="store-id">
      <SelectTrigger aria-label="Quán"><SelectValue /></SelectTrigger>
      <SelectContent>{loaded && <SelectItem value="store-id">Quán Tư Búa</SelectItem>}</SelectContent>
    </Select>;
    const { rerender } = render(field(false));
    rerender(field(true));
    expect(screen.getByRole("combobox", { name: "Quán" })).toHaveTextContent("Quán Tư Búa");
  });
});
