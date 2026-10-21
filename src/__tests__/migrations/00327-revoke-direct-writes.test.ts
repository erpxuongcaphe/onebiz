import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * F1b — thu hồi quyền ghi thẳng 3 bảng cấu hình bàn.
 *
 * Điều kiện sống còn: sau khi thu hồi, mọi màn vẫn ĐỌC được, và 4 RPC của
 * 00323 vẫn là đường ghi duy nhất. Tệp này khoá cả nội dung migration lẫn
 * bất biến của mã nguồn (không còn chỗ nào ghi thẳng, kể cả đã xoá hàm chết).
 */

const doc = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const MIGRATION = doc("supabase/migrations/00327_revoke_direct_writes_table_config.sql");
const ROLLBACK = doc("supabase/migrations/00327_rollback_revoke_direct_writes_table_config.sql");
const PREFLIGHT = doc("docs/PREFLIGHT-F1B-THU-HOI-QUYEN-GHI-2026-08-15.sql");

const BANG = ["restaurant_tables", "floor_plan_zones", "floor_plan_decorations"] as const;

const LENH = MIGRATION.split("\n")
  .filter((d) => !d.trimStart().startsWith("--"))
  .join("\n");

describe("00327 — thu hồi đúng và đủ", () => {
  it("thu hồi 4 quyền ghi trên cả 3 bảng, cho cả authenticated lẫn anon", () => {
    for (const b of BANG) {
      for (const vai of ["authenticated", "anon"]) {
        expect(LENH).toMatch(
          new RegExp(`revoke insert, update, delete, truncate on public\\.${b}\\s+from ${vai};`),
        );
      }
    }
  });

  it("KHÔNG thu hồi quyền đọc — mọi màn phải xem được như cũ", () => {
    expect(LENH).not.toMatch(/revoke[^;]*select[^;]*;/i);
    expect(MIGRATION).toContain("quyen SELECT bi mat");
  });

  it("không đụng RLS, bảng, cột, dữ liệu", () => {
    expect(LENH).not.toMatch(/\b(alter table|drop table|create policy|drop policy)\b/i);
    expect(LENH).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
    expect(LENH).not.toMatch(/enable row level security|disable row level security/i);
  });

  it("KHÔNG gộp audit_log — việc đó là đợt A1 riêng", () => {
    expect(LENH).not.toMatch(/audit_log/);
  });

  it("tự dừng nếu còn sót quyền ghi, mất quyền đọc, hoặc thiếu RPC", () => {
    expect(MIGRATION).toContain("van con % quyen ghi truc tiep");
    expect(MIGRATION).toContain("quyen SELECT bi mat");
    expect(MIGRATION).toContain("RPC cau hinh (SECURITY DEFINER)");
  });
});

describe("00327 rollback — cấp lại chính xác quyền cũ", () => {
  it("cấp lại đúng 4 quyền × 3 bảng cho authenticated", () => {
    for (const b of BANG) {
      expect(ROLLBACK).toMatch(
        new RegExp(`grant insert, update, delete, truncate on public\\.${b}\\s+to authenticated;`),
      );
    }
    expect(ROLLBACK).toContain("12");
  });

  it("KHÔNG cấp lại cho anon — vai trò đó vốn đã sạch từ 00239", () => {
    expect(ROLLBACK).not.toMatch(/grant[^;]*to anon;/i);
  });
});

describe("00327 preflight — chụp được cả hai đầu", () => {
  it("chỉ đọc", () => {
    expect(PREFLIGHT).not.toMatch(/\b(revoke|grant|insert into|update |delete from|drop )\b/i);
  });

  it("soi quyền, RPC cấu hình, RPC vận hành và số liệu đối chiếu", () => {
    expect(PREFLIGHT).toContain("role_table_grants");
    expect(PREFLIGHT).toContain("fnb_table_config_atomic");
    expect(PREFLIGHT).toContain("mark_fnb_table_available_atomic");
    expect(PREFLIGHT).toContain("SỐ LIỆU ĐỐI CHIẾU");
  });
});

describe("bất biến mã nguồn — điều kiện để F1b an toàn", () => {
  const goc = ["app", "components", "hooks", "lib"].map((f) =>
    path.join(process.cwd(), "src", f),
  );

  function liet(thumuc: string): string[] {
    if (!fs.existsSync(thumuc)) return [];
    return fs.readdirSync(thumuc, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(thumuc, e.name);
      return e.isDirectory() ? liet(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  }

  it("không còn chỗ nào ghi thẳng 3 bảng ngoài RPC", () => {
    const viPham: string[] = [];
    for (const f of goc.flatMap(liet)) {
      const src = fs.readFileSync(f, "utf8");
      for (const b of BANG) {
        const re = new RegExp(`from\\(["'\`]${b}["'\`]\\)([\\s\\S]{0,120})`, "g");
        for (const m of src.matchAll(re)) {
          if (/\.(insert|update|upsert|delete)\(/.test(m[1])) {
            viPham.push(`${path.relative(process.cwd(), f)} → ${b}`);
          }
        }
      }
    }
    expect(viPham, `còn ghi thẳng: ${viPham.join(", ")}`).toEqual([]);
  });

  it("hàm chết cancelKitchenOrder đã gỡ khỏi service", () => {
    const src = doc("src/lib/services/supabase/kitchen-orders.ts");
    expect(src).not.toMatch(/export async function cancelKitchenOrder/);
    // Luồng thật phải còn nguyên
    expect(src).toMatch(/export async function cancelUnpaidKitchenOrder/);
  });

  it("lỗi 42501 báo bằng lời người dùng hiểu được", () => {
    const base = doc("src/lib/services/supabase/base.ts");
    expect(base).toContain("Phiên bản đã cũ, vui lòng tải lại trang.");
    expect(base).toContain('error?.code === "42501"');
  });
});
