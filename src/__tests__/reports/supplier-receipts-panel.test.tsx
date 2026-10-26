import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ allowed: true, exportAllowed: true, read: vi.fn(), full: vi.fn() }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: "actor" }, tenant: { id: "tenant" }, hasPermission: (code: string) => code === "reports.export_detail" ? fake.exportAllowed : fake.allowed }) }));
vi.mock("@/lib/services/supabase/supplier-receipts", () => ({ getSupplierReceiptWorkspace: fake.read, getAllSupplierReceipts: fake.full,
  SUPPLIER_RECEIPT_KINDS: { receipt: "Nhập kho", revert: "Hoàn nhập", return: "Trả NCC" }, SUPPLIER_RECEIPT_STATUSES: { verified: "Đủ nguồn", missing_price: "Thiếu giá lịch sử" } }));
import { SupplierReceiptsPanel } from "@/components/shared/report/supplier-receipts-panel";
const range = { from: "2026-10-01", to: "2026-10-26" };
const result = (code = "PN-fixture") => ({ items: [{ id: "one", occurredAt: "2026-10-26T01:00:00Z", kind: "receipt", branchName: "Fixture", orderCode: code, supplierName: "Fixture", documentCode: code, documentStatus: "partial", productCode: "SKU-fixture", productName: "Fixture", stockUnit: "G", quantity: 1.2345, unitPrice: null, amount: null, signedAmount: null, priceSource: null, status: "missing_price" }], total: 1, summary: { rows: 1, reviewRows: 1, receivedAmount: null, revertedAmount: 0, returnedAmount: 0, netAmount: null } });
beforeEach(() => { fake.allowed = true; fake.exportAllowed = true; fake.read.mockReset().mockResolvedValue(result()); fake.full.mockReset(); });
afterEach(cleanup);
describe("supplier physical receipts UI", () => {
  it("loads after Strict Mode effect cleanup and remount", async () => {
    render(<StrictMode><SupplierReceiptsPanel branchId="a" branchName="A" range={range} ready /></StrictMode>);
    await screen.findAllByText("PN-fixture"); expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeEnabled();
  });
  it("does not request confidential purchase data without the required permissions", () => {
    fake.allowed = false; render(<SupplierReceiptsPanel branchId="a" branchName="A" range={range} ready />);
    expect(fake.read).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("Không có quyền");
  });
  it("shows missing-source impact, full columns and original quantity precision", async () => {
    render(<SupplierReceiptsPanel branchId="a" branchName="A" range={range} ready />);
    await screen.findAllByText("PN-fixture");
    expect(screen.getByRole("status")).toHaveTextContent("1 dòng cần đối chiếu");
    expect(screen.getAllByText("1.2345").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Trạng thái phiếu hiện tại" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sắp xếp thực nhập" }).querySelectorAll("option")).toHaveLength(16);
  });
  it("drops late branch results and does not retain old totals", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    fake.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<SupplierReceiptsPanel branchId="a" branchName="A" range={range} ready />);
    view.rerender(<SupplierReceiptsPanel branchId="b" branchName="B" range={range} ready />);
    await screen.findAllByText("PN-fixture");await act(async () => { resolve(result("OLD")); });
    expect(screen.queryByText("OLD")).not.toBeInTheDocument();
  });
  it("separates export permission and blocks export after a failed reload", async () => {
    fake.exportAllowed = false; const view=render(<SupplierReceiptsPanel branchId="a" branchName="A" range={range} ready />);
    await screen.findAllByText("PN-fixture");expect(screen.queryByRole("button", { name: "Excel đầy đủ" })).not.toBeInTheDocument();
    fake.exportAllowed = true;view.rerender(<SupplierReceiptsPanel branchId="a" branchName="A" range={range} ready />);
    fake.read.mockRejectedValue(new Error("Source unavailable"));fireEvent.click(screen.getByRole("button", { name: "Tải lại thực nhập" }));
    await screen.findByRole("alert");expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
  });
});
