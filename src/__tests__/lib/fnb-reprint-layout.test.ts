import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/printer/print-job", () => ({ sendPrintJob: dispatch }));
import { generateDocumentHtml, printDocument } from "@/lib/print-document";

const bill = {
  documentType: "HÓA ĐƠN THANH TOÁN",
  documentCode: "HD001753",
  date: "2026-10-10T15:20:43+00:00",
  storeName: "Xưởng Tư Búa",
  branchName: "Xưởng Tư Búa",
  fnbThermalReadable: true,
  items: [
    { name: "Cà Phê Muối (Size M)", quantity: 1, unitPrice: 30000, total: 30000 },
    { name: "Cà Phê Muối (Size L)", quantity: 1, unitPrice: 35000, total: 35000 },
  ],
  summaryRows: [{ label: "Tổng cộng", value: "65.000đ", bold: true }],
};

describe("thermal invoice reprint layout", () => {
  it("renders readable thermal items, not the A5 document table or signatures", () => {
    const html = generateDocumentHtml(bill, "80mm");
    expect(html).not.toContain("size: A5");
    expect(html).toContain('class="t-items"');
    expect(html).toMatch(/\.footer\s*\{[^}]*display:\s*none/);
    expect(html).toContain("padding-top:1mm");
    expect(html).toContain("65.000đ");
    if (process.env.ONEBIZ_PRINT_PREVIEW_PATH) writeFileSync(process.env.ONEBIZ_PRINT_PREVIEW_PATH, html, "utf8");
  });

  it("passes the invoice branch and a route-width renderer to the print queue", () => {
    printDocument(bill, { paperSize: "80mm", branchId: "xtb" });
    const args = dispatch.mock.calls.at(-1)![0];
    expect(args).toMatchObject({ branchId: "xtb", paperSize: "80mm", role: "cashier" });
    expect(args.buildHtml("58mm")).toContain("65.000đ");
    expect(args.buildHtml("58mm")).not.toContain("size: A5");
  });
});
