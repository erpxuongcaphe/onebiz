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
import { productExcelSchema, supplierExcelSchema } from "@/lib/excel/schemas";

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
      ["SP001", "Cà phê đen", 25000, 100, "Có", "coffee", "19/04/2026"],
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
      ["SP001", "Cà phê đen", 25000, 100, "Có", "Cà phê", "19/04/2026"],
      ["SP002", "Bánh mì", 30000, 50, "Không", "Thức ăn", "20/04/2026"],
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

  it("rejects vi-VN decimal number format", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", "1,5"],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("Giá bán"))).toBe(true);
  });

  it("accepts en-US thousands and decimal number format", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", "1,234.56"],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].price).toBe(1234.56);
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

  it("rejects ISO date strings so imports stay DD/MM/YYYY", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán", "Ngày bán"],
      ["SP001", "Cà phê", 25000, "2026-04-19"],
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

  it("valid row giữ Excel row index nội bộ để service báo lỗi đúng dòng", () => {
    const wb = makeWb([
      ["Mã SP", "Tên sản phẩm", "Giá bán"],
      ["SP001", "Cà phê", 25000],
      ["SP002", "Trà", 10000],
    ]);
    const result = parseWorkbook(wb, productSchema);
    expect((result.validRows[1] as Product & { __excelRowIndex?: number }).__excelRowIndex).toBe(3);
  });
});

