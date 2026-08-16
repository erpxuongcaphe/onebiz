import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Đợt A1 — sổ nhật ký chỉ được THÊM.
 *
 * Ràng buộc sống còn: client vẫn phải GHI được audit (nhiều luồng ghi trực
 * tiếp) và các màn Lịch sử / Hồ sơ vẫn phải ĐỌC được. Chỉ chặn sửa/xoá.
 */

const doc = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const MIGRATION = doc("supabase/migrations/00328_lock_audit_log_append_only.sql");
const ROLLBACK = doc("supabase/migrations/00328_rollback_lock_audit_log_append_only.sql");
const PREFLIGHT = doc("docs/PREFLIGHT-A1-SO-NHAT-KY-2026-08-15.sql");

const LENH = MIGRATION.split("\n")
  .filter((d) => !d.trimStart().startsWith("--"))
  .join("\n");

describe("00328 — nhật ký chỉ thêm, không sửa/xoá", () => {
  it("thu hồi đúng 3 quyền, cho cả authenticated lẫn anon", () => {
    for (const vai of ["authenticated", "anon"]) {
      expect(LENH).toContain(`revoke update, delete, truncate on public.audit_log from ${vai};`);
    }
  });

  it("KHÔNG thu hồi SELECT hay INSERT — app còn ghi và đọc nhật ký", () => {
    expect(LENH).not.toMatch(/revoke[^;]*\b(select|insert)\b[^;]*;/i);
    expect(MIGRATION).toContain("mat quyen doc/ghi nhat ky");
  });

  it("chỉ đụng audit_log, không lan sang 3 bảng cấu hình bàn của F1b", () => {
    expect(LENH).not.toMatch(/restaurant_tables|floor_plan_zones|floor_plan_decorations/);
  });

  it("không đụng RLS, bảng, cột, dữ liệu", () => {
    expect(LENH).not.toMatch(/\b(alter table|drop table|create policy|drop policy)\b/i);
    expect(LENH).not.toMatch(/\b(insert into|delete from|update public\.)\b/i);
  });

  it("rollback cấp lại đúng 3 quyền cho authenticated, không cấp lại anon", () => {
    expect(ROLLBACK).toContain("grant update, delete, truncate on public.audit_log to authenticated;");
    expect(ROLLBACK).not.toMatch(/grant[^;]*to anon;/i);
  });

  it("preflight chỉ đọc và đếm được số dòng nhật ký để đối chiếu", () => {
    expect(PREFLIGHT).not.toMatch(/\b(revoke|grant|insert into|update |delete from|drop )\b/i);
    expect(PREFLIGHT).toContain("SỐ DÒNG NHẬT KÝ");
    expect(PREFLIGHT).toContain("GHI NHẬT KÝ 7 NGÀY QUA");
  });
});

describe("bất biến mã nguồn — điều kiện để A1 an toàn", () => {
  it("app chỉ ĐỌC và THÊM nhật ký, không sửa/xoá", () => {
    const goc = ["app", "components", "hooks", "lib"].map((f) =>
      path.join(process.cwd(), "src", f),
    );
    function liet(d: string): string[] {
      if (!fs.existsSync(d)) return [];
      return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? liet(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      });
    }
    const viPham: string[] = [];
    for (const f of goc.flatMap(liet)) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\(["'`]audit_log["'`]\)([\s\S]{0,120})/g)) {
        if (/\.(update|upsert|delete)\(/.test(m[1])) {
          viPham.push(path.relative(process.cwd(), f));
        }
      }
    }
    expect(viPham, `còn sửa/xoá nhật ký: ${viPham.join(", ")}`).toEqual([]);
  });
});
