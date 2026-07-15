import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/00192_mkt_deletes.sql"), "utf8");
const campaignPage = readFileSync(
  resolve("src/app/mkt/campaigns/[campaignId]/page.tsx"),
  "utf8",
);
const deleteButton = readFileSync(resolve("src/components/mkt/delete-button.tsx"), "utf8");
const api = readFileSync(resolve("src/lib/mkt/api.ts"), "utf8");
const route = (p: string) => readFileSync(resolve(`src/app/api/mkt/v1/${p}`), "utf8");

describe("MKT deletes — migration 00192", () => {
  it("xoá MỀM, không xoá cứng (giữ lịch sử, khôi phục được)", () => {
    expect(migration).toContain("set deleted_at = now()");
    for (const table of [
      "public.mkt_campaigns",
      "public.mkt_tasks",
      "public.mkt_channel_work_packages",
      "public.mkt_campaign_readiness_items",
    ]) {
      expect(migration).not.toContain(`delete from ${table}`);
    }
  });

  it("mọi RPC xoá đều check quyền + khoá theo tenant + ghi audit", () => {
    for (const fn of [
      "mkt_delete_campaign",
      "mkt_delete_work_package",
      "mkt_delete_task",
      "mkt_delete_readiness_item",
    ]) {
      expect(migration).toContain(`function public.${fn}(`);
    }
    expect(migration).toContain("'mkt.manage_campaigns'");
    expect(migration).toContain("tenant_id = v_tenant");
    expect(migration).toContain("'mkt_campaign_deleted'");
    expect(migration).toContain("'mkt_work_package_deleted'");
    expect(migration).toContain("'mkt_task_deleted'");
    expect(migration).toContain("'mkt_readiness_deleted'");
  });

  it("chặn xoá chiến dịch đang chạy", () => {
    expect(migration).toContain("CAMPAIGN_RUNNING");
    expect(migration).toContain("v_campaign.status = 'running'");
    expect(api).toContain("CAMPAIGN_RUNNING: 409");
    // Người dùng phải thấy thông báo tiếng Việt, không phải mã lỗi thô
    expect(api).toContain("Chiến dịch đang chạy nên không xoá được");
  });

  it("xoá cha thì xoá mềm luôn con — không để rác mồ côi", () => {
    // Xoá chiến dịch → task/nội dung/gói việc/sẵn sàng/kế hoạch
    expect(migration).toContain("where campaign_id = p_campaign_id");
    // Xoá gói việc → task bên trong
    expect(migration).toContain("where work_package_id = p_work_package_id");
  });

  it("xoá task thì nối lại chuỗi phụ thuộc, không để việc sau kẹt blocked", () => {
    expect(migration).toContain("dependency_task_id = v_task.dependency_task_id");
    expect(migration).toContain("'todo'");
    expect(migration).toContain("mkt_sync_work_package_status");
  });

  it("khoá quyền execute: revoke public/anon + grant authenticated", () => {
    expect(migration).toContain("revoke all on function public.mkt_delete_campaign(uuid, text) from public, anon");
    expect(migration).toContain("grant execute on function public.mkt_delete_campaign(uuid, text) to authenticated");
  });
});

describe("MKT deletes — API routes", () => {
  it("có route DELETE cho chiến dịch / gói việc / công việc / mục sẵn sàng", () => {
    expect(route("campaigns/[campaignId]/route.ts")).toContain("mkt_delete_campaign");
    expect(route("work-packages/[id]/route.ts")).toContain("mkt_delete_work_package");
    expect(route("tasks/[taskId]/route.ts")).toContain("mkt_delete_task");
    expect(route("campaigns/[campaignId]/readiness/[itemId]/route.ts")).toContain(
      "mkt_delete_readiness_item",
    );
  });

  it("mỗi route đều qua requireMktSession (không lộ cho khách vãng lai)", () => {
    for (const p of [
      "campaigns/[campaignId]/route.ts",
      "work-packages/[id]/route.ts",
      "tasks/[taskId]/route.ts",
      "campaigns/[campaignId]/readiness/[itemId]/route.ts",
    ]) {
      expect(route(p)).toContain("requireMktSession");
      expect(route(p)).toContain("export async function DELETE");
    }
  });
});

describe("MKT deletes — UI", () => {
  it("nút xoá dùng chung: hỏi xác nhận trước khi xoá", () => {
    expect(deleteButton).toContain("export function MktDeleteButton");
    expect(deleteButton).toContain("confirm(confirmMessage)");
    expect(deleteButton).toContain("mktDelete(url)");
  });

  it("chỉ người có quyền quản lý chiến dịch mới thấy nút xoá", () => {
    expect(campaignPage).toContain("<MktDeleteButton");
    expect(campaignPage).toContain("/api/mkt/v1/campaigns/${c.id}");
    expect(campaignPage).toContain("/api/mkt/v1/work-packages/${w.id}");
    expect(campaignPage).toContain("/api/mkt/v1/tasks/${t.id}");
  });

  it("xoá chiến dịch xong phải rời trang chi tiết (bản ghi không còn)", () => {
    expect(campaignPage).toContain('redirectTo="/mkt/campaigns"');
    expect(deleteButton).toContain("router.push(toMktHref(redirectTo))");
  });
});
