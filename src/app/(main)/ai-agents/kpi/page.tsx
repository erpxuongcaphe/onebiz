"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { CreateKpiBreakdownDialog } from "@/components/shared/dialogs/create-kpi-breakdown-dialog";
import { CreateAgentTaskDialog } from "@/components/shared/dialogs/create-agent-task-dialog";
import { AutoBreakdownDialog } from "@/components/shared/dialogs/auto-breakdown-dialog";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  deleteKpiBreakdown,
  getKpiBreakdownTree,
  syncKpiActualsFromDb,
  updateKpiActual,
} from "@/lib/services";
import {
  KPI_PERIOD_LABELS,
  KPI_TYPE_LABELS,
  type KpiBreakdown,
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
  onBreakdown,
  onAutoBreakdown,
  onUpdateActual,
  onCreateTask,
  onDelete,
  busy,
}: {
  node: KpiBreakdownTreeNode;
  depth?: number;
  onBreakdown: (node: KpiBreakdown) => void;
  onAutoBreakdown: (node: KpiBreakdown) => void;
  onUpdateActual: (node: KpiBreakdown) => void;
  onCreateTask: (node: KpiBreakdown) => void;
  onDelete: (node: KpiBreakdown) => void;
  busy: boolean;
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
        className="rounded-xl bg-surface-container-lowest ambient-shadow border border-border p-4 mb-2 group"
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

        {/* Action row — always visible mobile, hover-reveal desktop */}
        <div className="flex flex-wrap items-center gap-1 mt-3 pt-3 border-t border-border/60 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => onAutoBreakdown(node)}
          >
            <Icon name="auto_awesome" size={12} />
            <span className="ml-1">Tự động chia nhỏ</span>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => onBreakdown(node)}
          >
            <Icon name="account_tree" size={12} />
            <span className="ml-1">Tạo KPI con</span>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => onUpdateActual(node)}
          >
            <Icon name="edit" size={12} />
            <span className="ml-1">Cập nhật thực tế</span>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => onCreateTask(node)}
          >
            <Icon name="add_task" size={12} />
            <span className="ml-1">Tạo task</span>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => onDelete(node)}
            className="ml-auto text-status-error hover:text-status-error"
          >
            <Icon name="delete" size={12} />
            <span className="ml-1">Xoá</span>
          </Button>
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="border-l-2 border-border/40 ml-3 pl-2">
          {node.children.map((child) => (
            <KpiNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onBreakdown={onBreakdown}
              onAutoBreakdown={onAutoBreakdown}
              onUpdateActual={onUpdateActual}
              onCreateTask={onCreateTask}
              onDelete={onDelete}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Update-actual inline dialog (simple prompt-style)
// ────────────────────────────────────────────
function UpdateActualDialog({
  open,
  onOpenChange,
  kpi,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kpi: KpiBreakdown | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && kpi) setValue(String(kpi.actualValue ?? 0));
  }, [open, kpi]);

  const handleSave = async () => {
    if (!kpi) return;
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) {
      toast({ title: "Giá trị không hợp lệ", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      await updateKpiActual(kpi.id, v);
      toast({ title: "Đã cập nhật thực tế", variant: "success" });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi cập nhật",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cập nhật giá trị thực tế"
      description={
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            KPI: <span className="font-semibold">{kpi?.kpiName}</span>
            {kpi?.unit && (
              <span className="text-muted-foreground"> ({kpi.unit})</span>
            )}
          </p>
          <Input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </div>
      }
      confirmLabel="Lưu"
      cancelLabel="Huỷ"
      loading={saving}
      onConfirm={handleSave}
    />
  );
}

// ────────────────────────────────────────────
// Page
// ────────────────────────────────────────────
export default function KpiBreakdownPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<KpiBreakdownTreeNode[]>([]);
  const [busy, setBusy] = useState(false);

  // Dialog state
  const [kpiDialogOpen, setKpiDialogOpen] = useState(false);
  const [parentKpi, setParentKpi] = useState<KpiBreakdown | null>(null);

  const [autoDialogOpen, setAutoDialogOpen] = useState(false);
  const [autoParentKpi, setAutoParentKpi] = useState<KpiBreakdown | null>(null);

  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskKpi, setTaskKpi] = useState<KpiBreakdown | null>(null);

  const [actualDialogOpen, setActualDialogOpen] = useState(false);
  const [actualKpi, setActualKpi] = useState<KpiBreakdown | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteKpi, setDeleteKpi] = useState<KpiBreakdown | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [syncing, setSyncing] = useState(false);

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

  const openCreateRoot = () => {
    setParentKpi(null);
    setKpiDialogOpen(true);
  };

  const openCreateChild = (node: KpiBreakdown) => {
    setParentKpi(node);
    setKpiDialogOpen(true);
  };

  const openAutoBreakdown = (node: KpiBreakdown) => {
    setAutoParentKpi(node);
    setAutoDialogOpen(true);
  };

  const openUpdateActual = (node: KpiBreakdown) => {
    setActualKpi(node);
    setActualDialogOpen(true);
  };

  const handleSyncActuals = async () => {
    setSyncing(true);
    try {
      const result = await syncKpiActualsFromDb();
      const errMsg =
        result.errors.length > 0
          ? ` · ${result.errors.length} lỗi`
          : "";
      toast({
        title: `Đồng bộ xong: ${result.updated}/${result.totalScanned} KPI được cập nhật${errMsg}`,
        description:
          result.errors.length > 0
            ? result.errors
                .slice(0, 3)
                .map((e) => `${e.kpiName}: ${e.error}`)
                .join(" · ")
            : `${result.skipped} KPI không đổi`,
        variant: result.errors.length > 0 ? "warning" : "success",
      });
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi đồng bộ KPI",
        variant: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  const openCreateTask = (node: KpiBreakdown) => {
    setTaskKpi(node);
    setTaskDialogOpen(true);
  };

  const openDelete = (node: KpiBreakdown) => {
    setDeleteKpi(node);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteKpi) return;
    setDeleting(true);
    try {
      await deleteKpiBreakdown(deleteKpi.id);
      toast({ title: "Đã xoá KPI", variant: "success" });
      setDeleteOpen(false);
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Lỗi xoá KPI",
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  };

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
          {
            label: syncing ? "Đang đồng bộ..." : "Đồng bộ thực tế",
            icon: (
              <Icon
                name={syncing ? "progress_activity" : "sync"}
                size={16}
                className={syncing ? "animate-spin" : ""}
              />
            ),
            variant: "outline",
            onClick: handleSyncActuals,
            disabled: syncing || loading,
          },
          {
            label: "Tạo KPI",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: openCreateRoot,
          },
        ]}
      />

      <p className="text-sm text-muted-foreground px-1">
        Cây KPI do AI Agent tạo ra — mỗi KPI cha break down xuống các KPI
        con theo kỳ (quý/tháng/tuần/ngày) và có thể kéo xuống task cụ thể.
        Hover vào card để thao tác.
      </p>

      {tree.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-10 text-center">
          <div className="mx-auto size-16 rounded-full bg-status-info/10 flex items-center justify-center mb-4">
            <Icon name="trending_up" size={32} className="text-status-info" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Chưa có KPI nào</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Tạo KPI đầu tiên hoặc để agent CEO tự đề xuất KPI tổng. Bạn cũng
            có thể POST thủ công qua webhook{" "}
            <code className="font-mono">/api/ai-agent/kpi</code>.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="default" onClick={openCreateRoot}>
              <Icon name="add" size={16} />
              <span className="ml-1">Tạo KPI đầu tiên</span>
            </Button>
            <Link href="/ai-agents">
              <Button variant="outline">
                <Icon name="auto_awesome" size={16} />
                <span className="ml-1">Chạy agent</span>
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div>
          {tree.map((root) => (
            <KpiNode
              key={root.id}
              node={root}
              onBreakdown={openCreateChild}
              onAutoBreakdown={openAutoBreakdown}
              onUpdateActual={openUpdateActual}
              onCreateTask={openCreateTask}
              onDelete={openDelete}
              busy={busy || deleting || syncing}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateKpiBreakdownDialog
        open={kpiDialogOpen}
        onOpenChange={(o) => {
          setKpiDialogOpen(o);
          if (!o) setParentKpi(null);
        }}
        parentKpi={parentKpi}
        onSuccess={() => {
          setBusy(true);
          load().finally(() => setBusy(false));
        }}
      />

      <AutoBreakdownDialog
        open={autoDialogOpen}
        onOpenChange={(o) => {
          setAutoDialogOpen(o);
          if (!o) setAutoParentKpi(null);
        }}
        parentKpi={autoParentKpi}
        onSuccess={() => {
          setBusy(true);
          load().finally(() => setBusy(false));
        }}
      />

      <CreateAgentTaskDialog
        open={taskDialogOpen}
        onOpenChange={(o) => {
          setTaskDialogOpen(o);
          if (!o) setTaskKpi(null);
        }}
        kpiBreakdown={taskKpi}
        onSuccess={() => {
          toast({
            title: "Task đã được thêm vào danh sách hàng ngày",
            variant: "info",
          });
        }}
      />

      <UpdateActualDialog
        open={actualDialogOpen}
        onOpenChange={(o) => {
          setActualDialogOpen(o);
          if (!o) setActualKpi(null);
        }}
        kpi={actualKpi}
        onSaved={() => {
          setBusy(true);
          load().finally(() => setBusy(false));
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setDeleteKpi(null);
        }}
        title="Xoá KPI"
        description={
          deleteKpi
            ? `Xoá KPI "${deleteKpi.kpiName}"? Các KPI con và task gắn vào sẽ không tự động xoá theo.`
            : ""
        }
        confirmLabel="Xoá"
        cancelLabel="Huỷ"
        variant="destructive"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
