"use client";

/**
 * DiscountAuditRetry — Day 17/05/2026 (CEO P2.B).
 *
 * Mount trong main layout, mỗi 60s retry các audit log discount fail trước.
 * Đảm bảo không miss audit khi RPC fail thoáng qua (mạng / server restart).
 */

import { useEffect } from "react";
import { retryFailedDiscountAudits } from "@/lib/services/supabase/pos-checkout";

export function DiscountAuditRetry() {
  useEffect(() => {
    // Retry ngay khi mount (tab vừa load lại)
    retryFailedDiscountAudits().catch(() => {
      /* silent */
    });

    // Retry định kỳ 60s
    const interval = setInterval(() => {
      retryFailedDiscountAudits().catch(() => {
        /* silent */
      });
    }, 60_000);

    // Retry khi mạng online lại
    const handleOnline = () => {
      retryFailedDiscountAudits().catch(() => {});
    };
    window.addEventListener("online", handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return null;
}
