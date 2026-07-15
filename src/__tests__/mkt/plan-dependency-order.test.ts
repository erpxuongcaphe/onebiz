import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fix = readFileSync(
  resolve("supabase/migrations/00195_mkt_task_dependency_order.sql"),
  "utf8",
);
const planControls = readFileSync(resolve("src/components/mkt/plan-controls.tsx"), "utf8");
const splitDialog = readFileSync(resolve("src/components/mkt/split-dialog.tsx"), "utf8");
const core = readFileSync(resolve("supabase/migrations/00168_mkt_hub_core.sql"), "utf8");

/**
 * Bối cảnh (15/07, rà lại toàn luồng sau 00194): lệnh sinh việc chạy từ trên
 * xuống và nối phụ thuộc NGAY lúc tạo. Nếu công đoạn 1 phụ thuộc công đoạn 2
 * (giao diện CHO PHÉP chọn "Sau: <công đoạn nằm dưới>"), lúc tạo việc 1 thì
 * việc 2 chưa tồn tại → khoá ngoại đá ra, bấm "Duyệt & sinh việc" chết.
 *
 * Rào cũ không bắt được vì mkt_submit_plan chỉ soi phụ thuộc VÒNG LẶP (1→2→1);
 * ca này 1→2, 2→không nên chuỗi kết thúc → nộp lọt, chết ở bước duyệt.
 *
 * Cách sửa: tạo hết việc trước (phụ thuộc = null), nối phụ thuộc ở lượt sau.
 */
describe("Nối phụ thuộc SAU khi tạo đủ việc — thứ tự khai báo không còn ảnh hưởng", () => {
  it("khoá ngoại phụ thuộc vẫn còn (không gỡ bừa ràng buộc để né lỗi)", () => {
    expect(core).toContain("dependency_task_id uuid references public.mkt_tasks(id)");
    expect(fix).not.toContain("drop constraint");
  });

  it("sinh việc từ kế hoạch: tạo với phụ thuộc rỗng, nối ở lượt riêng", () => {
    expect(fix).toContain("function public.mkt_generate_tasks_from_plan_internal");
    // Cách CŨ: nhét thẳng v_dep_task vào lệnh tạo, ngay sau người duyệt.
    expect(fix).not.toContain("nullif(v_it ->> 'reviewer_id', '')::uuid, v_dep_task,");
    // Cách MỚI: nối bằng lệnh cập nhật, sau khi mọi việc đã tồn tại.
    expect(fix).toContain("set dependency_task_id = v_dep_task");
  });

  it("việc có phụ thuộc VẪN bị khoá ngay từ đầu (người dùng không thấy khác gì)", () => {
    expect(fix).toContain("case when v_dep_task is null then 'todo' else 'blocked' end");
    expect(fix).toContain("case when v_dep_task is null then null else 'DEPENDENCY_BLOCKED' end");
  });

  it("Chia Task Ngay: vá cùng cái gốc để mai này thêm ô phụ thuộc là chạy đúng", () => {
    expect(fix).toContain("function public.mkt_split_work_package");
    expect(fix).toContain("set dependency_task_id = (v_link->>'dep')::uuid");
    expect(fix).toContain("case when v_dependency_id is null then 'todo' else 'blocked' end");
  });
});

/**
 * Ô "điểm khối lượng" là <input type="number"> không đặt min → bấm mũi tên
 * xuống về 0 là dính "violates check constraint ..._workload_points_check"
 * (ràng buộc workload_points > 0 có ở CẢ mkt_tasks lẫn mkt_channel_plan_items).
 */
describe("Điểm khối lượng không được 0 / âm", () => {
  it("ràng buộc > 0 vẫn giữ ở cả hai bảng", () => {
    expect(core).toContain("workload_points integer not null default 1 check (workload_points > 0)");
  });

  it("giao diện chặn từ đầu: min=1 + kẹp lại lúc gửi", () => {
    for (const src of [planControls, splitDialog]) {
      expect(src).toContain("min={1}");
      expect(src).toContain("Math.max(1, Math.floor(Number(r.workloadPoints)) || 1)");
      // Cách cũ: "0" là chuỗi khác rỗng nên lọt qua, gửi thẳng số 0 xuống.
      expect(src).not.toContain("r.workloadPoints ? Number(r.workloadPoints) : 1");
    }
  });

  it("lớp chặn thứ hai dưới hàm, cho ai gọi thẳng không qua giao diện", () => {
    expect(fix).toContain("greatest(1, coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1))");
    expect(fix).toContain("greatest(1, coalesce(nullif(v_task->>'workloadPoints', '')::integer, 1))");
  });
});
