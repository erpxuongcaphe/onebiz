import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 05/08/2026 (CEO): "anh sẽ cập nhật giá sau, e chỉ cần build tốt việc nhập
 * xuất dữ liệu từ xlsx".
 *
 * Vòng tròn phải khép: XUẤT (nút "Sửa & nhập lại") → sửa giá trong Excel →
 * NHẬP lại → cập nhật đúng dòng cũ.
 *
 * Trước 05/08 đường nhập chỉ `.insert` nên nhập lại là trùng mã, hỏng cả file
 * — nút "Sửa & nhập lại" hứa mà không làm được. Bộ test này khoá lại:
 *   1. nhập biết CẬP NHẬT khi mã đã tồn tại
 *   2. tồn kho KHÔNG bao giờ đi qua đường Excel hàng hóa
 *   3. quy đổi đơn vị không nhân bản khi nhập lại nhiều lần
 *   4. giao diện nói rõ hành vi cho người dùng
 */

const importSvc = readFileSync(
  "src/lib/services/supabase/excel-import.ts",
  "utf8",
);
const dialog = readFileSync(
  "src/components/shared/dialogs/import-excel-dialog.tsx",
  "utf8",
);
const productsPage = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");
const schema = readFileSync("src/lib/excel/schemas/products.ts", "utf8");

describe("Nhập Excel hàng hóa — sửa được hàng đã có", () => {
  it("tra mã cũ rồi CẬP NHẬT thay vì luôn thêm mới", () => {
    expect(importSvc).toContain("const codeToId = new Map<string, string>()");
    expect(importSvc).toContain("const existingId = codeToId.get(row.code.trim())");
    expect(importSvc).toMatch(/if \(existingId\)[\s\S]{0,200}from\("products"\)\.update/);
  });

  it("mã mới vừa thêm được nhớ lại — file có 2 dòng trùng mã không vỡ", () => {
    expect(importSvc).toContain("codeToId.set(row.code.trim(), productId)");
  });

  it("tồn kho KHÔNG đi qua đường Excel hàng hóa", () => {
    // chặn ngay đầu hàm
    expect(importSvc).toContain(
      "File hàng hóa không ghi tồn kho; dùng mẫu Tồn kho đầu kỳ hoặc phiếu nhập",
    );

    // Bộ cột dùng chung cho cả thêm mới lẫn CẬP NHẬT: tuyệt đối không có
    // stock — nếu lọt vào đây là nhập Excel sẽ ghi đè tồn kho thật.
    const sharedFields = importSvc.slice(
      importSvc.indexOf("const fields = {"),
      importSvc.indexOf("const existingId = codeToId.get"),
    );
    expect(sharedFields.length).toBeGreaterThan(100);
    expect(sharedFields).not.toMatch(/\bstock:/);

    // Nhánh CẬP NHẬT chỉ trải `fields`, không thêm cột nào khác ngoài dấu thời gian
    expect(importSvc).toContain("({ ...fields, updated_at: new Date().toISOString() })");
    // stock: 0 chỉ được phép ở nhánh THÊM MỚI (hàng mới bắt đầu từ 0)
    expect(importSvc).toContain("{ tenant_id: tenantId, code: row.code, stock: 0, ...fields }");
  });

  it("quy đổi đơn vị không nhân bản khi nhập lại", () => {
    expect(importSvc).toContain('.from("uom_conversions")');
    expect(importSvc).toContain("existingConv?.id");
  });
});

describe("Khách hàng + Nhà cung cấp cũng sửa được, không chỉ thêm", () => {
  it("mã KH đã có thì cập nhật", () => {
    expect(importSvc).toContain("const custCodeToId = new Map<string, string>()");
    expect(importSvc).toMatch(/if \(existingCustId\)[\s\S]{0,160}from\("customers"\)\.update/);
  });

  it("mã NCC đã có thì cập nhật", () => {
    expect(importSvc).toContain("const supCodeToId = new Map<string, string>()");
    expect(importSvc).toMatch(/if \(existingSupId\)[\s\S]{0,160}from\("suppliers"\)\.update/);
  });

  it("KHÔNG ghi đè công nợ qua Excel", () => {
    // debt của KH/NCC chỉ đổi qua hóa đơn, phiếu nhập, phiếu thu/chi
    const custFields = importSvc.slice(
      importSvc.indexOf("const custFields = {"),
      importSvc.indexOf("const existingCustId"),
    );
    const supFields = importSvc.slice(
      importSvc.indexOf("const supFields = {"),
      importSvc.indexOf("const existingSupId"),
    );
    expect(custFields.length).toBeGreaterThan(100);
    expect(supFields.length).toBeGreaterThan(100);
    // soi PHÉP GÁN trường (`debt:`), không phải chữ "debt" trong chú thích
    expect(custFields).not.toMatch(/^\s*debt\s*:/m);
    expect(supFields).not.toMatch(/^\s*debt\s*:/m);
    // và cũng không ghi đè tổng chi tiêu / lịch sử mua
    expect(custFields).not.toMatch(/^\s*total_spent\s*:/m);
  });
});

describe("Vòng xuất → sửa → nhập được nối đủ", () => {
  it("trang hàng hóa có nút xuất đúng mẫu nhập", () => {
    expect(productsPage).toContain("Sửa & nhập lại");
    expect(productsPage).toContain('handleExport("import")');
    expect(productsPage).toContain("bulkImportProducts");
  });

  it("mẫu Excel có cột giá bán để CEO điền", () => {
    expect(schema).toContain('key: "sellPrice"');
  });

  it("giao diện nói rõ: mã cũ được cập nhật, tồn kho không đổi", () => {
    expect(dialog).toContain("Mã đã có sẽ được cập nhật");
    expect(dialog).toContain("Tồn kho");
  });
});
