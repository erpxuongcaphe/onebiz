import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 05/08/2026 — CEO: *"anh cảm giác nó vẫn bị không mượt có thể do animation
 * không?"* → đo trên máy thật: KHÔNG phải animation (JS chỉ 112–467 ms).
 * Thủ phạm là dữ liệu về theo 6 ĐỢT NỐI ĐUÔI, xong ở giây 6,4.
 *
 * Trang Hàng hóa: sau khi có danh sách, 3 việc phụ (nhãn BOM · quy đổi đơn
 * vị · tồn khả dụng) đều CHỈ cần danh sách id, KHÔNG cần kết quả của nhau —
 * nhưng bị 3 `await` xếp hàng chờ nhau. Giờ chạy cùng lúc.
 *
 * ⚠️ KỶ LUẬT SỐ LIỆU (CEO: "dữ liệu vẫn phải đúng chính xác, tức thời"):
 *  - Câu hỏi gửi lên máy chủ KHÔNG đổi (cùng bộ lọc, cùng tham số).
 *  - KHÔNG gộp các lời gọi lại — bước 0 đã chứng minh 5 lời gọi bảng
 *    products mỗi cái lọc một kiểu, gộp là SAI SỐ.
 *  - KHÔNG thêm lớp nhớ tạm (cache) — sẽ tái hiện bug tháng 5 "tạo xong
 *    F5 không thấy".
 */

const page = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

/** Thân hàm fetchData — vùng em vừa sửa. */
const fetchData = page.slice(
  page.indexOf("const fetchData = useCallback"),
  page.indexOf("// Đổi chi nhánh / bật-tắt"),
);

describe("Trang Hàng hóa — 3 việc phụ chạy cùng lúc", () => {
  it("dùng Promise.all thay vì 3 await nối đuôi", () => {
    expect(fetchData).toContain("await Promise.all([");
    // cả 3 việc phụ phải nằm TRONG khối song song
    const songSong = fetchData.slice(fetchData.indexOf("await Promise.all(["));
    expect(songSong).toContain("getProductIdsWithActiveBom");
    expect(songSong).toContain("getUOMConversionsByProductIds");
    expect(songSong).toContain("getPosStockSnapshot");
  });

  it("giữ nguyên thứ tự bắt buộc: danh sách TRƯỚC, việc phụ SAU", () => {
    // 3 việc phụ cần id từ danh sách → không được đưa lên trước
    expect(fetchData.indexOf("await getProducts({")).toBeLessThan(
      fetchData.indexOf("await Promise.all(["),
    );
  });

  it("mỗi việc phụ vẫn tự bắt lỗi — một cái hỏng không kéo sập bảng", () => {
    const songSong = fetchData.slice(fetchData.indexOf("await Promise.all(["));
    expect((songSong.match(/catch\s*\{/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("KHÔNG gộp lời gọi và KHÔNG thêm nhớ tạm", () => {
    // vẫn đủ 3 hàm riêng (không ai gộp thành 1 truy vấn)
    expect(fetchData).toContain("getProductIdsWithActiveBom(");
    expect(fetchData).toContain("getUOMConversionsByProductIds(");
    expect(fetchData).toContain("getPosStockSnapshot(");
    // không có lớp cache tự chế trong trang
    expect(fetchData).not.toMatch(/localStorage|sessionStorage|cacheRef/);
  });

  it("bộ lọc danh sách giữ nguyên — số liệu bất biến", () => {
    expect(fetchData).toContain("branchId: viewAllBranches ? undefined : activeBranchId");
    expect(fetchData).toContain("filters: listFilters");
    expect(fetchData).toContain("search: debouncedSearch");
  });
});

describe("Chuyển động — tôn trọng người dùng tắt hiệu ứng", () => {
  it("có khai báo prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important");
    expect(css).toContain("transition-duration: 0.01ms !important");
  });

  it("vẫn giữ vòng xoay chờ — tắt hẳn thì người dùng tưởng treo máy", () => {
    const khoi = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(khoi).toContain(".animate-spin");
    expect(khoi).toContain("animation-iteration-count: infinite !important");
  });
});
