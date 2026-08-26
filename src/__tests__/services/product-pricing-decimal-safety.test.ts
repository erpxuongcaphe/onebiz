import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatNumber, parseNumberInput } from "@/lib/format";

const dialogSource = readFileSync(
  "src/components/shared/dialogs/create-product-dialog.tsx",
  "utf8",
);

describe("Giá vốn SKU có phần lẻ", () => {
  it("giữ nguyên 2,168.11 khi hiển thị và khi nhận lại từ ô nhập", () => {
    expect(formatNumber(2168.11)).toBe("2,168.11");
    expect(parseNumberInput("2,168.11")).toBe(2168.11);
  });

  it("popup sản phẩm dùng ô số thập phân chuẩn, không xóa dấu chấm của giá vốn", () => {
    expect(dialogSource).toContain(
      'import { NumericInput } from "@/components/ui/numeric-input";',
    );
    expect(dialogSource).toContain('value={costPrice === "" ? null : Number(costPrice)}');
    expect(dialogSource).toContain("decimals={4}");
    expect(dialogSource).not.toContain("function formatVnd");
    expect(dialogSource).not.toContain("function parseVnd");
  });

  it("giá bán vẫn chỉ nhận số nguyên VND", () => {
    const pricingSection = dialogSource.slice(
      dialogSource.indexOf("Giá bán (₫)"),
      dialogSource.indexOf("Thuế VAT (%)"),
    );
    expect(pricingSection).toContain("decimals={0}");
  });
});
