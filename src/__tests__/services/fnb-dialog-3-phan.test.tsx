import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 06/08/2026 — PR 1 plan vòng 4 (CEO duyệt): popup FnB cấu trúc 3 PHẦN.
 *
 * Bằng chứng gốc đo trên prod: dialog món cao 1.103px trên màn 574px,
 * `overflow: visible`, nút "Thêm vào đơn" ở y=791 NGOÀI màn — không bấm được.
 *
 * Cấu trúc bắt buộc:
 *   DialogContent: max-h + overflow-hidden + flex flex-col
 *   ├─ đầu cố định (shrink-0)
 *   ├─ THÂN: min-h-0 flex-1 overflow-y-auto  ← vùng cuộn DUY NHẤT
 *   └─ chân cố định (shrink-0, NGOÀI vùng cuộn — không sticky)
 *
 * Giới hạn nói thẳng: jsdom không dựng layout nên KHÔNG đo được px ở đây —
 * phần đo px làm bằng Chrome trên Vercel Preview trước merge (quy trình
 * CEO chốt). Test này khoá CẤU TRÚC + các điều cấm để không tái phạm.
 */

const itemSrc = readFileSync("src/app/pos/fnb/components/fnb-item-dialog.tsx", "utf8");
const paySrc = readFileSync("src/app/pos/fnb/components/fnb-payment-dialog.tsx", "utf8");

describe.each([
  ["fnb-item-dialog", itemSrc],
  ["fnb-payment-dialog", paySrc],
])("%s — cấu trúc 3 phần", (_ten, src) => {
  it("DialogContent có trần chiều cao + overflow-hidden + flex flex-col", () => {
    const m = src.match(/<DialogContent className="([^"]+)"/);
    expect(m, "phải có DialogContent với className").toBeTruthy();
    const cls = m![1];
    expect(cls).toContain("max-h-[calc(100dvh-2rem)]");
    expect(cls).toContain("overflow-hidden");
    expect(cls).toContain("flex flex-col");
  });

  it("THÂN là vùng cuộn duy nhất: min-h-0 flex-1 overflow-y-auto", () => {
    expect(src).toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });

  it("đầu + chân cố định (shrink-0), KHÔNG dùng sticky", () => {
    expect(src).toMatch(/<DialogHeader className="shrink-0"/);
    expect(src).toMatch(/<DialogFooter className="shrink-0"/);
    expect(src).not.toContain("sticky bottom-0");
  });

  it("cấm chữ 10px trong dialog", () => {
    expect(src).not.toContain("text-[10px]");
  });
});

describe("Tiền không được giấu", () => {
  it("payment: cặp 'Tổng đã nhập' xuống dòng khi hẹp (flex-wrap), số không truncate", () => {
    const vung = paySrc.slice(
      paySrc.indexOf("Tổng đã nhập") - 400,
      paySrc.indexOf("Tổng đã nhập") + 600,
    );
    expect(vung).toContain("flex-wrap");
    expect(vung).toContain("tabular-nums");
    // soi CHUỖI CLASS trong vùng, không soi cả text (comment cũng chứa chữ
    // "truncate" — bài học regex bắt nhầm chú thích, lần 3)
    const classes = [...vung.matchAll(/className=\{?cn\(\s*"([^"]+)"|className="([^"]+)"/g)]
      .map((m) => m[1] ?? m[2]);
    for (const c of classes) expect(c).not.toContain("truncate");
  });

  it("split-bill: tên món truncate được, cột tiền shrink-0 + tabular-nums", () => {
    const src = readFileSync("src/app/pos/fnb/components/split-bill-dialog.tsx", "utf8");
    expect(src).toMatch(/min-w-0 truncate[^"]*">\{formatNumber\(item\.quantity\)\}x \{item\.name\}/);
    expect(src).toMatch(/shrink-0[^"]*tabular-nums/);
  });

  it("shift-dialog: dòng tiền flex-wrap (số dài xuống dòng, không tràn)", () => {
    const src = readFileSync("src/app/pos/fnb/components/shift-dialog.tsx", "utf8");
    expect(src).toContain("flex flex-wrap justify-between gap-x-2");
    // CloseShiftDialog vẫn giữ mẫu chuẩn max-h + overflow
    expect(src).toContain("max-h-[90vh] overflow-y-auto");
  });
});

describe("Panel tìm kiếm / chọn khách — chiều cao theo màn hình thật", () => {
  it.each([
    ["fnb-customer-picker", "src/app/pos/fnb/components/fnb-customer-picker.tsx"],
    ["fnb-search-modal", "src/app/pos/fnb/components/fnb-search-modal.tsx"],
  ])("%s: danh sách dùng dvh (không px cứng đơn độc) + kbd ẩn ở màn nhỏ", (_t, p) => {
    const src = readFileSync(p, "utf8");
    expect(src).toContain("max-h-[calc(100dvh-14rem)]");
    // dàn phím tắt vô nghĩa trên màn cảm ứng nhỏ
    expect(src).toMatch(/hidden sm:flex[^"]*text-\[11px\]/);
  });
});

describe("Nền dialog.tsx — title không chồng dòng, không chui dưới nút X", () => {
  it("DialogTitle: leading-snug + pr-8 (bỏ leading-none)", () => {
    const src = readFileSync("src/components/ui/dialog.tsx", "utf8");
    const title = src.slice(src.indexOf("function DialogTitle"));
    // soi đúng CHUỖI CLASS (comment giải thích cũng nhắc "leading-none")
    const m = title.match(/"([^"]*font-heading[^"]*)"/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("leading-snug");
    expect(m![1]).toContain("pr-8");
    expect(m![1]).not.toContain("leading-none");
  });

  it("KHÔNG thêm overflow toàn cục ở PR này (chờ kiểm ≥10 dialog dropdown — bước 1c)", () => {
    const src = readFileSync("src/components/ui/dialog.tsx", "utf8");
    const content = src.slice(src.indexOf('data-slot="dialog-content"'), src.indexOf("DialogHeader"));
    expect(content).not.toContain("overflow-y-auto");
    expect(content).not.toContain("max-h-");
  });
});
