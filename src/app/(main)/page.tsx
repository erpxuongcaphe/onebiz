"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth, useBranchFilter } from "@/lib/contexts";
import { useReportScope } from "@/lib/hooks/use-report-scope";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icon";
import OperationalSalesOverview from "./_operational-sales-overview";

const BusinessOverview = dynamic(() => import("./_business-overview"), {
  loading: () => <div role="status" className="p-4 text-sm text-muted-foreground">Đang tải tổng quan...</div>,
});

export default function DashboardPage() {
  const { isReady } = useBranchFilter();
  const { isReady: scopeReady } = useReportScope();
  const { hasPermission } = useAuth();
  const [selectedView, setSelectedView] = useState("operations");
  const canViewBusiness = hasPermission("reports.analytics")
    && hasPermission("reports.view_detail") && hasPermission("reports.view_profit");
  const view = canViewBusiness ? selectedView : "operations";

  if (!isReady || !scopeReady) return <div role="status" className="p-4 text-sm text-muted-foreground">Đang tải tổng quan...</div>;
  if (!canViewBusiness) return <OperationalSalesOverview />;
  return (
    <Tabs value={view} onValueChange={setSelectedView} className="h-full min-h-0 gap-0">
      <div className="shrink-0 border-b px-4 py-2">
        <TabsList aria-label="Góc nhìn quản trị">
          <TabsTrigger value="operations"><Icon name="point_of_sale" size={17} />Bán hàng</TabsTrigger>
          <TabsTrigger value="business"><Icon name="monitoring" size={17} />Kinh doanh</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="operations" className="min-h-0 overflow-auto">{view === "operations" && <OperationalSalesOverview />}</TabsContent>
      <TabsContent value="business" className="min-h-0 overflow-auto">{view === "business" && <BusinessOverview />}</TabsContent>
    </Tabs>
  );
}
