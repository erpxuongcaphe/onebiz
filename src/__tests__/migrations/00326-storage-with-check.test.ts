import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * F1c.1 — vá WITH CHECK của luật ghi ảnh nền.
 *
 * Kịch bản phải chặn: người có floor_plan.edit_branch ở chi nhánh A đổi tên
 * tệp ảnh nền sang thư mục chi nhánh B (cùng công ty). Trước 00326, USING kiểm
 * đường dẫn CŨ (hợp lệ) còn WITH CHECK chỉ kiểm công ty → lọt.
 *
 * Kiểm thật trên máy chủ cần một phiên đăng nhập của hai vai trò khác nhau,
 * không làm được ở đây (và không được thao tác dữ liệu production). Nên tệp
 * này khoá bằng cấu trúc: cả hai vế của policy UPDATE phải gọi CÙNG một hàm
 * kiểm, và hàm đó phải kiểm đủ 5 điều kiện.
 */

const doc = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const MIGRATION = doc("supabase/migrations/00326_storage_floor_plans_with_check.sql");
const ROLLBACK = doc("supabase/migrations/00326_rollback_storage_floor_plans_with_check.sql");
const PREFLIGHT = doc("docs/PREFLIGHT-F1C1-WITH-CHECK-ANH-NEN-2026-08-15.sql");

/** Bỏ ghi chú để đếm trên lệnh thật. */
const LENH = MIGRATION.split("\n")
  .filter((d) => !d.trimStart().startsWith("--"))
  .join("\n");

/** Cắt lấy nguyên khối lệnh tạo một policy. */
function khoiPolicy(ten: string): string {
  const i = LENH.indexOf(`create policy ${ten} on storage.objects`);
  expect(i, `không thấy policy ${ten}`).toBeGreaterThan(-1);
  const j = LENH.indexOf(");", LENH.indexOf("with check", i) > -1 ? LENH.indexOf("with check", i) : i);
  return LENH.slice(i, j > i ? j + 2 : undefined);
}

describe("00326 — hai vế của UPDATE phải kiểm như nhau", () => {
  it("policy UPDATE gọi hàm kiểm ở CẢ using lẫn with check", () => {
    const khoi = khoiPolicy("floor_plans_update");
    const viTriUsing = khoi.indexOf("using (");
    const viTriCheck = khoi.indexOf("with check (");
    expect(viTriUsing).toBeGreaterThan(-1);
    expect(viTriCheck).toBeGreaterThan(viTriUsing);

    const veUsing = khoi.slice(viTriUsing, viTriCheck);
    const veCheck = khoi.slice(viTriCheck);
    expect(veUsing).toContain("fnb_floor_plan_object_writable(name)");
    expect(veCheck).toContain("fnb_floor_plan_object_writable(name)");
  });

  it("không còn vế nào chỉ kiểm mỗi công ty như bản 00325", () => {
    // Bản cũ: with check chỉ có foldername[1] = tenant. Bản mới không được vậy nữa.
    const khoi = khoiPolicy("floor_plans_update");
    const veCheck = khoi.slice(khoi.indexOf("with check ("));
    expect(veCheck).not.toMatch(/foldername\(name\)\)\[1\] = public\.get_user_tenant_id/);
  });

  it("cả 3 cửa ghi dùng chung một bộ kiểm", () => {
    for (const p of ["insert", "update", "delete"]) {
      expect(khoiPolicy(`floor_plans_${p}`)).toContain("fnb_floor_plan_object_writable(name)");
    }
    // insert 1 + update 2 + delete 1
    expect(LENH.match(/fnb_floor_plan_object_writable\(name\)/g)?.length).toBe(4);
  });

  it("migration tự kiểm lại điều đó trước khi kết thúc", () => {
    expect(MIGRATION).toContain("policy UPDATE chua kiem du ca USING lan WITH CHECK");
  });
});

