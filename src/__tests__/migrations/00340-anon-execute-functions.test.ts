import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 00340 — ĐÓNG LỖ HỔNG `anon` / `PUBLIC` GỌI ĐƯỢC RPC.
 *
 * ĐÃ ĐO trên PostgreSQL 16.4 local với nền có đủ: function thường, function có
 * OVERLOAD, PROCEDURE, AGGREGATE, hàm chỉ mở qua PUBLIC, hàm có GRANT OPTION,
 * và routine thuộc chủ sở hữu CHƯA có dòng pg_default_acl.
 *
 *   trước vá : anon 10 · PUBLIC 10 · authenticated 10 · grant option 1
 *   sau  vá  : anon  2 · PUBLIC  0 · authenticated 10
 *              procedure/aggregate/hàm chủ khác đều bị chặn
 *              FUNCTION mới và PROCEDURE mới đều KHÔNG tự mở
 *   chạy lần 2: ảnh chụp GIỮ NGUYÊN mốc thời gian, vẫn ghi 10 (không phải 2)
 *   hoàn tác  : anon 10 · PUBLIC 10 · authenticated 10 · grant option 1
 *              0 routine LỆCH ACL so với ảnh chụp (khớp cả grantor)
 *   vá lại    : anon 2
 *   vai trò KHÔNG superuser + chủ sở hữu khác: RAISE EXCEPTION nêu đúng tên
 *              chủ, cuộn lại sạch (anon vẫn 3, không bỏ lại bảng ảnh chụp)
 *
 * Test này khoá các tính chất mà bản nháp trước đã sai.
 */

const THU_MUC = join(process.cwd(), "supabase/migrations");
const VA = readFileSync(join(THU_MUC, "00340_revoke_anon_execute_functions.sql"), "utf8");
const HOAN_TAC = readFileSync(
  join(THU_MUC, "00340_rollback_revoke_anon_execute_functions.sql"),
  "utf8",
);
/** Bỏ dòng chú thích để chỉ soi LỆNH thật. */
const chiLenh = (s: string) =>
  s.split("\n").filter((d) => !d.trimStart().startsWith("--")).join("\n");

