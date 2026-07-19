import { type NextRequest, NextResponse } from "next/server";
import { requireMktSession, readJsonBody } from "@/lib/mkt/api";
import { MKT_AUDIT_SCENARIOS } from "@/lib/mkt/audit-runner";
import { getMktContext } from "@/lib/mkt/read-models";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunBody = { scenarioKeys?: string[] };

type ResultRow = {
  scenario_key: string;
  expected: string;
  actual: string;
  error_code: string | null;
  audit_recorded: boolean;
  result: "PASS" | "FAIL" | "ERROR";
  duration_ms: number;
};

async function authorize() {
  const session = await requireMktSession();
  if (session.response || !session.user) return { ...session, ctx: null };
  const ctx = await getMktContext(session.supabase);
  if (!ctx.canAuditRunner || !ctx.tenantId) {
    return {
      ...session,
      ctx,
      response: NextResponse.json(
        {
          success: false,
          error: {
            code: "INSUFFICIENT_ROLE",
            message: "B\u1ea1n ch\u01b0a c\u00f3 quy\u1ec1n ch\u1ea1y Audit Runner.",
          },
        },
        { status: 403 },
      ),
    };
  }
  return { ...session, ctx };
}

function mapResults(rows: ResultRow[]) {
  return rows.map((row) => ({
    scenarioKey: row.scenario_key,
    expected: row.expected,
    actual: row.actual,
    errorCode: row.error_code,
    auditRecorded: row.audit_recorded,
    result: row.result,
    durationMs: row.duration_ms,
  }));
}

export async function GET() {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId) return auth.response ?? NextResponse.json({ success: false }, { status: 401 });

  const db = getMktDatabaseClient(getAdminClient());
  const { data: runs, error } = await db
    .from<{
      id: string;
      status: "running" | "completed" | "failed";
      total_count: number;
      passed_count: number;
      failed_count: number;
      started_at: string;
      completed_at: string | null;
    }>("mkt_audit_runs")
    .select("id, status, total_count, passed_count, failed_count, started_at, completed_at")
    .eq("owner_tenant_id", auth.ctx.tenantId)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: "AUDIT_READ_FAILED", message: error.message } },
      { status: 500 },
    );
  }
  const run = runs?.[0];
  if (!run) return NextResponse.json({ success: true, run: null });

  const { data: results, error: resultError } = await db
    .from<ResultRow>("mkt_audit_results")
    .select("scenario_key, expected, actual, error_code, audit_recorded, result, duration_ms")
    .eq("run_id", run.id)
    .order("scenario_key", { ascending: true });
  if (resultError) {
    return NextResponse.json(
      { success: false, error: { code: "AUDIT_READ_FAILED", message: resultError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    run: {
      id: run.id,
      status: run.status,
      totalCount: run.total_count,
      passedCount: run.passed_count,
      failedCount: run.failed_count,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      results: mapResults(results ?? []),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId || !auth.user) return auth.response ?? NextResponse.json({ success: false }, { status: 401 });

  const body = await readJsonBody<RunBody>(request);
  const validKeys = new Set(MKT_AUDIT_SCENARIOS.map((scenario) => scenario.key));
  const requested = Array.isArray(body.scenarioKeys) && body.scenarioKeys.length > 0
    ? Array.from(new Set(body.scenarioKeys))
    : MKT_AUDIT_SCENARIOS.map((scenario) => scenario.key);
  const scenarioKeys = requested.filter((key) => validKeys.has(key as never));

  if (scenarioKeys.length === 0 || scenarioKeys.length !== requested.length) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_STATE",
          message: "Danh s\u00e1ch k\u1ecbch b\u1ea3n ki\u1ec3m tra kh\u00f4ng h\u1ee3p l\u1ec7.",
        },
      },
      { status: 400 },
    );
  }

  const db = getMktDatabaseClient(getAdminClient());
  const { data: sandbox, error: sandboxError } = await db
    .from<{ id: string; sandbox_tenant_id: string; is_enabled: boolean }>("mkt_audit_sandboxes")
    .select("id, sandbox_tenant_id, is_enabled")
    .eq("owner_tenant_id", auth.ctx.tenantId)
    .maybeSingle();

  if (sandboxError || !sandbox?.is_enabled) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUDIT_SANDBOX_NOT_READY",
          message: "C\u1ea7n kh\u1edfi t\u1ea1o m\u00f4i tr\u01b0\u1eddng th\u1eed nghi\u1ec7m tr\u01b0\u1edbc.",
        },
      },
      { status: 409 },
    );
  }

  const { data: actors } = await db
    .from<{ actor_key: string }>("mkt_audit_actors")
    .select("actor_key")
    .eq("sandbox_id", sandbox.id);
  if ((actors ?? []).length !== 5) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUDIT_SANDBOX_INCOMPLETE",
          message: "M\u00f4i tr\u01b0\u1eddng th\u1eed nghi\u1ec7m ch\u01b0a \u0111\u1ee7 ng\u01b0\u1eddi d\u00f9ng gi\u1ea3.",
        },
      },
      { status: 409 },
    );
  }

  const { data: run, error: runError } = await db
    .from<{ id: string }>("mkt_audit_runs")
    .insert({
      owner_tenant_id: auth.ctx.tenantId,
      sandbox_id: sandbox.id,
      requested_by: auth.user.id,
      status: "running",
      total_count: scenarioKeys.length,
    })
    .select("id")
    .single();

  if (runError || !run) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "AUDIT_RUN_FAILED", message: runError?.message ?? "Cannot create audit run" },
      },
      { status: 500 },
    );
  }

  for (const scenarioKey of scenarioKeys) {
    await db.rpc("mkt_audit_execute_scenario", {
      p_run_id: run.id,
      p_scenario_key: scenarioKey,
    });
  }

  const { data: results, error: resultError } = await db
    .from<ResultRow>("mkt_audit_results")
    .select("scenario_key, expected, actual, error_code, audit_recorded, result, duration_ms")
    .eq("run_id", run.id)
    .order("scenario_key", { ascending: true });
  const resultRows = results ?? [];
  const passedCount = resultRows.filter((row) => row.result === "PASS").length;
  const failedCount = resultRows.length - passedCount;
  const status = resultError || resultRows.length !== scenarioKeys.length ? "failed" : "completed";

  await db
    .from("mkt_audit_runs")
    .update({
      status,
      passed_count: passedCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  if (resultError) {
    return NextResponse.json(
      { success: false, error: { code: "AUDIT_RUN_FAILED", message: resultError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: status === "completed",
    run: {
      id: run.id,
      status,
      totalCount: scenarioKeys.length,
      passedCount,
      failedCount,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      results: mapResults(resultRows),
    },
  }, { status: status === "completed" ? 200 : 500 });
}
