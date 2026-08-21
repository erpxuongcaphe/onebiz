import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ĐỒNG BỘ REPO ↔ PRODUCTION (00335 Pha A/A3).
 *
 * LỖ HỔNG ĐANG VÁ: tám RPC báo cáo đã đổi sang đọc NGÀY HÓA ĐƠN trên
 * production ngày 20/08/2026, nhưng bản đổi chỉ nằm ở tệp vận hành CHƯA TRACK
 * (SQL-CAN-CHAY/…). Dựng database trắng từ repo sẽ ra tám hàm vẫn lọc theo
 * invoices.created_at ⇒ khác production, các trang báo cáo lệch số nhau đúng
 * vào những hóa đơn được chỉnh ngày.
 *
 * Test này khoá: mọi hàm trong danh sách phải được một migration TRONG REPO
 * chuyển sang ngày hóa đơn. Nếu ai đó thêm bản vá mới ở SQL-CAN-CHAY mà quên
 * đưa vào repo, hàm đó phải được thêm vào đây và test sẽ đỏ cho tới khi có
 * migration.
 */

const THU_MUC = join(process.cwd(), "supabase/migrations");

const NOI_DUNG_MIGRATION = readdirSync(THU_MUC)
  .filter((f) => f.endsWith(".sql") && !f.includes("rollback"))
  .map((f) => ({ ten: f, noiDung: readFileSync(join(THU_MUC, f), "utf8") }));

/** Tám RPC báo cáo phải đọc theo ngày hóa đơn, kèm migration chịu trách nhiệm. */
const HAM_PHAI_DOI: Array<[string, string]> = [
  ["get_customer_product_report", "00338"],
  ["get_customer_product_detail_page", "00338"],
  ["get_customer_product_export_page", "00338"],
  ["get_invoice_list_summary", "00339"],
  ["get_sales_report_invoice_page", "00339"],
  ["get_sales_report_summary", "00339"],
  ["get_profit_and_loss_report", "00339"],
  ["get_branch_profit_and_loss_report", "00339"],
];

describe("Tám RPC báo cáo đọc theo ngày hóa đơn phải nằm TRONG REPO", () => {
  it.each(HAM_PHAI_DOI)("%s — có migration %s xử lý", (ham, soHieu) => {
    const file = NOI_DUNG_MIGRATION.find((m) => m.ten.startsWith(soHieu));
    expect(file, `thiếu migration ${soHieu}`).toBeTruthy();
    expect(file!.noiDung).toContain(ham);
    expect(file!.noiDung).toContain("issued_at");
  });

  it("00338 và 00339 đều idempotent: bỏ qua hàm đã có marker", () => {
    for (const so of ["00338", "00339"]) {
      const f = NOI_DUNG_MIGRATION.find((m) => m.ten.startsWith(so))!;
      expect(f.noiDung, `${so} phải nhận marker`).toContain("ISSUED_AT_00335");
    }
  });

  it("KHÔNG mang md5 guard của bản vận hành (nổ oan trên database trắng)", () => {
    for (const so of ["00338", "00339"]) {
      const f = NOI_DUNG_MIGRATION.find((m) => m.ten.startsWith(so))!;
      // Chỉ được nhắc md5 trong chú thích, không được có phép so md5 thật.
      expect(f.noiDung).not.toMatch(/^\s*(if|and|or).*md5\(/im);
    }
  });

  it("mỗi migration đều có file hoàn tác", () => {
    const tep = readdirSync(THU_MUC);
    expect(tep).toContain("00338_rollback_report_rpcs_issued_at.sql");
    expect(tep).toContain("00339_rollback_invoice_report_rpcs_issued_at.sql");
    expect(tep).toContain("00337_rollback_mark_order_processed_completed_only.sql");
  });

  it("hậu kiểm nằm TRONG transaction — sai là rollback, không để nửa vời", () => {
    for (const so of ["00338", "00339"]) {
      const f = NOI_DUNG_MIGRATION.find((m) => m.ten.startsWith(so))!;
      const viTriHauKiem = f.noiDung.indexOf("hau_kiem");
      const viTriCommit = f.noiDung.lastIndexOf("commit;");
      expect(viTriHauKiem, `${so} thiếu hậu kiểm`).toBeGreaterThan(-1);
      expect(viTriHauKiem, `${so}: hậu kiểm phải trước commit`).toBeLessThan(viTriCommit);
    }
  });
});

describe("Sổ quỹ và ca GIỮ thời gian giao dịch thật", () => {
  it("không migration nào kéo cash_transactions sang issued_at", () => {
    for (const m of NOI_DUNG_MIGRATION) {
      const doan = m.noiDung.match(/cash_transactions[^\n]*issued_at/g);
      expect(doan, `${m.ten} kéo sổ quỹ sang ngày hóa đơn`).toBeNull();
    }
  });

  it("màn hóa đơn trong ca vẫn lọc theo created_at", () => {
    const drawer = readFileSync(
      join(process.cwd(), "src/app/pos/components/shift-invoice-drawer.tsx"),
      "utf8",
    );
    expect(drawer).toContain('dateColumn: "created_at"');
  });
});
