import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/00173_mkt_hub_workflow_hardening.sql"),
  "utf8",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`function public.${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf("create or replace function public.", start + 20);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe("MKT workflow hardening migration", () => {
  it("enforces tenant consistency at the database boundary", () => {
    expect(migration).toContain("create trigger trg_%I_tenant_links");
    expect(migration).toContain("CROSS_TENANT_REFERENCE: assignee");
    expect(migration).toContain("CROSS_TENANT_REFERENCE: dependency");
    expect(migration).toContain("INVALID_SOURCE_REFERENCE");
  });

  it("only accepts tasks from pending and only completes accepted doing tasks", () => {
    const accept = functionBody("mkt_accept_task");
    expect(accept).toContain("v_task.acceptance_status <> 'pending'");
    expect(accept).toContain("raise exception 'ALREADY_PROCESSED'");
    const markDone = functionBody("mkt_mark_task_done");
    expect(markDone).toContain("v_task.acceptance_status <> 'accepted'");
    expect(markDone).toContain("v_task.task_status <> 'doing'");
    expect(markDone).toContain("mkt_complete_task_internal");
  });

  it("validates the current pending content version and unblocks via normal completion", () => {
    const review = functionBody("mkt_review_content");
    expect(review).toContain("v_content.content_status <> 'pending_review'");
    expect(review).toContain("version_number = v_content.current_version");
    expect(review).toContain("status = 'pending'");
    expect(review).toContain("mkt_complete_task_internal");
    expect(review).toContain("task_status = 'doing'");
    expect(review).toContain("v_required_role in ('ceo', 'owner')");
    expect(review).toContain("risk_level in ('high', 'critical')");
  });

  it("claims outbox rows with skip locked and deduplicates Telegram updates", () => {
    expect(functionBody("mkt_claim_outbox_events")).toContain(
      "for update skip locked",
    );
    expect(migration).toContain("update_id bigint primary key");
    expect(functionBody("mkt_consume_telegram_link_token")).toContain(
      "on conflict (update_id) do nothing",
    );
  });

  it("keeps internal helpers unavailable to authenticated clients", () => {
    expect(migration).toContain(
      "revoke all on function public.mkt_complete_task_internal",
    );
    expect(migration).toContain(
      "revoke all on function public.mkt_claim_outbox_events(integer, uuid) from public, anon, authenticated",
    );
  });
});
