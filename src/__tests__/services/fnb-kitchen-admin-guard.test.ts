import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/00372_harden_kitchen_station_admin.sql"),
  "utf8",
);
const printPage = readFileSync(
  join(root, "src/app/(main)/cai-dat/in-an/page.tsx"),
  "utf8",
);
const readiness = readFileSync(
  join(root, "src/app/(main)/hang-hoa/tuy-chon-fnb/fnb-readiness-band.tsx"),
  "utf8",
);

describe("FnB kitchen administration guard", () => {
  it("requires branch administration on the page and every write policy", () => {
    expect(printPage).toContain("<PermissionPage requires={PERMISSIONS.SYSTEM_MANAGE_BRANCHES}>");
    expect(migration.match(/user_has_permission\(auth\.uid\(\), 'system\.manage_branches'\)/g)).toHaveLength(4);
    expect(migration.match(/user_has_branch_access\(auth\.uid\(\), branch_id\)/g)).toHaveLength(4);
  });

  it("does not claim that product data alone means the store is ready", () => {
    expect(readiness).toContain("Dữ liệu món FnB đã đạt kiểm tra");
    expect(readiness).toContain("Trước khi mở bán vẫn cần kiểm tra ca, nhân sự, tồn nguyên liệu, máy in và một đơn thử");
    expect(readiness).not.toContain("Cấu hình FnB đã sẵn sàng");
  });
});
