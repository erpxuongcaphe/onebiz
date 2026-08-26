import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Bộ chọn thành phần công thức FnB", () => {
  it("màn công thức chung tìm theo mã hoặc tên và loại thành phần đã thêm", () => {
    const source = readFileSync(
      "src/components/shared/dialogs/bom-editor-dialog.tsx",
      "utf8",
    );
    expect(source).toContain('placeholder="Nhập mã hoặc tên thành phần..."');
    expect(source).toContain("product.code.toLocaleLowerCase");
    expect(source).toContain("product.name.toLocaleLowerCase");
    expect(source).toContain("!items.some((item) => item.materialId === product.id)");
  });

  it("công thức theo cỡ dùng productId ổn định và không cho chọn trùng dòng", () => {
    const source = readFileSync(
      "src/components/shared/dialogs/per-size-recipe-matrix.tsx",
      "utf8",
    );
    expect(source).toContain("function MaterialSearchCell");
    expect(source).toContain('placeholder="Nhập mã hoặc tên nguyên liệu..."');
    expect(source).toContain("material.id === row.materialId");
    expect(source).toContain("other.key !== row.key && other.materialId === material.id");
    expect(source).toContain("materialId: material.id");
  });

  it("BOM món nước lấy đơn vị đầu ra từ chính SKU, không mặc định kg", () => {
    const source = readFileSync(
      "src/components/shared/dialogs/bom-editor-dialog.tsx",
      "utf8",
    );
    expect(source).toContain("const selectedSkuForYield = skuOptions.find");
    expect(source).toContain("setYieldUnit(selectedSkuForYield.unit)");
  });

  it("dấu chọn trong dòng không phải nút lồng nên không giành sự kiện click", () => {
    const source = readFileSync(
      "src/components/shared/dialogs/create-product-dialog.tsx",
      "utf8",
    );
    const start = source.indexOf('data-selected={isSelected ? "true" : "false"}');
    const checkbox = source.slice(start, start + 620);
    expect(start).toBeGreaterThan(0);
    expect(checkbox).toContain("isSelected && <Icon");
    expect(checkbox).not.toContain("<Checkbox");
  });
});
