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

  it("ảnh chụp lưu TOÀN BỘ mục EXECUTE, không chỉ anon/PUBLIC", () => {
    // Migration còn CẤP TRỰC TIẾP cho authenticated/service_role ở Khối 4;
    // hai vai đó trước khi vá có thể chỉ có quyền NHỜ PUBLIC. Chụp thiếu thì
    // hoàn tác không gỡ được các mục do chính migration tạo ra.
    expect(VA).toContain("acl_execute jsonb");
    expect(VA).not.toContain("acl_anon_public");
    expect(VA).toContain("'grantor', a.grantor::regrole::text");
    expect(VA).toContain("'grantable', a.is_grantable");
    // Không lọc grantee: phải lấy MỌI mục EXECUTE.
    const khoi = VA.slice(VA.indexOf("acl_execute)"), VA.indexOf("create table public.default_acl_backup"));
    expect(khoi).not.toMatch(/a\.grantee = 0 or a\.grantee = 'anon'/);
  });

  it("ảnh chụp quyền mặc định lưu TỪNG MỤC, không chỉ cờ có/không", () => {
    expect(VA).toContain("acl_items");
    expect(VA).toContain("from aclexplode(d.defaclacl) a");
    expect(VA).not.toContain("as co_anon");
    expect(VA).not.toContain("as co_public");
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
    const khoi = VA.slice(VA.indexOf("do $mac_dinh$"), VA.indexOf("end $mac_dinh$"));
    // Hợp của: chủ sở hữu routine hiện có ∪ chủ có dòng default ACL ∪ vai trò đang chạy.
    expect(khoi).toContain("select p.proowner::regrole::text as chu");
    expect(khoi).toContain("union");
    expect(khoi).toContain("select current_user");
  });

  it("không sửa được quyền mặc định của một chủ ⇒ EXCEPTION, không cảnh báo rồi đi tiếp", () => {
    const khoi = VA.slice(VA.indexOf("do $mac_dinh$"), VA.indexOf("end $mac_dinh$"));
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

  it("hậu kiểm bắt cả MẤT quyền lẫn MỞ RỘNG quyền, cho CẢ HAI vai", () => {
    expect(VA).toContain("authenticated mất quyền");
    expect(VA).toContain("authenticated được mở rộng thêm");
    expect(VA).toContain("service_role mất quyền");
    expect(VA).toContain("service_role được mở rộng thêm");
  });

  it("hậu kiểm đo CẢ ACL trực tiếp của anon, không chỉ quyền hiệu lực", () => {
    expect(VA).toContain("muc ACL TRUC TIEP cua anon TRONG TAM ma ngoai danh sach");
  });
});

