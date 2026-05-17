// ────────────────────────────────────────────────────────────────────────
// Stock Reconciliation Cron — /api/cron/stock-reconciliation
// ────────────────────────────────────────────────────────────────────────
// Day 4 16/05/2026 (CEO).
//
// Mục đích: Mỗi ngày 02:00 ICT (UTC+7), chạy verify_stock_invariants cho
// tất cả tenant. Nếu phát hiện DRIFT KHO (sai lệch giữa products.stock,
// branch_stock, product_lots) → tạo notification cho admin tenant + ghi
// audit_log để CEO biết.
//
// Vercel Cron: cấu hình trong `vercel.json` với schedule "0 19 * * *" UTC
// (= 02:00 ICT). Auth bằng header `Authorization: Bearer ${CRON_SECRET}`.
//
// Response:
//   200 OK — { success: true, tenantsChecked: N, driftsFound: M }
//   401 Unauthorized — nếu thiếu/sai CRON_SECRET
//   500 — nếu RPC fail

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface InvariantViolation {
  product_id?: string;
  branch_id?: string;
  code?: string;
  product_code?: string;
  name?: string;
  product_name?: string;
  drift: number;
}

interface VerifyResult {
  verified_at: string;
  tenant_id: string;
  tolerance: number;
  all_ok: boolean;
  invariant_1: {
    description: string;
    violations_count: number;
    violations: InvariantViolation[];
  };
  invariant_2: {
    description: string;
    violations_count: number;
    violations: InvariantViolation[];
  };
  invariant_3: {
    description: string;
    violations_count: number;
    violations: InvariantViolation[];
  };
}

export async function GET(req: NextRequest) {
  // Auth: Vercel Cron gửi header `Authorization: Bearer ${CRON_SECRET}`
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Service-role client (cron không có user JWT, cần bypass RLS để check tất cả tenant)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // Lấy danh sách tenant
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name");

    if (tenantErr) {
      return NextResponse.json(
        { success: false, error: tenantErr.message },
        { status: 500 },
      );
    }

    if (!tenants || tenants.length === 0) {
      return NextResponse.json({
        success: true,
        tenantsChecked: 0,
        driftsFound: 0,
        message: "Không có tenant nào để check.",
      });
    }

    let totalDrifts = 0;
    const driftTenants: { tenantId: string; tenantName: string; drifts: number }[] = [];

    for (const tenant of tenants) {
      // Verify invariants cho tenant này
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "verify_stock_invariants",
        { p_tenant_id: tenant.id, p_tolerance: 0.01 },
      );

      if (error || !data) {
        console.error(
          `[stock-reconciliation] tenant ${tenant.id} (${tenant.name}) verify lỗi:`,
          error,
        );
        continue;
      }

      const result = data as VerifyResult;
      if (result.all_ok) {
        continue;
      }

      const driftCount =
        (result.invariant_1?.violations_count ?? 0) +
        (result.invariant_2?.violations_count ?? 0) +
        (result.invariant_3?.violations_count ?? 0);

      totalDrifts += driftCount;
      driftTenants.push({
        tenantId: tenant.id,
        tenantName: tenant.name ?? "",
        drifts: driftCount,
      });

      // Thông báo cho tất cả admin của tenant (role='admin' hoặc role='owner')
      const { data: admins } = await supabase
        .from("profiles")
        .select("id")
        .eq("tenant_id", tenant.id)
        .in("role", ["admin", "owner"]);

      if (admins && admins.length > 0) {
        const sampleViolations = [
          ...(result.invariant_1?.violations ?? []).slice(0, 3),
          ...(result.invariant_2?.violations ?? []).slice(0, 3),
          ...(result.invariant_3?.violations ?? []).slice(0, 3),
        ];
        const description = `Phát hiện ${driftCount} sản phẩm/chi nhánh có sai lệch tồn kho. Top: ${sampleViolations
          .map(
            (v) =>
              `${v.code || v.product_code || v.product_id} (lệch ${v.drift.toFixed(2)})`,
          )
          .join(", ")}. Vào trang "Toàn vẹn kho" để xem chi tiết.`;

        const notifications = admins.map((admin) => ({
          tenant_id: tenant.id,
          user_id: admin.id,
          type: "stock_drift",
          title: `⚠️ Drift kho phát hiện (${driftCount} mục)`,
          description,
          reference_type: "stock_reconciliation",
          reference_id: null as string | null,
        }));

        await supabase.from("notifications").insert(notifications);
      }

      // Ghi audit_log
      await supabase.from("audit_log").insert({
        tenant_id: tenant.id,
        user_id: "00000000-0000-0000-0000-000000000000",
        action: "stock_drift_detected",
        entity_type: "stock_reconciliation",
        entity_id: null,
        new_data: {
          verified_at: result.verified_at,
          invariant_1_count: result.invariant_1?.violations_count ?? 0,
          invariant_2_count: result.invariant_2?.violations_count ?? 0,
          invariant_3_count: result.invariant_3?.violations_count ?? 0,
          total_drifts: driftCount,
        },
      });
    }

    return NextResponse.json({
      success: true,
      tenantsChecked: tenants.length,
      driftsFound: totalDrifts,
      driftTenants,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[stock-reconciliation] exception:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
