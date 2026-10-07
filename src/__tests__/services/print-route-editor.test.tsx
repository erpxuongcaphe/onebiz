import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PrintRouteEditor } from "@/components/shared/print-route-editor";
import type { PrintRoute } from "@/lib/printer/branch-queue";
afterEach(cleanup);
function Harness({ initial = "" }: { initial?: string }) {
  const [route, setRoute] = useState<PrintRoute>({ key: "cashier", label: "Quầy", printer: initial, paper: "80mm" });
  return <><PrintRouteEditor route={route} printers={["Xprinter USB"]} onChange={setRoute} /><output>{route.printer}</output></>;
}
describe("printer route setup", () => {
  it("switches to LAN with editable IP and default port", () => {
    render(<Harness />); fireEvent.change(screen.getByLabelText("Kết nối — Quầy"), { target: { value: "tcp" } });
    fireEvent.change(screen.getByLabelText("IP máy in"), { target: { value: "192.168.10.222" } });
    expect(screen.getByLabelText("Cổng")).toHaveValue("9100"); expect(screen.getByRole("status")).toHaveTextContent("tcp://192.168.10.222:9100");
    fireEvent.change(screen.getByLabelText("Cổng"), { target: { value: "9200" } });
    expect(screen.getByRole("status")).toHaveTextContent(":9200");
  });
  it("retains an existing installed USB printer and exposes driver guidance", () => {
    render(<Harness initial="Xprinter USB" />); expect(screen.getByLabelText("Tên máy trong Windows")).toHaveValue("Xprinter USB");
    expect(screen.getByText(/cài driver đúng model/)).toBeInTheDocument();
  });
  it("does not reuse the LAN address when changing to USB", () => {
    const onChange = vi.fn(); render(<PrintRouteEditor route={{ key: "cashier", label: "Quầy", printer: "tcp://192.168.10.222:9100", paper: "80mm" }} printers={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Kết nối — Quầy"), { target: { value: "windows" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ printer: "" }));
  });
});