describe("00326 — hàm kiểm phải soi đủ 5 điều", () => {
  it("1) đúng khuôn đường dẫn 2 cấp thư mục + tên tệp", () => {
    expect(LENH).toContain("storage.foldername(p_name)");
    expect(LENH).toContain("array_length(v_parts, 1) is distinct from 2");
    expect(LENH).toContain("storage.filename(p_name)");
  });

  it("2) thư mục cấp 1 đúng công ty của người gọi", () => {
    expect(LENH).toContain("v_parts[1] <> v_tenant::text");
    expect(LENH).toContain("public.get_user_tenant_id()");
  });

  it("3) chi nhánh có thật và thuộc đúng công ty", () => {
    expect(LENH).toMatch(/from public\.branches b\s+where b\.id = v_branch and b\.tenant_id = v_tenant/);
  });

  it("4) khu sơ đồ có thật, đúng công ty VÀ đúng chi nhánh trên đường dẫn", () => {
    expect(LENH).toMatch(/from public\.floor_plan_zones z[\s\S]{0,200}z\.branch_id = v_branch/);
  });

  it("5) quyền edit_global, hoặc edit_branch kèm quyền chi nhánh", () => {
    expect(LENH).toContain("'floor_plan.edit_global'");
    expect(LENH).toContain("'floor_plan.edit_branch'");
    expect(LENH).toContain("public.user_has_branch_access(v_actor, v_branch)");
  });

  it("chuỗi lạ không phải uuid thì trả false, không nổ lỗi ép kiểu", () => {
    expect(LENH).toContain("v_uuid_re");
    expect(LENH.match(/!~ v_uuid_re/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("chưa đăng nhập → false", () => {
    expect(LENH).toMatch(/v_actor := auth\.uid\(\);[\s\S]{0,80}return false;/);
  });

  it("hàm khoá theo mẫu an toàn của dự án", () => {
    expect(LENH).toContain("security definer");
    expect(LENH).toContain("set search_path = ''");
    expect(LENH).toContain("revoke all on function public.fnb_floor_plan_object_writable(text) from public, anon;");
    expect(LENH).toContain("grant execute on function public.fnb_floor_plan_object_writable(text) to authenticated;");
  });
});

describe("00326 — không lan sang chỗ khác", () => {
  it("không đụng bucket khác, không xoá tệp, không sửa dữ liệu", () => {
    // Được phép ĐỌC pg_policies của product-images trong hậu kiểm, nhưng tuyệt
    // đối không tạo/xoá/sửa luật của bucket đó.
    expect(LENH).not.toMatch(/(create|drop|alter) policy[^\n]*product[-_]images/i);
    expect(LENH).not.toMatch(/mkt-media/);
    expect(LENH).not.toMatch(/delete from storage\.objects/i);
    expect(LENH).not.toMatch(/update storage\.buckets/i);
    expect(LENH).not.toMatch(/truncate/i);
  });

  it("giữ nguyên policy đọc của 00325", () => {
    expect(LENH).not.toContain("drop policy if exists floor_plans_select");
  });

  it("migration dừng lại nếu policy ảnh sản phẩm bị ảnh hưởng", () => {
    expect(MIGRATION).toContain("policy product-images bi anh huong");
  });
});

describe("00326 — rollback và preflight", () => {
  it("rollback trả đúng 3 policy bản 00325 và gỡ hàm", () => {
    for (const p of ["insert", "update", "delete"]) {
      expect(ROLLBACK).toContain(`create policy floor_plans_${p} on storage.objects`);
    }
    expect(ROLLBACK).toContain("drop function if exists public.fnb_floor_plan_object_writable(text);");
    expect(ROLLBACK).not.toMatch(/delete from storage\.objects/i);
  });

  it("rollback nói rõ lui thì lỗ cũ quay lại", () => {
    expect(ROLLBACK).toContain("lỗ cũ quay lại");
  });

  it("preflight chỉ đọc và có soi tệp hiện có lẫn khu lệch chi nhánh", () => {
    expect(PREFLIGHT).not.toMatch(/\b(insert into|update |delete from|drop |create policy)\b/i);
    expect(PREFLIGHT).toContain("TỆP CÓ KHỚP KHUÔN?");
    expect(PREFLIGHT).toContain("KHU LỆCH CÔNG TY/CHI NHÁNH");
  });
});
