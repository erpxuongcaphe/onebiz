"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { pendingFnbCancellations } from "@/lib/services/supabase/fnb-cancel-requests";
import { Icon } from "@/components/ui/icon";

export function OtpQuickAccess() {
  const { user, hasPermission } = useAuth();
  const userId = user?.id;
  const canIssue = hasPermission(PERMISSIONS.SYSTEM_ISSUE_OTP);
  const canCancel = hasPermission(PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER);
  const [pending, setPending] = useState<{ userId: string; count: number } | null>(null);
  useEffect(() => {
    if (!canIssue || !canCancel || !userId) return;
    let active = true;
    let sequence = 0;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      const generation = ++sequence;
      try { const rows = await pendingFnbCancellations(); if (active && sequence === generation) setPending({ userId, count: rows.length }); }
      catch { if (active && sequence === generation) setPending(null); }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    document.addEventListener("visibilitychange", load);
    return () => { active = false; sequence++; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [canIssue, canCancel, userId]);
  if (!canIssue) return null;
  const count = pending?.userId === user?.id ? pending?.count ?? 0 : 0;
  return <Link href="/cap-otp" className="relative inline-flex min-h-11 items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2.5 text-sm font-semibold text-primary hover:bg-primary/20" aria-label={`Cấp OTP${count ? `, ${count} yêu cầu hủy chờ duyệt` : ""}`} title="Cấp OTP duyệt từ xa">
    <Icon name="vpn_key" size={18} /><span>Cấp OTP</span>
    {count > 0 && <span className="rounded-full bg-status-error px-1.5 text-xs text-white">{count >= 50 ? "50+" : count}</span>}
  </Link>;
}
