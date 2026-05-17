// ────────────────────────────────────────────────────────────────────────
// End-of-Day Summary Cron — /api/cron/end-of-day
// ────────────────────────────────────────────────────────────────────────
// Day 11 16/05/2026 (CEO).
//
// Mục đích: Hàng ngày 23:59 ICT (16:59 UTC), tổng kết doanh số ngày cho
// owner/admin từng tenant + gửi push notification (nếu user opt-in).
//
// Vercel Cron schedule: "59 16 * * *" UTC = 23:59 ICT.
// Auth: header `Authorization: Bearer ${CRON_SECRET}`.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // Lấy tất cả tenant + owner/admin user
    const { data: tenants } = await supabase.from("tenants").select("id, name");
    if (!tenants || tenants.length === 0) {
      return NextResponse.json({ success: true, tenantsProcessed: 0 });
    }

    // Tính khoảng thời gian "hôm nay" theo ICT
    const now = new Date();
    const ictOffset = 7 * 60 * 60 * 1000;
    const ictNow = new Date(now.getTime() + ictOffset);
    const ictDay = ictNow.toISOString().slice(0, 10);
    const dayStart = `${ictDay}T00:00:00+07:00`;
    const dayEnd = `${ictDay}T23:59:59+07:00`;

    let totalNotificationsSent = 0;

    for (const tenant of tenants) {
      // Tính tổng doanh thu ngày từ invoices.completed
      const { data: revenueRow } = await supabase
        .from("invoices")
        .select("total")
        .eq("tenant_id", tenant.id)
        .eq("status", "completed")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);
      const totalRevenue = (revenueRow ?? []).reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sum: number, row: any) => sum + Number(row.total ?? 0),
        0,
      );
      const orderCount = revenueRow?.length ?? 0;

      // Tính tổng thu/chi sổ quỹ ngày
      const { data: cashRows } = await supabase
        .from("cash_transactions")
        .select("type, amount")
        .eq("tenant_id", tenant.id)
        .eq("status", "completed")
        .gte("date", dayStart)
        .lte("date", dayEnd);
      let totalReceipt = 0;
      let totalPayment = 0;
      (cashRows ?? []).forEach(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (row: any) => {
          const amount = Number(row.amount ?? 0);
          if (row.type === "receipt") totalReceipt += amount;
          else if (row.type === "payment") totalPayment += amount;
        },
      );

      // Tìm owner/admin có notification_preferences.push_end_of_day=true
      const { data: admins } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("tenant_id", tenant.id)
        .in("role", ["owner", "admin"]);

      if (!admins || admins.length === 0) continue;

      // Format số (US-style: comma thousands)
      const fmt = (n: number) => n.toLocaleString("en-US");

      const title = `📊 Tổng kết ngày ${ictDay.split("-").reverse().join("/")}`;
      const description =
        `Doanh thu: ${fmt(totalRevenue)}đ (${orderCount} đơn). ` +
        `Sổ quỹ: thu ${fmt(totalReceipt)}đ, chi ${fmt(totalPayment)}đ. ` +
        `Vào trang Báo cáo cuối ngày để xem chi tiết.`;

      // Insert notification cho mỗi admin
      const notifications = admins.map((a) => ({
        tenant_id: tenant.id,
        user_id: a.id,
        type: "end_of_day_summary",
        title,
        description,
        reference_type: "daily_summary",
        reference_id: null as string | null,
      }));

      await supabase.from("notifications").insert(notifications);
      totalNotificationsSent += notifications.length;

      // TODO Day 12: gửi push thật qua web-push library (cần VAPID keys).
      // Hiện chỉ ghi notification để user vào trang Thông báo xem.
    }

    return NextResponse.json({
      success: true,
      tenantsProcessed: tenants.length,
      notificationsSent: totalNotificationsSent,
      day: ictDay,
    });
  } catch (err) {
    console.error("[cron/end-of-day] exception:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
