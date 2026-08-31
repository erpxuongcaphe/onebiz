import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/dialogs/create-product-dialog.tsx"),
  "utf8",
);

describe("quản trị FnB nhiều size dùng một nguồn dữ liệu", () => {
  it("tải variants trước khi mở Giá, BOM hoặc Quy cách", () => {
    expect(source).toContain(
      'innerTab !== "pricing" && innerTab !== "bom" && innerTab !== "variants"',
    );
    expect(source).toContain("if (!variantDataReady) return;");
    expect(source).toContain("if (variantItems.length > 0) {");
    expect(source).toContain("setBomDraftSourceReady(true);");
  });

  it("Giá hiển thị đủ quy cách, giá bán, giá vốn, BOM và mặc định POS", () => {
    expect(source).toContain("Giá theo quy cách");
    expect(source).toContain("Giá vốn F&B");
    expect(source).toContain("Mã BOM");
    expect(source).toContain("POS mặc định");
    expect(source).toContain("variantItems.map((variant, index)");
    expect(source).toContain("Giá quản lý tại tab Giá & Tồn kho");
    expect(source).toContain(
      '(innerTab === "pricing" || innerTab === "bom" || innerTab === "variants")',
    );
    expect(source).toContain(
      '(innerTab !== "pricing" && innerTab !== "bom" && innerTab !== "variants")',
    );
    expect(source).toContain(
      'firstIssue.code === "variant_price_invalid"\n          ? "pricing"',
    );
  });

  it("chỉ có một ma trận công thức và ma trận nằm trong tab BOM", () => {
    expect(source.match(/<PerSizeRecipeMatrix/g)).toHaveLength(1);
    const bomTab = source.indexOf('<TabsContent value="bom"');
    const matrix = source.indexOf("<PerSizeRecipeMatrix");
    const variantTab = source.indexOf('<TabsContent value="variants"');
    expect(bomTab).toBeGreaterThan(0);
    expect(matrix).toBeGreaterThan(bomTab);
    expect(matrix).toBeLessThan(variantTab);
    expect(source).toContain("Tổng quan công thức theo size");
    expect(source).toContain("Mỗi cột là một BOM độc lập");
  });

  it("sản phẩm có size không đi qua luồng cập nhật hoặc tạo BOM đơn cũ", () => {
    expect(source).toContain(
      "variantItems.length === 0 &&\n            hasBom &&",
    );
    expect(source).toContain(
      "variantItems.length === 0 && !hasBom && bomExistingId",
    );
    expect(source).toContain(
      '!createAtomicallyWithFnbSizes &&\n        scope === "sku" &&\n        variantItems.length === 0 &&',
    );
  });
});
