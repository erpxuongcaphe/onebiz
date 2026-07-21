import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mig = readFileSync(resolve("supabase/migrations/00215_mkt_owner_add_subplan.sql"), "utf8");
const mig216 = readFileSync(
  resolve("supabase/migrations/00216_mkt_branch_assign_notify.sql"),
  "utf8",
);
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");
const planningTree = readFileSync(resolve("src/components/mkt/planning-tree.tsx"), "utf8");
const route = readFileSync(
  resolve("src/app/api/mkt/v1/plan-nodes/[nodeId]/subplan/route.ts"),
  "utf8",
);

/**
 * 00215 — "giao việc thì người được giao PHẢI THẤY" (CEO 19/07).
 * Trước đây gán Phụ trách cho một mảng (nút cấp 2/3) chỉ là nhãn, không tạo
 * việc, người được giao không thấy gì. Nay: họ thấy mảng trong màn Lập kế
 * hoạch (dù chưa có Kế hoạch phụ) và tự thêm Kế hoạch phụ để soạn ngay.
 */
describe("00215 — hàm để người được giao mảng tự thêm Kế hoạch phụ", () => {
  it("quyền: owner của nút HOẶC Leader/chia việc — không đòi manage_campaigns ở người được giao", () => {
    expect(mig).toContain("mkt_owner_add_subplan");
    expect(mig).toMatch(/v_node\.owner_id = v_actor\s*\n\s*or public\.user_has_permission\(v_actor, 'mkt\.manage_campaigns'\)/);
    expect(mig).toContain("mkt.split_work_packages");
  });

  it("tạo Kế hoạch phụ + plan (owner = người bấm, status planning) để soạn ngay — chép khuôn 00181", () => {
    // Work package: owner = v_actor, vào thẳng status 'planning', gắn đúng nút.
    expect(mig).toMatch(/trim\(p_title\), v_actor,\s*\n\s*'planning', v_node\.id/);
    // Channel plan: owner = v_actor (người bấm), status 'planning', version 1.
    expect(mig).toMatch(/v_wp_id, v_node\.campaign_id, v_actor, null,\s*\n\s*'planning', 1/);
  });

  it("khoá quyền gọi hàm đúng chuẩn (revoke public/anon, grant authenticated)", () => {
    expect(mig).toContain("revoke all on function public.mkt_owner_add_subplan(uuid, text, text) from public, anon");
    expect(mig).toContain("grant execute on function public.mkt_owner_add_subplan(uuid, text, text) to authenticated");
  });
});

describe("00216 — gán mảng cho ai thì BÁO người đó (Telegram)", () => {
  it("enqueue thông báo loại mkt_branch_assigned tới owner mới, đi outbox → Telegram", () => {
    expect(mig216).toContain("mkt_enqueue_notification");
    expect(mig216).toContain("'mkt_branch_assigned'");
    expect(mig216).toMatch(/v_tenant, v_notify, 'mkt_branch_assigned'/);
  });

  it("chỉ báo khi owner mới KHÁC người thao tác và (khi sửa) thật sự ĐỔI người", () => {
    // create or replace cùng chữ ký 8 tham số — KHÔNG drop (tránh 42P13 ngược).
    expect(mig216).not.toContain("drop function");
    expect(mig216).toContain("p_owner_id <> v_actor");
    expect(mig216).toContain("p_owner_id is distinct from v_old_owner");
  });
});

describe("00215 — read-model + trang + route", () => {
  it("read-model lấy chiến dịch có mảng giao cho user hiện tại", () => {
    expect(readModels).toContain("export async function getMyAssignedNodeCampaignIds");
    expect(readModels).toMatch(/\.eq\("owner_id", userId\)[\s\S]{0,60}\.is\("deleted_at", null\)/);
  });

  it("trang Lập kế hoạch kéo mảng-được-giao vào campaignIds + truyền tên chiến dịch + userId", () => {
    expect(planningPage).toContain("getMyAssignedNodeCampaignIds(supabase, userId)");
    expect(planningPage).toContain("...myNodeCampaignIds");
    expect(planningPage).toContain("campaignNames={campaignNames}");
    expect(planningPage).toContain("currentUserId={userId}");
  });

  it("route gọi đúng RPC mkt_owner_add_subplan", () => {
    expect(route).toContain("mkt_owner_add_subplan");
    expect(route).toContain("p_campaign_plan_id: nodeId");
  });
});

describe("00215 — giao diện: người được giao THẤY mảng + tự thêm việc", () => {
  it("cây gom cả chiến dịch chỉ-có-mảng (không có plan) khi không lọc", () => {
    expect(planningTree).toContain("if (!hasFilter) planNodes.forEach((n) => campaignIds.add(n.campaignId))");
    // Màn trống xét theo cây (có mảng là hiện), không xét theo plan.
    expect(planningTree).toContain("tree.length === 0 ?");
  });

  it("nút của người ĐƯỢC GIAO: badge 'Giao cho bạn' + nút tự thêm Kế hoạch phụ (RPC owner)", () => {
    expect(planningTree).toContain("const isMine = Boolean(currentUserId && nodeData?.ownerId === currentUserId)");
    expect(planningTree).toContain("Giao cho bạn");
    expect(planningTree).toContain("function OwnerAddSubplan");
    expect(planningTree).toContain("/api/mkt/v1/plan-nodes/${nodeId}/subplan");
    // Không phải Leader nhưng là người được giao thì vẫn thêm được.
    expect(planningTree).toContain(") : isMine ? (");
  });
});
