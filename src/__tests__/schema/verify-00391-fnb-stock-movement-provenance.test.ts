import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/verify/00391_fnb_stock_movement_provenance.sql"),
  "utf8",
);
const executable = sql.replace(/^\s*--.*$/gm, "");

describe("00391 F&B stock movement provenance", () => {
  it("locks the audit to Xưởng Tư Búa and the approved tenant", () => {
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("CNH-XTB");
  });

  it("shows the source type and distinguishes linked internal sales from other entries", () => {
    expect(sql).toContain("sm.reference_type");
    expect(sql).toContain("public.internal_sales noi_bo");
    expect(sql).toContain("public.input_invoices pn");
    expect(sql).toContain("Không gắn phiếu cấp nội bộ");
    expect(sql).toContain("Xuất theo BOM F&B");
    expect(sql).toContain("Hoàn kho F&B từ hủy/trả hóa đơn");
    expect(sql).toContain("Tồn đầu hoặc điều chỉnh");
  });

  it("remains strictly read-only", () => {
    expect(executable).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  });
});
