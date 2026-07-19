import { type NextRequest, NextResponse } from "next/server";
import { requireMktSession, readJsonBody } from "@/lib/mkt/api";
import {
  executeMktAuditRun,
  MktAuditRunnerError,
  readLatestMktAuditRun,
  resolveMktAuditScenarioKeys,
} from "@/lib/mkt/audit-runner-server";
import { getMktContext } from "@/lib/mkt/read-models";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunBody = { scenarioKeys?: string[] };

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
            message: "Bạn chưa có quyền chạy Audit Runner.",
          },
        },
        { status: 403 },
      ),
    };
  }
  return { ...session, ctx };
}

function runnerErrorResponse(error: unknown) {
  if (error instanceof MktAuditRunnerError) {
    const status = error.code === "INVALID_STATE"
      ? 400
      : error.code === "AUDIT_SANDBOX_NOT_READY" ||
          error.code === "AUDIT_SANDBOX_INCOMPLETE" ||
          error.code === "AUDIT_ALREADY_RUNNING"
        ? 409
        : 500;
    return NextResponse.json(
      { success: false, error: { code: error.code, message: error.message } },
      { status },
    );
  }
  return NextResponse.json(
    {
      success: false,
      error: { code: "AUDIT_RUN_FAILED", message: "Không thể chạy Audit Runner." },
    },
    { status: 500 },
  );
}

export async function GET() {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId) {
    return auth.response ?? NextResponse.json({ success: false }, { status: 401 });
  }

  try {
    const db = getMktDatabaseClient(getAdminClient());
    const run = await readLatestMktAuditRun({
      db,
      ownerTenantId: auth.ctx.tenantId,
    });
    return NextResponse.json({ success: true, run });
  } catch (error) {
    return runnerErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId || !auth.user) {
    return auth.response ?? NextResponse.json({ success: false }, { status: 401 });
  }

  try {
    const body = await readJsonBody<RunBody>(request);
    const scenarioKeys = resolveMktAuditScenarioKeys(body.scenarioKeys);
    const db = getMktDatabaseClient(getAdminClient());
    const { data: sandbox, error } = await db
      .from<{ id: string; is_enabled: boolean }>("mkt_audit_sandboxes")
      .select("id, is_enabled")
      .eq("owner_tenant_id", auth.ctx.tenantId)
      .maybeSingle();
    if (error || !sandbox?.is_enabled) {
      throw new MktAuditRunnerError(
        "AUDIT_SANDBOX_NOT_READY",
        "Cần khởi tạo môi trường thử nghiệm trước.",
      );
    }

    const run = await executeMktAuditRun({
      db,
      ownerTenantId: auth.ctx.tenantId,
      sandboxId: sandbox.id,
      requestedBy: auth.user.id,
      scenarioKeys,
    });
    return NextResponse.json(
      { success: run.status === "completed", run },
      { status: run.status === "completed" ? 200 : 500 },
    );
  } catch (error) {
    return runnerErrorResponse(error);
  }
}