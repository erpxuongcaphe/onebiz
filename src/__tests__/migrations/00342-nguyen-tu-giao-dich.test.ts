import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 00342 — TÍNH NGUYÊN TỬ CỦA GIAO DỊCH
 *
 * Lỗi được sửa (Codex bắt 22/08/2026): bản đầu của 00342 ghi trong chú thích là
 * "hậu kiểm chạy TRONG cùng transaction, sai là cuộn lại" nhưng KHÔNG có
 * `begin;`/`commit;`. psql chạy autocommit từng lệnh ⇒ lời hứa đó là SAI.
 *
 * ĐÃ ĐO HÀNH VI THẬT trên PostgreSQL 16.4 (nền sao chép có 00339, chèn một hậu
 * kiểm cố ý hỏng vào cuối phần ghi):
 *
 *   bản KHÔNG bọc transaction → marker trên hàm f → **t**, bảng chụp f → **t**
 *                               (1 dòng)  ⇒ để lại RPC ĐÃ VÁ dù hậu kiểm hỏng
 *   bản CÓ begin/commit       → marker f → **f**, bảng chụp **không được tạo**
 *                               ⇒ sạch, không dấu vết dở
 *
 *   file HOÀN TÁC có hậu kiểm hỏng → marker VẪN = t (không để RPC nửa cũ nửa
 *                               mới); chạy hoàn tác thật thì marker về f.
 *
 * NOTIFY nằm TRONG transaction, ngay trước COMMIT (Codex 23/08): PostgreSQL chỉ
 * GIAO notification khi COMMIT, nên hậu kiểm nổ ⇒ cuộn lại ⇒ KHÔNG reload nào
 * được phát. Đặt SAU commit thì client bỏ qua lỗi và chạy tiếp vẫn phát reload
 * dù bản vá đã cuộn lại. Đã đo bằng `LISTEN pgrst` trong cùng phiên psql:
 *   hậu kiểm hỏng → 0 notification · chạy thành công → đúng 1 notification.
 *
 * CI không có PostgreSQL nên tệp này KHÔNG chạy lại phép đo đó. Nó khoá các
 * BẤT BIẾN CẤU TRÚC khiến phép đo trên còn đúng: mọi lệnh GHI phải nằm giữa
 * `begin;` và `commit;`, và thứ tự phải là begin → notify → commit.
 */

const goc = join(process.cwd(), "supabase", "migrations");
const doc = (ten: string) => readFileSync(join(goc, ten), "utf8");

const CAP_FILE: Array<[string, string]> = [
  ["bản vá", "00342_invoice_list_only_sales_documents.sql"],
  ["bản hoàn tác", "00342_rollback_invoice_list_only_sales_documents.sql"],
];

/** Vị trí dòng chỉ chứa đúng `begin;` / `commit;` (không tính chữ trong chú thích). */
function viTriDongLenh(sql: string, lenh: "begin" | "commit"): number[] {
  const dong = sql.split(/\r?\n/);
  const ra: number[] = [];
  dong.forEach((d, i) => {
    if (d.trim().toLowerCase() === `${lenh};`) ra.push(i);
  });
  return ra;
}

