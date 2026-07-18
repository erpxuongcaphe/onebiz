import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(resolve("supabase/migrations/00200_mkt_campaign_plans.sql"), "utf8");
const planningTree = readFileSync(resolve("src/components/mkt/planning-tree.tsx"), "utf8");
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");
const cpControls = readFileSync(resolve("src/components/mkt/campaign-plan-controls.tsx"), "utf8");
const campaignDetail = readFileSync(resolve("src/app/mkt/campaigns/[campaignId]/page.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");

/**
 * Cây kế hoạch 4 CẤP (CEO 18/07, Hướng A): Chiến dịch(1) → Kế hoạch(2, MỚI) →
 * Kênh(3) → Kế hoạch phụ(4) → Công đoạn. Cấp 2 là tầng TỔ CHỨC, không duyệt
 * riêng. Bộ test khoá thiết kế + bẫy đã duyệt.
 */
describe("00200 — tầng SQL", () => {
  it("bẫy 42P13: mkt_create_work_package đổi chữ ký → DROP + grant chữ ký mới", () => {
    expect(mig).toContain(
      "drop function if exists public.mkt_create_work_package(uuid, text, text, text, uuid, uuid);",
    );
    expect(mig).toContain(
      "grant execute on function public.mkt_create_work_package(uuid, text, text, text, uuid, uuid, uuid) to authenticated;",
    );
  });

  it("cấp 2 KHÔNG có vòng nộp/duyệt/sinh việc riêng (chỉ upsert/delete/set-plan)", () => {
    expect(mig).not.toMatch(/submit[_a-z]*campaign_plan|approve[_a-z]*campaign_plan|campaign_plan[_a-z]*review/i);
    expect(mig).toContain("mkt_campaign_plan_upsert");
    expect(mig).toContain("mkt_campaign_plan_delete");
    expect(mig).toContain("mkt_work_package_set_campaign_plan");
  });

  it("xoá cấp 2 KHÔNG mất kênh — kênh về 'chưa xếp' (set null)", () => {
    expect(mig).toContain("on delete set null");
    expect(mig).toMatch(/set campaign_plan_id = null[\s\S]{0,80}where campaign_plan_id = p_id/);
  });

  it("chống gắn chéo: kênh chỉ nhận Kế hoạch cấp 2 THUỘC ĐÚNG chiến dịch", () => {
    expect(mig).toContain("mkt_assert_wp_campaign_plan_link");
    expect(mig).toMatch(/cp\.id = new\.campaign_plan_id[\s\S]{0,80}cp\.campaign_id = new\.campaign_id/);
  });

  it("create_work_package chép nguyên văn 00170 + chỉ thêm campaign_plan (guard đúng chiến dịch)", () => {
    expect(mig).toContain("00200: nhận Kế hoạch cấp 2 nếu thuộc ĐÚNG chiến dịch này");
    expect(mig).toContain("status, campaign_plan_id, created_by, updated_by");
  });
});

describe("00200 — read-model", () => {
  it("campaign detail có campaignPlans + workPackage.campaignPlanId", () => {
    expect(readModels).toContain("export type MktCampaignPlan");
    expect(readModels).toContain("campaignPlans: MktCampaignPlan[]");
    expect(readModels).toContain("campaignPlanId: w.campaign_plan_id");
  });

  it("plan inbox mang campaignPlanId + campaignPlanName để dựng cây 4 cấp", () => {
    expect(readModels).toContain("campaignPlanId: wpCampaignPlan.get(p.work_package_id)");
    expect(readModels).toContain("mkt_campaign_plans");
  });
});

describe("giao diện cây lồng (00201 — thuần Việt, nhãn theo độ sâu, phân tầng màu)", () => {
  it("cây tối đa 4 cấp: Kế hoạch cấp 1/2/3 theo độ sâu + Kế hoạch phụ xanh lá", () => {
    expect(planningTree).toContain("Kế hoạch cấp 1 · Chiến dịch");
    expect(planningTree).toContain("Kế hoạch cấp {level}");
    expect(planningTree).toContain("border-l-indigo-500");
    expect(planningTree).toContain("border-l-orange-500");
    expect(planningTree).toContain("border-l-sky-500");
    expect(planningTree).toContain("border-l-emerald-500");
    expect(planningPage).toContain("Kế hoạch phụ");
    expect(planningPage).toContain("tối đa 4 cấp");
  });

  it("cây lồng dựng từ campaignPlanPath: chiến dịch → cấp 2 → cấp 3; nhánh nông hiện 'Trực thuộc Chiến dịch'", () => {
    expect(planningTree).toContain("byCampaign");
    expect(planningTree).toContain("campaignPlanPath");
    expect(planningTree).toContain("type TreeNode");
    expect(planningTree).toContain("Trực thuộc Chiến dịch (không qua cấp 2/3)");
    // Tìm kiếm khớp cả tên nút cấp 2/3 trên nhánh.
    expect(planningTree).toContain("const pathNames = p.campaignPlanPath.map((n) => n.name)");
    expect(planningTree).toContain("${pathNames}");
  });

  it("đủ 4 bộ lọc: tên + khoảng ngày + người phụ trách + trạng thái, kèm Xoá lọc", () => {
    expect(planningTree).toContain("Tìm theo tên");
    expect(planningTree).toContain("Hạn từ");
    expect(planningTree).toContain("Mọi người phụ trách");
    expect(planningTree).toContain("Mọi trạng thái");
    expect(planningTree).toContain("Xoá lọc");
    // Lọc thật sự chạy trên nhiều tiêu chí.
    expect(planningTree).toContain("p.ownerId !== owner");
    expect(planningTree).toContain("p.status !== status");
  });

  it("quản lý nút cây trong chi tiết chiến dịch: thêm/sửa/xoá + chọn cha + xoá nối lên tầng trên", () => {
    expect(cpControls).toContain("CampaignPlanFormButton");
    expect(cpControls).toContain("Thêm Kế hoạch");
    expect(cpControls).toContain("thành Kế hoạch cấp 2");
    expect(cpControls).toContain("thành Kế hoạch cấp 3");
    expect(cpControls).toContain("nối lên tầng trên");
    expect(campaignDetail).toContain("CampaignPlanHeader");
    expect(campaignDetail).toContain("Trực thuộc Chiến dịch (không qua cấp 2/3)");
  });
});
