// ────────────────────────────────────────────────────────────────────────
// Health check endpoint — /api/health
// ────────────────────────────────────────────────────────────────────────
// Sprint LT-2 (CEO 04/05/2026).
//
// Mục đích:
// - Uptime monitor (UptimeRobot, Pingdom, Better Uptime…) ping endpoint
//   này mỗi 1-5 phút → nếu fail → email/SMS alert anh
// - Anh tự kiểm tra hệ thống bằng cách mở `onebiz.com.vn/api/health`
// - Load balancer (nếu sau này có) dùng để route traffic
//
// Response:
//   200 OK  — { status: "ok", db: "connected", ...metadata }
//   503 SERVICE_UNAVAILABLE — { status: "degraded", db: "error", ...err }
//
// Không cần auth — public endpoint (uptime monitor không có credential).

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Force dynamic — không cache, mỗi request check thật
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HealthResponse {
  status: "ok" | "degraded";
  db: "connected" | "error";
  timestamp: string;
  uptime?: number;
  version?: string;
  region?: string;
  error?: string;
}

const startedAt = Date.now();
let pendingProbe: Promise<boolean> | undefined;
let lastProbe: { ok: boolean; expiresAt: number } | undefined;

async function probeDatabase(): Promise<boolean> {
  if (lastProbe && Date.now() < lastProbe.expiresAt) return lastProbe.ok;
  if (pendingProbe) return pendingProbe;
  pendingProbe = (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(false); }, 5000);
      });
      // One row is sufficient. An exact table count adds work without making
      // connectivity checks more useful. Deduplicate concurrent public probes.
      const query = getAdminClient().from("tenants").select("id", { head: true })
        .limit(1).abortSignal(controller.signal);
      const ok = await Promise.race([
        deadline,
        Promise.resolve(query).then(({ error }) => !error, () => false),
      ]);
      lastProbe = { ok, expiresAt: Date.now() + (ok ? 10000 : 2000) };
      return ok;
    } catch {
      lastProbe = { ok: false, expiresAt: Date.now() + 2000 };
      return false;
    } finally { clearTimeout(timer); }
  })().finally(() => { pendingProbe = undefined; });
  return pendingProbe;
}

export async function GET() {
  const response: HealthResponse = {
    status: "ok",
    db: "connected",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    region: process.env.VERCEL_REGION ?? "local",
  };

  // Check DB connectivity — simple query
  try {
    if (!(await probeDatabase())) {
      response.status = "degraded";
      response.db = "error";
      response.error = "DATABASE_UNAVAILABLE";
      return NextResponse.json(response, { status: 503 });
    }
  } catch {
    response.status = "degraded";
    response.db = "error";
    response.error = "DATABASE_UNAVAILABLE";
    return NextResponse.json(response, { status: 503 });
  }

  return NextResponse.json(response, { status: 200 });
}
