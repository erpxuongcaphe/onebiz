import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailTabs } from "@/components/shared/inline-detail-panel/detail-tabs";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";

const tabs = [
  { id: "info", label: "Thông tin", content: <div>Nội dung thông tin</div> },
  { id: "stock_card", label: "Thẻ kho", content: <div>Nội dung thẻ kho</div> },
];

describe("DetailTabs persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("giữ tab đang xem khi panel của cùng sản phẩm được dựng lại", () => {
    const first = render(
      <DetailTabs tabs={tabs} persistenceKey="product:sku-1" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Thẻ kho" }));
    expect(screen.getByText("Nội dung thẻ kho")).toBeInTheDocument();

    first.unmount();
    render(<DetailTabs tabs={tabs} persistenceKey="product:sku-1" />);

    expect(screen.getByText("Nội dung thẻ kho")).toBeInTheDocument();
  });

  it("không mang tab của sản phẩm này sang sản phẩm khác", () => {
    const first = render(
      <DetailTabs tabs={tabs} persistenceKey="product:sku-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Thẻ kho" }));
    first.unmount();

    render(<DetailTabs tabs={tabs} persistenceKey="product:sku-2" />);

    expect(screen.getByText("Nội dung thông tin")).toBeInTheDocument();
  });

  it("bỏ qua tab đã lưu nếu tab đó không còn hợp lệ", () => {
    window.sessionStorage.setItem(
      "onebiz:detail-tab:product:sku-1",
      "removed_tab",
    );

    render(<DetailTabs tabs={tabs} persistenceKey="product:sku-1" />);

    expect(screen.getByText("Nội dung thông tin")).toBeInTheDocument();
  });

  it("không refetch khi panel chi tiết đang mở", () => {
    const callback = vi.fn();
    renderHook(() => useRevalidateOnFocus(callback, { enabled: false }));

    act(() => window.dispatchEvent(new Event("focus")));

    expect(callback).not.toHaveBeenCalled();
  });

  it("trang Hàng hóa khóa refresh-on-focus trong lúc có dòng mở", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(main)/hang-hoa/page.tsx"),
      "utf8",
    );

    expect(page).toContain(
      "useRevalidateOnFocus(fetchData, { enabled: expandedRow === null })",
    );
    expect(page).toContain("persistenceKey={`product:${product.id}`}");
  });
});
