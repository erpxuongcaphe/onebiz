import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(resolve("supabase/migrations/00217_mkt_auto_content_from_plan.sql"), "utf8");
const mig218 = readFileSync(resolve("supabase/migrations/00218_mkt_auto_content_pillar.sql"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const tasksPage = readFileSync(resolve("src/app/mkt/tasks/page.tsx"), "utf8");
const taskActions = readFileSync(resolve("src/components/mkt/task-actions.tsx"), "utf8");

/**
 * 00217 — "phương án tổng thể, đúng luồng Hub" (CEO 21/07): kế hoạch duyệt
 * xong → công đoạn sản xuất TỰ SINH Bài gắn vào việc, để toàn bộ đường ray
 * Nội dung sẵn có (nộp bản+link → màn Duyệt nội dung → việc tự xong/quay về
 * → gate đăng) chạy cho MỌI việc từ kế hoạch. Đóng nốt vòng mà 00193/00194
 * chủ đích mở (không ép gắn bài trước khi lập kế hoạch).
 */
describe("00217 — SQL: sinh việc tự tạo/thừa hưởng Bài", () => {
  it("idea/shooting/editing chưa gắn bài → tự tạo bài nháp thuộc campaign + work package", () => {
    expect(mig).toMatch(/v_type in \('idea', 'shooting', 'editing'\)[\s\S]{0,250}insert into public\.mkt_content_items/);
    expect(mig).toContain("returning id into v_cid");
  });

  it("publish/review chưa gắn bài → THỪA HƯỞNG bài của công đoạn phụ thuộc (đăng đúng bài mình chờ)", () => {
    expect(mig).toMatch(/case when v_type in \('publish', 'review'\) and v_dep_item is not null/);
    expect(mig).toContain("nullif(v_cmap ->> v_dep_item, '')::uuid");
  });

  it("gắn tay qua picker được tôn trọng (ghi vào map trước, không tạo đè)", () => {
    expect(mig).toMatch(/v_cid := nullif\(v_it ->> 'content_item_id', ''\)::uuid;\s*\n\s*v_type/);
    expect(mig).toMatch(/if v_cid is null and v_type in/);
  });

  it("giữ nguyên khung 00195: 3 lượt + nối phụ thuộc lượt 3 + audit (thêm đếm bài tự sinh)", () => {
    expect(mig).toContain("Lượt 1: map plan_item_id → task uuid");
    expect(mig).toContain("Lượt 3: nối phụ thuộc");
    expect(mig).toContain("'auto_content_count', v_auto_content");
    // Cùng chữ ký → create or replace, không DROP (tránh 42P13 ngược).
    expect(mig).not.toContain("drop function");
  });

  it("backfill CHỈ việc chưa kết thúc (không dựng việc done/canceled) + publish thừa hưởng theo dependency", () => {
    expect(mig).toMatch(/task_type in \('idea', 'shooting', 'editing'\)[\s\S]{0,80}task_status not in \('done', 'canceled'\)/);
    expect(mig).toMatch(/p\.dependency_task_id = d\.id[\s\S]{0,200}d\.content_item_id is not null/);
  });
});

describe("00218 — bài tự sinh phải gắn Trụ (kẻo trigger 00189 đá MISSING_PILLAR)", () => {
  it("tra trụ mặc định (active đầu tiên) + insert bài kèm pillar_id", () => {
    expect(mig218).toMatch(/select id into v_pillar from public\.mkt_content_pillars[\s\S]{0,120}is_active and deleted_at is null/);
    expect(mig218).toContain("title, channel_type, pillar_id");
    expect(mig218).toMatch(/v_it ->> 'title', v_wp_channel, v_pillar/);
  });

  it("không có trụ nào → BỎ QUA tạo bài (giữ việc thường, không chặn duyệt) — degrade êm", () => {
    expect(mig218).toContain("and v_pillar is not null then");
    expect(mig218).toContain("if v_pillar is null then continue;");
    // Chép nguyên khung 00217, cùng chữ ký → replace, không DROP.
    expect(mig218).not.toContain("drop function");
  });
});

describe("00217 — read-model + UI: thấy đề bài, thấy bài, nộp lại được", () => {
  it("MktMyTask mang contentStatus + contentUrl (bản MỚI NHẤT — xếp version giảm dần, lấy bản gặp đầu)", () => {
    expect(readModels).toContain("contentStatus: string | null");
    expect(readModels).toContain("contentUrl: string | null");
    expect(readModels).toMatch(/mkt_content_versions[\s\S]{0,300}\.order\("version_number", \{ ascending: false \}\)/);
    expect(readModels).toContain("!contentUrl.has(v.content_item_id)");
  });

  it("thẻ việc hiện mô tả (đề bài) + trạng thái Bài + link Xem bài đã nộp", () => {
    expect(tasksPage).toContain("task.description");
    expect(tasksPage).toContain("ContentStatusBadge");
    expect(tasksPage).toContain("Xem bài đã nộp");
    expect(tasksPage).toContain('target="_blank"');
  });

  it("bài bị trả → nút nói rõ 'Nộp lại bản sửa'; đang chờ duyệt bài nói rõ là duyệt BÀI", () => {
    expect(taskActions).toContain("Nộp lại bản sửa");
    expect(taskActions).toContain('task.contentStatus === "revision_required"');
    expect(taskActions).toContain("Đang chờ duyệt bài");
  });

  it("00219: người làm THU HỒI bản đã nộp để sửa link (lúc đang chờ duyệt) — không phải chờ người duyệt trả lại", () => {
    const mig219 = readFileSync(resolve("supabase/migrations/00219_mkt_recall_task_review.sql"), "utf8");
    const route = readFileSync(
      resolve("src/app/api/mkt/v1/tasks/[taskId]/[action]/route.ts"),
      "utf8",
    );
    // RPC: chỉ người làm, chỉ khi CÒN chờ duyệt; bản pending → cần sửa (bỏ chặn nộp lại).
    expect(mig219).toContain("v_task.assignee_id <> v_actor");
    expect(mig219).toContain("v_content.content_status <> 'pending_review'");
    expect(mig219).toMatch(/status = 'revision_required'\s*\n\s*where content_item_id = v_task\.content_item_id and status = 'pending'/);
    expect(mig219).toContain("set task_status = 'doing'");
    // Route + nút.
    expect(route).toContain('"recall-review": { rpc: "mkt_recall_task_review"');
    expect(taskActions).toContain("Thu hồi để sửa");
    expect(taskActions).toContain('run("recall-review")');
  });
});
