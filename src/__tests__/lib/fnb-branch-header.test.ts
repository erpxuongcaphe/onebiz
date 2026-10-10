import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/services", () => ({ resolvePrintTemplate: vi.fn(), getResolvedBrand: vi.fn() }));
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";

const base: DocumentPrintData = {
  fnbThermalReadable: true, documentType: "PHIẾU THANH TOÁN", documentCode: "HD1", date: "2026-10-10",
  branchName: "Xưởng Tư Búa", businessName: "Công ty cũ", businessTaxCode: "MST-CONG-TY",
};
const brand = { branchName: "Xưởng Tư Búa", businessName: "Công ty TNHH", address: "03 Trần Minh Trí", phone: "0915667500" };
describe("branch-only F&B print headers", () => {
  it.each(["PHIẾU TẠM TÍNH", "PHIẾU THANH TOÁN"])("prints only the branch on %s", documentType => {
    const data = applyTemplateToDocData({ ...base, documentType }, { brand, config: {} });
    const html = generateDocumentHtml(data, "80mm");
    expect(html).toContain("Xưởng Tư Búa");
    expect(html).toContain("0915667500");
    expect(html).toContain("03 Trần Minh Trí");
    expect(html).not.toContain("Công ty");
    expect(html).not.toContain("MST-CONG-TY");
    expect(data.branchName).toBeUndefined();
  });
  it("keeps branch and contact visibility editable", () => {
    const data = applyTemplateToDocData(base, { brand, config: { header: { branch: false, address: false, phone: false } } });
    expect(data.storeName).toBeUndefined();
    expect(data.businessAddress).toBeUndefined();
    expect(data.businessPhone).toBeUndefined();
  });
  it("preserves company headers for non-F&B documents", () => {
    const data = applyTemplateToDocData({ ...base, fnbThermalReadable: false }, { brand, config: {} });
    expect(data.businessName).toBe("Công ty TNHH");
    expect(data.businessTaxCode).toBe("MST-CONG-TY");
  });
});
