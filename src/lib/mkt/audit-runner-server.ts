import {
  MKT_AUDIT_SCENARIOS,
  type MktAuditRun,
  type MktAuditScenarioKey,
} from "@/lib/mkt/audit-runner";
import type { MktDatabaseClient } from "@/lib/mkt/supabase";

type ResultRow = {
  scenario_key: string;
  expected: string;
  actual: string;
  error_code: string | null;
  audit_recorded: boolean;
  result: "PASS" | "FAIL" | "ERROR";
  duration_ms: number;
};

type RunRow = {
  id: string;
  status: "running" | "completed" | "failed";
  total_count: number;
  passed_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
};

export class MktAuditRunnerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MktAuditRunnerError";
  }
}

export function resolveMktAuditScenarioKeys(
  requested?: readonly string[],
): MktAuditScenarioKey[] {
  const allKeys = MKT_AUDIT_SCENARIOS.map((scenario) => scenario.key);
  if (!requested || requested.length === 0) return [...allKeys];

  const unique = Array.from(new Set(requested));
  const valid = new Set<string>(allKeys);
  if (unique.some((key) => !valid.has(key))) {
    throw new MktAuditRunnerError(
      "INVALID_STATE",
      "Danh sách kịch bản kiểm tra không hợp lệ.",
    );
  }
  return unique as MktAuditScenarioKey[];
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

async function readResults(
  db: MktDatabaseClient,
  runId: string,
): Promise<ResultRow[]> {
  const { data, error } = await db
    .from<ResultRow>("mkt_audit_results")
    .select(
      "scenario_key, expected, actual, error_code, audit_recorded, result, duration_ms",
    )
    .eq("run_id", runId)
    .order("scenario_key", { ascending: true });
  if (error) {
    throw new MktAuditRunnerError("AUDIT_READ_FAILED", error.message);
  }
  return data ?? [];
}

function mapRun(row: RunRow, results: ResultRow[]): MktAuditRun {
  return {
    id: row.id,
    status: row.status,
    totalCount: row.total_count,
    passedCount: row.passed_count,
    failedCount: row.failed_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    results: mapResults(results),
  };
}

export async function readLatestMktAuditRun(params: {
  db: MktDatabaseClient;
  ownerTenantId?: string;
  accessTokenId?: string;
}): Promise<MktAuditRun | null> {
  let query = params.db
    .from<RunRow>("mkt_audit_runs")
    .select(
      "id, status, total_count, passed_count, failed_count, started_at, completed_at",
    );
  if (params.accessTokenId) {
    query = query.eq("access_token_id", params.accessTokenId);
  } else if (params.ownerTenantId) {
    query = query.eq("owner_tenant_id", params.ownerTenantId);
  } else {
    throw new MktAuditRunnerError("AUDIT_READ_FAILED", "Thiếu phạm vi đọc kết quả.");
  }

  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new MktAuditRunnerError("AUDIT_READ_FAILED", error.message);
  }
  const run = data?.[0];
  if (!run) return null;
  return mapRun(run, await readResults(params.db, run.id));
}

export async function executeMktAuditRun(params: {
  db: MktDatabaseClient;
  ownerTenantId: string;
  sandboxId: string;
  requestedBy: string;
  scenarioKeys: MktAuditScenarioKey[];
  accessTokenId?: string;
  claimedRun?: { id: string; startedAt: string };
}): Promise<MktAuditRun> {
  const { data: sandbox, error: sandboxError } = await params.db
    .from<{ id: string; sandbox_tenant_id: string; is_enabled: boolean }>(
      "mkt_audit_sandboxes",
    )
    .select("id, sandbox_tenant_id, is_enabled")
    .eq("id", params.sandboxId)
    .eq("owner_tenant_id", params.ownerTenantId)
    .maybeSingle();
  if (sandboxError || !sandbox?.is_enabled) {
    throw new MktAuditRunnerError(
      "AUDIT_SANDBOX_NOT_READY",
      "Môi trường thử nghiệm chưa sẵn sàng.",
    );
  }

  const { data: actors, error: actorError } = await params.db
    .from<{ actor_key: string }>("mkt_audit_actors")
    .select("actor_key")
    .eq("sandbox_id", params.sandboxId);
  if (actorError || (actors ?? []).length !== 5) {
    throw new MktAuditRunnerError(
      "AUDIT_SANDBOX_INCOMPLETE",
      "Môi trường thử nghiệm chưa đủ người dùng giả.",
    );
  }

  let run = params.claimedRun
    ? { id: params.claimedRun.id, started_at: params.claimedRun.startedAt }
    : null;

  if (!run) {
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    await params.db
      .from("mkt_audit_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("sandbox_id", params.sandboxId)
      .eq("status", "running")
      .lte("started_at", staleBefore);

    const { data, error } = await params.db
      .from<{ id: string; started_at: string }>("mkt_audit_runs")
      .insert({
        owner_tenant_id: params.ownerTenantId,
        sandbox_id: params.sandboxId,
        requested_by: params.requestedBy,
        access_token_id: params.accessTokenId ?? null,
        status: "running",
        total_count: params.scenarioKeys.length,
      })
      .select("id, started_at")
      .single();
    if (error || !data) {
      const concurrent = error?.code === "23505";
      throw new MktAuditRunnerError(
        concurrent ? "AUDIT_ALREADY_RUNNING" : "AUDIT_RUN_FAILED",
        concurrent
          ? "Một lượt kiểm tra khác đang chạy. Vui lòng chờ hoàn tất."
          : error?.message ?? "Không thể tạo lượt kiểm tra.",
      );
    }
    run = data;
  }

  for (const scenarioKey of params.scenarioKeys) {
    const execution = await params.db.rpc("mkt_audit_execute_scenario", {
      p_run_id: run.id,
      p_scenario_key: scenarioKey,
    });
    if (!execution.error) continue;

    const scenario = MKT_AUDIT_SCENARIOS.find((item) => item.key === scenarioKey);
    await params.db.from("mkt_audit_results").upsert(
      {
        run_id: run.id,
        scenario_key: scenarioKey,
        expected: scenario?.expected ?? "Scenario execution",
        actual: "Runner error: " + execution.error.message,
        error_code: execution.error.code ?? "AUDIT_SCENARIO_FAILED",
        audit_recorded: false,
        result: "ERROR",
        duration_ms: 0,
      },
      { onConflict: "run_id,scenario_key" },
    );
  }

  let resultRows: ResultRow[] = [];
  let readError: MktAuditRunnerError | null = null;
  try {
    resultRows = await readResults(params.db, run.id);
  } catch (error) {
    readError = error instanceof MktAuditRunnerError
      ? error
      : new MktAuditRunnerError("AUDIT_READ_FAILED", "Không thể đọc kết quả.");
  }

  const passedCount = resultRows.filter((row) => row.result === "PASS").length;
  const failedCount = resultRows.length - passedCount;
  const completedAt = new Date().toISOString();
  const status = readError || resultRows.length !== params.scenarioKeys.length
    ? "failed"
    : "completed";

  await params.db
    .from("mkt_audit_runs")
    .update({
      status,
      passed_count: passedCount,
      failed_count: failedCount,
      completed_at: completedAt,
    })
    .eq("id", run.id);

  if (readError) throw readError;

  return {
    id: run.id,
    status,
    totalCount: params.scenarioKeys.length,
    passedCount,
    failedCount,
    startedAt: run.started_at,
    completedAt,
    results: mapResults(resultRows),
  };
}