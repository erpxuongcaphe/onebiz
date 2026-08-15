import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleError } from "@/lib/services/supabase/base";

/**
 * F1a 15/08/2026 — khoá các bất biến an toàn của migration 00323 theo đúng
 * 9 điểm CEO duyệt: quyền, FOR UPDATE, whitelist, chặn anon, rollback đủ,
 * và thông báo 42501 cho tab chạy bundle cũ (chuẩn bị F1b).
 */

const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/00323_fnb_table_config_rpcs.sql"),
  "utf8",
);
const ROLLBACK = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/00323_rollback_fnb_table_config_rpcs.sql"),
  "utf8",
);
const PATCH_324 = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/00324_fnb_table_create_from_floor_plan.sql"),
  "utf8",
);

const FN_SIGNATURES = [
  "fnb_table_config_atomic(text, uuid, jsonb)",
  "fnb_floor_zone_config_atomic(text, uuid, jsonb)",
  "fnb_floor_layout_update_atomic(jsonb)",
  "fnb_floor_decoration_config_atomic(text, jsonb)",
] as const;

describe("00323 — bất biến an toàn", () => {
  it("cả 4 hàm là SECURITY DEFINER với search_path rỗng", () => {
    expect(MIGRATION.match(/security definer/gi)?.length).toBe(4);
    expect(MIGRATION.match(/set search_path = ''/gi)?.length).toBe(4);
  });

  it("khoá hàng trước khi kiểm/sửa (FOR UPDATE)", () => {
    expect(MIGRATION.match(/for update/gi)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("quyền đúng theo CEO: manage_branches cho cấu hình, floor_plan.edit_* cho sơ đồ — KHÔNG dùng pos_fnb.manage_tables", () => {
    expect(MIGRATION).toContain("'system.manage_branches'");
    expect(MIGRATION).toContain("'floor_plan.edit_global'");
    expect(MIGRATION).toContain("'floor_plan.edit_branch'");
    // Chỉ được xuất hiện trong ghi chú, KHÔNG trong lời gọi kiểm quyền.
    expect(MIGRATION).not.toMatch(/user_has_permission\([^)]*pos_fnb\.manage_tables/);
  });

  it("tenant/actor lấy từ auth phía máy chủ, không tin client", () => {
    expect(MIGRATION).toContain("auth.uid()");
    // Không có tham số tenant nào trong chữ ký hàm
    expect(MIGRATION).not.toMatch(/p_tenant/i);
  });

  it("edit_branch phải qua user_has_branch_access", () => {
    expect(MIGRATION).toContain("user_has_branch_access");
  });

  it("chặn key JSON lạ bằng whitelist jsonb_object_keys", () => {
    expect(MIGRATION.match(/jsonb_object_keys/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("thu hồi PUBLIC/anon + chỉ grant authenticated cho đủ 4 chữ ký", () => {
    for (const sig of FN_SIGNATURES) {
      expect(MIGRATION).toContain(`revoke all on function public.${sig} from public, anon;`);
      expect(MIGRATION).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
  });

  it("có audit_log cho các nhánh ghi", () => {
    expect(MIGRATION.match(/insert into public\.audit_log/gi)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("thông báo chặn bằng tiếng Việt", () => {
    expect(MIGRATION).toContain("đang phục vụ hoặc còn đơn");
    expect(MIGRATION).toContain("chuyển bàn sang khu khác");
  });
});

describe("00323 rollback — gỡ đủ, không đụng bảng", () => {
  it("DROP đúng 4 chữ ký hàm", () => {
    for (const sig of FN_SIGNATURES) {
      expect(ROLLBACK).toContain(`drop function if exists public.${sig};`);
    }
  });

  it("không DROP TABLE / không đụng dữ liệu", () => {
    expect(ROLLBACK).not.toMatch(/drop table/i);
    expect(ROLLBACK).not.toMatch(/\b(delete from|update |truncate)\b/i);
  });
});

describe("00324 — tạo bàn từ sơ đồ không mất quyền của vai trò Quản lý", () => {
  it("giữ nguyên khuôn an toàn của 00323", () => {
    expect(PATCH_324).toContain("security definer");
    expect(PATCH_324).toContain("set search_path = ''");
    expect(PATCH_324).toContain("auth.uid()");
    expect(PATCH_324).not.toMatch(/p_tenant/i);
    expect(PATCH_324).toMatch(/for update/i);
    expect(PATCH_324).toContain(
      "revoke all on function public.fnb_table_config_atomic(text, uuid, jsonb) from public, anon;",
    );
  });

  it("lối sơ đồ CHỈ mở khi payload có zone_id, và phải kèm branch access", () => {
    expect(PATCH_324).toMatch(/v_plan_ok\s*:=\s*p_action\s*=\s*'create'/);
    expect(PATCH_324).toContain("(p_payload ? 'zone_id')");
    expect(PATCH_324).toContain("'floor_plan.edit_global'");
    expect(PATCH_324).toContain("user_has_branch_access(v_actor, p_branch_id)");
  });

  it("các action còn lại vẫn bắt buộc system.manage_branches", () => {
    // Sau nhánh create phải có chốt chặn thứ hai chỉ chấp nhận v_manage.
    const sauCreate = PATCH_324.slice(PATCH_324.indexOf("Mọi action còn lại"));
    expect(sauCreate).toMatch(/if not v_manage then\s*\n\s*raise exception/);
    expect(PATCH_324).toContain("'system.manage_branches'");
    expect(PATCH_324).not.toMatch(/user_has_permission\([^)]*pos_fnb\.manage_tables/);
  });

  it("giữ đủ guard nghiệp vụ đã có (xoá bàn bận, khu còn bàn, whitelist)", () => {
    expect(PATCH_324).toContain("đang phục vụ hoặc còn đơn");
    expect(PATCH_324).toContain("đang phục vụ hoặc còn đơn — không thể xoá khu.");
    expect(PATCH_324.match(/jsonb_object_keys/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(PATCH_324).toContain("Số bàn % đã tồn tại trong chi nhánh.");
  });
});

describe("handleError 42501 — tab bundle cũ sau F1b", () => {
  it("permission denied for table → lời tiếng Việt bảo tải lại trang", () => {
    expect(() =>
      handleError(
        { message: 'permission denied for table "restaurant_tables"', code: "42501" },
        "updateTable",
      ),
    ).toThrow("Phiên bản đã cũ, vui lòng tải lại trang.");
  });

  it("42501 loại khác (RLS/function) KHÔNG bị nuốt thành thông báo tải lại", () => {
    expect(() =>
      handleError(
        { message: "permission denied for function xyz", code: "42501" },
        "ctx",
      ),
    ).toThrow(/\[ctx\] permission denied for function/);
  });

  it("lỗi thường giữ format cũ [context] message", () => {
    expect(() => handleError({ message: "boom", code: "500" }, "ctx")).toThrow(
      "[ctx] boom (code: 500)",
    );
  });
});
