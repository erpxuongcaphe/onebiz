import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/dialogs/create-product-dialog.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const parentSummaryMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/00369_sync_fnb_parent_from_default_size.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

describe("quản trị FnB nhiều size dùng một nguồn dữ liệu", () => {
  it("tải variants trước khi mở Giá, BOM hoặc Quy cách", () => {
    expect(source).toContain(
      'innerTab !== "pricing" && innerTab !== "bom" && innerTab !== "variants"',
    );
    expect(source).toContain("if (!variantDataReady) return;");
    expect(source).toContain("if (variantItems.length > 0) {");
    expect(source).toContain("setBomDraftSourceReady(true);");
  });

  it("không kẹt tải hoặc rơi về form một giá khi đổi tab giữa chừng", () => {
    expect(source).toContain(
      "if (!settled && loadedVariantsKeyRef.current === loadingProductId)",
    );
    expect(source).toContain("const restoredVariantDataReady =");
    expect(source).toContain('draft.channel !== "fnb"');
    expect(source).toContain("variantDataError ? (");
    expect(source).toContain("Không tải được đầy đủ giá và công thức theo size");
    expect(source).toContain("Thử lại");
    expect(source).toContain("retryVariantDataLoad");
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

  it("chốt SKU cha theo size mặc định sau khi toàn bộ BOM size đã lưu", () => {
    const atomicSave = parentSummaryMigration.indexOf(
      "v_result := public.save_fnb_size_setup_atomic_00368",
    );
    const parentUpdate = parentSummaryMigration.indexOf(
      "update public.products product",
    );

    expect(atomicSave).toBeGreaterThan(0);
    expect(parentUpdate).toBeGreaterThan(atomicSave);
    expect(parentSummaryMigration).toContain(
      "sell_price = (v_default_variant->>'sellPrice')::numeric",
    );
    expect(parentSummaryMigration).toContain(
      "cost_price = coalesce((v_default_variant->>'costPrice')::numeric, 0)",
    );
    expect(parentSummaryMigration).toContain("has_bom = true");
    expect(parentSummaryMigration).toContain("product.tenant_id = v_tenant");
    expect(parentSummaryMigration).toContain("to authenticated");
  });
});
