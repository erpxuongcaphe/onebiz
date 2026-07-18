import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(resolve("supabase/migrations/00199_mkt_plan_stages.sql"), "utf8");
const planControls = readFileSync(resolve("src/components/mkt/plan-controls.tsx"), "utf8");
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");
// 00200: cây 4 cấp + màu chuyển sang planning-tree.tsx (client component).
const planningTree = readFileSync(resolve("src/components/mkt/planning-tree.tsx"), "utf8");
const planProgress = readFileSync(resolve("src/components/mkt/plan-progress.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const itemsRoute = readFileSync(
  resolve("src/app/api/mkt/v1/plans/[planId]/items/route.ts"),
  "utf8",
);

/**
 * 00199 dựng bảng stages; 00201 chốt lại TỪ VỰNG theo CEO: cây tối đa 4 cấp
 * (Cấp 1 Chiến dịch → cấp 2 → cấp 3 tự đặt tên → KẾ HOẠCH PHỤ = work package,
 * nơi chứa việc); stages 00199 đổi tên hiển thị thành "NHÓM CÔNG ĐOẠN".
 * Phần SQL khoá theo văn bản migration 00199 (lịch sử đã chạy — chữ "kế hoạch
 * phụ" trong đó là tên cũ của stages, KHÔNG sửa file cũ). Phần giao diện khoá
 * theo từ vựng MỚI. Sửa test phải hiểu vì sao khoá tồn tại.
 */
describe("00199 — tầng SQL", () => {
  it("bẫy 42P13: mkt_save_plan_items đổi chữ ký → DROP hàm cũ + grant chữ ký mới", () => {
    expect(mig).toContain(
      "drop function if exists public.mkt_save_plan_items(uuid, jsonb, jsonb, integer);",
    );
    expect(mig).toContain(
      "grant execute on function public.mkt_save_plan_items(uuid, jsonb, jsonb, integer, jsonb) to authenticated;",
    );
  });

  it("bẫy chép nhầm bản cũ: mkt_submit_plan giữ dấu vân 00193/00196, không dựng lại luật đã gỡ", () => {
    expect(mig).toContain("BỎ (00193): không ép gắn nội dung");
    expect(mig).toContain("'strategySummary', v_plan.strategy_summary");
    expect(mig).not.toContain("cần gắn nội dung'");
    // Snapshot chốt luôn kế hoạch phụ theo phiên bản.
    expect(mig).toMatch(/'stages', coalesce\(\(select jsonb_agg/);
  });

  it("RLS bảng kế hoạch phụ theo mkt_can_read_plan — không rộng hơn tầm nhìn kế hoạch", () => {
    expect(mig).toContain('create policy "mkt_plan_stages_select"');
    expect(mig).toContain("mkt_can_read_plan(plan_id)");
    expect(mig).not.toContain("'mkt.view'");
  });

  it("chống gắn chéo: công đoạn chỉ nhận kế hoạch phụ THUỘC ĐÚNG kế hoạch (trigger DB)", () => {
    expect(mig).toContain("mkt_assert_item_stage_link");
    expect(mig).toMatch(/s\.id = new\.stage_id and s\.plan_id = new\.plan_id and s\.tenant_id = new\.tenant_id/);
  });

  it("kế hoạch phụ KHÔNG có vòng duyệt riêng (không RPC duyệt stage nào)", () => {
    expect(mig).not.toMatch(/approve[_a-z]*stage|stage[_a-z]*review/i);
  });

  it("validate tiếng Việt: kế hoạch phụ phải có tên; stageId lạ về 'chưa xếp' êm", () => {
    expect(mig).toContain("có kế hoạch phụ chưa đặt tên");
    expect(mig).toContain("if v_stage_id is not null and not (v_stage_id = any(v_stage_ids)) then");
  });

  it("báo cáo tiến độ rollup theo kế hoạch phụ, cùng luật loại việc huỷ/xoá", () => {
    expect(mig).toContain("'byStage', v_by_stage");
    expect(mig).toMatch(/t\.deleted_at is null and t\.task_status <> 'canceled'/);
  });
});

describe("00199 — API + read-model", () => {
  it("route items truyền stages xuống RPC", () => {
    expect(itemsRoute).toContain("p_stages: Array.isArray(body.stages) ? body.stages : []");
  });

  it("read-model có stages + công đoạn mang stageId", () => {
    expect(readModels).toContain("export type MktPlanStage");
    expect(readModels).toContain("mkt_channel_plan_stages");
    expect(readModels).toContain("stageId: it.stage_id");
  });
});

describe("giao diện phân tầng (00201 — thuần Việt, không nhầm tầng)", () => {
  it("dòng định vị chống lạc: Cấp 1 → [cấp 2 → cấp 3] → Kế hoạch phụ, ở cả soạn lẫn duyệt", () => {
    expect(planControls).toContain("function TierBreadcrumb");
    expect(planControls).toContain("Cấp 1: {campaignName");
    expect(planControls).toContain("Kế hoạch phụ: {channelTitle");
    // Nhánh giữa hiện đúng đường dẫn thật (campaignPlanPath), cấp nào bỏ qua thì không hiện.
    expect(planControls).toContain("planPath={plan.campaignPlanPath}");
    const uses = planControls.match(/<TierBreadcrumb/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("từ vựng 00201: hộp soạn/duyệt gọi đúng 'Kế hoạch phụ'; stages 00199 = 'nhóm công đoạn' (hết trùng tên)", () => {
    expect(planControls).toContain("Soạn Kế hoạch phụ —");
    expect(planControls).toContain("Duyệt Kế hoạch phụ —");
    expect(planControls).toContain("Thêm nhóm công đoạn");
    expect(planControls).toContain("Thêm công đoạn vào nhóm công đoạn này");
    // Không còn chữ "kế hoạch nhỏ" và không còn stages mang tên "kế hoạch phụ".
    expect(planControls).not.toContain("kế hoạch nhỏ");
    expect(planControls).not.toContain("Kế hoạch phụ {si + 1}");
  });

  it("hệ màu phân tầng: cấp 1 tím · cấp 2 cam · cấp 3 xanh dương · Kế hoạch phụ xanh lá", () => {
    expect(planControls).toContain("bg-indigo-50");
    expect(planControls).toContain("bg-orange-50");
    expect(planControls).toContain("bg-sky-50");
    expect(planControls).toContain("bg-emerald-50");
    expect(planningTree).toContain("border-l-indigo-500");
    expect(planningTree).toContain("border-l-orange-500");
    expect(planningTree).toContain("border-l-sky-500");
    expect(planningTree).toContain("border-l-emerald-500");
  });

  it("bỏ nhóm công đoạn KHÔNG mất công đoạn — về nhóm chưa xếp", () => {
    expect(planControls).toContain("function removeStage");
    expect(planControls).toMatch(/r\.stageId === id \? \{ \.\.\.r, stageId: "" \}/);
    expect(planControls).toContain("Chưa xếp nhóm công đoạn");
  });

  it("vá công đoạn theo ID, không theo vị trí (danh sách giờ hiển thị theo nhóm)", () => {
    expect(planControls).toContain("function patchById");
    expect(planControls).not.toMatch(/function patch\(idx: number/);
  });

  it("màn duyệt nhóm theo nhóm công đoạn kèm tổng điểm; nhóm trống bị nhắc", () => {
    expect(planControls).toContain("công đoạn · ");
    expect(planControls).toContain("Chưa có công đoạn nào — cân nhắc Yêu cầu sửa.");
  });

  it("màn Lập kế hoạch thành cây lồng: nhãn theo độ sâu + tổng hợp việc/ngân sách/sức khỏe xấu nhất", () => {
    expect(planningTree).toContain("Kế hoạch cấp 1 · Chiến dịch");
    expect(planningTree).toContain("Kế hoạch cấp {level}");
    expect(planningTree).toContain("việc xong");
    expect(planningTree).toContain("Ngân sách");
    expect(planningTree).toContain("HEALTH_RANK");
    expect(planningTree).toContain("nhóm công đoạn");
  });

  it("nhật ký báo cáo hiện số máy theo từng nhóm công đoạn", () => {
    expect(planProgress).toContain("byStage");
    expect(readModels).toContain("byStage?: Array<{ stageId: string; title: string;");
  });
});
