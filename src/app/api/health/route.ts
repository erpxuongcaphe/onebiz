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
import { createServerClient } from "@supabase/ssr";

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
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => [],
          setAll: () => {},
        },
      },
    );

    // Lightweight query — đếm 1 row trong tenants table (luôn có ít nhất 1)
    const { error } = await supabase
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .limit(1);

    if (error) {
      response.status = "degraded";
      response.db = "error";
      response.error = error.message;
      return NextResponse.json(response, { status: 503 });
    }
  } catch (err) {
    response.status = "degraded";
    response.db = "error";
    response.error = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(response, { status: 503 });
  }

  return NextResponse.json(response, { status: 200 });
}
