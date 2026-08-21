import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 00340 — ĐÓNG LỖ HỔNG `anon` / `PUBLIC` GỌI ĐƯỢC RPC.
 *
 * Đã đo trên PostgreSQL 16.4 local (không dùng production làm nơi thử):
 *   · trước vá: anon gọi được 5/5 hàm (1 trong đó CHỈ qua PUBLIC)
 *   · sau vá  : anon còn đúng 2 hàm đăng nhập, PUBLIC = 0,
 *               authenticated/service_role giữ nguyên 5, hàm tạo mới anon=false
 *   · hoàn tác: trả về đúng 5/5, không thừa không thiếu
 *   · chạy dưới vai trò KHÔNG phải superuser với một hàm thuộc chủ khác:
 *     RAISE EXCEPTION nêu đúng tên hàm và CUỘN LẠI sạch (anon vẫn 3, bảng ảnh
 *     chụp không bị bỏ lại)
 *
 * Test này khoá các tính chất mà bản nháp 00337 cũ đã sai.
 */

const THU_MUC = join(process.cwd(), "supabase/migrations");
const VA = readFileSync(join(THU_MUC, "00340_revoke_anon_execute_functions.sql"), "utf8");
const HOAN_TAC = readFileSync(
  join(THU_MUC, "00340_rollback_revoke_anon_execute_functions.sql"),
  "utf8",
);