describe("00340 — đo bằng QUYỀN HIỆU LỰC, không chỉ ACL trực tiếp", () => {
  it("hậu kiểm dùng has_function_privilege cho cả ba vai", () => {
    expect(VA).toContain("has_function_privilege('anon'");
    expect(VA).toContain("has_function_privilege('authenticated'");
    expect(VA).toContain("has_function_privilege('service_role'");
  });

  it("tách riêng PUBLIC: đọc grantee = 0 trong ACL", () => {
    expect(VA).toContain("a.grantee = 0");
  });

  it("so danh sách cho phép bằng OID, KHÔNG so chuỗi regprocedure", () => {
    expect(VA).toContain("to_regprocedure(chu_ky)::oid");
    expect(VA).not.toMatch(/oid::regprocedure::text not in \(select chu_ky/);
  });
});

describe("00340 — bao phủ MỌI loại routine", () => {
  it("mọi truy vấn đếm/chụp đều lấy đủ 4 prokind", () => {
    const soLan = (VA.match(/prokind in \('f', ?'p', ?'a', ?'w'\)/g) ?? []).length;
    expect(soLan, "phải dùng nhất quán ở chụp ảnh và các phép hậu kiểm").toBeGreaterThanOrEqual(4);
    // Không được sót chỗ nào chỉ lọc prokind='f'.
    expect(chiLenh(VA)).not.toMatch(/prokind\s*=\s*'f'/);
  });

  it("GRANT dùng đúng từ khoá theo prokind — PROCEDURE không nhận ON FUNCTION", () => {
    expect(VA).toContain("case p.prokind when 'p' then 'PROCEDURE' else 'FUNCTION' end");
    expect(VA).toContain("grant execute on %s %s to authenticated");
    expect(VA).toContain("grant execute on %s %s to service_role");
    expect(VA).toContain("grant execute on %s %s to anon");
    // Cấm quay lại dạng cứng ON FUNCTION cho mọi loại.
    expect(chiLenh(VA)).not.toMatch(/grant execute on function %s to (authenticated|service_role)/);
  });

  it("hậu kiểm dựng thật CẢ function LẪN procedure rồi bỏ đi", () => {
    expect(VA).toContain("create function public._kiem_00340_ham_moi()");
    expect(VA).toContain("drop function public._kiem_00340_ham_moi()");
    expect(VA).toContain("create procedure public._kiem_00340_thu_tuc_moi()");
    expect(VA).toContain("drop procedure public._kiem_00340_thu_tuc_moi()");
    expect(VA).toContain("PROCEDURE tạo mới VẪN tự mở cho anon");
  });
});

describe("00340 — ảnh chụp BẤT BIẾN", () => {
  it("KHÔNG drop rồi chụp đè — chạy lần hai phải giữ ảnh chụp cũ", () => {
    expect(chiLenh(VA)).not.toMatch(/drop table if exists public\.acl_backup_00340/);
    expect(chiLenh(VA)).not.toMatch(/drop table if exists public\.default_acl_backup_00340/);
    expect(VA).toContain("if to_regclass('public.acl_backup_00340') is not null then");
    expect(VA).toContain("GIỮ NGUYÊN (bất biến)");
  });

  it("ảnh chụp lưu đủ grantee/grantor/grant option để hoàn tác chính xác", () => {
    expect(VA).toContain("acl_anon_public jsonb");
    expect(VA).toContain("'grantor', a.grantor::regrole::text");
    expect(VA).toContain("'grantable', a.is_grantable");
    expect(VA).toContain("prokind");
    expect(VA).toContain("tu_khoa");
  });
});

describe("00340 — thu hồi cả PUBLIC, phủ mọi chủ sở hữu", () => {
  it("thu hồi trên routine hiện có gồm cả public", () => {
    expect(VA).toMatch(/revoke execute on all functions in schema public from anon, public/);
    expect(VA).toMatch(/revoke execute on all routines\s+in schema public from anon, public/);
  });

  it("quyền mặc định: gỡ anon THEO SCHEMA và gỡ PUBLIC TOÀN CSDL", () => {
    expect(VA).toContain("in schema public revoke execute on functions from anon");
    expect(VA).toMatch(/alter default privileges for role %I revoke execute on functions from public/);
  });

  it("phủ MỌI chủ sở hữu, kể cả chủ CHƯA có dòng pg_default_acl", () => {
    const khoi = VA.slice(VA.indexOf("$mac_dinh$"), VA.indexOf("Khối 4"));
    // Hợp của: chủ sở hữu routine hiện có ∪ chủ có dòng default ACL ∪ vai trò đang chạy.
    expect(khoi).toContain("select p.proowner::regrole::text as chu");
    expect(khoi).toContain("union");
    expect(khoi).toContain("select current_user");
  });

  it("không sửa được quyền mặc định của một chủ ⇒ EXCEPTION, không cảnh báo rồi đi tiếp", () => {
    const khoi = VA.slice(VA.indexOf("$mac_dinh$"), VA.indexOf("Khối 4"));
    expect(khoi).toContain("exception when insufficient_privilege then");
    expect(khoi).toContain("raise exception");
    expect(khoi).not.toContain("raise warning");
  });
});

describe("00340 — sai là CUỘN LẠI, không cảnh báo rồi commit", () => {
  it("mọi kiểm tra thất bại đều RAISE EXCEPTION", () => {
    const hauKiem = VA.slice(VA.indexOf("$hau_kiem$"), VA.lastIndexOf("commit;"));
    expect(hauKiem).toContain("raise exception");
    expect(hauKiem).not.toContain("raise warning");
  });

  it("hậu kiểm nằm TRƯỚC commit", () => {
    expect(VA.indexOf("$hau_kiem$")).toBeLessThan(VA.lastIndexOf("commit;"));
  });
});

describe("00340 — danh sách công khai theo CHỮ KÝ ĐẦY ĐỦ", () => {
  it("dùng to_regprocedure với chữ ký, không cấp theo tên", () => {
    expect(VA).toContain("public.get_email_by_phone(text)");
    expect(VA).toContain("public.normalize_phone(text)");
    expect(VA).toContain("to_regprocedure(r.chu_ky) is null");
    expect(VA).not.toMatch(/p\.proname in \('get_email_by_phone', 'normalize_phone'\)/);
  });

  it("có overload lạ thì DỪNG để người quyết định", () => {
    expect(VA).toContain("phải nêu rõ chữ ký nào được công khai");
  });
});

describe("00340 — giữ nguyên authenticated / service_role", () => {
  it("chụp quyền hiệu lực trước khi thu hồi rồi cấp lại đúng tập đó", () => {
    expect(VA).toContain("authenticated_goi_duoc");
    expect(VA).toContain("service_role_goi_duoc");
  });

  it("hậu kiểm bắt cả MẤT quyền lẫn MỞ RỘNG quyền", () => {
    expect(VA).toContain("authenticated mất quyền");
    expect(VA).toContain("authenticated được mở rộng thêm");
  });
});

describe("00340 — hoàn tác khôi phục CHÍNH XÁC từ ảnh chụp", () => {
  it("TUYỆT ĐỐI không GRANT EXECUTE ON ALL FUNCTIONS TO anon", () => {
    expect(chiLenh(HOAN_TAC)).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*anon/i);
    expect(chiLenh(VA)).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*anon/i);
    // Chú thích cảnh báo phải còn để người sau không lặp lại.
    expect(HOAN_TAC).toContain("TUYỆT ĐỐI không");
  });

  it("khôi phục ĐÚNG từng mục: grantee, grantor, grant option", () => {
    expect(HOAN_TAC).toContain("jsonb_array_elements(r.acl_anon_public)");
    expect(HOAN_TAC).toContain("m->>'grantor'");
    expect(HOAN_TAC).toContain("with grant option");
    // Đặt lại vai trò về đúng người đã cấp để mục ACL khớp cả grantor.
    expect(HOAN_TAC).toContain("set local role %I");
    expect(HOAN_TAC).toContain("reset role");
  });

  it("dùng đúng từ khoá FUNCTION/PROCEDURE khi cấp lại", () => {
    expect(HOAN_TAC).toContain("grant execute on %s %s to public");
    expect(HOAN_TAC).toContain("grant execute on %s %s to %I");
  });

  it("KHÔNG grant PUBLIC tràn cho mọi chủ sở hữu", () => {
    const khoi = HOAN_TAC.slice(
      HOAN_TAC.indexOf("$tra_mac_dinh$"),
      HOAN_TAC.indexOf("$don_dong_thua$"),
    );
    // Chỉ trả cho chủ mà ảnh chụp ghi là CÓ.
    expect(khoi).toContain("if r.co_public then");
    expect(khoi).toContain("if r.co_anon and r.pham_vi = 'public' then");
    // Không được có lệnh alter default privileges trần (không nêu for role).
    expect(chiLenh(HOAN_TAC)).not.toMatch(
      /^\s*alter default privileges grant execute on functions to public;/m,
    );
  });

  it("dừng nếu không có ảnh chụp; hậu kiểm bắt cả thiếu lẫn THỪA", () => {
    expect(HOAN_TAC).toContain("không thể hoàn tác chính xác");
    expect(HOAN_TAC).toContain("thiếu % routine cho anon so với ảnh chụp");
    expect(HOAN_TAC).toContain("cấp THỪA % routine cho anon");
    expect(HOAN_TAC).toContain("thiếu % routine cho PUBLIC so với ảnh chụp");
  });
});

describe("00340 — bộ file và phạm vi", () => {
  it("có cả file vá và file hoàn tác trong repo", () => {
    const tep = readdirSync(THU_MUC);
    expect(tep).toContain("00340_revoke_anon_execute_functions.sql");
    expect(tep).toContain("00340_rollback_revoke_anon_execute_functions.sql");
  });

  it("không đụng schema auth/storage/graphql_public và không đụng bảng dữ liệu", () => {
    expect(VA).not.toMatch(/\bauth\.\w+\s+from\s+anon/i);
    expect(VA).not.toMatch(/revoke[^;]*on\s+all\s+tables/i);
    expect(VA).not.toMatch(/\b(drop|truncate|delete\s+from)\s+public\.(invoices|profiles)/i);
  });

  it("KHÔNG chứa UUID vai trò production", () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(VA).not.toMatch(uuid);
    expect(HOAN_TAC).not.toMatch(uuid);
  });
});
