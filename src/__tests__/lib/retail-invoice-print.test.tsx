import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), print: vi.fn() }));
vi.mock("@/lib/services", () => ({ resolvePrintTemplate: mocks.resolve }));
vi.mock("@/lib/print-document", () => ({ printDocument: mocks.print }));
vi.mock("@/lib/print-apply-template", () => ({ applyTemplateToDocData: (data: unknown) => data }));
vi.mock("@/components/shared/dialogs/print-size-picker-dialog", () => ({
  PrintSizePickerDialog: ({ children, onPrint, onOpenChange }: {
    children: ReactNode;
    onPrint: (paper: "A5") => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      {children}
      <button onClick={() => onOpenChange(false)}>Hủy</button>
      <button onClick={() => { onPrint("A5"); onOpenChange(false); }}>In ngay</button>
    </div>
  ),
}));
import { useRetailInvoicePrint } from "@/lib/hooks/use-retail-invoice-print";

const base = { documentType: "Hóa đơn", documentCode: "HD001", date: "2026-11-12" };
const total = { label: "Tổng cộng", value: "100,000" };
const invoiceBalanceRow = { label: "Khách còn phải trả", value: "30,000" };
const retail = {
  ...base,
  invoiceBalanceRow,
  summaryRows: [
    total,
    { label: "Nợ cũ", value: "50,000", customerDebt: true },
    { label: "Còn nợ", value: "80,000", customerDebt: true },
  ],
};

function PrintControls({ withDebt = true }: { withDebt?: boolean }) {
  const { printRetailInvoice, printerDialog } = useRetailInvoicePrint();
  return (
    <>
      <button onClick={() => void printRetailInvoice(withDebt ? retail : base, "warehouse")}>In hóa đơn</button>
      {printerDialog}
    </>
  );
}

async function requestPrint() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "In hóa đơn" })); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ paperSize: "A5" });
});

describe("Retail invoice print choice", () => {
  it("resets the checkbox on reprint and only removes cumulative debt when unchecked", async () => {
    render(<PrintControls />);
    await requestPrint();
    expect(mocks.resolve).toHaveBeenCalledWith("retail", "sale_invoice", "warehouse");
    const checkbox = () => screen.getByRole<HTMLInputElement>("checkbox", { name: /In công nợ cũ/ });
    expect(checkbox().checked).toBe(true);
    expect(mocks.print).not.toHaveBeenCalled();
    fireEvent.click(checkbox());
    fireEvent.click(screen.getByRole("button", { name: "In ngay" }));
    expect(mocks.print).toHaveBeenLastCalledWith(expect.objectContaining({
      summaryRows: [total, invoiceBalanceRow],
    }), { paperSize: "A5" });

    await requestPrint();
    expect(checkbox().checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "In ngay" }));
    expect(mocks.print).toHaveBeenLastCalledWith(retail, { paperSize: "A5" });
  });

  it("prints directly when the resolved print data has no debt block", async () => {
    render(<PrintControls withDebt={false} />);
    await requestPrint();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(mocks.print).toHaveBeenCalledWith(base, { paperSize: "A5" });
  });

  it("cancels without printing and keeps the paper picker if the template is unavailable", async () => {
    mocks.resolve.mockRejectedValueOnce(new Error("template unavailable"));
    render(<PrintControls />);
    await requestPrint();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(mocks.print).not.toHaveBeenCalled();
  });
});
