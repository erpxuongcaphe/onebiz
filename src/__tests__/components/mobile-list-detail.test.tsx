import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/shared/data-table";
import { DetailItemsTable } from "@/components/shared/inline-detail-panel/detail-items-table";

const mounted = vi.fn();
function Detail({ close }: { close: () => void }) {
  useEffect(() => { mounted(); }, []);
  return <div><p>Phiếu PN001</p><input aria-label="Tìm trong lịch sử" /><button onClick={close}>Đóng phiếu</button></div>;
}
function viewport(width: number) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: width >= Number(query.match(/min-width: (\d+)/)?.[1] ?? Infinity),
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}
beforeEach(() => { viewport(390); mounted.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("mobile list detail", () => {
  it("opens one detail instance, closes back to the same selected list", async () => {
    const { container } = render(<DataTable columns={[{ accessorKey: "code", header: "Mã" }]} data={[{ id: "1", code: "PN001" }]} selectable renderDetail={(_row, close) => <Detail close={close} />} />);
    const mobile = within(container.querySelector('[data-slot="mobile-list"]') as HTMLElement);
    fireEvent.click(mobile.getByRole("checkbox", { name: "Chọn dòng 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết dòng 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Phiếu PN001")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
    fireEvent.change(within(dialog).getByLabelText("Tìm trong lịch sử"), {target:{value:"Từ khóa"}});
    fireEvent.click(within(dialog).getByRole("button", { name: "Danh sách" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mobile.getByRole("checkbox", { name: "Chọn dòng 1" })).toBeChecked();
  });

  it("retains inline detail on desktop without mounting a hidden mobile copy", async () => {
    viewport(1440);
    render(<DataTable columns={[{ accessorKey: "code", header: "Mã" }]} data={[{ code: "PN001" }]} selectable={false} renderDetail={(_row, close) => <Detail close={close} />} />);
    fireEvent.click(screen.getAllByText("PN001")[0]);
    expect(await screen.findByText("Phiếu PN001")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("does not load desktop detail first when a mobile deep link starts expanded", async () => {
    render(<DataTable columns={[{accessorKey:"code",header:"Mã"}]} data={[{code:"PN001"}]} expandedRow={0} renderDetail={(_row,close)=><Detail close={close}/>} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("keeps hidden desktop columns available in mobile item detail", () => {
    const { container } = render(<DetailItemsTable columns={[{header:"Tên hàng",accessor:"name"},{header:"Đơn vị",accessor:"unit",hideOn:"mobile"}]} items={[{name:"Sữa đặc",unit:"Lon"}]} />);
    const cards = container.querySelector(".md\\:hidden")!;
    expect(cards.textContent).toContain("Sữa đặc");
    expect(cards.textContent).toContain("Lon");
  });
});
