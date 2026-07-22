import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chuông thông báo MKT Hub (CEO 22/07): trước đây MKT Hub KHÔNG có chuông —
 * thông báo MKT chỉ chảy vào chuông ERP chính + Telegram. Nay Hub có chuông
 * riêng, dùng chung bảng notifications, ưu tiên giao diện mobile.
 */
const read = (p: string) => readFileSync(resolve(p), "utf8");
const bell = read("src/components/mkt/notification-bell.tsx");
const layout = read("src/app/mkt/layout.tsx");
const readModels = read("src/lib/mkt/read-models.ts");
const listRoute = read("src/app/api/mkt/v1/notifications/route.ts");
const readRoute = read("src/app/api/mkt/v1/notifications/read/route.ts");

describe("Chuông MKT Hub — chỉ thấy thông báo của chính mình", () => {
  it("read-model lọc user_id (KHÔNG chỉ dựa RLS) + chỉ loại mkt_*", () => {
    expect(readModels).toContain("export async function getMktNotifications");
    expect(readModels).toContain('.eq("user_id", userId)');
    expect(readModels).toContain('.like("type", "mkt_%")');
  });

  it("route đánh dấu đã đọc cũng khoá theo user_id + mkt_*", () => {
    expect(readRoute).toContain('.eq("user_id", user.id)');
    expect(readRoute).toContain('.like("type", "mkt_%")');
    // Không dùng .or() với update — PostgREST 20/07 nổ 42703 (bài học cũ).
    expect(readRoute).not.toContain(".or(");
  });

  it("route danh sách trả kèm số chưa đọc + chặn khi chưa đăng nhập", () => {
    expect(listRoute).toContain("getMktNotifications");
    expect(listRoute).toContain("unread");
    expect(listRoute).toContain("UNAUTHENTICATED");
  });
});

describe("Chuông MKT Hub — giao diện mobile", () => {
  it("mobile: bảng trải ngang màn hình dưới header, cuộn trong khung; desktop: thả xuống 380px", () => {
    expect(bell).toContain("fixed inset-x-2 top-16");
    expect(bell).toContain("max-h-[70vh]");
    expect(bell).toContain("overflow-y-auto");
    expect(bell).toContain("sm:absolute");
    expect(bell).toContain("sm:w-[380px]");
  });

  it("chuông có badge số chưa đọc + nhãn trợ năng, chữ dài tự xuống dòng", () => {
    expect(bell).toContain('Icon name="notifications"');
    expect(bell).toContain("99+");
    expect(bell).toContain("aria-label");
    expect(bell).toContain("line-clamp-2");
    expect(bell).toContain("break-words");
  });

  it("KHÔNG gọi API khi tab đang ẩn (đỡ tải web), quay lại tab thì làm mới ngay", () => {
    expect(bell).toContain("document.hidden");
    expect(bell).toContain('"visibilitychange"');
  });

  it("đóng được bằng bấm/chạm ra ngoài / Esc (chạm quan trọng trên điện thoại)", () => {
    expect(bell).toContain('"mousedown"');
    expect(bell).toContain('"touchstart"');
    expect(bell).toContain('e.key === "Escape"');
  });
});

describe("Chuông MKT Hub — bấm vào mở đúng chỗ + gắn vào header", () => {
  it("ánh xạ tham chiếu → màn hình (việc / kế hoạch / nội dung)", () => {
    expect(bell).toContain('case "mkt_task"');
    expect(bell).toContain("/tasks?task=");
    expect(bell).toContain('case "mkt_channel_plan"');
    expect(bell).toContain("/planning?plan=");
    expect(bell).toContain('case "mkt_content_item"');
    expect(bell).toContain("/approvals?content=");
    // Điều hướng qua useMktHref để đúng basePath subdomain.
    expect(bell).toContain("useMktHref");
  });

  it("đã gắn vào header MKT Hub", () => {
    expect(layout).toContain("MktNotificationBell");
    expect(layout).toContain('from "@/components/mkt/notification-bell"');
  });
});
