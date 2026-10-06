import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleSidebarLayout } from "@/components/shared/module-sidebar-layout";

const navigation = vi.hoisted(() => ({ pathname: "/cai-dat/in-an/mau", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
const nav = [{ label: "Thiết lập", items: [
  { label: "Cài đặt", href: "/cai-dat", icon: "settings" },
  { label: "In ấn", href: "/cai-dat/in-an", icon: "print" },
  { label: "Cửa hàng", href: "/cai-dat/cua-hang", icon: "storefront" },
] }];

describe("điều hướng module", () => {
  beforeEach(() => navigation.push.mockClear());
  it("giữ đúng mục con đang xem và chuyển trang khi chọn mục khác", () => {
    render(<ModuleSidebarLayout title="Cài đặt" nav={nav}>Nội dung</ModuleSidebarLayout>);
    const select = screen.getByRole("combobox", { name: "Mục Cài đặt" });
    expect(select).toHaveValue("/cai-dat/in-an");
    fireEvent.change(select, { target: { value: "/cai-dat/cua-hang" } });
    expect(navigation.push).toHaveBeenCalledWith("/cai-dat/cua-hang");
  });
  it("tìm menu không dấu mà không làm mất các mục trong danh sách chọn", () => {
    render(<ModuleSidebarLayout title="Cài đặt" nav={nav} enableSearch>Nội dung</ModuleSidebarLayout>);
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm mục cài đặt" }), { target: { value: "cua hang" } });
    expect(screen.getByRole("link", { name: /Cửa hàng/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /In ấn/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "In ấn" })).toBeInTheDocument();
  });
});
