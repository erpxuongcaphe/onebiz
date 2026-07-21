import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Cho làm — Ghi lại — Nhắc" (CEO 21/07): bớt rào cứng, cho làm rồi GHI LOG để
 * theo dõi. 4 nới:
 *   00220 — Nộp kế hoạch dễ thở (người làm + hạn tuỳ chọn; việc chưa giao).
 *   00221 — Cập nhật bản nộp mọi lúc (nộp lại cả khi đang duyệt).
 *   00222 — Sửa kế hoạch cả khi đang chạy (mở lại + ĐỐI SOÁT việc) + Nhật ký.
 */
const read = (p: string) => readFileSync(resolve(p), "utf8");
const mig220 = read("supabase/migrations/00220_mkt_relax_plan_submit.sql");
const mig221 = read("supabase/migrations/00221_mkt_relax_content_resubmit.sql");
const mig222 = read("supabase/migrations/00222_mkt_edit_running_plan_reconcile.sql");
const readModels = read("src/lib/mkt/read-models.ts");
const planControls = read("src/components/mkt/plan-controls.tsx");
const planningTree = read("src/components/mkt/planning-tree.tsx");
const taskActions = read("src/components/mkt/task-actions.tsx");

describe("00220 — Nộp kế hoạch: người làm + hạn TUỲ CHỌN", () => {
  it("bỏ 2 rào bắt buộc người làm + hạn (rào code đã biến mất)", () => {
    // Anchor theo CODE (comment có thể còn nhắc tên rào để giải thích).
    expect(mig220).not.toContain("if v_item.suggested_assignee_id is null then raise");
    expect(mig220).not.toContain("if v_item.due_at is null then raise");
  });
  it("người làm NẾU điền vẫn phải hợp lệ (kiểm có điều kiện)", () => {
    expect(mig220).toContain("v_item.suggested_assignee_id is not null and not exists");
    // Vẫn giữ rào tối thiểu: ≥1 công đoạn + có tên + chống vòng lặp.
    expect(mig220).toContain("cần ít nhất 1 công đoạn");
    expect(mig220).toContain("có công đoạn chưa đặt tên");
    expect(mig220).toContain("phụ thuộc vòng lặp");
  });
  it("generate: việc chưa giao → assignee null-safe + KHÔNG bắn thông báo rỗng", () => {
    expect(mig220).toContain("nullif(v_it ->> 'suggested_assignee_id', '')::uuid");
    expect(mig220).toMatch(
      /if nullif\(v_it ->> 'suggested_assignee_id', ''\) is not null then\s*\n\s*perform public\.mkt_enqueue_notification/,
    );
  });
});

describe("00221 — Cập nhật bản nộp MỌI LÚC", () => {
  it("cho nộp lại cả khi đang 'reviewing' (không chỉ 'doing')", () => {
    expect(mig221).toContain("v_task.task_status not in ('doing', 'reviewing')");
  });
  it("bỏ chặn ALREADY_PROCESSED → HẠ bản pending cũ xuống revision_required", () => {
    expect(mig221).not.toContain("raise exception 'ALREADY_PROCESSED'");
    expect(mig221).toMatch(
      /update public\.mkt_content_versions set status = 'revision_required'\s*\n\s*where content_item_id = p_content_item_id and status = 'pending'/,
    );
  });
  it("UI: nút 'Cập nhật bản nộp' thay 'Thu hồi'; bỏ gọi recall-review", () => {
    expect(taskActions).toContain("Cập nhật bản nộp");
    expect(taskActions).not.toContain('run("recall-review")');
  });
});

describe("00222 — Sửa kế hoạch cả khi đang chạy + ĐỐI SOÁT", () => {
  it("khoá công đoạn bền (channel_plan_item_key, KHÔNG khoá ngoại) + backfill + index", () => {
    expect(mig222).toContain("add column if not exists channel_plan_item_key uuid");
    expect(mig222).toContain("set channel_plan_item_key = channel_plan_item_id");
    expect(mig222).toContain("idx_mkt_tasks_plan_item_key");
  });
  it("đối soát theo key: công đoạn còn → dùng lại việc; mới → tạo; ghi key cả tạo lẫn cập nhật", () => {
    expect(mig222).toContain("where channel_plan_id = p_plan_id and channel_plan_item_key = v_item_id::uuid");
    expect(mig222).toContain("channel_plan_item_key = v_item_id::uuid"); // set khi cập nhật
    // Đổi người/điểm chỉ khi việc CHƯA bắt đầu.
    expect(mig222).toContain(
      "v_can_reassign := (v_existing.acceptance_status = 'pending' and v_existing.task_status in ('todo', 'blocked'))",
    );
    // Đếm tạo/cập nhật/huỷ vào audit → hiện ở Nhật ký.
    expect(mig222).toMatch(/'created', v_created, 'updated', v_updated,\s*\n?\s*'canceled', v_canceled/);
  });
  it("prune: công đoạn bị bỏ mà việc CHƯA bắt đầu thì huỷ; đang chạy/đã xong GIỮ", () => {
    expect(mig222).toMatch(
      /set task_status = 'canceled'[\s\S]*?not \(channel_plan_item_key = any\(v_item_ids\)\)[\s\S]*?task_status in \('todo', 'blocked'\)/,
    );
  });
  it("mở lại kế hoạch đang chạy: BỎ khoá PLAN_TASKS_IN_PROGRESS + KHÔNG huỷ sạch việc", () => {
    expect(mig222).not.toContain("raise exception 'PLAN_TASKS_IN_PROGRESS'");
    expect(mig222).toContain("active_tasks_kept");
    // Chép replace, không DROP (tránh 42P13).
    expect(mig222).not.toContain("drop function");
  });
});

describe("00222 — Nhật ký thay đổi + Việc chưa giao (UI)", () => {
  it("read-model getPlanActivity đọc audit_log theo kế hoạch (RLS tenant)", () => {
    expect(readModels).toContain("export async function getPlanActivity");
    expect(readModels).toContain('.eq("entity_type", "mkt_channel_plan")');
  });
  it("nút Nhật ký hiện trên thẻ kế hoạch + tải lười qua API activity", () => {
    expect(planControls).toContain("export function PlanActivityButton");
    expect(planControls).toContain("/activity");
    expect(planningTree).toContain("PlanActivityButton");
  });
  it("PlanReconcileButton: việc chưa giao → 'Giao người' (không cần lý do)", () => {
    expect(planControls).toContain('t.assigneeName ? "Đổi người" : "Giao người"');
    // effReason mặc định khi giao/đổi (không cần lý do) — anchor ASCII (chuỗi
    // tiếng Việt ở vùng này lưu dạng \u escape).
    expect(planControls).toContain('decision === "reassign" ? "');
  });
  it("ChangeRequestButton: bỏ câu 'chỉ khi chưa ai nhận việc' + bỏ bẫy lỗi cũ", () => {
    expect(planControls).not.toContain("Chỉ làm được khi");
    expect(planControls).not.toContain("PLAN_TASKS_IN_PROGRESS");
    expect(planControls).toContain("đang chạy / đã xong vẫn giữ nguyên");
  });
});
