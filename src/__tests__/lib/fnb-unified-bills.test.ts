import { describe, it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ resolve: vi.fn(), send: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/services", () => ({ resolvePrintTemplate: mock.resolve }));
vi.mock("@/lib/print-apply-template", () => ({ applyTemplateToDocData: (data: object) => ({ ...data, documentType: "MẪU CHUNG" }) }));
vi.mock("@/lib/print-document", () => ({ generateDocumentHtml: mock.render }));
vi.mock("@/lib/printer/print-job", () => ({ getPrintSettings: () => ({ paperSize: "80mm", openCashDrawer: true }), sendPrintJob: mock.send }));
import { buildFnbReceiptHtml, buildPreBillHtml, printPreBill, type PreBillData } from "@/lib/print-fnb";
import { printFnbBillWithTemplate } from "@/lib/print-fnb-template";
const data: PreBillData = { branchId: "branch", orderNumber: "DEMO", tableName: "Bàn 5", orderType: "dine_in", createdAt: "2026-10-06T03:00:00Z", storeName: "Quán", customerName: "Khách thử", items: [{ name: "Cà phê", quantity: 2, unitPrice: 25000, toppings: [{ name: "Thạch", quantity: 1, price: 5000 }], modifierLabels: ["Đường: 50%"], note: "Đá riêng" }], subtotal: 60000, discountAmount: 5000, deliveryFee: 0, total: 55000, footer: "Cảm ơn" };
beforeEach(() => { vi.clearAllMocks(); mock.send.mockResolvedValue({ success: true }); mock.resolve.mockResolvedValue(null); mock.render.mockReturnValue("HTML"); });
describe("same F&B bill layout before and after payment", () => {
  for (const paperSize of ["58mm", "80mm"] as const) for (const receiptStyle of ["minimal", "standard", "full"] as const) {
    it(`shares content and CSS at ${paperSize}/${receiptStyle}`, () => {
      const common = { ...data, paperSize, receiptStyle };
      const pre = new DOMParser().parseFromString(buildPreBillHtml(common), "text/html");
      const paid = new DOMParser().parseFromString(buildFnbReceiptHtml({ ...common, invoiceCode: data.orderNumber, paymentMethod: "cash", paid: 60000, change: 5000 }), "text/html");
      expect(pre.querySelector("[data-fnb-payment]")).toBeNull();
      expect(paid.querySelector("[data-fnb-payment]")?.textContent).toContain("Tiền khách đưa");
      paid.querySelector("[data-fnb-payment]")?.remove();
      paid.querySelector(".title")!.textContent = pre.querySelector(".title")!.textContent;
      expect(paid.querySelector("style")?.textContent).toBe(pre.querySelector("style")?.textContent);
      expect(paid.body.innerHTML.replace(/\s+/g, " ")).toBe(pre.body.innerHTML.replace(/\s+/g, " "));
    });
  }
  it("uses the configured sale invoice template for prebill without opening the drawer", async () => {
    mock.resolve.mockResolvedValue({ paperSize: "58mm" });
    printPreBill(data);
    await vi.waitFor(() => expect(mock.send).toHaveBeenCalled());
    expect(mock.resolve).toHaveBeenCalledWith("fnb", "sale_invoice", "branch");
    const doc = mock.render.mock.calls[0][0];
    expect(doc.documentType).toBe("PHIẾU TẠM TÍNH");
    expect(doc.summaryRows.some((r: { label: string }) => /Tiền khách|Khách còn|thối/.test(r.label))).toBe(false);
    expect(mock.send.mock.calls[0][0].openCashDrawer).toBe(false);
  });
  it("keeps template common totals/items identical and adds collection rows only after payment", async () => {
    mock.resolve.mockResolvedValue({ paperSize: "80mm" });
    const payload = { ...data, invoiceCode: "DEMO", tableName: "Bàn 5", tipAmount: 0, paid: 60000 };
    await printFnbBillWithTemplate({ ...payload, billPhase: "prebill" });
    await printFnbBillWithTemplate({ ...payload, paymentMethod: "cash" });
    const pre = mock.render.mock.calls[0][0], paid = mock.render.mock.calls[1][0];
    expect(pre.items).toEqual(paid.items);
    expect(pre.items.reduce((sum: number, item: { total: number }) => sum + item.total, 0)).toBe(data.subtotal);
    expect(paid.summaryRows.slice(0, pre.summaryRows.length)).toEqual(pre.summaryRows);
    expect(paid.summaryRows.map((r: { label: string }) => r.label)).toContain("Tiền khách đưa");
  });
});