describe("00340 — hoàn tác khôi phục CHÍNH XÁC từ ảnh chụp", () => {
  it("TUYỆT ĐỐI không GRANT EXECUTE ON ALL FUNCTIONS TO anon", () => {
    expect(chiLenh(HOAN_TAC)).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*anon/i);
    expect(chiLenh(VA)).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*anon/i);
    // Chú thích cảnh báo phải còn để người sau không lặp lại.
    expect(HOAN_TAC).toContain("TUYỆT ĐỐI không");
  });

  it("hội tụ HAI CHIỀU: gỡ mục thừa VÀ cấp mục thiếu", () => {
    // Chiều gỡ là điểm mấu chốt: migration tạo grant trực tiếp cho
    // authenticated/service_role mà trước đó không có.
    expect(HOAN_TAC).toContain("GỠ mục đang có mà ảnh chụp không có");
    expect(HOAN_TAC).toMatch(/revoke execute on %s %s from %I/);
    expect(HOAN_TAC).toMatch(/revoke execute on %s %s from public/);
    expect(HOAN_TAC).toContain("jsonb_array_elements(coalesce(r.acl_execute");
    expect(HOAN_TAC).toContain("with grant option");
    expect(HOAN_TAC).toContain("set local role %I");
    expect(HOAN_TAC).toContain("reset role");
  });

  it("không SET ROLE được về grantor ⇒ RAISE EXCEPTION, KHÔNG warning rồi đi tiếp", () => {
    const dv = HOAN_TAC.slice(HOAN_TAC.indexOf("pg_temp.dat_vai"), HOAN_TAC.indexOf("Khối 1."));
    expect(dv).toContain("raise exception");
    expect(dv).not.toContain("raise warning");
  });

  it("hậu kiểm kiểm CẢ ACL trực tiếp LẪN quyền hiệu lực của bốn vai", () => {
    const hk = HOAN_TAC.slice(HOAN_TAC.indexOf("$hau_kiem$"));
    expect(hk).toContain("ACL TRỰC TIẾP lệch ảnh chụp");
    expect(hk).toContain("array['anon','authenticated','service_role']");
    expect(hk).toContain("has_function_privilege");
    expect(hk).toContain("PUBLIC lệch ảnh chụp");
    expect(hk).toContain("dòng quyền mặc định lệch ảnh chụp");
  });

  it("dùng đúng từ khoá FUNCTION/PROCEDURE khi cấp lại", () => {
    expect(HOAN_TAC).toContain("grant execute on %s %s to public");
    expect(HOAN_TAC).toContain("grant execute on %s %s to %I");
  });

  it("KHÔNG grant PUBLIC tràn cho mọi chủ sở hữu", () => {
    // Chỉ dựng lại đúng mục ảnh chụp ghi, và chỉ trả mặc định dựng sẵn cho chủ
    // KHÔNG có trong ảnh chụp (tức chủ mà 00340 mới tạo dòng cho).
    expect(HOAN_TAC).toContain("not exists (");
    expect(HOAN_TAC).toContain("from public.default_acl_backup_00340 b");
    // Không được có lệnh alter default privileges trần (không nêu for role).
    expect(chiLenh(HOAN_TAC)).not.toMatch(
      /^\s*alter default privileges grant execute on functions to public;/m,
    );
  });

  it("dừng nếu thiếu bất kỳ bảng ảnh chụp nào", () => {
    expect(HOAN_TAC).toContain("không thể hoàn tác chính xác");
    expect(HOAN_TAC).toContain("không có bảng ảnh chụp quyền mặc định");
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

describe("00340 — nhóm NGOÀI TẦM (chủ sở hữu không sửa được)", () => {
  it("whitelist ĐÍCH DANH pg_trgm — không nhận extension-nào-cũng-được, không đếm số", () => {
    // Prod 22/08 (BƯỚC 1B): cả 31 routine ngoài tầm đều pg_trgm, C, invoker.
    // "Extension + invoker" KHÔNG phải tính chất an toàn: http_get (pgsql-http)
    // và dblink_connect (dblink) đều là invoker thuộc extension nhưng gọi mạng
    // ra ngoài. Chỉ chấp nhận đúng những gì đã kiểm tận nơi.
    expect(VA).toContain("_ext_cho_phep_00340");
    expect(VA).toContain("values ('pg_trgm')");
    expect(VA).toContain("t.ngon_ngu <> 'c'");
    expect(VA).toContain("or t.security_definer");
    expect(VA).toContain("http_get/dblink_connect");
    // Cấm hai kiểu guard cũ: đếm số và "extension nào cũng được".
    expect(VA).not.toContain("c_ky_vong");
    expect(VA).not.toContain("phai thuoc extension VA khong phai SECURITY DEFINER");
  });

  it("bảng ngoài tầm ghi extension, ngôn ngữ và cờ SECURITY DEFINER", () => {
    const khoi = VA.slice(VA.indexOf("create temporary table _ngoai_tam_00340"), VA.indexOf("_ext_cho_phep_00340"));
    expect(khoi).toContain("p.prosecdef");
    expect(khoi).toContain("pg_extension");
    expect(khoi).toContain("d.deptype = 'e'");
    expect(khoi).toContain("l.lanname");
  });

  it("xác định bằng pg_has_role, không đoán theo tên chủ sở hữu", () => {
    const khoi = VA.slice(VA.indexOf("create temporary table _ngoai_tam_00340"), VA.indexOf("$chot_ngoai_tam$"));
    expect(khoi).toContain("not pg_has_role(current_user, p.proowner, 'USAGE')");
    expect(khoi).not.toContain("supabase_admin");
  });

  it("cảnh báo TO khi còn routine ngoài tầm, không im lặng", () => {
    expect(VA).toContain("raise warning");
    expect(VA).toContain("VAN mo cho anon");
    expect(VA).toContain("khong suy rong cho extension khac");
  });

  it("hậu kiểm chỉ đòi hỏi ở phần TRONG TẦM, nhưng vẫn chặt", () => {
    const hk = VA.slice(VA.indexOf("$hau_kiem$"));
    // Mọi phép kiểm anon/PUBLIC/ACL trực tiếp đều trừ nhóm ngoài tầm...
    expect((hk.match(/_ngoai_tam_00340/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // ...và quyền mặc định chỉ xét chủ trong tầm.
    expect(hk).toContain("pg_has_role(current_user, d.defaclrole, 'USAGE')");
    // Còn sót TRONG TẦM vẫn là EXCEPTION.
    expect(hk).toContain("CUON LAI");
  });

  it("thông báo cuối nói rõ đóng được bao nhiêu và còn dư bao nhiêu", () => {
    expect(VA).toContain("NGOAI TAM: % routine van mo cho anon");
  });
});

describe("00340 — hoàn tác quyền mặc định cho owner/scope NGOÀI ảnh chụp", () => {
  it("nhánh (b) xử lý CẢ HAI phạm vi: in schema public lẫn toàn CSDL", () => {
    const b = HOAN_TAC.slice(
      HOAN_TAC.indexOf("-- (b) Dòng (chủ sở hữu, phạm vi) KHÔNG có trong ảnh chụp"),
      HOAN_TAC.indexOf("raise notice '00340 hoàn tác: dựng lại"),
    );
    expect(b.length).toBeGreaterThan(100);
    // Phạm vi lấy từ chính dòng pg_default_acl, không ép cứng toàn CSDL.
    expect(b).toContain("case when r.pham_vi = 'public' then ' in schema public' else '' end");
    expect(b).not.toMatch(/if r\.pham_vi = '\(toan_csdl\)' then/);
    // Hội tụ về MẶC ĐỊNH DỰNG SẴN acldefault: gỡ mục thừa VÀ cấp mục thiếu.
    expect(b).toContain("acldefault('f', r.chu_oid)");
    expect(b).toMatch(/revoke execute on functions from/);
    expect(b).toMatch(/grant execute on functions to/);
  });

  it("HẬU KIỂM ÂM: còn dòng default ACL ngoài ảnh chụp là CUỘN LẠI", () => {
    expect(HOAN_TAC).toContain("KHONG co trong anh chup");
    expect(HOAN_TAC).toContain("chi co the do chinh 00340 tao ra. CUON LAI");
    // Kiểm ngược đã chạy trên local: bỏ nhánh (b) đi thì hậu kiểm này nổ đúng
    // với 2 dòng do 00340 tạo; bản đủ thì sạch.
  });
});
