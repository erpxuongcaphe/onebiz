import { type NextRequest, NextResponse } from "next/server";
import {
  hashMktAuditAccessToken,
  MKT_AUDIT_PUBLIC_HEADERS,
  readMktAuditBearerToken,
  readMktAuditRequestToken,
} from "@/lib/mkt/audit-access";
import {
  executeMktAuditRun,
  MktAuditRunnerError,
  readLatestMktAuditRun,
  resolveMktAuditScenarioKeys,
} from "@/lib/mkt/audit-runner-server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReadAccess = {
  accessId: string;
  expiresAt: string;
  maxRuns: number;
  usedRuns: number;
};

type ClaimedAccess = {
  accessId: string;
  ownerTenantId: string;
  sandboxId: string;
  sandboxTenantId: string;
  requestedBy: string;
  runId: string;
  runStartedAt: string;
  expiresAt: string;
  usedRuns: number;
  maxRuns: number;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: MKT_AUDIT_PUBLIC_HEADERS,
  });
}

function denied() {
  return json(
    {
      success: false,
      error: {
        code: "AI_ACCESS_DENIED",
        message: "Liên kết không hợp lệ, đã hết hạn hoặc đã hết lượt chạy.",
      },
    },
    403,
  );
}

async function readActiveAccess(token: string) {
  const db = getMktDatabaseClient(getAdminClient());
  const { data, error } = await db.rpc<ReadAccess>(
    "mkt_read_audit_access_token",
    { p_token_hash: hashMktAuditAccessToken(token) },
  );
  if (error || !data?.accessId) return null;
  return { db, access: data };
}

export async function GET(request: NextRequest) {
  const token = readMktAuditBearerToken(request);
  if (!token) return denied();

  const rate = checkRateLimit(`mkt-ai-audit-read:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "Quá nhiều yêu cầu. Vui lòng thử lại sau." },
      },
      429,
    );
  }

  const state = await readActiveAccess(token);
  if (!state) return denied();

  try {
    const run = await readLatestMktAuditRun({
      db: state.db,
      accessTokenId: state.access.accessId,
    });
    return json({
      success: true,
      ready: true,
      access: {
        expiresAt: state.access.expiresAt,
        maxRuns: state.access.maxRuns,
        usedRuns: state.access.usedRuns,
        remainingRuns: state.access.maxRuns - state.access.usedRuns,
      },
      run,
    });
  } catch {
    return json(
      {
        success: false,
        error: { code: "AUDIT_READ_FAILED", message: "Không thể đọc kết quả kiểm tra." },
      },
      500,
    );
  }
}

export async function POST(request: NextRequest) {
  const token = await readMktAuditRequestToken(request);
  if (!token) return denied();

  const rate = checkRateLimit(`mkt-ai-audit-run:${getClientIp(request)}`, {
    limit: 6,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "Quá nhiều yêu cầu. Vui lòng thử lại sau." },
      },
      429,
    );
  }

  const db = getMktDatabaseClient(getAdminClient());
  const { data, error } = await db.rpc<ClaimedAccess>(
    "mkt_claim_audit_access_token",
    { p_token_hash: hashMktAuditAccessToken(token) },
  );
  if (error || !data?.accessId) {
    if (error?.message.includes("AUDIT_ALREADY_RUNNING")) {
      return json(
        {
          success: false,
          error: {
            code: "AUDIT_ALREADY_RUNNING",
            message: "Một lượt kiểm tra khác đang chạy. Vui lòng chờ hoàn tất.",
          },
        },
        409,
      );
    }
    return denied();
  }

  try {
    const run = await executeMktAuditRun({
      db,
      ownerTenantId: data.ownerTenantId,
      sandboxId: data.sandboxId,
      requestedBy: data.requestedBy,
      accessTokenId: data.accessId,
      scenarioKeys: resolveMktAuditScenarioKeys(),
      claimedRun: { id: data.runId, startedAt: data.runStartedAt },
    });

    await db.from("mkt_security_events").insert({
      tenant_id: data.sandboxTenantId,
      run_id: run.id,
      actor_id: data.requestedBy,
      event_type: "mkt_audit_access_run_completed",
      entity_type: "mkt_audit_access_token",
      entity_id: data.accessId,
      details: {
        status: run.status,
        passed_count: run.passedCount,
        failed_count: run.failedCount,
      },
    });

    return json({
      success: run.status === "completed",
      access: {
        expiresAt: data.expiresAt,
        maxRuns: data.maxRuns,
        usedRuns: data.usedRuns,
        remainingRuns: Math.max(0, data.maxRuns - data.usedRuns),
      },
      run,
    }, run.status === "completed" ? 200 : 500);
  } catch (cause) {
    const code = cause instanceof MktAuditRunnerError
      ? cause.code
      : "AUDIT_RUN_FAILED";
    const message = cause instanceof MktAuditRunnerError
      ? cause.message
      : "Không thể chạy Audit Runner.";

    await db.from("mkt_security_events").insert({
      tenant_id: data.sandboxTenantId,
      actor_id: data.requestedBy,
      event_type: "mkt_audit_access_run_failed",
      entity_type: "mkt_audit_access_token",
      entity_id: data.accessId,
      reason_code: code,
      details: { message },
    });

    return json(
      { success: false, error: { code, message } },
      code === "AUDIT_ALREADY_RUNNING" ? 409 : 500,
    );
  }
}