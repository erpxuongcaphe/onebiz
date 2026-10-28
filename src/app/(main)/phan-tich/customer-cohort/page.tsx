"use client";

import { ReportPageHeader } from "@/components/shared/report";
import { CustomerCohortEvidencePanel } from "@/components/reports/customer-cohort-evidence-panel";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { getCustomerCohortEvidence } from "@/lib/services/supabase/customer-cohort-evidence";

export default function CustomerCohortPage() {
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisYear", defaultViewMode: "table" });
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { user, tenant, hasPermission, isLoading } = useAuth();
  const allowed = hasPermission("reports.analytics") && hasPermission("reports.view_detail");
  return <div className="h-[calc(100vh-4rem)] overflow-auto p-4 lg:p-6">
    <CustomerCohortEvidencePanel
      actorId={user?.id ?? ""} tenantId={tenant?.id ?? ""} branchId={activeBranchId ?? null} branchLabel={branchLabel}
      allowed={allowed} ready={isReady && !isLoading} canExport={hasPermission("reports.export_detail")}
      canExportView={hasPermission("reports.export")} load={getCustomerCohortEvidence}
      renderHeader={({ actions, disabled, onExportView, onExportFull }) => <ReportPageHeader
        title="Khách hàng quay lại theo tháng đầu mua" subtitle="Theo hóa đơn hoàn tất trong phạm vi báo cáo"
        preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
        hideDateRange actions={actions} exportDisabled={disabled} onExportView={onExportView} onExportFull={onExportFull}
      />}
    />
  </div>;
}
