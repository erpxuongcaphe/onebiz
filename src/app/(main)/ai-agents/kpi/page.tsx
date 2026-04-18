"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getKpiBreakdownTree } from "@/lib/services";
import {
  KPI_PERIOD_LABELS,
  KPI_TYPE_LABELS,
  type KpiBreakdownTreeNode,
  type KpiPeriod,
} from "@/lib/types/ai-agents";
import { useToast } from "@/lib/contexts";

// ────────────────────────────────────────────
// Progress bar helper
// ────────────────────────────────────────────
function progressPct(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

function formatKpiValue(node: KpiBreakdownTreeNode, value: number): string {
  if (node.unit?.toUpperCase() === "VND" || node.kpiType === "revenue") {
    return formatCurrency(value);
  }
  return `${formatNumber(value)}${node.unit ? ` ${node.unit}` : ""}`;
}

// ────────────────────────────────────────────
// KPI tree node
// ────────────────────────────────────────────
function KpiNode({
  node,
  depth = 0,
}: {
  node: KpiBreakdownTreeNode;
  depth?: number;
}) {
  const pct = progressPct(node.actualValue, node.targetValue);
  const tone =
    pct >= 100
      ? "success"
      : pct >= 70
        ? "info"
        : pct >= 40
          ? "warning"
          : "error";

  const toneClass: Record<string, { bar: string; pill: string }> = {
    success: {
      bar: "bg-status-success",
      pill: "bg-status-success/10 text-status-success",
    },
    info: {
      bar: "bg-status-info",
      pill: "bg-status-info/10 text-status-info",
    },
    warning: {
      bar: "bg-status-warning",
      pill: "bg-status-warning/10 text-status-warning",
    },
    error: {
      bar: "bg-status-error",
      pill: "bg-status-error/10 text-status-error",
    },
  };

  return (
    <div>
      <div
        className="rounded-xl bg-surface-container-lowest ambient-shadow border border-border p-4 mb-2"
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">
                {node.kpiName}
              </span>
              <span className="text-[10px] uppercase tracking-wider font-medium rounded-full px-2 py-0.5 bg-primary-fixed text-primary">
                {KPI_PERIOD_LABELS[node.period as KpiPeriod] ?? node.period}
              </span>
              <span className="text-[10px] uppercase tracking-wider font-medium rounded-full px-2 py-0.5 bg-surface-container text-muted-foreground">
                {KPI_TYPE_LABELS[node.kpiType] ?? node.kpiType}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {new Date(node.periodStart).toLocaleDateString("vi-VN")} →{" "}
              {new Date(node.periodEnd).toLocaleDateString("vi-VN")}
              {node.ownerRole && ` · ${node.ownerRole}`}
            </div>
          </div>
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${toneClass[tone].pill}`}
          >
            {pct}%
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm mb-2">
          <div>
            <span className="text-muted-foreground">Thực tế:</span>{" "}
            <span className="font-semibold tabular-nums">
              {formatKpiValue(node, node.actualValue)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Mục tiêu:</span>{" "}
            <span className="font-semibold tabular-nums">
              {formatKpiValue(node, node.targetValue)}
            </span>
          </div>
        </div>

        <div className="relative h-1.5 rounded-full bg-surface-container overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all ${toneClass[tone].bar}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="border-l-2 border-border/40 ml-3 pl-2">
          {node.children.map((child) => (
            <KpiNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Page
// ────────────────────────────────────────────
export default function KpiBreakdownPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<KpiBreakdownTreeNode[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getKpiBreakdownTree();
      setTree(data);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi tải KPI",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon
          name="progress_activity"
          size={32}
          className="animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="KPI Breakdown"
        actions={[
          {
            label: "Về AI Agents",
            icon: <Icon name="arrow_back" size={16} />,
            variant: "outline",
            href: "/ai-agents",
          },
        ]}
      />

      <p className="text-sm text-muted-foreground px-1">
        Cây KPI do AI Agent tạo ra — mỗi KPI cha break down xuống các KPI
        con theo kỳ (quý/tháng/tuần/ngày) và có thể kéo xuống task cụ thể.
      </p>

      {tree.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-10 text-center">
          <div className="mx-auto size-16 rounded-full bg-status-info/10 flex items-center justify-center mb-4">
            <Icon name="trending_up" size={32} className="text-status-info" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Chưa có KPI nào</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Agent CEO sẽ tự đề xuất KPI tổng khi được chạy. Bạn cũng có thể
            POST thủ công qua webhook <code className="font-mono">/api/ai-agent/kpi</code>.
          </p>
          <Link href="/ai-agents">
            <Button variant="default">
              <Icon name="auto_awesome" size={16} />
              <span className="ml-1">Chạy agent</span>
            </Button>
          </Link>
        </div>
      ) : (
        <div>
          {tree.map((root) => (
            <KpiNode key={root.id} node={root} />
          ))}
        </div>
      )}
    </div>
  );
}
