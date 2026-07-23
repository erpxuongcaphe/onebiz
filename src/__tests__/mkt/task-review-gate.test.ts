import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(resolve("supabase/migrations/00197_mkt_task_review_gate.sql"), "utf8");
const taskActions = readFileSync(resolve("src/components/mkt/task-actions.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const api = readFileSync(resolve("src/lib/mkt/api.ts"), "utf8");
const actionRoute = readFileSync(
  resolve("src/app/api/mkt/v1/tasks/[taskId]/[action]/route.ts"),
  "utf8",
);
const tasksPage = readFileSync(resolve("src/app/mkt/tasks/page.tsx"), "utf8");

/**
 * Bug CEO 16/07 (kèm ảnh Kanban): việc có NGƯỜI DUYỆT vẫn nhảy thẳng
 * "Đang sản xuất" → "Đã đăng", bỏ qua "Chờ duyệt" ("Đăng bài" xong trong 7
 * giây). Gốc: cột Chờ duyệt trước giờ chỉ có cửa vào cho việc GẮN NỘI DUNG;
 * mkt_mark_task_done không nhìn reviewer_id. Bộ test này khoá luật mới:
 * CÓ người duyệt (khác người làm) + KHÔNG nội dung → bắt buộc qua Chờ duyệt.
 */
describe("00197 — tầng SQL", () => {
  it("mkt_mark_task_done chép từ 00193 + CHỈ thêm guard người duyệt", () => {
    // Dấu vân 00193 còn nguyên (không dựng lại luật ép gắn nội dung).
    expect(mig).toContain("ĐỔI: chỉ chặn khi CÓ gắn nội dung.");
    expect(mig).toContain("CONTENT_NOT_APPROVED");
    expect(mig).not.toContain("cần gắn nội dung'");
    // Guard mới: đúng 3 điều kiện — có reviewer, khác người bấm, không nội dung.
    expect(mig).toContain(
      "if v_task.reviewer_id is not null and v_task.reviewer_id <> v_actor and v_task.content_item_id is null then",
    );
    expect(mig).toContain("TASK_REQUIRES_REVIEW: việc này có người duyệt");
  });

  it("nộp duyệt: chỉ người làm, đang doing, KHÔNG nội dung, có reviewer riêng", () => {
    const fn = mig.slice(mig.indexOf("mkt_submit_task_for_approval"));
    expect(fn).toContain("NOT_ASSIGNEE");
    expect(fn).toContain("v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'doing'");
    // Việc gắn nội dung đi đường nộp NỘI DUNG (giữ version + màn duyệt nội dung).
    expect(fn).toContain("if v_task.content_item_id is not null then raise exception 'REVIEW_TASK_REQUIRES_REVIEW_API'");
    expect(fn).toContain("việc này không có người duyệt riêng");
    expect(fn).toContain("set task_status = 'reviewing'");
  });

  it("duyệt xong / trả lại: chỉ người duyệt hoặc leader; việc gắn nội dung bị đá sang màn nội dung", () => {
    for (const name of ["mkt_approve_task_review", "mkt_return_task_review"]) {
      const fn = mig.slice(mig.indexOf(`create or replace function public.${name}`));
      expect(fn).toContain("v_task.reviewer_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')");
      expect(fn).toContain("v_task.task_status <> 'reviewing'");
      expect(fn).toContain("REVIEW_TASK_REQUIRES_REVIEW_API");
    }
    // Trả lại bắt buộc lý do; về lại doing; báo người làm.
    expect(mig).toContain("MISSING_REASON");
    expect(mig).toContain("set task_status = 'doing'");
    expect(mig).toContain("'mkt_task_review_returned'");
  });

  it("nộp lại sau khi bị trả vẫn báo được (dedupe key kèm mốc thời gian)", () => {
    expect(mig).toContain("'mkt_task_pending_review:' || p_task_id::text || ':' || to_char(now()");
  });

  it("quyền gọi hàm + notify pgrst đủ", () => {
    for (const sig of [
      "mkt_submit_task_for_approval(uuid)",
      "mkt_approve_task_review(uuid)",
      "mkt_return_task_review(uuid, text)",
      "mkt_mark_task_done(uuid)",
    ]) {
      expect(mig).toContain(`revoke all on function public.${sig} from public, anon;`);
      expect(mig).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
    expect(mig).toContain("notify pgrst, 'reload schema';");
  });
});

describe("00197 — API + read-model", () => {
  it("2 mã lỗi mới có trong bảng dịch", () => {
    expect(api).toContain("TASK_REQUIRES_REVIEW: 400");
    expect(api).toContain("TASK_REVIEW_VALIDATION: 400");
  });

  it("route có đủ 3 hành động mới", () => {
    expect(actionRoute).toContain('"submit-approval": { rpc: "mkt_submit_task_for_approval"');
    expect(actionRoute).toContain('"approve-review": { rpc: "mkt_approve_task_review"');
    expect(actionRoute).toContain('"return-review"');
  });

  it("hộp 'Chờ tôi duyệt' lấy đúng: tôi là reviewer + đang reviewing", () => {
    expect(readModels).toContain("getTasksAwaitingMyReview");
    const fn = readModels.slice(readModels.indexOf("getTasksAwaitingMyReview"));
    expect(fn).toContain('.eq("reviewer_id", userId)');
    expect(fn).toContain('.eq("task_status", "reviewing")');
    // 23/07: TRƯỚC đây còn loại việc gắn bài ra khỏi hàng chờ này, khiến người
    // duyệt nội dung mở Lịch cá nhân thấy trống trơn. Nay việc gắn bài VẪN được
    // liệt kê, thẻ dẫn sang màn "Duyệt nội dung" — xem my-tasks-buckets.test.ts.
    expect(tasksPage).toContain("Mở màn duyệt nội dung");
  });
});

describe("00197 — giao diện", () => {
  it("người làm: việc có người duyệt riêng → 'Nộp duyệt', không còn Hoàn tất thẳng", () => {
    expect(taskActions).toContain(
      "Boolean(task.reviewerId) && task.reviewerId !== task.assigneeId && !task.contentItemId",
    );
    expect(taskActions).toContain('run("submit-approval")');
    // Đăng bài có người duyệt → nộp nghiệm thu sau khi đăng.
    expect(taskActions).toContain("Đã đăng — nộp nghiệm thu");
  });

  it("người duyệt: có nút Duyệt xong / Trả lại (kèm lý do bắt buộc qua ReasonDialog)", () => {
    expect(taskActions).toContain("export function ReviewTaskActions");
    expect(taskActions).toContain('run("approve-review")');
    expect(taskActions).toContain('run("return-review", { reason })');
    expect(taskActions).toContain("Trả lại việc");
  });

  it("trang Việc của tôi có hộp 'Chờ tôi duyệt' hiện tên người làm", () => {
    expect(tasksPage).toContain("getTasksAwaitingMyReview");
    expect(tasksPage).toContain("Chờ tôi duyệt");
    expect(tasksPage).toContain("reviewMode");
    expect(tasksPage).toContain("Người làm:");
  });
});
