"use client";
import { useEffect } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSettings } from "@/lib/contexts/settings-context";
import { getBranchPrintState } from "@/lib/printer/branch-queue";

export function saveDevicePrintOverride(tenantId: string | undefined, branchId: string | undefined, values: Record<string, boolean>) {
  if (!tenantId || !branchId) return;
  try {
    const key = `onebiz-print-override:${tenantId}:${branchId}`;
    const old = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...old, ...values }));
  } catch { /* Private browsing may disable storage; current session still works. */ }
}

/** Apply branch defaults to every employee browser; local exceptions are scoped. */
export function BranchPrintDefaults() {
  const { tenant, currentBranch, hasPermission } = useAuth();
  const { updateSettings } = useSettings();
  const branchId = currentBranch?.id;
  const tenantId = tenant?.id;
  const allowed = hasPermission("pos_fnb.view_orders") || hasPermission("pos_fnb.send_kitchen") || hasPermission("pos_fnb.checkout") || hasPermission("system.manage_branches");
  useEffect(() => {
    updateSettings("print", { fnbBranchQueue: false });
    if (!branchId || !tenantId || !allowed) return;
    let disposed = false;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const { point } = await getBranchPrintState(branchId);
        if (disposed || request !== generation) return;
        let override: Record<string, unknown> = {};
        try { override = JSON.parse(localStorage.getItem(`onebiz-print-override:${tenantId}:${branchId}`) ?? "{}"); } catch { /* Ignore malformed preference. */ }
        const ready = Boolean(point?.enabled && point.routes.some(route => route.key === "cashier") && point.routes.some(route => route.key === "kitchen"));
        updateSettings("print", {
          fnbBranchQueue: ready && override.fnbBranchQueue !== false,
          autoPrintKitchen: typeof override.autoPrintKitchen === "boolean" ? override.autoPrintKitchen : point?.policy?.autoPrintKitchen ?? true,
          autoPrintReceipt: typeof override.autoPrintReceipt === "boolean" ? override.autoPrintReceipt : point?.policy?.autoPrintReceipt ?? false,
          receiptStyle: point?.policy?.receiptStyle ?? "standard",
          kitchenTicketStyle: point?.policy?.kitchenTicketStyle ?? "compact",
        });
      } catch { /* Never silently route a failed branch request to another branch. */ }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    window.addEventListener("focus", load);
    window.addEventListener("onebiz-branch-print-policy", load);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", load); window.removeEventListener("onebiz-branch-print-policy", load); };
  }, [branchId, tenantId, allowed, updateSettings]);
  return null;
}
