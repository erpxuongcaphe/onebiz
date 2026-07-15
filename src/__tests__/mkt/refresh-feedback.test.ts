import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hook = readFileSync(resolve("src/lib/mkt/use-mkt-refresh.ts"), "utf8");

const dir = resolve("src/components/mkt");
const components = readdirSync(dir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ name: f, src: readFileSync(resolve(dir, f), "utf8") }));

/**
 * Bối cảnh (đo thật trên prod 15/07, thao tác tạo kênh):
 *   gọi máy chủ ghi dữ liệu 3,03s  +  dựng lại màn hình 2,72s  =  ~5,7s
 * Mẫu cũ tắt "đang chạy" và đóng hộp thoại NGAY khi máy chủ trả lời (giây thứ
 * 3) → gần 3 giây người dùng thấy hộp thoại biến mất mà màn hình y nguyên,
 * không dấu hiệu gì → tưởng hỏng, bấm lại, đẻ bản ghi trùng.
 *
 * Lưu ý: router.refresh() KHÔNG hỏng, các trang MKT đều force-dynamic — dữ liệu
 * vẫn tự cập nhật. Đây thuần tuý là khoảng lặng không phản hồi.
 */
describe("Giữ trạng thái đang chạy tới khi màn hình có dữ liệu mới", () => {
  it("hook bọc router.refresh() trong useTransition để biết lúc nào xong", () => {
    expect(hook).toContain("useTransition");
    expect(hook).toContain("router.refresh()");
    // `after` phải nằm TRONG nhịp chuyển tiếp thì việc đóng hộp thoại mới
    // được áp cùng lúc với dữ liệu mới.
    expect(hook).toMatch(/startTransition\(\(\) => \{\s*router\.refresh\(\);\s*after\?\.\(\);/);
  });

  it("KHÔNG component MKT nào còn gọi thẳng router.refresh()", () => {
    const offenders = components
      .filter((c) => c.src.includes("router.refresh("))
      .map((c) => c.name);
    expect(offenders).toEqual([]);
  });

  it("mọi component gọi refresh() đều lấy từ hook (không tự chế biến refresh)", () => {
    const offenders = components
      .filter((c) => /[^.\w]refresh\(/.test(c.src) && !c.src.includes("useMktRefresh"))
      .map((c) => c.name);
    expect(offenders).toEqual([]);
  });

  /**
   * Bẫy đã vấp: đợt đầu mình chỉ thêm `refreshing` vào trạng thái nút, nhưng để
   * nguyên `setOpen(false); refresh();` — nút giữ được, còn HỘP THOẠI vẫn đóng
   * sớm 2,7 giây, tức khoảng lặng vẫn y nguyên. Kiểm chứng trên prod mới lòi ra.
   * Việc đóng phải nằm TRONG nhịp làm mới: `refresh(() => setOpen(false))`.
   */
  it("không nơi nào đóng hộp thoại/dọn form NGAY rồi mới làm mới", () => {
    const bad = /^[ ]+(?:set[A-Z]\w*|onOpenChange)\([^\n]*\);\n[ ]+refresh\(\);/m;
    const offenders = components.filter((c) => bad.test(c.src)).map((c) => c.name);
    expect(offenders).toEqual([]);
  });

  it("hộp thoại con không tự đóng trước khi cha tải xong (nhận cờ busy từ cha)", () => {
    // Con nhận việc qua callback (onAdded/onSaved/onSubmit) thì KHÔNG giữ lệnh
    // làm mới → phải nhận cờ bận của cha, nếu không nút hết quay quá sớm.
    for (const name of ["media-library.tsx", "document-library.tsx", "pillar-board.tsx"]) {
      const src = components.find((c) => c.name === name)!.src;
      expect(src, name).toContain("busy={refreshing}");
      expect(src, name).toContain("busy?: boolean;");
      expect(src, name).toContain("const loading = saving || busy;");
    }
    const lq = components.find((c) => c.name === "leader-queue-actions.tsx")!.src;
    expect(lq).toContain("busy={refreshing}");
    expect(lq).toContain("const loading = saving || busy;");
  });
});
