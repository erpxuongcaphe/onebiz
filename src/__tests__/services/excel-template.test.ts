/**
 * Excel Template Import/Export — unit tests
 *
 * Test parseWorkbook directly với in-memory workbook để tránh phụ thuộc FS.
 * Round-trip test: build workbook từ schema → parse → verify.
 */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

import { parseWorkbook } from "@/lib/excel/template-parser";
import type { ExcelSchema } from "@/lib/excel/types";

interface Product {
  sku: string;
  name: string;
  price: number;
  stock: number;
  active: boolean;
  category: string;
  releaseDate: Date;
}

const productSchema: ExcelSchema<Product> = {
  name: "Sản phẩm",
  fileName: "san-pham",
  columns: [
    {
      key: "sku",
      header: "Mã SP",
      type: "string",
      required: true,
      unique: true,
      minLength: 3,
      maxLength: 20,
    },
    {
      key: "name",
      header: "Tên sản phẩm",
      type: "string",
      required: true,
    },
    {
      key: "price",
      header: "Giá bán",
      type: "number",
      required: true,
      min: 0,
    },
    {
      key: "stock",
      header: "Tồn kho",
      type: "integer",
      min: 0,
    },
    {
      key: "active",
      header: "Đang bán",
      type: "boolean",
    },
    {
      key: "category",
      header: "Nhóm hàng",
      type: "enum",
      enumValues: ["food", "drink", "coffee"] as const,
      enumLabels: {
        food: "Thức ăn",
        drink: "Nước uống",
        coffee: "Cà phê",
      },
    },
    {
      key: "releaseDate",
      header: "Ngày bán",
      type: "date",
    },
  ],
};

/** Build workbook in-memory với aoa → test parse mà không đụng FS. */
function makeWb(rows: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dữ liệu");
  return wb;
}

describe("parseWorkbook — happy path", () => {
  it("parse 1 row hợp lệ", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Tồn kho", "Đang bán", "Nhóm hàng", "Ngày bán"],
      ["SP001", "Cà phê đen", 25000, 100, "Có", "coffee", "2026-04-19"],
    ]);
    const result = parseWorkbook(wb, productSchema);

    expect(result.tableErrors).toEqual([]);
    expect(result.errorRows).toEqual([]);
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toHaveLength(1);

    const row = result.validRows[0];
    expect(row.sku).toBe("SP001");
    expect(row.name).toBe("Cà phê đen");
    expect(row.price).toBe(25000);
    expect(row.stock).toBe(100);
    expect(row.active).toBe(true);
    expect(row.category).toBe("coffee");
    expect(row.releaseDate).toBeInstanceOf(Date);
  });

  it("parse nhiều rows, match enum bằng label tiếng Việt", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Tồn kho", "Đang bán", "Nhóm hàng", "Ngày bán"],
      ["SP001", "Cà phê đen", 25000, 100, "Có", "Cà phê", "2026-04-19"],
      ["SP002", "Bánh mì", 30000, 50, "Không", "Thức ăn", "2026-04-20"],
    ]);
    const result = parseWorkbook(wb, productSchema);

    expect(result.errorRows).toEqual([]);
    expect(result.validRows).toHaveLength(2);
    expect(result.validRows[0].category).toBe("coffee");
    expect(result.validRows[1].category).toBe("food");
    expect(result.validRows[1].active).toBe(false);
  });

  it("bỏ qua row trống", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
      [null, null, null],
      ["", "", ""],
      ["SP002", "Trà", 20000],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toHaveLength(2);
  });

  it("cho phép columns được rearrange không theo order schema", () => {
    // Headers thứ tự khác schema
    const wb = makeWb([
      ["Tên sản phẩm", "Mã SP", "Giá bán"],
      ["Cà phê", "SP001", 25000],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].sku).toBe("SP001");
    expect(result.validRows[0].name).toBe("Cà phê");
  });
});

