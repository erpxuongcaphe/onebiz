import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 04/08/2026 — Đợt E (giảm tải KDS) + lỗi ô món POS FnB.
 *
 * Khoá 3 hành vi:
 *  1. Màn bếp KHÔNG gọi máy chủ khi tab bị che (trước: cứ 30 giây một lần dù
 *     không ai nhìn — nhiều màn bếp cộng lại là tải vô ích cho Supabase).
 *  2. Chỉ nhận sự kiện đơn có branch_id; bảng kitchen_order_items không có
 *     branch_id nên không mở publication/subscription rộng toàn doanh nghiệp.
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

  it("không đăng ký sự kiện món không lọc được theo chi nhánh", () => {
    expect(schema.bang.kitchen_order_items).not.toContain("branch_id");
    expect(kds).not.toContain('table: "kitchen_order_items"');
    expect(schema.bang.kitchen_orders).toContain("branch_id");
    expect(kds).toMatch(
      /table: "kitchen_orders"[\s\S]{0,80}filter: `branch_id=eq\.\$\{branchId\}`/,
    );
  });

  it("hiển thị đúng khi chỉ polling và cảnh báo nếu dữ liệu thực sự cũ", () => {
    expect(kds).toContain('lastFetchAt === null ? "Đang tải" : "Đồng bộ 30s"');
    expect(kds).toContain("Dữ liệu bếp chưa cập nhật");
    expect(kds).toContain("now - lastFetchAt > 90_000");
  });

  it("kết quả tải cũ không đè danh sách mới hoặc chi nhánh mới", () => {
    expect(kds).toContain("fetchRequestIdRef");
    expect(kds).toContain("activeBranchIdRef.current !== requestedBranchId");
    expect(kds).toContain("requestId !== fetchRequestIdRef.current");
  });

  it("gom sự kiện realtime cùng giao dịch thành một lượt tải", () => {
    expect(kds).toContain("REALTIME_REFRESH_DEBOUNCE = 250");
    expect(kds).toContain("scheduleRealtimeRefresh");
    expect(kds).toMatch(
      /if \(refreshTimer !== null\) clearTimeout\(refreshTimer\)/,
    );
    expect(kds).toContain("}, REALTIME_REFRESH_DEBOUNCE)");
  });

  it("thử lại nhanh đúng một nhịp khi tải lỗi", () => {
    expect(kds).toContain("QUICK_RETRY_DELAY = 3_000");
    expect(kds).toContain('if (!fetchError || document.visibilityState === "hidden") return');
    expect(kds).toContain("}, QUICK_RETRY_DELAY)");
    expect(kds).toContain("Đang thử lại nhanh, sau đó tiếp tục đồng bộ mỗi 30s");
  });

  it("không nói sai rằng poll vẫn chạy khi màn KDS đang bị ẩn", () => {
    expect(kds).toContain('document.visibilityState === "hidden"');
    expect(kds).toContain("Màn bếp đang chạy nền nên tạm dừng đồng bộ để giảm tải");
    expect(kds).toContain("Dữ liệu sẽ tải lại ngay khi mở lại màn này");
  });
});

describe("KDS khóa thao tác lặp và đồng bộ an toàn", () => {
  it("khóa ngay theo món và theo đơn trước khi gọi máy chủ", () => {
    expect(kds).toContain("itemIds.some((id) => pendingItemIdsRef.current.has(id))");
    expect(kds).toContain("pendingOrderIdsRef.current.has(item.kitchenOrderId)");
    expect(kds).toContain("pendingOrderIdsRef.current.has(orderId)");
    expect(kds).toContain("setItemsPending(itemIds, true)");
    expect(kds).toContain("setOrderPending(orderId, true)");
  });

  it("chờ toàn bộ cập nhật hàng loạt kết thúc rồi mới đồng bộ lại", () => {
    expect(kds).toContain("await Promise.allSettled(");
    expect(kds).not.toContain("await Promise.all(\n          toMark.map");
    expect(kds).toContain("result is PromiseRejectedResult");
  });

  it("nút món và nút đơn hiển thị trạng thái bận, không cho bấm tiếp", () => {
    expect(kds).toContain(
      "isPending={isOrderPending || group.items.some((item) => pendingItemIds.has(item.id))}",
    );
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

  it("ba luong chia het chieu ngang, moi luong co them cot tren man hinh lon", () => {
    expect(kds).toContain(
      '"grid min-h-full grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3"',
    );
    expect(kds).toContain(
      '"grid auto-rows-max grid-cols-1 items-start gap-2 2xl:grid-cols-2"',
    );
  });

  it("chỉ còn một bố cục gọn và cài đặt quản trị theo chi nhánh", () => {
    expect(kds).not.toContain("KDS_DENSITY_KEY");
    expect(kds).not.toContain("Dễ đọc");
    expect(kds).toContain('aria-label="Cài đặt hiển thị KDS"');
    expect(kds).toContain("canManageKds &&");
    expect(kds).toContain("updateBranchSettings(branchId");
    expect(kds).toContain("KdsDisplaySettingsDialog");
  });

  it("loc mot luong co the hien toi nam cot ticket tren man rong", () => {
    expect(kds).toContain(
      '"grid auto-rows-max grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"',
    );
    expect(kds).toContain("#{order.orderNumber}");
    expect(kds).toContain("compactModifierGroupName(selection.groupName)");
    expect(kds).toContain("prepareKdsItemGroups(projectKitchenReturnItems(order.items, order.returnLines), preferences)");
    expect(kds).toContain('"flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-lg border p-2');
  });

  it("dong ho don cu hien ngay va gio thay vi cong don hang nghin phut", () => {
    expect(kds).toContain("const days = Math.floor(totalHours / 24)");
    expect(kds).toContain("formatElapsed(order.createdAt, now)");
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
