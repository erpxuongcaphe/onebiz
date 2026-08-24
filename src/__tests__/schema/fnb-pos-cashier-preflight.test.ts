import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sqlPath = resolve(
  process.cwd(),
  "SQL-CAN-CHAY/PREFLIGHT-FNB-POS-THU-NGAN-VA-NVL.sql",
);
const sql = readFileSync(sqlPath, "utf8");
const executableSql = sql
  .replace(/--.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const sqlWithoutStrings = executableSql.replace(/'(?:''|[^'])*'/g, "''");

describe("Hậu kiểm POS F&B cho thu ngân", () => {
  it("chỉ đọc và cố định đúng tenant vận hành", () => {
    expect(sqlWithoutStrings).not.toMatch(
      /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|begin|commit)\b/i,
    );
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("OneBiz Coffee Demo");
    expect(sql).not.toMatch(/DAN_TENANT|TENANT_ID_VAO_DAY/i);
  });

  it("không cho bỏ qua kiểm ghi trực tiếp, hủy bill hoặc ca thu ngân", () => {
    expect(sql).toContain("P1_RLS_VA_GHI_TRUC_TIEP");
    expect(sql).toContain("P3B_HUY_BILL_DUNG_CHI_NHANH");
    expect(sql).toContain("user_has_branch_access");
    expect(sql).toContain("p_voided_by is distinct from v_actor");
    expect(sql).toContain("P3C_THANH_TOAN_TRONG_CA");
    expect(sql).toContain("FNB_PAYMENT_OPEN_SHIFT_REQUIRED");
    expect(sql).toContain("Z_KET_LUAN_BAO_MAT_THU_NGAN");
  });
});