describe("parseWorkbook — validation errors", () => {
  it("required column thiếu → tableError", () => {
    const wb = makeWb([
      ["Tên sản phẩm", "Giá bán"], // thiếu "Mã SP" (required)
      ["Cà phê", 25000],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.tableErrors.some((e) => e.includes("Mã SP"))).toBe(true);
  });

  it("required cell trống → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["", "Cà phê", 25000], // thiếu SKU
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("Mã SP"))).toBe(true);
  });

  it("wrong type number → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", "khong-phai-so"],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("Giá bán"))).toBe(true);
    expect(result.errorRows[0].errors.some((e) => e.includes("số"))).toBe(true);
  });

  it("integer nhưng truyền float → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Tồn kho"],
      ["SP001", "Cà phê", 25000, 10.5], // stock phải là integer
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("Tồn kho"))).toBe(true);
  });

  it("min/max violation → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", -100], // price >= 0
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("không được nhỏ hơn 0"))).toBe(
      true
    );
  });

  it("minLength violation → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["AB", "Cà phê", 25000], // sku < 3 chars
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows[0].errors.some((e) => e.includes("ít nhất 3"))).toBe(true);
  });

  it("enum mismatch → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Nhóm hàng"],
      ["SP001", "Cà phê", 25000, "invalid-category"],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("Nhóm hàng"))).toBe(true);
  });

  it("date không hợp lệ → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Ngày bán"],
      ["SP001", "Cà phê", 25000, "not-a-date"],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("Ngày bán"))).toBe(true);
  });

  it("unique violation → cả 2 row đều lỗi", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
      ["SP001", "Cà phê sữa", 28000], // trùng SKU
      ["SP002", "Trà", 20000],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(2);
    expect(result.errorRows[0].rowIndex).toBe(2);
    expect(result.errorRows[1].rowIndex).toBe(3);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].sku).toBe("SP002");
  });

  it("multiple errors cùng 1 row", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Nhóm hàng"],
      ["AB", "", -50, "invalid"], // sku too short, name empty, price negative, enum invalid
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseWorkbook — boolean variants", () => {
  it.each([
    ["Có", true],
    ["co", true],
    ["yes", true],
    ["TRUE", true],
    ["1", true],
    ["x", true],
    ["Không", false],
    ["no", false],
    ["false", false],
    ["0", false],
  ])("parse '%s' → %s", (input, expected) => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Đang bán"],
      ["SP001", "Cà phê", 25000, input],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].active).toBe(expected);
  });

  it("boolean không hợp lệ → row error", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Đang bán"],
      ["SP001", "Cà phê", 25000, "maybe"],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
  });
});

describe("parseWorkbook — validateRow callback", () => {
  it("callback return null → valid", () => {
    const schema: ExcelSchema<Product> = {
      ...productSchema,
      validateRow: () => null,
    };
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
    ]);
    const result = parseWorkbook(wb, schema);
    expect(result.errorRows).toEqual([]);
  });

  it("callback return message → row error", () => {
    const schema: ExcelSchema<Product> = {
      ...productSchema,
      validateRow: (row) =>
        row.price > 10000 ? "Giá không được vượt quá 10000" : null,
    };
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
    ]);
    const result = parseWorkbook(wb, schema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors).toContain("Giá không được vượt quá 10000");
  });

  it("callback throw error → row error", () => {
    const schema: ExcelSchema<Product> = {
      ...productSchema,
      validateRow: () => {
        throw new Error("Lỗi DB check");
      },
    };
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
    ]);
    const result = parseWorkbook(wb, schema);
    expect(result.errorRows[0].errors).toContain("Lỗi DB check");
  });
});

describe("parseWorkbook — file-level edge cases", () => {
  it("file trống (chỉ header) → totalRows = 0", () => {
    const wb = makeWb([["Mã SP", "Tên sản phẩm", "Giá bán"]]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.totalRows).toBe(0);
    expect(result.validRows).toEqual([]);
    expect(result.errorRows).toEqual([]);
  });

  it("file hoàn toàn trống → tableError", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Dữ liệu");
    const result = parseWorkbook(wb, productSchema);
    expect(result.tableErrors.length).toBeGreaterThan(0);
  });

  it("không có sheet nào → tableError", () => {
    const wb: XLSX.WorkBook = { SheetNames: [], Sheets: {} };
    const result = parseWorkbook(wb, productSchema);
    expect(result.tableErrors.length).toBeGreaterThan(0);
  });

  it("fallback sheet đầu tiên nếu không có 'Dữ liệu'", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const result = parseWorkbook(wb, productSchema);
    expect(result.validRows).toHaveLength(1);
  });
});

describe("parseWorkbook — rowIndex tracking", () => {
  it("rowIndex = Excel 1-indexed bao gồm header row", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"], // row 1
      ["SP001", "Cà phê", 25000], // row 2 OK
      ["", "Bánh", 15000], // row 3 LỖI
      ["SP003", "Trà", 10000], // row 4 OK
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].rowIndex).toBe(3);
  });
});
