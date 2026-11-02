"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import InventoryMovementV2Report from "@/components/shared/report/inventory-movement-v2-report";
import type { InventoryMovementV2Report as ReportSnapshot } from "@/lib/reports/inventory-movement-v2-contract";
import { getInventoryMovementV2Report } from "@/lib/services/supabase/inventory-movement-v2";
import { getStockReportUnits, stockUnitReferenceKey } from "@/lib/services/supabase/report-stock-units";
import { useReportState } from "@/lib/hooks/use-report-state";

type LoadedReport = {
  scope: string;
  report: ReportSnapshot | null;
  conversions?: ReadonlyMap<string, string>;
  error: string | null;
  unitsError: boolean;
};

export default function AgingReportPage() {
  const { user, tenant, permissions, hasPermission, isLoading } = useAuth();
  const { activeBranchId, isReady } = useBranchFilter();
  const { viewMode, setViewMode } = useReportState({ defaultViewMode: "table" });
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<LoadedReport | null>(null);
  const allowed = hasPermission("reports.analytics") && hasPermission("reports.view_detail");
  const branchId = activeBranchId ?? null;
  const scope = JSON.stringify([tenant?.id, user?.id, [...permissions ?? []].sort(), branchId, isLoading, isReady, allowed, revision]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requestSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++requestSequence.current;
    const current = () => !controller.signal.aborted && request === requestSequence.current && currentScope.current === scope;
    if (!isLoading && isReady && allowed && tenant?.id && user?.id) {
      void (async () => {
        try {
          const report = await getInventoryMovementV2Report({ branchId, signal: controller.signal });
          if (!current()) return;
          if (report.tenant_id !== tenant.id || report.branch_id !== branchId ||
            (branchId !== null && report.rows.some(row => row.branch_id !== branchId))) {
            throw new Error("Nguồn tồn kho không khớp phạm vi báo cáo.");
          }
          let conversions: Map<string, string> | undefined;
          let unitsError = false;
          try {
            const productIds = [...new Set(report.rows.map(row => row.product_id))];
            // current_stock conversion labels do not use count snapshots or quantities.
            const units = await getStockReportUnits(productIds.map(productId => ({ referenceId: productId, productId, actualQuantity: 0 })), "current_stock");
            if (!current()) return;
            for (const row of report.rows) {
              const expectedUnit = row.catalog_unit?.trim();
              const currentUnit = units.get(stockUnitReferenceKey(row.product_id, row.product_id))?.catalogUnit?.trim();
              if (!expectedUnit || !currentUnit || expectedUnit !== currentUnit) {
                throw new Error("ĐVT quy đổi chưa khớp dữ liệu tồn kho.");
              }
            }
            conversions = new Map(productIds.map(productId => {
              const unit = units.get(stockUnitReferenceKey(productId, productId));
              if (!unit?.currentConversion?.trim()) throw new Error("Thiếu quy đổi trong kết quả tải.");
              return [productId, unit.currentConversion];
            }));
          } catch {
            if (!current()) return;
            unitsError = true;
          }
          if (current()) setLoaded({ scope, report, conversions, error: null, unitsError });
        } catch {
          if (current()) setLoaded({ scope, report: null, error: "Không tải được dữ liệu tồn kho. Vui lòng thử lại.", unitsError: false });
        }
      })();
    }
    return () => { controller.abort(); };
  }, [scope, branchId, allowed, isLoading, isReady, tenant?.id, user?.id]);

  if (isLoading || !isReady) return <p role="status" className="p-6">Đang xác thực phạm vi báo cáo...</p>;
  if (!allowed || !tenant?.id || !user?.id) return <p role="alert" className="p-6">Chưa được cấp quyền xem báo cáo tồn kho chi tiết.</p>;
  const visible = loaded?.scope === scope ? loaded : null;
  return <>
    {visible?.unitsError && <p role="status" className="border-l-2 border-amber-400 px-4 py-2 text-sm">Chưa tải được quy đổi hiện tại. Tải lại để kiểm tra.</p>}
    <InventoryMovementV2Report key={scope} report={visible?.report ?? null} conversions={visible?.conversions}
      loading={!visible} error={visible?.error ?? null} onReload={() => setRevision(value => value + 1)}
      viewMode={viewMode} onViewModeChange={setViewMode} readScope={scope}
      canExportView={hasPermission("reports.export")} canExportFull={hasPermission("reports.export_detail")} />
  </>;
}
