import { NextResponse } from "next/server";
import { requireMktSession } from "@/lib/mkt/api";
import { getMktContext } from "@/lib/mkt/read-models";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTORS = [
  { key: "ceo", name: "Audit CEO", role: "owner" },
  { key: "leader", name: "Audit Leader", role: "owner" },
  { key: "executive", name: "Audit Executive", role: "staff" },
  { key: "reviewer", name: "Audit Reviewer", role: "owner" },
  { key: "unauthorized", name: "Audit Unauthorized", role: "staff" },
] as const;

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

export async function GET() {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId) return auth.response ?? NextResponse.json({ success: false }, { status: 401 });

  const db = getMktDatabaseClient(getAdminClient());
  const { data: sandbox, error } = await db
    .from<{
      id: string;
      sandbox_tenant_id: string;
      is_enabled: boolean;
    }>("mkt_audit_sandboxes")
    .select("id, sandbox_tenant_id, is_enabled")
    .eq("owner_tenant_id", auth.ctx.tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: "AUDIT_SETUP_FAILED", message: error.message } },
      { status: 500 },
    );
  }
  if (!sandbox?.is_enabled) return NextResponse.json({ success: true, ready: false });

  const { data: actors } = await db
    .from<{ actor_key: string }>("mkt_audit_actors")
    .select("actor_key")
    .eq("sandbox_id", sandbox.id);

  return NextResponse.json({
    success: true,
    ready: (actors ?? []).length === ACTORS.length,
    sandboxId: sandbox.id,
    sandboxTenantId: sandbox.sandbox_tenant_id,
    actorCount: (actors ?? []).length,
  });
}

export async function POST() {
  const auth = await authorize();
  if (auth.response || !auth.ctx?.tenantId || !auth.user) return auth.response ?? NextResponse.json({ success: false }, { status: 401 });

  const admin = getAdminClient();
  const db = getMktDatabaseClient(admin);
  const { data: existing } = await db
    .from<{ id: string; sandbox_tenant_id: string; is_enabled: boolean }>("mkt_audit_sandboxes")
    .select("id, sandbox_tenant_id, is_enabled")
    .eq("owner_tenant_id", auth.ctx.tenantId)
    .maybeSingle();

  if (existing) {
    const { data: actors } = await db
      .from<{ actor_key: string }>("mkt_audit_actors")
      .select("actor_key")
      .eq("sandbox_id", existing.id);
    const actorCount = (actors ?? []).length;
    return NextResponse.json({
      success: existing.is_enabled && actorCount === ACTORS.length,
      ready: existing.is_enabled && actorCount === ACTORS.length,
      sandboxId: existing.id,
      sandboxTenantId: existing.sandbox_tenant_id,
      actorCount,
      error:
        actorCount === ACTORS.length
          ? undefined
          : {
              code: "AUDIT_SANDBOX_INCOMPLETE",
              message: "M\u00f4i tr\u01b0\u1eddng th\u1eed nghi\u1ec7m ch\u01b0a \u0111\u1ee7 ng\u01b0\u1eddi d\u00f9ng gi\u1ea3.",
            },
    }, { status: actorCount === ACTORS.length ? 200 : 409 });
  }

  const suffix = crypto.randomUUID().slice(0, 8);
  let sandboxTenantId: string | null = null;
  const createdUserIds: string[] = [];

  try {
    const tenantResult = await admin
      .from("tenants")
      .insert({
        name: "[AUDIT SANDBOX] MKT Hub",
        slug: "mkt-audit-" + auth.ctx.tenantId.slice(0, 8) + "-" + suffix,
        settings: {
          is_audit_sandbox: true,
          owner_tenant_id: auth.ctx.tenantId,
          outbound_notifications_disabled: true,
        },
      })
      .select("id")
      .single();

    if (tenantResult.error || !tenantResult.data) {
      throw new Error(tenantResult.error?.message ?? "Cannot create audit tenant");
    }
    sandboxTenantId = tenantResult.data.id;

    const branchResult = await admin
      .from("branches")
      .insert({
        tenant_id: sandboxTenantId,
        name: "Audit Sandbox",
        is_default: true,
        is_active: true,
      })
      .select("id")
      .single();
    if (branchResult.error || !branchResult.data) {
      throw new Error(branchResult.error?.message ?? "Cannot create audit branch");
    }

    const actorRows: Array<{ actor_key: string; user_id: string }> = [];
    for (const actor of ACTORS) {
      const email = "mkt-audit-" + actor.key + "-" + suffix + "@onebiz.invalid";
      const created = await admin.auth.admin.createUser({
        email,
        password: crypto.randomUUID() + "Aa1!",
        email_confirm: true,
        user_metadata: {
          full_name: actor.name,
          is_mkt_audit_actor: true,
          audit_owner_tenant_id: auth.ctx.tenantId,
        },
      });
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Cannot create actor " + actor.key);
      }

      const userId = created.data.user.id;
      createdUserIds.push(userId);
      const profile = await admin.from("profiles").upsert({
        id: userId,
        tenant_id: sandboxTenantId,
        branch_id: branchResult.data.id,
        full_name: actor.name,
        email,
        role: actor.role,
        is_active: true,
      });
      if (profile.error) throw new Error(profile.error.message);
      actorRows.push({ actor_key: actor.key, user_id: userId });
    }

    const sandboxResult = await db
      .from<{ id: string }>("mkt_audit_sandboxes")
      .insert({
        owner_tenant_id: auth.ctx.tenantId,
        sandbox_tenant_id: sandboxTenantId,
        created_by: auth.user.id,
        is_enabled: true,
      })
      .select("id")
      .single();
    if (sandboxResult.error || !sandboxResult.data) {
      throw new Error(sandboxResult.error?.message ?? "Cannot register audit sandbox");
    }

    const actorsResult = await db.from("mkt_audit_actors").insert(
      actorRows.map((actor) => ({ sandbox_id: sandboxResult.data!.id, ...actor })),
    );
    if (actorsResult.error) throw new Error(actorsResult.error.message);

    return NextResponse.json({
      success: true,
      ready: true,
      sandboxId: sandboxResult.data.id,
      sandboxTenantId,
      actorCount: actorRows.length,
    });
  } catch (error) {
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    if (sandboxTenantId) {
      await admin.from("tenants").delete().eq("id", sandboxTenantId);
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUDIT_SETUP_FAILED",
          message: error instanceof Error ? error.message : "Audit setup failed",
        },
      },
      { status: 500 },
    );
  }
}
