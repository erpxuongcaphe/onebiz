import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 16/08/2026 — mục D: thanh đầu POS F&B không được tràn ở tablet ngang.
 *
 * ĐO TRÊN PRODUCTION (khung nhúng 1024×768, fnb.onebiz.com.vn/pos/fnb):
 *   khối "Màn bếp + cài đặt" nằm ở left=978 → right=1080 trong khung 1024
 *   → tràn 56px và bị cắt, nút bấm không tới.
 *
 * Mốc `lg` của Tailwind đúng bằng 1024px nên vừa bật hiện là đã hết chỗ.
 * Phải dùng `xl` (1280px). Tablet vẫn vào Màn bếp qua ngăn kéo.
 */

const HEADER = readFileSync(
  "src/app/pos/fnb/components/fnb-header.tsx",
  "utf8",
);
const DRAWER = readFileSync(
  "src/app/pos/fnb/components/fnb-sidenav-drawer.tsx",
  "utf8",
);

/** Bỏ dòng ghi chú để không đếm nhầm chữ trong lời giải thích. */
const HEADER_MA = HEADER.split("\n")
  .filter((d) => {
    const t = d.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("Thanh đầu POS F&B — không tràn ở tablet ngang 1024", () => {
  it("khối Màn bếp chỉ hiện từ xl (1280px), KHÔNG phải lg (1024px)", () => {
    const khoi = HEADER_MA.match(/className="order-22[^"]*"/)?.[0] ?? "";
    expect(khoi).toContain("xl:flex");
    expect(khoi).not.toContain("lg:flex");
  });

  it("chữ 'Màn bếp' cũng theo mốc xl, không lệch mốc với khối cha", () => {
    expect(HEADER_MA).toContain('className="hidden xl:inline text-xs font-semibold"');
    expect(HEADER_MA).not.toMatch(/hidden lg:inline[^"]*"\s*>Màn bếp/);
  });

  it("ẩn nút vẫn còn đường vào Màn bếp qua ngăn kéo — không mất chức năng", () => {
    expect(DRAWER).toContain("/pos/fnb/kds");
    expect(DRAWER).toContain("Màn bếp (KDS)");
  });
});
