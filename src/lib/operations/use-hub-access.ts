"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
export function useHubAccess() {
  const { user, hasPermission, isLoading } = useAuth();
  const permission = !isLoading && hasPermission(PERMISSIONS.OPS_VIEW);
  const [grant, setGrant] = useState<{ userId: string; allowed: boolean } | null>(null);
  const userId = user?.id;
  useEffect(() => {
    if (!permission || !userId) return;
    const controller = new AbortController();
    void fetch("/api/operations/access", { cache: "no-store", signal: controller.signal })
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (!controller.signal.aborted) setGrant({ userId, allowed: ok && body.allowed === true }); })
      .catch(() => { if (!controller.signal.aborted) setGrant({ userId, allowed: false }); });
    return () => controller.abort();
  }, [userId, permission]);
  return !!permission && !!grant && grant.userId === userId && grant.allowed;
}
