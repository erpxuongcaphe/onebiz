import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * F1c 15/08/2026 — ảnh nền sơ đồ bàn.
 *
 * Luật mới gác theo ĐƯỜNG DẪN tệp: {tenant_id}/{branch_id}/{zone_id}.{ext}.
 * Nếu ai đổi cách đặt đường dẫn trong mã nguồn mà quên luật, nhân viên sẽ bị
 * chặn upload oan — nên tệp này khoá cả hai đầu: nội dung migration VÀ đường
 * dẫn mà service sinh ra.
 */

const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/00325_storage_floor_plans_policy.sql"),
  "utf8",
);
const ROLLBACK = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/00325_rollback_storage_floor_plans_policy.sql"),
  "utf8",
);
const SERVICE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/services/supabase/floor-plan-decorations.ts"),
  "utf8",
);

/** Bỏ dòng ghi chú để đếm đúng số lần xuất hiện trong lệnh thật. */
const LENH = MIGRATION.split("\n")
  .filter((d) => !d.trimStart().startsWith("--"))
  .join("\n");

describe("00325 — luật ghi ảnh nền theo công ty + quyền", () => {
  it("có đủ 4 policy, gồm UPDATE vốn đang thiếu", () => {
    for (const p of ["select", "insert", "update", "delete"]) {
      expect(MIGRATION).toContain(`create policy floor_plans_${p} on storage.objects`);
    }
  });

  it("mọi policy chặn theo thư mục cấp 1 = công ty của người gọi", () => {
    const soLan = MIGRATION.match(
      /\(storage\.foldername\(name\)\)\[1\] = public\.get_user_tenant_id\(\)::text/g,
    )?.length ?? 0;
    expect(soLan).toBeGreaterThanOrEqual(5); // 4 policy + với UPDATE có cả with check
  });

  it("ba nhánh ghi đòi quyền sơ đồ, edit_branch phải kèm quyền chi nhánh", () => {
    expect(LENH.match(/floor_plan\.edit_global/g)?.length).toBe(3); // insert + update + delete
    expect(LENH.match(/floor_plan\.edit_branch/g)?.length).toBe(3);
    expect(
      LENH.match(/user_has_branch_access\(\s*\n?\s*auth\.uid\(\), \(\(storage\.foldername\(name\)\)\[2\]\)::uuid\)/g)
        ?.length,
    ).toBe(3);
  });

  it("chỉ đụng bucket floor-plans, không chạm ảnh sản phẩm / kho MKT", () => {
    expect(MIGRATION).not.toMatch(/drop policy[^\n]*product_images/i);
    expect(MIGRATION).not.toMatch(/drop policy[^\n]*mkt/i);
    expect(MIGRATION).not.toMatch(/update storage\.buckets[\s\S]{0,200}'product-images'/);
    // Hậu kiểm trong migration phải khẳng định product-images còn nguyên 4 policy
    expect(MIGRATION).toContain("policy product-images bi anh huong");
  });

  it("đặt giới hạn dung lượng + chỉ nhận ảnh", () => {
    expect(MIGRATION).toContain("file_size_limit = 5242880");
    expect(MIGRATION).toContain("'image/jpeg','image/png','image/webp','image/gif'");
  });

  it("không xoá tệp nào của người dùng", () => {
    expect(MIGRATION).not.toMatch(/delete from storage\.objects/i);
    expect(MIGRATION).not.toMatch(/truncate/i);
  });

  it("rollback trả đúng 3 policy cũ + bỏ giới hạn", () => {
    for (const p of ["select", "insert", "delete"]) {
      expect(ROLLBACK).toContain(`create policy floor_plans_${p} on storage.objects`);
    }
    expect(ROLLBACK).toContain("auth.role() = 'authenticated'");
    expect(ROLLBACK).toContain("file_size_limit = null");
    expect(ROLLBACK).not.toMatch(/delete from storage\.objects/i);
  });
});

describe("đường dẫn tệp mà mã nguồn sinh ra phải khớp luật", () => {
  it("upload đặt tên theo công ty / chi nhánh / khu", () => {
    expect(SERVICE).toContain("`${ctx.tenantId}/${branchId}/${zoneId}.${ext}`");
  });

  it("xoá ảnh nền cũng dùng đúng khuôn đường dẫn đó", () => {
    const soLan = SERVICE.match(/\$\{ctx\.tenantId\}\/\$\{branchId\}\/\$\{zoneId\}\./g)?.length ?? 0;
    expect(soLan).toBe(2); // upload + remove
  });

  it("vẫn đọc ảnh qua đường dẫn công khai (bucket public — hiển thị không đổi)", () => {
    expect(SERVICE).toContain("getPublicUrl");
  });
});
