"use client";

/**
 * Lịch sử thao tác (Audit Log) — Sprint 7
 * Real DataTable with filters, pagination, detail viewer.
 */

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { formatDate } from "@/lib/format";
import {
  getAuditLogs,
  getAuditStats,
  getActionOptions,
  getEntityTypeOptions,
} from "@/lib/services/supabase/audit";
import type { AuditLogEntry } from "@/lib/services/supabase/audit";
import { Icon } from "@/components/ui/icon";

const PAGE_SIZE = 25;

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  update: "bg-primary-fixed text-primary",
  delete: "bg-red-100 text-red-800",
  complete: "bg-emerald-100 text-emerald-800",
  cancel: "bg-amber-100 text-amber-800",
  approve: "bg-purple-100 text-purple-800",
  receive: "bg-indigo-100 text-indigo-800",
  transfer: "bg-cyan-100 text-cyan-800",
};

export default function AuditPage() {
  const { toast } = useToast();
  const [data, setData] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  // Filters
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");

  // Stats
  const [stats, setStats] = useState<{
    totalToday: number;
    totalWeek: number;
    topAction: string;
    topEntity: string;
  } | null>(null);

  // Detail dialog
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(
    null
  );

  const actionOpts = getActionOptions();
  const entityOpts = getEntityTypeOptions();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, statsRes] = await Promise.all([
        getAuditLogs({
          page,
          pageSize: PAGE_SIZE,
          search,
          filters: {
            action: actionFilter,
            entityType: entityFilter,
          },
        }),
        page === 0 ? getAuditStats() : Promise.resolve(null),
      ]);
      setData(logRes.data);
      setTotal(logRes.total);
      if (statsRes) setStats(statsRes);
    } catch (err) {
      toast({
        title: "Lỗi tải audit log",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [page, search, actionFilter, entityFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnDef<AuditLogEntry, unknown>[] = [
    {
      accessorKey: "createdAt",
      header: "Thời gian",
      size: 155,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground font-mono">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "userName",
      header: "Người thực hiện",
      size: 160,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Icon name="person" size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium">{row.original.userName}</span>
        </div>
      ),
    },
    {
      accessorKey: "actionLabel",
      header: "Hành động",
      size: 120,
      cell: ({ row }) => {
        const colorCls =
          ACTION_COLORS[row.original.action] ?? "bg-muted text-foreground";
        return (
          <Badge variant="secondary" className={`text-[11px] ${colorCls}`}>
            {row.original.actionLabel}
          </Badge>
        );
      },
    },
    {
      accessorKey: "entityTypeLabel",
      header: "Đối tượng",
      size: 150,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.entityTypeLabel}</span>
      ),
    },
    {
      accessorKey: "entityId",
      header: "Mã",
      size: 120,
      cell: ({ row }) => (
        <span className="text-xs font-mono text-primary truncate max-w-[110px] block">
          {row.original.entityId || "—"}
        </span>
      ),
    },
    {
      id: "detail",
      header: "",
      size: 50,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setSelectedEntry(row.original)}
        >
          <Icon name="visibility" size={14} />
        </Button>
      ),
    },
  ];

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <PageHeader
        title="Lịch sử thao tác"
        searchPlaceholder="Tìm theo mã đối tượng, hành động..."
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
      />

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
          <StatCard
            icon={<Icon name="monitoring" size={16} className="text-primary" />}
            label="Hôm nay"
            value={`${stats.totalToday} thao tác`}
            bg="bg-primary-fixed border-primary-fixed"
          />
          <StatCard
            icon={<Icon name="calendar_today" size={16} className="text-emerald-600" />}
            label="7 ngày qua"
            value={`${stats.totalWeek} thao tác`}
            bg="bg-emerald-50 border-emerald-200"
          />
          <StatCard
            icon={<Icon name="file_present" size={16} className="text-purple-600" />}
            label="Hành động phổ biến"
            value={stats.topAction}
            bg="bg-purple-50 border-purple-200"
          />
          <StatCard
            icon={<Icon name="file_present" size={16} className="text-amber-600" />}
            label="Đối tượng phổ biến"
            value={stats.topEntity}
            bg="bg-amber-50 border-amber-200"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 pt-3">
        <FilterSelect
          label="Hành động"
          value={actionFilter}
          onChange={(v) => {
            setActionFilter(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "Tất cả" },
            ...actionOpts,
          ]}
        />
        <FilterSelect
          label="Đối tượng"
          value={entityFilter}
          onChange={(v) => {
            setEntityFilter(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "Tất cả" },
            ...entityOpts,
          ]}
        />
        <div className="ml-auto text-xs text-muted-foreground">
          {total} bản ghi
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pt-3 pb-4">
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          pageIndex={page}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          onPageChange={setPage}
          onPageSizeChange={() => {}}
          getRowId={(r) => r.id}
        />
      </div>

      {/* Detail dialog */}
      <Dialog
        open={!!selectedEntry}
        onOpenChange={() => setSelectedEntry(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="file_present" />
              Chi tiết thao tác
            </DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">
                    Người thực hiện
                  </span>
                  <p className="font-medium">{selectedEntry.userName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Thời gian
                  </span>
                  <p className="font-medium font-mono text-xs">
                    {formatDate(selectedEntry.createdAt)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Hành động
                  </span>
                  <p>
                    <Badge
                      variant="secondary"
                      className={
                        ACTION_COLORS[selectedEntry.action] ??
                        "bg-muted text-foreground"
                      }
                    >
                      {selectedEntry.actionLabel}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Đối tượng
                  </span>
                  <p className="font-medium">
                    {selectedEntry.entityTypeLabel}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground text-xs">
                    Mã đối tượng
                  </span>
                  <p className="font-mono text-xs text-primary">
                    {selectedEntry.entityId || "—"}
                  </p>
                </div>
                {selectedEntry.ipAddress && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs">
                      IP
                    </span>
                    <p className="font-mono text-xs">
                      {selectedEntry.ipAddress}
                    </p>
                  </div>
                )}
              </div>

              {/* Data diff */}
              {(selectedEntry.oldData || selectedEntry.newData) && (
                <div className="space-y-2">
                  {selectedEntry.oldData && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Dữ liệu cũ
                      </p>
                      <pre className="text-[11px] bg-red-50 border border-red-200 rounded p-2 overflow-auto max-h-40">
                        {JSON.stringify(selectedEntry.oldData, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selectedEntry.newData && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Dữ liệu mới
                      </p>
                      <pre className="text-[11px] bg-green-50 border border-green-200 rounded p-2 overflow-auto max-h-40">
                        {JSON.stringify(selectedEntry.newData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg: string;
}) {
  return (
    <div className={`border rounded-lg p-3 ${bg}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none text-xs border rounded-md px-3 py-1.5 pr-7 bg-background cursor-pointer hover:bg-muted/50 transition-colors"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {label}: {opt.label}
          </option>
        ))}
      </select>
      <Icon name="expand_more" size={14} className="text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