describe("real OneBiz schemas", () => {
  it("product import không cho nhập tồn kho trực tiếp để tránh lệch lịch sử kho", () => {
    const wb = makeWb([
      [
        "Mã SP",
        "Tên sản phẩm",
        "Loại",
        "Kênh bán",
        "Đơn vị tính",
        "Giá bán",
        "Giá vốn",
        "Tồn kho ban đầu",
      ],
      ["CF001", "Cà phê đen", "sku", "fnb", "Ly", 35000, 15000, 10],
    ]);
    const result = parseWorkbook(wb, productExcelSchema);
    expect(result.validRows).toHaveLength(0);
    expect(result.errorRows[0].errors.some((e) => e.includes("Tồn kho đầu kỳ"))).toBe(true);
  });

  it("supplier schema nhận cột ghi chú để không mất thông tin khi export/import", () => {
    const wb = makeWb([
      ["Mã NCC", "Tên NCC", "Ghi chú"],
      ["NCC001", "Công ty Cà phê Việt", "Liên hệ anh Nam"],
    ]);
    const result = parseWorkbook(wb, supplierExcelSchema);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].note).toBe("Liên hệ anh Nam");
  });

  // ============================================================
  // CEO 19/05/2026: MST tự do — KHÔNG được validate format
  // CEO báo lỗi mặc dù đã sửa hôm 18/5. Test này LOCK lại fix.
  // ============================================================
  describe("MST (Mã số thuế) — KHÔNG validate format (CEO 19/05/2026)", () => {
    const MST_FORMATS_OK = [
      ["0301234567", "MST chuẩn VN 10 số"],
      ["0301234567-001", "MST có chi nhánh (10-3)"],
      ["123", "MST ngắn (NCC tạm)"],
      ["", "MST rỗng (NCC cá nhân)"],
      ["VAT-DE-12345678901", "MST nước ngoài (Đức)"],
      ["DOMESTIC-001", "MST tự đặt"],
      ["TAX_PENDING_2026", "MST tạm chờ cấp"],
      ["12345", "MST ngắn 5 số"],
      ["999999999999999", "MST dài 15 số"],
    ] as const;

    for (const [mst, label] of MST_FORMATS_OK) {
      it(`supplier import chấp nhận MST "${mst}" (${label})`, () => {
        const wb = makeWb([
          ["Mã NCC", "Tên NCC", "Mã số thuế"],
          ["NCC001", "Test NCC", mst],
        ]);
        const result = parseWorkbook(wb, supplierExcelSchema);
        expect(result.tableErrors).toEqual([]);
        expect(result.errorRows).toEqual([]);
        expect(result.validRows).toHaveLength(1);
        expect(result.validRows[0].taxCode ?? "").toBe(mst);
      });
    }

    it("supplier import KHÔNG báo lỗi 'phải là 10 chữ số' với MST bất kỳ", () => {
      const wb = makeWb([
        ["Mã NCC", "Tên NCC", "Mã số thuế"],
        ["NCC001", "NCC A", "abc"],
        ["NCC002", "NCC B", "12"],
        ["NCC003", "NCC C", "không-phải-số"],
      ]);
      const result = parseWorkbook(wb, supplierExcelSchema);
      expect(result.tableErrors).toEqual([]);
      expect(result.errorRows).toEqual([]);
      expect(result.validRows).toHaveLength(3);
      // Verify không có error message nào chứa "10 chữ số" hoặc "10 số"
      const allErrors = [
        ...result.tableErrors,
        ...result.errorRows.flatMap((r) => r.errors),
      ].join(" | ");
      expect(allErrors).not.toContain("10 chữ số");
      expect(allErrors).not.toContain("10 số");
      expect(allErrors).not.toContain("phải là 10");
    });
  });

  // ============================================================
  // CEO 19/05/2026 (Phương án D): chỉ 1 cột "Đơn vị tính" bắt buộc.
  // Bỏ 3 cột ĐVT nhập/kho/bán khỏi Excel template (redundant + không
  // có conversion logic trong flow nhập/xuất hiện tại).
  // ============================================================
  describe("Đơn vị tính — chỉ 1 cột bắt buộc (CEO Phương án D 19/05/2026)", () => {
    it("import OK với 'Đơn vị tính' bắt buộc đầy đủ", () => {
      const wb = makeWb([
        ["Mã SP", "Tên sản phẩm", "Loại", "Kênh bán", "Đơn vị tính", "Giá bán", "Giá vốn"],
        ["SP001", "Cà phê đen", "sku", "fnb", "Ly", 35000, 15000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.tableErrors).toEqual([]);
      expect(result.errorRows).toEqual([]);
      expect(result.validRows[0].unit).toBe("Ly");
    });

    it("import FAIL khi 'Đơn vị tính' để trống", () => {
      const wb = makeWb([
        ["Mã SP", "Tên sản phẩm", "Loại", "Kênh bán", "Đơn vị tính", "Giá bán", "Giá vốn"],
        ["SP001", "SP test", "sku", "fnb", "", 35000, 15000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.errorRows).toHaveLength(1);
      expect(result.errorRows[0].errors.some((e) => e.includes("Đơn vị tính"))).toBe(
        true,
      );
    });

    it("import FAIL khi thiếu cột 'Đơn vị tính' trong header file", () => {
      const wb = makeWb([
        ["Mã SP", "Tên sản phẩm", "Loại", "Kênh bán", "Giá bán", "Giá vốn"],
        ["SP001", "SP test", "sku", "fnb", 35000, 15000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(
        result.tableErrors.some((e) => e.includes("Đơn vị tính")),
      ).toBe(true);
    });

    it("schema KHÔNG còn cột ĐVT nhập / ĐVT kho / ĐVT bán", () => {
      const headers = productExcelSchema.columns.map((c) => c.header);
      expect(headers).not.toContain("ĐVT nhập");
      expect(headers).not.toContain("ĐVT kho");
      expect(headers).not.toContain("ĐVT bán");
      // Vẫn còn cột "Đơn vị tính"
      expect(headers).toContain("Đơn vị tính");
    });

    it("nhiều SP với ĐVT khác nhau (ly / kg / lon) đều import OK", () => {
      const wb = makeWb([
        ["Mã SP", "Tên sản phẩm", "Loại", "Kênh bán", "Đơn vị tính", "Giá bán", "Giá vốn"],
        ["CF001", "Cà phê đen", "sku", "fnb", "Ly", 35000, 15000],
        ["CF-R", "Robusta sống", "nvl", "", "Kg", 0, 145000],
        ["SUA-01", "Sữa Vinamilk", "sku", "retail", "Lon", 12000, 8000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.tableErrors).toEqual([]);
      expect(result.errorRows).toEqual([]);
      expect(result.validRows).toHaveLength(3);
      expect(result.validRows.map((r) => r.unit)).toEqual(["Ly", "Kg", "Lon"]);
    });
  });

  // ============================================================
  // CEO 19/05/2026 (UOM Smart Hybrid): 2 cột quy đổi optional
  // ============================================================
  describe("Quy đổi đơn vị — 2 cột Excel (CEO UOM Smart Hybrid)", () => {
    const HEADERS = [
      "Mã SP",
      "Tên sản phẩm",
      "Loại",
      "Kênh bán",
      "Đơn vị tính",
      "Đóng gói (ĐVT lớn)",
      "Hệ số quy đổi",
      "Giá bán",
      "Giá vốn",
    ];

    it("import OK khi điền cả 'Đóng gói' + 'Hệ số quy đổi'", () => {
      const wb = makeWb([
        HEADERS,
        ["VPP-HG-A4", "Hộp giấy A4", "nvl", "", "Hộp", "Thùng", 12, 0, 50000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.tableErrors).toEqual([]);
      expect(result.errorRows).toEqual([]);
      expect(result.validRows[0].bulkUnit).toBe("Thùng");
      expect(result.validRows[0].bulkFactor).toBe(12);
    });

    it("import OK khi không khai báo quy đổi (cả 2 cột trống)", () => {
      const wb = makeWb([
        HEADERS,
        ["VPP-HG-A4", "Hộp giấy A4", "nvl", "", "Hộp", "", "", 0, 50000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.tableErrors).toEqual([]);
      expect(result.errorRows).toEqual([]);
      expect(result.validRows[0].bulkUnit).toBeUndefined();
      expect(result.validRows[0].bulkFactor).toBeUndefined();
    });

    it("FAIL khi khai 'Đóng gói' nhưng thiếu 'Hệ số quy đổi'", () => {
      const wb = makeWb([
        HEADERS,
        ["VPP-HG-A4", "Hộp giấy A4", "nvl", "", "Hộp", "Thùng", "", 0, 50000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.errorRows).toHaveLength(1);
      expect(result.errorRows[0].errors.some((e) => e.includes("Hệ số quy đổi"))).toBe(true);
    });

    it("FAIL khi khai 'Hệ số quy đổi' nhưng thiếu 'Đóng gói'", () => {
      const wb = makeWb([
        HEADERS,
        ["VPP-HG-A4", "Hộp giấy A4", "nvl", "", "Hộp", "", 12, 0, 50000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.errorRows).toHaveLength(1);
      expect(result.errorRows[0].errors.some((e) => e.includes("Đóng gói"))).toBe(true);
    });

    it("FAIL khi 'Đóng gói' trùng 'Đơn vị tính'", () => {
      const wb = makeWb([
        HEADERS,
        ["VPP-HG-A4", "Hộp giấy A4", "nvl", "", "Hộp", "Hộp", 12, 0, 50000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.errorRows).toHaveLength(1);
      expect(result.errorRows[0].errors.some((e) => e.includes("trùng"))).toBe(true);
    });

    it("nhiều SP — mix quy đổi và không quy đổi", () => {
      const wb = makeWb([
        HEADERS,
        ["CF-R", "Cà phê Robusta sống", "nvl", "", "Kg", "Bao", 60, 0, 145000],
        ["SUA-01", "Sữa Vinamilk", "sku", "retail", "Lon", "Thùng", 24, 12000, 8000],
        ["DUONG-01", "Đường mía", "nvl", "", "Kg", "", "", 0, 24000],
      ]);
      const result = parseWorkbook(wb, productExcelSchema);
      expect(result.tableErrors).toEqual([]);
      expect(result.errorRows).toEqual([]);
      expect(result.validRows[0].bulkUnit).toBe("Bao");
      expect(result.validRows[0].bulkFactor).toBe(60);
      expect(result.validRows[1].bulkUnit).toBe("Thùng");
      expect(result.validRows[1].bulkFactor).toBe(24);
      expect(result.validRows[2].bulkUnit).toBeUndefined();
    });
  });
});

// ============================================================
// CEO 20/05/2026 (BOM Decouple Phase 4-5): cột "Mã BOM" trong Excel SP
// ============================================================
import { bomExcelSchema, type BOMImportRow } from "@/lib/excel/schemas";

describe("Excel SP — cột 'Mã BOM' link với BOM (CEO BOM Decouple)", () => {
  const HEADERS_WITH_BOM = [
    "Mã SP",
    "Tên sản phẩm",
    "Loại",
    "Kênh bán",
    "Đơn vị tính",
    "Mã BOM",
    "Giá bán",
    "Giá vốn",
  ];

  it("import OK khi điền Mã BOM cho SKU", () => {
    const wb = makeWb([
      HEADERS_WITH_BOM,
      ["SKU-CFS-001", "Cà phê sữa đá", "sku", "fnb", "Ly", "BOM-CFS-001", 35000, 15000],
    ]);
    const result = parseWorkbook(wb, productExcelSchema);
    expect(result.tableErrors).toEqual([]);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].bomCode).toBe("BOM-CFS-001");
  });

  it("import OK khi để trống Mã BOM", () => {
    const wb = makeWb([
      HEADERS_WITH_BOM,
      ["SKU-CFS-002", "Bạc xỉu", "sku", "fnb", "Ly", "", 38000, 16000],
    ]);
    const result = parseWorkbook(wb, productExcelSchema);
    expect(result.tableErrors).toEqual([]);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].bomCode).toBeUndefined();
  });

  it("FAIL khi NVL điền Mã BOM (chỉ SKU mới có BOM)", () => {
    const wb = makeWb([
      HEADERS_WITH_BOM,
      ["NVL-CPH-001", "Robusta sống", "nvl", "", "Kg", "BOM-CFS-001", 0, 145000],
    ]);
    const result = parseWorkbook(wb, productExcelSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("chỉ áp dụng cho SKU"))).toBe(
      true,
    );
  });
});

// ============================================================
// CEO 20/05/2026 (BOM Decouple Phase 3): Excel BOM standalone
// ============================================================
describe("Excel BOM — 1 sheet phẳng, standalone (CEO BOM Decouple)", () => {
  const BOM_HEADERS = [
    "Mã BOM",
    "Tên BOM",
    "Mã chi nhánh",
    "Mã NVL",
    "Số lượng",
    "ĐVT",
    "Năng suất",
    "ĐVT năng suất",
    "Ghi chú",
  ];

  it("parse 1 BOM với 3 NVL items", () => {
    const wb = makeWb([
      BOM_HEADERS,
      ["BOM-CFS-001", "Bạc xỉu chuẩn", "", "NVL-CPH-001", 18, "g", 1, "ly", "Cà phê rang"],
      ["BOM-CFS-001", "Bạc xỉu chuẩn", "", "NVL-SUA-001", 80, "ml", 1, "ly", "Sữa tươi"],
      ["BOM-CFS-001", "Bạc xỉu chuẩn", "", "NVL-DUO-001", 10, "g", 1, "ly", "Đường"],
    ]);
    const result = parseWorkbook(wb, bomExcelSchema);
    expect(result.tableErrors).toEqual([]);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows).toHaveLength(3);
    // Cùng Mã BOM repeat
    expect(result.validRows.map((r) => r.bomCode)).toEqual([
      "BOM-CFS-001",
      "BOM-CFS-001",
      "BOM-CFS-001",
    ]);
    expect(result.validRows.map((r) => r.materialCode)).toEqual([
      "NVL-CPH-001",
      "NVL-SUA-001",
      "NVL-DUO-001",
    ]);
  });

  it("parse nhiều BOM xen kẽ", () => {
    const wb = makeWb([
      BOM_HEADERS,
      ["BOM-CFS-001", "Bạc xỉu", "", "NVL-CPH-001", 18, "g", 1, "ly", ""],
      ["BOM-CFS-002", "Cà phê đen", "", "NVL-CPH-001", 20, "g", 1, "ly", ""],
      ["BOM-CFS-002", "Cà phê đen", "", "NVL-DUO-001", 5, "g", 1, "ly", ""],
    ]);
    const result = parseWorkbook(wb, bomExcelSchema);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows).toHaveLength(3);
  });

  it("FAIL khi quantity <= 0", () => {
    const wb = makeWb([
      BOM_HEADERS,
      ["BOM-CFS-001", "Test", "", "NVL-CPH-001", 0, "g", 1, "ly", ""],
    ]);
    const result = parseWorkbook(wb, bomExcelSchema);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].errors.some((e) => e.includes("> 0"))).toBe(true);
  });

  it("FAIL khi thiếu Mã BOM (required)", () => {
    const wb = makeWb([
      BOM_HEADERS,
      ["", "Test", "", "NVL-CPH-001", 18, "g", 1, "ly", ""],
    ]);
    const result = parseWorkbook(wb, bomExcelSchema);
    expect(result.errorRows).toHaveLength(1);
  });

  it("BOM với chi nhánh override (Mã chi nhánh có giá trị)", () => {
    const wb = makeWb([
      BOM_HEADERS,
      ["BOM-CFS-001-Q1", "Bạc xỉu Q1", "Q1", "NVL-CPH-001", 20, "g", 1, "ly", ""],
    ]);
    const result = parseWorkbook(wb, bomExcelSchema);
    expect(result.errorRows).toEqual([]);
    expect(result.validRows[0].branchCode).toBe("Q1");
  });

  it("Schema có đủ 9 cột định nghĩa", () => {
    const headers = bomExcelSchema.columns.map((c) => c.header);
    expect(headers).toContain("Mã BOM");
    expect(headers).toContain("Tên BOM");
    expect(headers).toContain("Mã chi nhánh");
    expect(headers).toContain("Mã NVL");
    expect(headers).toContain("Số lượng");
    expect(headers).toContain("ĐVT");
    expect(headers).toContain("Năng suất");
    expect(headers).toContain("ĐVT năng suất");
    expect(headers).toContain("Ghi chú");
    // KHÔNG có cột "Mã SKU" — BOM standalone
    expect(headers).not.toContain("Mã SKU");
  });
});
