/**
 * n8n Webhook endpoint — nhận task do agent tạo.
 *
 * n8n agent sau khi phân tích KPI sẽ POST về endpoint này để tạo task
 * cho nhân sự. Có API key auth (header `x-api-key` so với env).
 *
 * Body JSON:
 * {
 *   "tenant_id": "uuid",
 *   "agent_code": "hr",            // agent code (ceo/hr/marketing/...)
 *   "tasks": [
 *     {
 *       "task_date": "2026-04-18",
 *       "title": "Phục vụ 50 đơn hôm nay",
 *       "description": "...",
 *       "priority": "high",
 *       "assigned_to_role": "cashier-branch-A",
 *       "assigned_to_user_id": null,   // optional
 *       "branch_id": null,             // optional
 *       "target_metric": "50 đơn",
 *       "kpi_breakdown_id": null,      // optional
 *       "due_time": "18:00"            // optional
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

function toJson(v: unknown): Json {
  return v as Json;
}

export async function POST(req: NextRequest) {
  // ─── API key auth ───
  const apiKey = req.headers.get("x-api-key");
  const expected = process.env.N8N_WEBHOOK_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "Server chưa cấu hình N8N_WEBHOOK_API_KEY" },
      { status: 500 },
    );
  }
  if (apiKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    tenant_id?: string;
    agent_code?: string;
    tasks?: Array<{
      task_date: string;
      title: string;
      description?: string;
      priority?: "low" | "normal" | "high" | "urgent";
      status?: "pending" | "in_progress" | "done" | "skipped" | "blocked";
      assigned_to_user_id?: string;
      assigned_to_role?: string;
      branch_id?: string;
      target_metric?: string;
      kpi_breakdown_id?: string;
      due_time?: string;
      metadata?: Record<string, unknown>;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.tenant_id) {
    return NextResponse.json(
      { error: "Thiếu tenant_id" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    return NextResponse.json(
      { error: "Thiếu tasks (mảng)" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  // Resolve agent_id từ agent_code
  let agentId: string | null = null;
  if (body.agent_code) {
    const { data: agent } = await supabase
      .from("agents")
      .select("id")
      .eq("tenant_id", body.tenant_id)
      .eq("code", body.agent_code)
      .maybeSingle();
    agentId = agent?.id ?? null;
  }

  const rows = body.tasks.map((t) => ({
    tenant_id: body.tenant_id!,
    agent_id: agentId,
    kpi_breakdown_id: t.kpi_breakdown_id ?? null,
    task_date: t.task_date,
    title: t.title,
    description: t.description ?? null,
    priority: t.priority ?? "normal",
    status: t.status ?? "pending",
    assigned_to_user_id: t.assigned_to_user_id ?? null,
    assigned_to_role: t.assigned_to_role ?? null,
    branch_id: t.branch_id ?? null,
    target_metric: t.target_metric ?? null,
    due_time: t.due_time ?? null,
    metadata: toJson(t.metadata ?? {}),
  }));

  const { data, error } = await supabase
    .from("agent_tasks")
    .insert(rows)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 },
    );
  }

  // Log execution
  if (agentId) {
    await supabase.from("agent_executions").insert({
      tenant_id: body.tenant_id,
      agent_id: agentId,
      trigger_source: "n8n",
      status: "success",
      input_data: toJson(body),
      output_data: toJson({ created: data?.length ?? 0 }),
      completed_at: new Date().toISOString(),
    });
    await supabase
      .from("agents")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", agentId);
  }

  return NextResponse.json({
    ok: true,
    created: data?.length ?? 0,
    ids: data?.map((r) => r.id) ?? [],
  });
}

export async function GET() {
  return NextResponse.json({ service: "n8n-agent-task-webhook", ok: true });
}
