import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(
  resolve("supabase/migrations/00196_mkt_plan_strategy_progress.sql"),
  "utf8",
);
const planControls = readFileSync(resolve("src/components/mkt/plan-controls.tsx"), "utf8");
const planProgress = readFileSync(resolve("src/components/mkt/plan-progress.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const api = readFileSync(resolve("src/lib/mkt/api.ts"), "utf8");
const campaignsPage = readFileSync(resolve("src/app/mkt/campaigns/page.tsx"), "utf8");
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");

/**
 * Khoá "sổ bẫy" của tính năng Chiến lược + Báo cáo tiến độ (00196).
 * Mỗi test tương ứng một bẫy đã duyệt với CEO trước khi build — sửa/di dời
 * phải hiểu vì sao khoá tồn tại, không được nới cho tiện.
 */
describe("00196 — tầng SQL", () => {
  it("bẫy #1: mkt_submit_plan chép từ 00193, KHÔNG dựng lại luật ép gắn nội dung", () => {
    // Dấu vân bản 00193 phải còn nguyên…
    expect(mig).toContain("BỎ (00193): không ép gắn nội dung");
    expect(mig).toContain("chưa có người làm");
    expect(mig).toContain("chưa có hạn");
    expect(mig).toContain("phụ thuộc vòng lặp");
    // …và câu validate cũ của 00182 tuyệt đối không quay lại.
    expect(mig).not.toContain("cần gắn nội dung' ");
    expect(mig).not.toMatch(/task_type in \('review', 'publish'\) and .*content_item_id is null/);
  });

  it("bẫy #2: có notify pgrst cuối file (không thì web không thấy hàm mới — lỗi câm)", () => {
    expect(mig).toContain("notify pgrst, 'reload schema';");
  });

  it("bẫy #3: cả 3 bảng mới đọc theo mkt_can_read_plan — không rộng hơn tầm nhìn kế hoạch", () => {
    const policies = mig.match(/mkt_can_read_plan\(plan_id\)/g) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(3);
    // Không được lỡ tay dùng quyền xem chung (sẽ lộ ngân sách/chiến lược).
    expect(mig).not.toContain("'mkt.view'");
  });

  it("bẫy #4: trigger tenant-link riêng cho 3 bảng, KHÔNG đụng hàm hardening", () => {
    expect(mig).toContain("mkt_assert_plan_metric_tenant_links");
    expect(mig).toContain("trg_mkt_plan_kpis_tenant");
    expect(mig).toContain("trg_mkt_plan_progress_reports_tenant");
    expect(mig).toContain("trg_mkt_plan_kpi_entries_tenant");
    expect(mig).not.toMatch(/function public\.mkt_assert_tenant_links\(/);
  });

  it("bẫy #5: KHÔNG khoá trùng tên KPI (tránh vết xe xoá mềm + unique tên)", () => {
    expect(mig).not.toMatch(/unique\s*\(\s*plan_id\s*,\s*name\s*\)/i);
    expect(mig).not.toMatch(/create unique index[^\n]*mkt_plan_kpis[^\n]*name/i);
  });

  it("bẫy #6/#7: mục tiêu > 0, số thực tế >= 0 — RPC chặn trước bằng tiếng Việt", () => {
    expect(mig).toContain("check (target_value > 0)");
    expect(mig).toContain("check (actual_value >= 0)");
    expect(mig).toContain("phải là số lớn hơn 0");
    expect(mig).toContain("số thực tế phải là số không âm");
    // Trống KHÁC 0: dòng bỏ trống được bỏ qua, không bị ép thành 0.
    expect(mig).toContain("if v_actual is null then continue; end if;");
  });

  it("bẫy #8: số thực tế phải gắn KPI thuộc ĐÚNG kế hoạch — RPC lẫn trigger cùng soi", () => {
    expect(mig).toContain("chỉ số không thuộc kế hoạch này");
    expect(mig).toMatch(/k\.id = new\.kpi_id and k\.tenant_id = new\.tenant_id and k\.plan_id = new\.plan_id/);
  });

  it("bẫy #9: bảng mới chỉ có policy SELECT — mọi ghi đi qua RPC definer", () => {
    expect(mig).not.toMatch(/create policy[^\n]*for (insert|update|delete)/i);
  });

  it("bẫy #10: số máy dùng NGUYÊN VĂN luật trang Báo cáo (loại huỷ/xoá; trễ = chưa done + quá hạn)", () => {
    expect(mig).toContain("deleted_at is null and task_status <> 'canceled'");
    expect(mig).toContain("task_status <> 'done' and due_at is not null and due_at < now()");
  });

  it("bẫy #11: thông báo chống gửi trùng theo mã báo cáo", () => {
    expect(mig).toContain("'mkt_plan_progress:' || v_report_id::text");
  });

  it("bẫy #12: báo cáo bất biến — không có RPC sửa, chỉ xoá mềm có audit", () => {
    expect(mig).not.toMatch(/function public\.mkt_update_plan_progress/);
    expect(mig).toContain("mkt_delete_plan_progress_report");
    expect(mig).toContain("'mkt_plan_progress_deleted'");
  });

  it("snapshot phiên bản chốt CẢ chiến lược + KPI (Leader duyệt trọn bức tranh)", () => {
    expect(mig).toContain("'strategySummary', v_plan.strategy_summary");
    expect(mig).toContain("'budgetPlanned', v_plan.budget_planned");
    expect(mig).toMatch(/'kpis', coalesce\(\(select jsonb_agg/);
  });

  it("khoá sửa chiến lược sau khi nộp — cùng guard với lưu công đoạn", () => {
    const saveStrategy = mig.slice(mig.indexOf("mkt_save_plan_strategy"));
    expect(saveStrategy).toContain("v_plan.status not in ('planning', 'revision_required')");
    expect(saveStrategy).toContain("PLAN_VERSION_CONFLICT");
  });

  it("quyền gọi hàm: revoke public/anon đủ 4 hàm; helper trigger khoá cả authenticated", () => {
    expect(mig).toContain(
      "revoke all on function public.mkt_assert_plan_metric_tenant_links() from public, anon, authenticated;",
    );
    for (const sig of [
      "mkt_save_plan_strategy(uuid, text, numeric, jsonb, integer)",
      "mkt_submit_plan(uuid, integer)",
      "mkt_submit_plan_progress(uuid, text, text, text, text, jsonb)",
      "mkt_delete_plan_progress_report(uuid, text)",
    ]) {
      expect(mig).toContain(`revoke all on function public.${sig} from public, anon;`);
      expect(mig).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
  });
});

describe("00196 — tầng API + read-model", () => {
  it("bẫy #15: 2 mã lỗi mới có trong bảng dịch (không thì user thấy lỗi thô)", () => {
    expect(api).toContain("KPI_VALIDATION_FAILED: 400");
    expect(api).toContain("PROGRESS_VALIDATION_FAILED: 400");
  });

  it("bẫy numeric-chuỗi: PostgREST trả numeric dạng chuỗi — read-model ép số một cửa", () => {
    expect(readModels).toContain("PostgREST trả numeric dạng CHUỖI");
    expect(readModels).toContain("budgetPlanned: num(p.budget_planned)");
    expect(readModels).toContain("targetValue: num(k.target_value) ?? 0");
  });

  it("bẫy #21: nhật ký báo cáo xếp MỚI NHẤT TRÊN CÙNG ngay từ truy vấn", () => {
    expect(readModels).toMatch(/mkt_plan_progress_reports[\s\S]{0,900}ascending: false/);
  });
});

describe("00196 — tầng giao diện", () => {
  it("bẫy #16: hộp soạn kế hoạch + hộp báo cáo đều chặn bấm-ra-ngoài-mất-bài", () => {
    for (const src of [planControls, planProgress]) {
      expect(src).toContain('"outside-press"');
      expect(src).toContain('"escape-key"');
      expect(src).toContain('"close-watcher"');
    }
  });

  it("bẫy #17: nút mới theo khuôn giữ-trạng-thái-tới-khi-có-dữ-liệu (useMktRefresh)", () => {
    expect(planProgress).toContain("useMktRefresh");
    expect(planProgress).toMatch(/refresh\(\(\) => \{/);
  });

  it("bẫy #18/#19: số KPI/ngân sách validate bằng regex tiếng Việt, không dính bẫy chuỗi \"0\"", () => {
    expect(planControls).toContain("phải là số lớn hơn 0");
    expect(planControls).toContain("Ngân sách dự kiến phải là số tiền");
    expect(planControls).toMatch(/\^\\d\+\(\\\.\\d\+\)\?\$/);
    expect(planProgress).toContain("phải là số không âm");
    // Trống KHÁC 0 ở phía gửi: chỉ bỏ qua khi chuỗi rỗng, không dùng truthy.
    expect(planProgress).toContain('if (raw === "") continue;');
  });

  it("bẫy #20: tiền hiển thị qua formatVnd dùng chung — hết hàm money() cục bộ", () => {
    expect(planControls).toContain('from "@/lib/mkt/format"');
    expect(campaignsPage).toContain("formatVnd");
    expect(campaignsPage).not.toContain("function money(");
  });

  it("bẫy #22: nhãn sức khỏe thuần Việt đủ dấu", () => {
    expect(planProgress).toContain("Đúng nhịp");
    expect(planProgress).toContain("Có rủi ro");
    expect(planProgress).toContain("Lệch nhịp");
  });

  it("màn duyệt của Leader hiện khối chiến lược + nhắc khi trống (Leader là hàng rào)", () => {
    expect(planControls).toContain("Đề xuất chiến lược");
    expect(planControls).toContain("Yêu cầu sửa");
    expect(planControls).toContain("chưa có đề xuất chiến lược");
  });

  it("nút báo cáo chỉ gắn cho kế hoạch đang thực thi; có nhật ký khi đã có báo cáo", () => {
    expect(planningPage).toContain('p.status === "in_execution" ? <ProgressReportButton');
    expect(planningPage).toContain("p.progressReports.length > 0");
  });
});
