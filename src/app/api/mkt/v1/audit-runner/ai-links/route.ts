import { type NextRequest, NextResponse } from "next/server";
import {
  createMktAuditAccessToken,
  hashMktAuditAccessToken,
} from "@/lib/mkt/audit-access";
import { requireMktSession, readJsonBody } from "@/lib/mkt/api";
import { getMktContext } from "@/lib/mkt/read-models";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { getMktHubUrl } from "@/lib/mkt/telegram";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RUNS = 3;
const ALLOWED_HOURS = new Set([1, 4, 24]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

type AccessRow = {
  id: string;
  expires_at: string;
  max_runs: number;
  used_runs: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type CreateBody = { expiresInHours?: number };
type RevokeBody = { accessId?: string };

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
            message: "Bạn chưa có quyền quản lý liên kết Audit Runner.",
          },
        },
        { status: 403, headers: NO_STORE },
      ),
    };
  }
  return { ...session, ctx };
}

function publicAccess(row: AccessRow | null) {
  if (!row) return null;
  const active = !row.revoked_at &&
    new Date(row.expires_at).getTime() > Date.now() &&
    row.used_runs < row.max_runs;
  return {
    id: row.id,
    active,
    expiresAt: row.expires_at,
    maxRuns: row.max_runs,
    usedRuns: row.used_runs,
    remainingRuns: Math.max(0, row.max_runs - row.used_runs),
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export async function GET() {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId) {
    return auth.response ?? NextResponse.json({ success: false }, { status: 401, headers: NO_STORE });
  }

  const db = getMktDatabaseClient(getAdminClient());
  const { data, error } = await db
    .from<AccessRow>("mkt_audit_access_tokens")
    .select("id, expires_at, max_runs, used_runs, last_used_at, revoked_at, created_at")
    .eq("owner_tenant_id", auth.ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    return NextResponse.json(
      { success: false, error: { code: "AI_ACCESS_READ_FAILED", message: error.message } },
      { status: 500, headers: NO_STORE },
    );
  }

  const current = (data ?? []).find((row) => publicAccess(row)?.active) ?? null;
  return NextResponse.json(
    { success: true, access: publicAccess(current) },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId || !auth.user) {
    return auth.response ?? NextResponse.json({ success: false }, { status: 401, headers: NO_STORE });
  }

  const rate = checkRateLimit(
    `mkt-audit-link:${getClientIp(request)}:${auth.user.id}`,
    { limit: 5, windowMs: 60_000 },
  );
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "Thao tác quá nhanh. Vui lòng thử lại sau." },
      },
      { status: 429, headers: NO_STORE },
    );
  }

  const body = await readJsonBody<CreateBody>(request);
  const expiresInHours = Number(body.expiresInHours ?? 4);
  if (!ALLOWED_HOURS.has(expiresInHours)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "AI_ACCESS_EXPIRY_INVALID", message: "Thời hạn liên kết không hợp lệ." },
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const db = getMktDatabaseClient(getAdminClient());
  const { data: sandbox, error: sandboxError } = await db
    .from<{ id: string; is_enabled: boolean }>("mkt_audit_sandboxes")
    .select("id, is_enabled")
    .eq("owner_tenant_id", auth.ctx.tenantId)
    .maybeSingle();
  if (sandboxError || !sandbox?.is_enabled) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUDIT_SANDBOX_NOT_READY",
          message: "Cần khởi tạo Audit Sandbox trước khi tạo liên kết.",
        },
      },
      { status: 409, headers: NO_STORE },
    );
  }

  const token = createMktAuditAccessToken();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60_000).toISOString();
  const { data, error } = await db.rpc<{ accessId?: string }>(
    "mkt_create_audit_access_token",
    {
      p_owner_tenant_id: auth.ctx.tenantId,
      p_sandbox_id: sandbox.id,
      p_created_by: auth.user.id,
      p_token_hash: hashMktAuditAccessToken(token),
      p_expires_at: expiresAt,
      p_max_runs: MAX_RUNS,
    },
  );
  if (error || !data?.accessId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "AI_ACCESS_CREATE_FAILED", message: error?.message ?? "Không thể tạo liên kết." },
      },
      { status: 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      success: true,
      access: {
        id: data.accessId,
        active: true,
        expiresAt,
        maxRuns: MAX_RUNS,
        usedRuns: 0,
        remainingRuns: MAX_RUNS,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      },
      shareUrl: getMktHubUrl(`/ai-audit/${token}`),
    },
    { headers: NO_STORE },
  );
}

export async function DELETE(request: NextRequest) {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId || !auth.user) {
    return auth.response ?? NextResponse.json({ success: false }, { status: 401, headers: NO_STORE });
  }

  const body = await readJsonBody<RevokeBody>(request);
  const accessId = typeof body.accessId === "string" ? body.accessId : "";
  if (!UUID_PATTERN.test(accessId)) {
    return NextResponse.json(
      { success: false, error: { code: "AI_ACCESS_INVALID", message: "Liên kết không hợp lệ." } },
      { status: 400, headers: NO_STORE },
    );
  }

  const db = getMktDatabaseClient(getAdminClient());
  const { error } = await db.rpc("mkt_revoke_audit_access_token", {
    p_owner_tenant_id: auth.ctx.tenantId,
    p_access_id: accessId,
    p_revoked_by: auth.user.id,
  });
  if (error) {
    return NextResponse.json(
      { success: false, error: { code: "AI_ACCESS_REVOKE_FAILED", message: error.message } },
      { status: 404, headers: NO_STORE },
    );
  }

  return NextResponse.json({ success: true, access: null }, { headers: NO_STORE });
}