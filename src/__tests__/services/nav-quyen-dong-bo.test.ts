import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 05/08/2026 — Bắt được khi rà nhãn menu trùng.
 *
 * Trang `/phan-tich/canh-bao` có HAI lối vào:
 *   - nhóm "Tổng quan"  → KHÔNG khai báo `permission`
 *   - nhóm "Báo cáo"    → có `permission: "reports.dashboard"`
 *
 * `canViewLeaf` (app-sidebar.tsx:25) coi "không khai báo quyền" = ai cũng
 * xem được. Nên thu ngân / kho vận thấy lối tắt ở Tổng quan và mở được
 * trang cảnh báo: top 20 khách đang nợ kèm tên + số tiền.
 *
 * ⚠️ RANH GIỚI CỦA TEST NÀY — nói rõ để người sau không hiểu nhầm:
 * đây chỉ khoá phần MENU. Trang `(main)/phan-tich/*` KHÔNG có
 * `PermissionPage`, `src/proxy.ts` và `(main)/layout.tsx` cũng không chặn
 * theo đường dẫn. Ai gõ thẳng địa chỉ vẫn vào được. Test này ngăn việc
 * *vô tình lộ lối tắt*, KHÔNG phải lớp bảo vệ dữ liệu.
 */

const src = readFileSync("src/components/shared/nav-config.ts", "utf8");

/** Gom từng mục lá `{ ... href: "..." ... }` kèm quyền của chính nó. */
function docCacMuc() {
  const muc: { href: string; quyen: string[] }[] = [];
  const re = /\{[^{}]*href:\s*"([^"]+)"[^{}]*\}/g;
  for (const m of src.matchAll(re)) {
    const than = m[0];
    const quyen = [
      ...[...than.matchAll(/permission:\s*"([^"]+)"/g)].map((x) => x[1]),
      ...[...than.matchAll(/permissions:\s*\[([^\]]*)\]/g)].flatMap((x) =>
        [...x[1].matchAll(/"([^"]+)"/g)].map((y) => y[1]),
      ),
    ];
    muc.push({ href: m[1], quyen: quyen.sort() });
  }
  return muc;
}

describe("Menu — cùng một trang thì mọi lối vào phải cùng mức quyền", () => {
  const muc = docCacMuc();

  it("đọc được danh sách mục (chốt chặn cho chính test này)", () => {
    // nếu đổi cách viết nav-config làm regex trượt, test phải kêu chứ không
    // được lặng lẽ đạt vì đọc ra mảng rỗng
    expect(muc.length).toBeGreaterThan(50);
  });

  it("không có trang nào bị 'một cửa khoá, một cửa mở'", () => {
    const theoHref = new Map<string, Set<string>>();
    for (const m of muc) {
      if (!theoHref.has(m.href)) theoHref.set(m.href, new Set());
      theoHref.get(m.href)!.add(m.quyen.join("+") || "(KHÔNG KHOÁ)");
    }

    const lech = [...theoHref.entries()]
      .filter(([, bo]) => bo.size > 1)
      .map(([href, bo]) => `${href} → ${[...bo].join(" | ")}`);

    expect(lech).toEqual([]);
  });

  it("cụ thể: cả 2 lối vào trang Cảnh báo đều cần reports.dashboard", () => {
    const loi = muc.filter((m) => m.href === "/phan-tich/canh-bao");
    expect(loi).toHaveLength(2);
    for (const l of loi) expect(l.quyen).toContain("reports.dashboard");
  });
});
