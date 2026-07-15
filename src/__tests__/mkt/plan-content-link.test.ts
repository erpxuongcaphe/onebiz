import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const planControls = readFileSync(resolve("src/components/mkt/plan-controls.tsx"), "utf8");
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const submitRpc = readFileSync(
  resolve("supabase/migrations/00182_mkt_channel_planning_dot2.sql"),
  "utf8",
);
const startRpc = readFileSync(
  resolve("supabase/migrations/00174_mkt_hub_workflow_hardening.sql"),
  "utf8",
);

/**
 * Bối cảnh: CEO không nộp được kế hoạch — máy chủ báo "công đoạn (duyệt/đăng)
 * cần gắn nội dung" nhưng màn lập kế hoạch KHÔNG có ô chọn nội dung nào
 * => bế tắc, bấm kiểu gì cũng lỗi. Bộ test này khoá lại cả 2 đầu.
 */
describe("Lập kế hoạch — công đoạn Duyệt/Đăng phải gắn được nội dung", () => {
  it("luật ở máy chủ là ĐÚNG: task 'publish' không gắn nội dung sẽ không Bắt đầu được", () => {
    // Đây là lý do vì sao mkt_submit_plan bắt buộc gắn nội dung — không phải luật thừa.
    expect(startRpc).toContain("if v_task.task_type = 'publish' then");
    expect(startRpc).toContain("if v_task.content_item_id is null then raise exception 'INVALID_STATE'");
    expect(submitRpc).toContain("task_type in ('review', 'publish') and v_item.content_item_id is null");
  });

  it("màn lập kế hoạch PHẢI có ô chọn nội dung (nếu không sẽ không bao giờ nộp được)", () => {
    expect(planControls).toContain("contentItemId: string;");
    expect(planControls).toContain("— Chọn nội dung (bắt buộc) —");
    expect(planControls).toContain('patch(idx, { contentItemId: e.target.value })');
  });

  it("phải GỬI contentItemId lên máy chủ, không chỉ hiện ở giao diện", () => {
    expect(planControls).toContain("contentItemId: r.contentItemId || undefined");
  });

  it("cho tạo nhanh nội dung tại chỗ — lúc lập kế hoạch nội dung thường chưa tồn tại", () => {
    expect(planControls).toContain("quickCreateContent");
    expect(planControls).toContain("/api/mkt/v1/contents");
    expect(planControls).toContain("campaignId: plan.campaignId");
    // Nội dung tạo mới vẫn phải gắn Trụ (yêu cầu CEO)
    expect(planControls).toContain("pillarId: quickPillarId");
  });

  it("báo lỗi rõ ràng tại chỗ trước khi máy chủ trả mã lỗi khó hiểu", () => {
    expect(planControls).toContain("const needsContent");
    expect(planControls).toContain("Công đoạn Duyệt/Đăng phải gắn nội dung");
  });

  it("trang lập kế hoạch nạp danh sách nội dung + trụ và truyền xuống đúng chiến dịch", () => {
    expect(readModels).toContain("export async function getContentOptions");
    expect(planningPage).toContain("getContentOptions(supabase, campaignIds)");
    expect(planningPage).toContain("contents.filter((c) => c.campaignId === p.campaignId)");
    expect(planningPage).toContain("pillars={pillars}");
  });
});
