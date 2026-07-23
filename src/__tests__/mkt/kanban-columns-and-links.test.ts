import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CEO 23/07 — 2 việc ở Bảng tiến độ:
 *  (1) Duyệt xong bị nhảy thẳng vào "Đã Đăng" dù chưa ai đăng. Cột "Đã Đăng"
 *      phải do NGƯỜI PHỤ TRÁCH bấm, nên tách thêm cột "Đã duyệt (chờ đăng)".
 *  (2) Mỗi thẻ có nút mở tab mới sang trang quản lý (chiến dịch / kế hoạch /
 *      bài) — chỉ biểu tượng cho gọn, rê chuột mới hiện tên.
 */
const page = readFileSync(resolve("src/app/mkt/kanban/page.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");

describe("Việc 1 — tách 'Đã duyệt (chờ đăng)' khỏi 'Đã Đăng'", () => {
  it("có cột mới cho việc đã xong nhưng KHÔNG phải việc đăng", () => {
    expect(page).toContain('title: "Đã duyệt (chờ đăng)"');
    expect(page).toContain('t.taskStatus === "done" && t.taskType !== "publish"');
  });

  it("'Đã Đăng' CHỈ nhận việc loại đăng bài (do người phụ trách tự bấm)", () => {
    expect(page).toContain('t.taskStatus === "done" && t.taskType === "publish"');
    // Không còn kiểu "mọi việc done đều là đã đăng".
    expect(page).not.toMatch(/title: "Đã Đăng"[\s\S]{0,120}match: \(t\) => t\.taskStatus === "done",/);
  });

  it("mô tả đầu trang nói rõ luồng mới", () => {
    expect(page).toContain("chờ duyệt → đã duyệt");
    expect(page).toContain("Đã đăng bài");
  });
});

describe("Việc 2 — nút biểu tượng mở tab mới", () => {
  it("đủ 3 đích và chỉ hiện đích thực sự có", () => {
    expect(page).toContain("/campaigns/${task.campaignId}");
    expect(page).toContain("/planning?plan=${task.channelPlanId}");
    expect(page).toContain("/approvals?content=${task.contentItemId}");
    expect(page).toContain("if (links.length === 0) return null;");
  });

  it("mở TAB MỚI + đúng đường dẫn theo tên miền phụ", () => {
    expect(page).toContain('target="_blank"');
    expect(page).toContain('rel="noreferrer"');
    expect(page).toContain("resolveMktHref(l.href, basePath)");
  });

  it("gọn: chỉ biểu tượng, rê chuột mới hiện tên (không cần JS)", () => {
    expect(page).toContain("group-hover:opacity-100");
    expect(page).toContain("aria-label={l.label}");
    // Icon trùng bộ icon ở menu để nhìn là nhận ra.
    expect(page).toContain('icon: "campaign"');
    expect(page).toContain('icon: "edit_note"');
    expect(page).toContain('icon: "rate_review"');
  });

  it("read-model cấp thêm mã kế hoạch + mã bài cho thẻ (cùng 1 truy vấn)", () => {
    expect(readModels).toContain("channel_plan_id, content_item_id");
    expect(readModels).toContain("channelPlanId: r.channel_plan_id");
    expect(readModels).toContain("contentItemId: r.content_item_id");
  });
});
