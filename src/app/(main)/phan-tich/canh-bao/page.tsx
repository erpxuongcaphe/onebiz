"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import Link from "next/link";
import { getFinancialAlerts } from "@/lib/services";
import type { FinancialAlert } from "@/lib/services/supabase/reports";
import { Icon } from "@/components/ui/icon";

const SEVERITY_CONFIG = {
  critical: {
    icon: "gpp_bad" as const,
    bg: "bg-red-50 border-red-200",
    iconColor: "text-red-600",
    badgeBg: "bg-red-100 text-red-800",
    label: "Nghiêm trọng",
  },
  warning: {
    icon: "warning" as const,
    bg: "bg-amber-50 border-amber-200",
    iconColor: "text-amber-600",
    badgeBg: "bg-amber-100 text-amber-800",
    label: "Cảnh báo",
  },
  info: {
    icon: "info" as const,
    bg: "bg-blue-50 border-blue-200",
    iconColor: "text-blue-600",
    badgeBg: "bg-blue-100 text-blue-800",
    label: "Thông tin",
  },
};

const TYPE_ICONS: Record<FinancialAlert["type"], string> = {
  overdue_debt: "attach_money",
  low_stock: "inventory_2",
  expiring_lot: "schedule",
  negative_cashflow: "trending_down",
  high_expense: "account_balance_wallet",
};

const TYPE_LABELS: Record<FinancialAlert["type"], string> = {
  overdue_debt: "Công nợ",
  low_stock: "Tồn kho",
  expiring_lot: "Hạn sử dụng",
  negative_cashflow: "Dòng tiền",
  high_expense: "Chi phí",
};

export default function CanhBaoPage() {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<FinancialAlert[]>([]);
  const [filterType, setFilterType] = useState<string>("all");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFinancialAlerts();
      setAlerts(data);
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredAlerts =
    filterType === "all"
      ? alerts
      : alerts.filter((a) => a.type === filterType);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  // Unique alert types for filter
  const alertTypes = Array.from(new Set(alerts.map((a) => a.type)));

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] items-center justify-center">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Đang kiểm tra cảnh báo...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      {/* Header */}
      <div className="border-b px-4 md:px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Icon name="warning" className="size-5 text-amber-500" />
              Cảnh báo tài chính
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Theo dõi rủi ro: công nợ, tồn kho, hạn sử dụng, dòng tiền
            </p>
          </div>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {criticalCount} nghiêm trọng
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="bg-amber-100 text-amber-800 text-xs border-amber-200">
                {warningCount} cảnh báo
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            {
              label: "Tổng cảnh báo",
              value: alerts.length,
              iconName: "warning",
              bg: "bg-gray-100",
              color: "text-gray-700",
            },
            {
              label: "Nghiêm trọng",
              value: criticalCount,
              iconName: "gpp_bad",
              bg: "bg-red-100",
              color: "text-red-700",
            },
            {
              label: "Cảnh báo",
              value: warningCount,
              iconName: "warning",
              bg: "bg-amber-100",
              color: "text-amber-700",
            },
            {
              label: "Công nợ",
              value: alerts.filter((a) => a.type === "overdue_debt").length,
              iconName: "attach_money",
              bg: "bg-primary-fixed",
              color: "text-primary",
            },
            {
              label: "Tồn kho",
              value: alerts.filter(
                (a) => a.type === "low_stock" || a.type === "expiring_lot"
              ).length,
              iconName: "inventory_2",
              bg: "bg-purple-100",
              color: "text-purple-700",
            },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl",
                      card.bg
                    )}
                  >
                    <Icon name={card.iconName} size={16} className={cn(card.color)} />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      {card.label}
                    </p>
                    <p className={cn("text-xl font-bold", card.color)}>
                      {card.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter tabs */}
        {alertTypes.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setFilterType("all")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                filterType === "all"
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              Tất cả ({alerts.length})
            </button>
            {alertTypes.map((type) => {
              const count = alerts.filter((a) => a.type === type).length;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                    filterType === type
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {TYPE_LABELS[type as FinancialAlert["type"]] ?? type} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Alert list */}
        {filteredAlerts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Icon name="check_circle" className="size-12 text-green-500 mx-auto mb-3" />
                <p className="text-lg font-semibold text-green-700">
                  Không có cảnh báo
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {filterType === "all"
                    ? "Hệ thống đang hoạt động tốt. Không phát hiện rủi ro nào."
                    : `Không có cảnh báo thuộc loại "${TYPE_LABELS[filterType as FinancialAlert["type"]] ?? filterType}".`}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => {
              const severityCfg = SEVERITY_CONFIG[alert.severity];
              const typeIconName = TYPE_ICONS[alert.type] ?? "warning";

              return (
                <Card
                  key={alert.id}
                  className={cn("border rounded-xl", severityCfg.bg)}
                >
                  <CardHeader className="pb-1 pt-3 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm mt-0.5"
                          )}
                        >
                          <Icon name={typeIconName} size={16} className={cn(severityCfg.iconColor)} />
                        </div>
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            {alert.title}
                            <Badge
                              className={cn(
                                "text-[10px] px-1.5 py-0 font-medium",
                                severityCfg.badgeBg
                              )}
                            >
                              <Icon name={severityCfg.icon} size={10} className="mr-0.5" />
                              {severityCfg.label}
                            </Badge>
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">
                            {alert.description}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={cn(
                            "text-lg font-bold",
                            alert.severity === "critical"
                              ? "text-red-700"
                              : "text-amber-700"
                          )}
                        >
                          {alert.type === "high_expense"
                            ? `${alert.value}%`
                            : alert.type === "low_stock" ||
                                alert.type === "expiring_lot"
                              ? alert.value
                              : formatCurrency(alert.value)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {alert.type === "overdue_debt"
                            ? "VND"
                            : alert.type === "low_stock"
                              ? "sản phẩm"
                              : alert.type === "expiring_lot"
                                ? "lô hàng"
                                : alert.type === "negative_cashflow"
                                  ? "VND thiếu hụt"
                                  : "% doanh thu"}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  {alert.link && (
                    <CardContent className="pt-1 pb-3 px-4">
                      <Link
                        href={alert.link}
                        className="text-xs text-primary hover:underline flex items-center gap-0.5 ml-12"
                      >
                        Xem chi tiết
                        <Icon name="arrow_forward" className="size-3" />
                      </Link>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
