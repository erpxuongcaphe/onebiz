import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 04/08/2026 — Đợt E (giảm tải KDS) + lỗi ô món POS FnB.
 *
 * Khoá 3 hành vi:
 *  1. Màn bếp KHÔNG gọi máy chủ khi tab bị che (trước: cứ 30 giây một lần dù
 *     không ai nhìn — nhiều màn bếp cộng lại là tải vô ích cho Supabase).
 *  2. Sự kiện món của quán KHÁC không làm màn bếp này tải lại. ⚠️ Bảng
 *     kitchen_order_items KHÔNG có branch_id nên KHÔNG lọc được phía máy chủ
 *     → phải lọc phía máy khách theo đơn đang hiển thị.
 *  3. Ô món POS FnB: ảnh phải co được, khối tên giữ chỗ cố định — nếu không
 *     ảnh vuông ăn hết chiều cao 220px và tên món bị cắt (đo trên máy thật:
 *     ô kết thúc y=324, tên nằm y=323–340).
 */

const kds = readFileSync("src/app/pos/fnb/kds/page.tsx", "utf8");
const tile = readFileSync(
  "src/app/pos/fnb/components/fnb-product-grid.tsx",
  "utf8",
);
const schema = JSON.parse(
  readFileSync("src/__tests__/schema/db-schema.json", "utf8"),
) as { bang: Record<string, string[]> };

describe("KDS không tải máy chủ vô ích", () => {
  it("bỏ nhịp gọi khi màn hình bị che, gọi lại khi hiện", () => {
    expect(kds).toContain('document.visibilityState === "hidden"');
    expect(kds).toContain('document.addEventListener("visibilitychange"');
    expect(kds).toContain('document.removeEventListener("visibilitychange"');
  });

  it("sự kiện món của quán khác không làm tải lại", () => {
    expect(kds).toContain("visibleOrderIdsRef");
    expect(kds).toContain("kitchen_order_id");
    expect(kds).toMatch(/if \(orderId && !visibleOrderIdsRef\.current\.has\(orderId\)\) return/);
  });

  it("KHÔNG lọc kitchen_order_items theo branch_id — cột đó không tồn tại", () => {
    // Chốt lại sự thật schema để lần sau không ai thêm filter sai làm màn bếp
    // ngừng cập nhật.
    expect(schema.bang.kitchen_order_items).not.toContain("branch_id");
    expect(kds).not.toMatch(
      /table: "kitchen_order_items"[\s\S]{0,80}filter: `branch_id/,
    );
    // Kênh đơn (kitchen_orders) thì CÓ branch_id và PHẢI giữ filter
    expect(schema.bang.kitchen_orders).toContain("branch_id");
    expect(kds).toMatch(
      /table: "kitchen_orders"[\s\S]{0,80}filter: `branch_id=eq\.\$\{branchId\}`/,
    );
  });

  it("kết quả tải cũ không đè danh sách mới hoặc chi nhánh mới", () => {
    expect(kds).toContain("fetchRequestIdRef");
    expect(kds).toContain("activeBranchIdRef.current !== requestedBranchId");
    expect(kds).toContain("requestId !== fetchRequestIdRef.current");
  });
});

describe("KDS khóa thao tác lặp và đồng bộ an toàn", () => {
  it("khóa ngay theo món và theo đơn trước khi gọi máy chủ", () => {
    expect(kds).toContain("pendingItemIdsRef.current.has(item.id)");
    expect(kds).toContain("pendingOrderIdsRef.current.has(item.kitchenOrderId)");
    expect(kds).toContain("pendingOrderIdsRef.current.has(orderId)");
    expect(kds).toContain("setItemsPending([item.id], true)");
    expect(kds).toContain("setOrderPending(orderId, true)");
  });

  it("chờ toàn bộ cập nhật hàng loạt kết thúc rồi mới đồng bộ lại", () => {
    expect(kds).toContain("await Promise.allSettled(");
    expect(kds).not.toContain("await Promise.all(\n          toMark.map");
    expect(kds).toContain("result is PromiseRejectedResult");
  });

  it("nút món và nút đơn hiển thị trạng thái bận, không cho bấm tiếp", () => {
    expect(kds).toContain("isPending={isOrderPending || pendingItemIds.has(item.id)}");
    expect(kds).toContain("disabled={isPending}");
    expect(kds).toContain("disabled={isOrderPending}");
    expect(kds).toContain("disabled={!allReady || isOrderPending}");
    expect(kds).toContain('aria-busy={isOrderPending}');
  });
});

describe("KDS hien thi dung tren dien thoai va tablet", () => {
  it("dung dynamic viewport cho moi trang thai", () => {
    expect(kds).not.toContain("h-screen");
    expect(kds.match(/h-dvh/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("van doi duoc quan khi bo chon desktop dang an", () => {
    expect(kds).toContain(
      'className="flex shrink-0 items-center border-b border-border bg-card px-3 py-2 lg:hidden"',
    );
    expect(kds).toMatch(
      /lg:hidden[\s\S]{0,240}<PosBranchSelector[\s\S]{0,160}filter=\{\["store"\]\}/,
    );
  });
});

describe("Ô món POS FnB không cắt mất tên", () => {
  it("ảnh co được, không còn khung vuông cứng", () => {
    expect(tile).not.toContain("aspect-square overflow-hidden relative p-2 flex-shrink-0");
    expect(tile).toContain("relative min-h-0 flex-1 overflow-hidden p-2");
  });

  it("khối tên món luôn được giữ chỗ", () => {
    // C2 18/08 đổi padding (px-2.5 pb-2) — bất biến là flex-shrink-0 trên
    // khối chữ (không bị ảnh đẩy ra ngoài), không phải chuỗi padding cụ thể.
    expect(tile).toMatch(/flex-shrink-0 px-[\d.]+ pb-[\d.]+ pt-1/);
    expect(tile).not.toMatch(/px-[\d.]+ pb-[\d.]+ pt-1 flex-1 min-h-0/);
  });

  it("vẫn hiển thị giá món", () => {
    expect(tile).toContain("formatCurrency(product.sell_price)");
  });
});
