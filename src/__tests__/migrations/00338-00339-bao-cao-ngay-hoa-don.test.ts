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
    // Chỉ kiểm hai migration THUỘC PHẠM VI này. Hoàn tác của 00337 do PR đơn
    // bán con tự khoá — không kiểm chéo để hai PR độc lập nhau.
    const tep = readdirSync(THU_MUC);
    expect(tep).toContain("00338_rollback_report_rpcs_issued_at.sql");
    expect(tep).toContain("00339_rollback_invoice_report_rpcs_issued_at.sql");
  });

  it("chụp ẢNH BẤT BIẾN thân hàm trước khi vá", () => {
    for (const so of ["00338", "00339"]) {
      const f = NOI_DUNG_MIGRATION.find((m) => m.ten.startsWith(so))!;
      expect(f.noiDung).toContain("public.rpc_backup_ngay_hoa_don");
      expect(f.noiDung).toContain("pg_get_functiondef(p.oid)");
      // Chạy lần hai KHÔNG được chụp đè bản đã vá.
      expect(f.noiDung).toContain("on conflict (migration, ham_oid) do nothing");
      expect(f.noiDung).not.toMatch(/drop table if exists public\.rpc_backup_ngay_hoa_don/);
    }
  });

  it("HOÀN TÁC TỰ ĐỦ — không bắt người vận hành nhớ chạy 00305/00198", () => {
    for (const [so, soHam] of [["00338", "3"], ["00339", "5"]] as const) {
      const ht = readFileSync(
        join(
          THU_MUC,
          so === "00338"
            ? "00338_rollback_report_rpcs_issued_at.sql"
            : "00339_rollback_invoice_report_rpcs_issued_at.sql",
        ),
        "utf8",
      );
      // Khôi phục từ ảnh chụp, không chép thân hàm ra chỗ thứ hai.
      expect(ht).toContain("execute r.def_truoc");
      expect(ht).toContain("public.rpc_backup_ngay_hoa_don");
      expect(ht).toContain(`migration = '${so}'`);
      // Guard rõ khi thiếu ảnh chụp hoặc thiếu dòng.
      expect(ht).toContain("không thể hoàn tác chính xác");
      expect(ht).toContain(`(phải ${soHam})`);
      // KHÔNG được yêu cầu chạy thêm migration khác.
      expect(ht).not.toMatch(/chạy lại đúng migration gốc/);
      expect(ht).not.toMatch(/00305_kpi_hoa_don_summary\.sql/);
      expect(ht).not.toMatch(/00198_reporting_v3_core_aggregates\.sql/);
      // Hậu kiểm so với ẢNH CHỤP, không so marker: trên production bản trước
      // khi chạy vốn ĐÃ có marker (Pha A/A3 vá 20/08) nên so marker sẽ báo
      // hỏng oan.
      expect(ht).toContain("is distinct from b.def_truoc");
      expect(ht).not.toMatch(/còn % hàm mang marker/);
    }
  });

  it("00339 DỪNG khi chưa đủ 5 hàm — tránh chụp ảnh thiếu, mất đường lùi", () => {
    const f = NOI_DUNG_MIGRATION.find((m) => m.ten.startsWith("00339"))!;
    expect(f.noiDung).toContain("GUARD_00339: thiếu hàm");
    expect(f.noiDung).toContain("chạy 00198 và 00305 trước");
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
