/**
 * n8n Webhook endpoint — nhận KPI breakdown do CEO/HR agent tạo.
 *
 * Body JSON:
 * {
 *   "tenant_id": "uuid",
 *   "agent_code": "ceo",
 *   "kpis": [
 *     {
 *       "parent_id": null,
 *       "kpi_name": "Doanh thu tháng 4/2026",
 *       "kpi_type": "revenue",
 *       "period": "monthly",
 *       "period_start": "2026-04-01",
 *       "period_end": "2026-04-30",
 *       "target_value": 500000000,
 *       "unit": "VND",
 *       "owner_role": "ceo",
 *       "branch_id": null
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
    kpis?: Array<{
      parent_id?: string;
      kpi_name: string;
      kpi_type:
        | "revenue"
        | "orders"
        | "customers"
        | "profit"
        | "inventory"
        | "tasks"
        | "custom";
      period: "yearly" | "quarterly" | "monthly" | "weekly" | "daily";
      period_start: string;
      period_end: string;
      target_value: number;
      actual_value?: number;
      unit?: string;
      owner_role?: string;
      owner_user_id?: string;
      branch_id?: string;
      metadata?: Record<string, unknown>;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.tenant_id) {
    return NextResponse.json({ error: "Thiếu tenant_id" }, { status: 400 });
  }
  if (!Array.isArray(body.kpis) || body.kpis.length === 0) {
    return NextResponse.json(
      { error: "Thiếu kpis (mảng)" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  // Resolve agent id (source_agent_id để link KPI về agent tạo ra)
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

  const rows = body.kpis.map((k) => ({
    tenant_id: body.tenant_id!,
    parent_id: k.parent_id ?? null,
    kpi_name: k.kpi_name,
    kpi_type: k.kpi_type,
    period: k.period,
    period_start: k.period_start,
    period_end: k.period_end,
    target_value: k.target_value,
    actual_value: k.actual_value ?? 0,
    unit: k.unit ?? null,
    owner_role: k.owner_role ?? null,
    owner_user_id: k.owner_user_id ?? null,
    branch_id: k.branch_id ?? null,
    source_agent_id: agentId,
    metadata: toJson(k.metadata ?? {}),
  }));

  const { data, error } = await supabase
    .from("kpi_breakdowns")
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
  return NextResponse.json({ service: "n8n-agent-kpi-webhook", ok: true });
}
