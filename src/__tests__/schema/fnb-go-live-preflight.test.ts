import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sqlPath = resolve(
  process.cwd(),
  "docs/qc/sql/FNB-GO-LIVE-PREFLIGHT-READONLY.sql",
);
const sql = readFileSync(sqlPath, "utf8");
const dbSchema = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/__tests__/schema/db-schema.json"),
    "utf8",
  ),
) as { bang: Record<string, string[]> };
const executableSql = sql
  .replace(/--.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("Hậu kiểm trước vận hành FnB", () => {
  it("chỉ đọc, không chứa lệnh thay đổi dữ liệu hoặc cấu trúc", () => {
    expect(executableSql).not.toMatch(
      /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke)\b/i,
    );
  });

  it("chỉ dùng trạng thái đang có thật trên bảng sản phẩm", () => {
    expect(dbSchema.bang.products).toContain("is_active");
    expect(dbSchema.bang.products).not.toContain("deleted_at");
    expect(sql).toContain("p.is_active = true");
    expect(sql).not.toContain("p.deleted_at");
  });

  it("kiểm đủ giá topping, giới hạn lựa chọn và công thức theo Size", () => {
    expect(sql).toContain("GIA_TOPPING_SERVER_00304");
    expect(sql).toContain("enforce_fnb_modifier_multi_limits_00318");
    expect(sql).toContain("get_active_bom_for_branch(uuid,uuid,uuid)");
    expect(sql).toContain("consume_bom_for_sale(uuid,uuid,uuid,numeric");
    expect(sql).toContain("restore_bom_for_return(uuid,uuid,uuid,numeric");
    expect(sql).toContain("r.variant_id");
  });

  it("trả kết luận và hướng xử lý rõ ràng bằng tiếng Việt", () => {
    expect(sql).toContain("DỪNG - công thức theo Size chưa đủ mắt xích");
    expect(sql).toContain("CHƯA SẴN SÀNG - topping chưa đủ giá và công thức");
    expect(sql).toContain("ĐẠT - sẵn sàng kiểm khói FnB");
    expect(sql).toContain("viec_can_lam_tiep");
  });
});