describe.each(CAP_FILE)("%s — bọc trong MỘT transaction", (_ten, tep) => {
  const sql = doc(tep);
  const moDau = viTriDongLenh(sql, "begin");
  const ketThuc = viTriDongLenh(sql, "commit");

  it("có đúng một `begin;` và một `commit;`", () => {
    expect(moDau).toHaveLength(1);
    expect(ketThuc).toHaveLength(1);
  });

  it("`commit;` đứng sau `begin;`", () => {
    expect(ketThuc[0]).toBeGreaterThan(moDau[0]);
  });

  it("KHÔNG có `rollback;` bỏ quên trong file", () => {
    expect(viTriDongLenh(sql, "commit").length).toBeGreaterThan(0);
    expect(sql.split(/\r?\n/).some((d) => d.trim().toLowerCase() === "rollback;")).toBe(false);
  });

  it("mọi lệnh GHI nằm giữa begin và commit", () => {
    const dong = sql.split(/\r?\n/);
    // Lệnh ghi = tạo/sửa hàm, tạo bảng chụp, ghi bản chụp, gắn chú thích hàm.
    const laLenhGhi = (d: string) =>
      /^\s*(create\s+(or\s+replace\s+)?(function|table)|insert\s+into|comment\s+on\s+function|alter\s+)/i.test(d);
    const ngoaiVung = dong
      .map((d, i) => ({ d, i }))
      .filter(({ d, i }) => laLenhGhi(d) && (i < moDau[0] || i > ketThuc[0]))
      .map(({ d, i }) => `dòng ${i + 1}: ${d.trim().slice(0, 60)}`);
    expect(ngoaiVung).toEqual([]);
  });

  it("thứ tự phải là begin → notify → commit", () => {
    // PostgreSQL chỉ GIAO notification khi COMMIT. Đặt notify TRONG transaction
    // ⇒ hậu kiểm nổ thì không có reload nào được phát. Đặt SAU commit thì client
    // bỏ qua lỗi và chạy tiếp vẫn phát reload dù bản vá đã cuộn lại.
    const dong = sql.split(/\r?\n/);
    const viTriNotify = dong
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => /^\s*notify\s+pgrst/i.test(d))
      .map(({ i }) => i);
    expect(viTriNotify).toHaveLength(1);
    expect(viTriNotify[0]).toBeGreaterThan(moDau[0]);
    expect(viTriNotify[0]).toBeLessThan(ketThuc[0]);
  });

  it("KHÔNG còn dòng notify nào nằm sau `commit;`", () => {
    const sauCommit = sql.split(/\r?\n/).slice(ketThuc[0] + 1);
    expect(sauCommit.filter((d) => /^\s*notify/i.test(d))).toEqual([]);
  });

  it("có hậu kiểm nổ bằng RAISE EXCEPTION (không chỉ cảnh báo rồi đi tiếp)", () => {
    // Cảnh báo rồi commit là kiểu hỏng âm thầm: số liệu sai mà không ai biết.
    expect(sql).toMatch(/raise\s+exception/i);
  });
});

describe("00342 — chú thích phải khớp hành vi", () => {
  it("bản vá nói rõ vì sao cần bọc transaction", () => {
    const sql = doc("00342_invoice_list_only_sales_documents.sql");
    expect(sql).toMatch(/NGUYÊN TỬ/);
    expect(sql).toMatch(/autocommit/i);
  });

  it("bản hoàn tác nêu rủi ro RPC nửa cũ nửa mới", () => {
    const sql = doc("00342_rollback_invoice_list_only_sales_documents.sql");
    expect(sql).toMatch(/NGUYÊN TỬ/);
    expect(sql).toMatch(/nửa cũ nửa mới/);
  });
});

describe("Bộ SQL giao cho CEO phải TRÙNG file trong repo", () => {
  const canChay = join(process.cwd(), "SQL-CAN-CHAY");
  const cap: Array<[string, string]> = [
    ["00342-BUOC-2-CHAY-MIGRATION.sql", "00342_invoice_list_only_sales_documents.sql"],
    ["00342-HOAN-TAC-CHI-DUNG-KHI-CAN.sql", "00342_rollback_invoice_list_only_sales_documents.sql"],
  ];
  it.each(cap)("%s trùng %s", (tepGiao, tepRepo) => {
    // Nếu lệch, CEO có thể chạy nhầm bản cũ — đúng cái bẫy "file trùng tên".
    const a = readFileSync(join(canChay, tepGiao), "utf8").replace(/\r\n/g, "\n");
    const b = doc(tepRepo).replace(/\r\n/g, "\n");
    expect(a).toBe(b);
  });
});

describe("Điều kiện phân loại KHÔNG được đổi", () => {
  const sql = doc("00342_invoice_list_only_sales_documents.sql");
  it("giữ đúng mệnh đề đã chốt", () => {
    expect(sql).toContain("i.source IS DISTINCT FROM 'order' OR i.order_code IS NOT NULL");
  });
  it("không lọc bằng tiền tố DH", () => {
    expect(sql).not.toMatch(/i\.code\s+like\s+'DH/i);
  });
  it("không dùng source <> 'order' đơn thuần", () => {
    expect(sql).not.toMatch(/i\.source\s*<>\s*'order'/);
  });
});
