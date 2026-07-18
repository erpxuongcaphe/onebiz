import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(resolve("supabase/migrations/00201_mkt_plan_tree_nested.sql"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const plansRoute = readFileSync(
  resolve("src/app/api/mkt/v1/campaigns/[campaignId]/plans/route.ts"),
  "utf8",
);
const cpControls = readFileSync(resolve("src/components/mkt/campaign-plan-controls.tsx"), "utf8");
const campaignControls = readFileSync(resolve("src/components/mkt/campaign-controls.tsx"), "utf8");
const campaignDetail = readFileSync(
  resolve("src/app/mkt/campaigns/[campaignId]/page.tsx"),
  "utf8",
);

/**
 * 00201 — CEO chốt lần cuối 18/07: các CẤP do NGƯỜI LÀM KẾ HOẠCH tự chia,
 * "tùy nhu cầu của từng kế hoạch nhưng tối đa 4 cấp". Kênh không còn là tầng
 * cứng — thành NHÃN tùy chọn. Bộ test khoá luật cây + các bẫy sổ tay.
 */
describe("00201 — luật cây tại DB (trần 4 cấp)", () => {
  it("cha phải là nút GỐC cùng chiến dịch → không thể lồng sâu quá cấp 3", () => {
    expect(mig).toContain("mkt_assert_campaign_plan_nesting");
    expect(mig).toMatch(
      /p\.id = new\.parent_plan_id[\s\S]{0,220}p\.campaign_id = new\.campaign_id[\s\S]{0,120}p\.parent_plan_id is null/,
    );
  });

  it("chống vòng + chống tụt cấp: tự làm cha bị chặn; nút đang có con không được xuống cấp 3", () => {
    expect(mig).toContain("new.parent_plan_id = new.id");
    expect(mig).toMatch(/c\.parent_plan_id = new\.id and c\.deleted_at is null/);
    expect(mig).toContain("đang có kế hoạch con");
  });

  it("bẫy 42P13: upsert đổi chữ ký (thêm p_parent_plan_id) → DROP chữ ký cũ + grant chữ ký mới", () => {
    expect(mig).toContain(
      "drop function if exists public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date);",
    );
    expect(mig).toContain(
      "grant execute on function public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date, uuid) to authenticated;",
    );
    // create_work_package KHÔNG đổi chữ ký lần này — không được DROP nhầm.
    expect(mig).not.toContain("drop function if exists public.mkt_create_work_package");
  });

  it("xoá một nút KHÔNG mất gì: kế hoạch con + Kế hoạch phụ nối lên nút ông", () => {
    expect(mig).toMatch(
      /set parent_plan_id = v_plan\.parent_plan_id[\s\S]{0,120}where parent_plan_id = p_id/,
    );
    expect(mig).toMatch(
      /set campaign_plan_id = v_plan\.parent_plan_id[\s\S]{0,120}where campaign_plan_id = p_id/,
    );
    // Không còn hành vi cũ 00200 (ném hết về "chưa xếp" bằng null cứng).
    expect(mig).not.toMatch(/set campaign_plan_id = null/);
  });
});

describe("00201 — read-model + API", () => {
  it("nút kế hoạch mang parentPlanId; inbox mang đường dẫn tổ tiên campaignPlanPath", () => {
    expect(readModels).toContain("parentPlanId: string | null");
    expect(readModels).toContain("campaignPlanPath: Array<{ id: string; name: string }>");
    expect(readModels).toContain("const planPathOf");
    // Nút gắn là cấp 3 → phải kéo thêm nút CHA để đường dẫn đủ 2 mắt xích.
    expect(readModels).toMatch(/parentIds[\s\S]{0,300}in\("id", parentIds\)/);
  });

  it("route plans truyền p_parent_plan_id xuống RPC", () => {
    expect(plansRoute).toContain("parentPlanId?: string");
    expect(plansRoute).toContain("p_parent_plan_id: body.parentPlanId || null");
  });
});

describe("00201 — giao diện chi tiết chiến dịch (cây lồng, kênh = nhãn)", () => {
  it("form nút kế hoạch: chọn 'Nằm trong' quyết định cấp 2 hay cấp 3; nút có con bị khoá chuyển", () => {
    expect(cpControls).toContain("Nằm trong");
    expect(cpControls).toContain("const level: 2 | 3 = parentPlanId ? 3 : 2");
    expect(cpControls).toContain("editHasChildren");
    expect(cpControls).toMatch(/rootPlans = plans\.filter\(\(p\) => !p\.parentPlanId/);
  });

  it("tab Cây kế hoạch render lồng: cấp 2 chứa cấp 3 + Kế hoạch phụ ở cả 2 mức", () => {
    expect(campaignDetail).toContain("Cây kế hoạch");
    expect(campaignDetail).toContain("childrenOf");
    expect(campaignDetail).toContain("subPlansOf");
    expect(campaignDetail).toContain("renderSubPlan");
    expect(campaignDetail).toContain("level={2}");
    expect(campaignDetail).toContain("level={3}");
  });

  it("work package = 'Kế hoạch phụ' (nơi chứa việc); kênh thành nhãn tùy chọn, mặc định không gắn", () => {
    expect(campaignControls).toContain("Thêm Kế hoạch phụ");
    expect(campaignControls).toContain("Nhãn kênh (tuỳ chọn)");
    expect(campaignControls).toContain('useState("other")');
    expect(campaignControls).toContain("— Không gắn kênh —");
    expect(campaignDetail).toContain("Nhãn kênh: {CHANNEL_LABEL[w.channelType] ?? w.channelType}");
    // Nhãn chỉ hiện khi có gắn thật.
    expect(campaignDetail).toContain('w.channelType !== "other"');
  });

  it("chọn chỗ gắn Kế hoạch phụ liệt kê đủ cấp 2 lẫn cấp 3 (thụt dòng), kèm lối 'trực thuộc Chiến dịch'", () => {
    expect(campaignControls).toContain("Chiến dịch (không qua cấp 2/3)");
    expect(campaignControls).toMatch(/optgroup[\s\S]{0,200}Cấp 2 · \$\{p\.name\}/);
    expect(campaignControls).toContain("(cấp 3)");
  });

  it("bug UAT 18/07: form tạo phải reset sạch sau khi lưu — nhãn kênh không dính sang lần sau", () => {
    // WorkPackageForm: reset nhãn kênh về "không gắn" trong khối refresh sau submit.
    expect(campaignControls).toMatch(/refresh\(\(\) => \{[\s\S]{0,400}setChannelType\("other"\)/);
    // CampaignPlanFormButton: form TẠO mở lại phải trắng (form SỬA giữ nguyên).
    expect(cpControls).toMatch(/if \(!edit\) \{[\s\S]{0,220}setName\(""\)[\s\S]{0,220}setParentPlanId\(defaultParentPlanId\)/);
  });
});
