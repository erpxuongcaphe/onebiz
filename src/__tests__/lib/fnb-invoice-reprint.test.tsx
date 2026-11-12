import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), print: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/services", () => ({ resolvePrintTemplate: mocks.resolve }));
vi.mock("@/lib/print-document", () => ({ printDocument: mocks.print }));
vi.mock("@/lib/print-apply-template", () => ({ applyTemplateToDocData: (data: unknown) => data }));
vi.mock("@/lib/printer/print-job", () => ({ getPrintSettings: mocks.settings }));
vi.mock("@/components/shared/dialogs/print-size-picker-dialog", () => ({ PrintSizePickerDialog: () => null }));
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";

const data = { documentType: "Hoa don", documentCode: "TEST", date: "2026-10-12" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockReturnValue({ paperSize: "A5" });
  mocks.resolve.mockResolvedValue(null);
});

describe("F&B invoice reprint routing", () => {
  it("uses the F&B template and preserves the invoice branch for queue dispatch", async () => {
    mocks.resolve.mockResolvedValue({ paperSize: "80mm" });
    const { result } = renderHook(usePrintWithPicker);
    await act(async () => result.current.printWithPicker(data, "In", { channel: "fnb", docType: "sale_invoice", branchId: "xtb" }));
    expect(mocks.resolve).toHaveBeenCalledWith("fnb", "sale_invoice", "xtb");
    expect(mocks.print).toHaveBeenCalledWith({ ...data, fnbThermalReadable: true }, { paperSize: "80mm", branchId: "xtb" });
  });

  it("defaults a missing F&B template to 80mm instead of the ERP A5 setting", async () => {
    const { result } = renderHook(usePrintWithPicker);
    await act(async () => result.current.printWithPicker(data, "In", { channel: "fnb", docType: "sale_invoice", branchId: "xtb" }));
    const props = (result.current.printerDialog as React.ReactElement<{ defaultPaperSize?: string; onPrint: (paper: "80mm") => void }>).props;
    expect(props.defaultPaperSize).toBe("80mm");
    act(() => props.onPrint("80mm"));
    expect(mocks.print).toHaveBeenCalledWith({ ...data, fnbThermalReadable: true }, { paperSize: "80mm", branchId: "xtb" });
  });

  it("keeps 58mm for a configured small F&B printer", async () => {
    mocks.settings.mockReturnValue({ paperSize: "58mm" });
    const { result } = renderHook(usePrintWithPicker);
    await act(async () => result.current.printWithPicker(data, "In", { channel: "fnb", docType: "sale_invoice" }));
    expect((result.current.printerDialog as React.ReactElement<{ defaultPaperSize?: string }>).props.defaultPaperSize).toBe("58mm");
  });

  it("does not route Retail A5 invoices to the F&B branch queue", async () => {
    mocks.resolve.mockResolvedValue({ paperSize: "A5" });
    const { result } = renderHook(usePrintWithPicker);
    await act(async () => result.current.printWithPicker(data, "In", { channel: "retail", docType: "sale_invoice", branchId: "warehouse" }));
    expect(mocks.print).toHaveBeenCalledWith(data, { paperSize: "A5", branchId: undefined });
  });

  it("selects the invoice source in both single and bulk reprint actions", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/(main)/don-hang/hoa-don/page.tsx"), "utf8");
    expect(page.match(/channel: row.source === "fnb" \? "fnb" : "retail"/g)).toHaveLength(2);
  });
});

it("waits for a Retail print choice and omits only customer debt for that print", async () => {
  mocks.resolve.mockResolvedValue({ paperSize: "A5" });
  const invoiceBalanceRow = { label: "Khách còn phải trả", value: "30,000" };
  const total = { label: "Tổng cộng", value: "100,000" };
  const retail = {
    ...data,
    invoiceBalanceRow,
    summaryRows: [
      total,
      { label: "Nợ cũ", value: "50,000", customerDebt: true },
      { label: "Còn nợ", value: "80,000", customerDebt: true },
    ],
  };
  const { result } = renderHook(usePrintWithPicker);
  const context = { channel: "retail", docType: "sale_invoice", chooseCustomerDebt: true } as const;
  await act(async () => result.current.printWithPicker(retail, "In", context));
  const picker = () => (result.current.printerDialog as React.ReactElement<{
    showCustomerDebtChoice: boolean;
    onPrint: (paper: "A5", includeCustomerDebt: boolean) => void;
  }>).props;
  expect(picker().showCustomerDebtChoice).toBe(true);
  expect(mocks.print).not.toHaveBeenCalled();
  act(() => picker().onPrint("A5", false));
  expect(mocks.print).toHaveBeenLastCalledWith(expect.objectContaining({
    summaryRows: [total, invoiceBalanceRow],
  }), { paperSize: "A5", branchId: undefined });

  await act(async () => result.current.printWithPicker(retail, "In", context));
  act(() => picker().onPrint("A5", true));
  expect(mocks.print).toHaveBeenLastCalledWith(retail, { paperSize: "A5", branchId: undefined });
});
