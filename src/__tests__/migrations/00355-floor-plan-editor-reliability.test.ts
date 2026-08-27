import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const doc = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const migration = doc("supabase/migrations/00355_floor_plan_editor_reliability.sql");
const rollback = doc("supabase/migrations/00355_rollback_floor_plan_editor_reliability.sql");

describe("00355 — ràng buộc trang trí phải khớp preset giao diện", () => {
  it("chỉ hạ giới hạn kích thước tối thiểu xuống 4px", () => {
    expect(migration).toContain("floor_plan_decorations_width_check check (width between 4 and 2000)");
    expect(migration).toContain("floor_plan_decorations_height_check check (height between 4 and 2000)");
    expect(migration).toContain("drop constraint if exists floor_plan_decorations_width_check");
    expect(migration).toContain("drop constraint if exists floor_plan_decorations_height_check");
  });

  it("không sửa hoặc xoá dữ liệu sơ đồ hiện có", () => {
    const executable = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/\b(update|delete|insert into|truncate)\s+public\.floor_plan_decorations\b/i);
  });

  it("có prerequisite, hậu kiểm và reload schema sau commit", () => {
    expect(migration).toContain("FLOOR_PLAN_00355_PREREQUISITE_MISSING");
    expect(migration).toContain("FLOOR_PLAN_00355_CONSTRAINT_POSTCHECK_FAILED");
    expect(migration).toMatch(/commit;\s+\s*notify pgrst, 'reload schema';/);
  });

  it("rollback từ chối lui nếu đã có vật mảnh hợp lệ", () => {
    expect(rollback).toContain("FLOOR_PLAN_00355_ROLLBACK_BLOCKED_BY_THIN_DECORATION");
    expect(rollback).toContain("where width < 20 or height < 20");
  });
});