describe("00340 — đo bằng QUYỀN HIỆU LỰC, không chỉ ACL trực tiếp", () => {
  it("hậu kiểm dùng has_function_privilege chứ không đếm ACL của anon", () => {
    expect(VA).toContain("has_function_privilege('anon'");
    expect(VA).toContain("has_function_privilege('authenticated'");
    expect(VA).toContain("has_function_privilege('service_role'");
  });

  it("tách riêng PUBLIC: đọc grantee = 0 trong ACL", () => {
    // PUBLIC không phải một role nên has_function_privilege không đo được;
    // phải đọc thẳng mục grantee = 0.
    expect(VA).toContain("a.grantee = 0");
  });

  it("so danh sách cho phép bằng OID, KHÔNG so chuỗi regprocedure", () => {
    // oid::regprocedure::text bỏ tiền tố schema khi public nằm trong
    // search_path ⇒ so chuỗi lệch oan (đã dính thật khi thử local).
    expect(VA).toContain("to_regprocedure(chu_ky)::oid");
    expect(VA).not.toMatch(/oid::regprocedure::text not in \(select chu_ky/);
  });
});

describe("00340 — thu hồi cả PUBLIC, không chỉ anon", () => {
  it("thu hồi trên hàm hiện có gồm cả public", () => {
    expect(VA).toMatch(/revoke execute on all functions in schema public from anon, public/);
    expect(VA).toMatch(/revoke execute on all routines\s+in schema public from anon, public/);
  });

  it("quyền mặc định: gỡ anon THEO SCHEMA và gỡ PUBLIC TOÀN CSDL", () => {
    // Mục `=X/` dựng sẵn của PostgreSQL không thuộc schema nào nên lệnh có
    // IN SCHEMA không gỡ nổi — đã đo: hàm mới vẫn ra {=X/postgres,...}.
    expect(VA).toContain("in schema public revoke execute on functions from anon");
    expect(VA).toMatch(/alter default privileges for role %I revoke execute on functions from public/);
    expect(VA).toMatch(/^\s*alter default privileges revoke execute on functions from public;/m);
  });
});

describe("00340 — sai là CUỘN LẠI, không cảnh báo rồi commit", () => {
  it("mọi kiểm tra thất bại đều RAISE EXCEPTION", () => {
    const hauKiem = VA.slice(VA.indexOf("$hau_kiem$"), VA.lastIndexOf("commit;"));
    expect(hauKiem).toContain("raise exception");
    // Không được có raise warning trong hậu kiểm.
    expect(hauKiem).not.toContain("raise warning");
  });

  it("hậu kiểm nằm TRƯỚC commit", () => {
    expect(VA.indexOf("$hau_kiem$")).toBeLessThan(VA.lastIndexOf("commit;"));
  });

  it("toàn file không có chỗ nào warning-rồi-đi-tiếp về việc còn hàm sót", () => {
    expect(VA).not.toMatch(/raise warning.*KHÔNG đủ quyền/i);
  });
});

describe("00340 — danh sách công khai theo CHỮ KÝ ĐẦY ĐỦ", () => {
  it("dùng to_regprocedure với chữ ký, không cấp theo tên", () => {
    expect(VA).toContain("public.get_email_by_phone(text)");
    expect(VA).toContain("public.normalize_phone(text)");
    expect(VA).toContain("to_regprocedure(r.chu_ky) is null");
    // Cấm cấp theo tên cho mọi overload.
    expect(VA).not.toMatch(/p\.proname in \('get_email_by_phone', 'normalize_phone'\)/);
  });

  it("có overload lạ thì DỪNG để người quyết định", () => {
    expect(VA).toContain("phải nêu rõ chữ ký nào được công khai");
  });
});

describe("00340 — giữ nguyên authenticated / service_role", () => {
  it("chụp lại quyền hiệu lực trước khi thu hồi rồi cấp lại đúng tập đó", () => {
    expect(VA).toContain("authenticated_goi_duoc");
    expect(VA).toContain("service_role_goi_duoc");
    expect(VA).toContain("grant execute on function %s to authenticated");
  });

  it("hậu kiểm bắt cả MẤT quyền lẫn MỞ RỘNG quyền", () => {
    expect(VA).toContain("authenticated mất quyền");
    expect(VA).toContain("authenticated được mở rộng thêm");
  });
});

describe("00340 — hàm tạo MỚI không tự mở (chứng minh trong transaction)", () => {
  it("dựng thật một hàm rồi đo, xong bỏ đi", () => {
    expect(VA).toContain("create function public._kiem_00340_ham_moi()");
    expect(VA).toContain("drop function public._kiem_00340_ham_moi()");
    expect(VA).toContain("hàm tạo mới VẪN tự mở cho anon");
    expect(VA).toContain("hàm tạo mới VẪN tự mở cho PUBLIC");
  });
});

describe("00340 — hoàn tác khôi phục ĐÚNG ảnh chụp", () => {
  it("TUYỆT ĐỐI không GRANT EXECUTE ON ALL FUNCTIONS TO anon", () => {
    // Chỉ soi LỆNH thật: file có một dòng chú thích cảnh báo đúng chuỗi này,
    // nên phải bỏ chú thích trước khi kiểm, nếu không là báo động giả.
    const chiLenh = HOAN_TAC.split("\n")
      .filter((d) => !d.trimStart().startsWith("--"))
      .join("\n");
    expect(chiLenh).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*anon/i);
    // Và bản vá cũng vậy.
    const vaChiLenh = VA.split("\n")
      .filter((d) => !d.trimStart().startsWith("--"))
      .join("\n");
    expect(vaChiLenh).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*anon/i);
    // Chú thích cảnh báo vẫn phải còn để người sau không lặp lại sai lầm.
    expect(HOAN_TAC).toContain("KHÔNG BAO GIỜ dùng");
  });

  it("đọc từ bảng ảnh chụp, dừng nếu không có ảnh chụp", () => {
    expect(HOAN_TAC).toContain("public.acl_backup_00340");
    expect(HOAN_TAC).toContain("không thể hoàn tác chính xác");
  });

  it("hậu kiểm hoàn tác bắt cả thiếu lẫn THỪA", () => {
    expect(HOAN_TAC).toContain("thiếu % hàm so với ảnh chụp");
    expect(HOAN_TAC).toContain("cấp THỪA % hàm cho anon");
  });

  it("chỉ dẫn cách ít rủi ro hơn trước khi hoàn tác toàn bộ", () => {
    expect(HOAN_TAC).toContain("grant execute on function public.<ten>(<chu_ky>) to anon");
  });
});

describe("00340 — bộ file và phạm vi", () => {
  it("có cả file vá và file hoàn tác trong repo", () => {
    const tep = readdirSync(THU_MUC);
    expect(tep).toContain("00340_revoke_anon_execute_functions.sql");
    expect(tep).toContain("00340_rollback_revoke_anon_execute_functions.sql");
  });

  it("không đụng schema auth/storage/graphql_public và không đụng bảng", () => {
    expect(VA).not.toMatch(/\bauth\.\w+\s+from\s+anon/i);
    expect(VA).not.toMatch(/revoke[^;]*on\s+all\s+tables/i);
    expect(VA).not.toMatch(/\b(drop|truncate|delete\s+from)\s+public\.(invoices|profiles)/i);
  });

  it("KHÔNG chứa UUID vai trò production", () => {
    expect(VA).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(HOAN_TAC).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
