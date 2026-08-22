import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00296_fix_pos_prepare_product_status.sql",
  "utf8",
);
const invoicePage = readFileSync(
  "src/app/(main)/don-hang/hoa-don/page.tsx",
  "utf8",
);

describe("POS checkout product activity regression", () => {
  it("removes the retired product status predicate from price preparation", () => {
    expect(migration).toContain("pos_prepare_retail_checkout");
    expect(migration).toContain("and p.status = ''active''");
    expect(migration).toContain("checkout_chain_legacy_status_removed");
    expect(migration).toContain("p.is_active");
  });

  it("changes stored function code only and does not write business rows", () => {
    expect(migration).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\./i);
  });

  it("does not label an unfinished zero-debt draft as paid", () => {
    // Cắt tới HẾT định nghĩa cột thay vì đếm cứng số ký tự: thêm một nhánh vào
    // cột (ví dụ nhãn "Đã xử lý" cho đơn đặt hàng đã gắn hóa đơn con) sẽ đẩy
    // "Đã TT" ra ngoài cửa sổ cố định và làm test đỏ oan.
    const batDau = invoicePage.indexOf('accessorKey: "debt"');
    expect(batDau).toBeGreaterThan(-1);
    const ketThuc = invoicePage.indexOf("accessorKey:", batDau + 20);
    const debtColumn = invoicePage.slice(
      batDau,
      ketThuc > batDau ? ketThuc : invoicePage.length,
    );

    expect(debtColumn).toContain('row.original.status !== "completed"');
    expect(debtColumn).toContain("Chưa hoàn tất");
    expect(debtColumn).toContain("Đã TT");
    expect(debtColumn.indexOf('row.original.status !== "completed"')).toBeLessThan(
      debtColumn.indexOf("Đã TT"),
    );
    // Nhánh "chưa completed" vẫn phải đứng trước nhãn thanh toán: nhãn "Đã xử
    // lý" chỉ áp cho đơn CHƯA completed nên không được lọt vào nhánh đã thanh toán.
    expect(debtColumn.indexOf("Đã xử lý")).toBeLessThan(debtColumn.indexOf("Đã TT"));
  });
});
