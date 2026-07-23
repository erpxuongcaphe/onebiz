import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2 lỗi nhân viên báo 23/07:
 *  (1) Đặt hạn HÔM NAY nhưng việc vẫn nằm ở cột "Deadline gần (24-48h)",
 *      không nhảy sang "Hôm nay làm gì".
 *  (2) Có bài chờ mình duyệt ở màn "Duyệt nội dung" nhưng Lịch cá nhân TRỐNG.
 */
const read = (p: string) => readFileSync(resolve(p), "utf8");
const page = read("src/app/mkt/tasks/page.tsx");
const readModels = read("src/lib/mkt/read-models.ts");

describe("Lỗi 1 — việc đến hạn hôm nay phải nằm ở cột 'Hôm nay làm gì'", () => {
  it("có khái niệm 'đến hạn hôm nay / quá hạn' và cột Deadline gần LOẠI nó ra", () => {
    expect(page).toContain("function isDueTodayOrOverdue");
    // isDueSoonTask phải trả false cho việc hôm nay/quá hạn.
    expect(page).toMatch(/function isDueSoonTask[\s\S]{0,220}if \(isDueTodayOrOverdue\(task\)\) return false;/);
  });

  it("so ngày theo giờ Việt Nam (trang render ở máy chủ UTC, không thì lệch 7 tiếng)", () => {
    expect(page).toContain('timeZone: "Asia/Ho_Chi_Minh"');
    expect(page).toContain("const vnDay");
  });

  it("hạn hiển thị cũng ghim múi giờ Việt Nam", () => {
    // Trong dueLabel: format hạn phải kèm timeZone.
    expect(page).toMatch(/minute: "2-digit",[\s\S]{0,160}timeZone: "Asia\/Ho_Chi_Minh"/);
  });

  it("nhãn cột rỗng nói đúng bản chất (đến hạn hôm nay), không phải 'đang làm'", () => {
    expect(page).toContain("Không có việc đến hạn hôm nay");
    expect(page).not.toContain("Chưa có việc đang làm");
  });
});

describe("Lỗi 2 — bài chờ tôi duyệt phải hiện ở Lịch cá nhân", () => {
  it("hàng chờ duyệt KHÔNG còn loại bỏ việc gắn bài", () => {
    // Dòng cũ .is("content_item_id", null) đã bỏ khỏi getTasksAwaitingMyReview.
    const fn = readModels.slice(
      readModels.indexOf("export async function getTasksAwaitingMyReview"),
      readModels.indexOf("export async function getCampaignList"),
    );
    expect(fn).toContain('.eq("reviewer_id", userId)');
    expect(fn).toContain('.eq("task_status", "reviewing")');
    expect(fn).not.toContain('.is("content_item_id", null)');
  });

  it("thẻ việc gắn bài dẫn sang màn Duyệt nội dung (RPC duyệt tại chỗ chặn loại này)", () => {
    expect(page).toContain("Mở màn duyệt nội dung");
    expect(page).toContain("/approvals?content=");
    expect(page).toContain("task.contentItemId ?");
  });
});
