"use client";

/**
 * Lịch sử thao tác (Audit Log) — Sprint 7
 * Real DataTable with filters, pagination, detail viewer.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips } from "@/components/shared/filter-chips";
import {
  DatePresetFilter,
  FilterGroup,
  FilterPanel,
  SelectFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import { Badge } from "@/components/ui/badge";
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
  localizeAuditData,
} from "@/lib/services/supabase/audit";
import type { AuditLogEntry } from "@/lib/services/supabase/audit";
import { Icon } from "@/components/ui/icon";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL,
} from "@/lib/utils/list-date-preset-range";

const PAGE_SIZE = 25;

const ACTION_COLORS: Record<string, string> = {
  create: "bg-status-success/10 text-status-success",
  update: "bg-primary-fixed text-primary",
  delete: "bg-status-error/10 text-status-error",
  complete: "bg-status-success/10 text-status-success",
  cancel: "bg-status-warning/10 text-status-warning",
  approve: "bg-status-info/10 text-status-info",
  receive: "bg-status-info/10 text-status-info",
  transfer: "bg-cyan-100 text-cyan-800",
};

// S-2 13/06/2026 audit lần 2: wrap PermissionPage chống IDOR qua URL.
export default function AuditPageGuarded() {
  return (
    <PermissionPage requires={PERMISSIONS.SYSTEM_VIEW_AUDIT}>
      <AuditPage />
    </PermissionPage>
  );
}

function AuditPage() {
  const { toast } = useToast();
  const [data, setData] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  // Filters
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Stats
  const [stats, setStats] = useState<{
    totalToday: number;
    totalWeek: number;
    topAction: string;
    topEntity: string;
  } | null>(null);

  // Detail dialog
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(
    null,
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
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
          },
        }),
        page === 0 ? getAuditStats() : Promise.resolve(null),
      ]);
      setData(logRes.data);
      setTotal(logRes.total);
      if (statsRes) setStats(statsRes);
    } catch (err) {
      toast({
        title: "Lỗi tải lịch sử thao tác",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [page, search, actionFilter, entityFilter, dateFrom, dateTo, toast]);

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
        <div className="flex items-center gap-2">
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
          <Badge variant="secondary" className={`text-xs ${colorCls}`}>
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
      accessorKey: "entityName",
      header: "Tên / mã hiển thị",
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">
          {row.original.entityName || "—"}
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

  const filterChips = useMemo(() => {
    const chips = [];
    if (actionFilter !== "all") {
      chips.push({
        key: "action",
        label: "Hành động",
        value:
          actionOpts.find((option) => option.value === actionFilter)?.label ??
          actionFilter,
        onClear: () => setActionFilter("all"),
      });
    }
    if (entityFilter !== "all") {
      chips.push({
        key: "entity",
        label: "Đối tượng",
        value:
          entityOpts.find((option) => option.value === entityFilter)?.label ??
          entityFilter,
        onClear: () => setEntityFilter("all"),
      });
    }
    if (datePreset !== "all" || dateFrom || dateTo) {
      const presetLabel = STANDARD_LIST_PRESETS_WITH_ALL.find(
        (option) => option.value === datePreset,
      )?.label;
      chips.push({
        key: "date",
        label: "Thời gian",
        value:
          datePreset === "custom"
            ? `${dateFrom || "..."} đến ${dateTo || "..."}`
            : (presetLabel ?? "Tùy chỉnh"),
        onClear: () => {
          setDatePreset("all");
          setDateFrom("");
          setDateTo("");
        },
      });
    }
    return chips;
  }, [
    actionFilter,
    actionOpts,
    dateFrom,
    datePreset,
    dateTo,
    entityFilter,
    entityOpts,
  ]);

  function clearFilters() {
    setActionFilter("all");
    setEntityFilter("all");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }

  function handleDatePreset(value: DatePresetValue) {
    setDatePreset(value);
    if (value === "custom") {
      setPage(0);
      return;
    }
    const range = computeListPresetRange(value);
    setDateFrom(range.from ?? "");
    setDateTo(range.to ?? "");
    setPage(0);
  }

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Lịch sử thao tác"
        density="compact"
        searchPlaceholder="Tìm mã đối tượng hoặc mã hành động..."
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
      />

      <div className="flex-1 min-h-0 px-3 pt-2 pb-3">
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          density="compact"
          columnToggle
          toolbarMetrics={
            <>
              <ListMetric
                icon={<Icon name="monitoring" size={16} />}
                label="Hôm nay"
                value={(stats?.totalToday ?? 0).toString()}
                loading={!stats && loading}
              />
              <ListMetric
                icon={<Icon name="calendar_today" size={16} />}
                label="7 ngày qua"
                value={(stats?.totalWeek ?? 0).toString()}
                loading={!stats && loading}
              />
              <ListMetric
                icon={<Icon name="rule" size={16} />}
                label="Phổ biến"
                value={stats?.topAction ?? "—"}
                hint={stats?.topEntity}
                loading={!stats && loading}
              />
            </>
          }
          toolbarActions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
              onClick={() => setFilterOpen(true)}
            >
              <Icon name="filter_alt" size={15} />
              <span className="hidden sm:inline">Bộ lọc</span>
              {filterChips.length > 0 && (
                <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {filterChips.length}
                </span>
              )}
            </Button>
          }
          toolbarFooter={
            filterChips.length > 0 ? (
              <FilterChips
                filters={filterChips}
                onClearAll={filterChips.length > 1 ? clearFilters : undefined}
              />
            ) : null
          }
          total={total}
          pageIndex={page}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          onPageChange={setPage}
          onPageSizeChange={() => {}}
          getRowId={(r) => r.id}
        />
      </div>

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={clearFilters}
        title="Bộ lọc lịch sử thao tác"
      >
        <FilterGroup label="Hành động">
          <SelectFilter
            value={actionFilter}
            onChange={(value) => {
              setActionFilter(value);
              setPage(0);
            }}
            options={actionOpts}
            placeholder="Tất cả hành động"
          />
        </FilterGroup>
        <FilterGroup label="Đối tượng">
          <SelectFilter
            value={entityFilter}
            onChange={(value) => {
              setEntityFilter(value);
              setPage(0);
            }}
            options={entityOpts}
            placeholder="Tất cả đối tượng"
          />
        </FilterGroup>
        <FilterGroup label="Thời gian">
          <DatePresetFilter
            value={datePreset}
            onChange={handleDatePreset}
            from={dateFrom}
            to={dateTo}
            onFromChange={(value) => {
              setDateFrom(value);
              setPage(0);
            }}
            onToChange={(value) => {
              setDateTo(value);
              setPage(0);
            }}
            presets={STANDARD_LIST_PRESETS_WITH_ALL}
          />
        </FilterGroup>
      </FilterPanel>

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
                  <p className="font-medium">{selectedEntry.entityTypeLabel}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground text-xs">
                    Tên / mã hiển thị
                  </span>
                  <p className="font-medium text-sm text-foreground">
                    {selectedEntry.entityName || "—"}
                  </p>
                </div>
                {selectedEntry.ipAddress && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs">IP</span>
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
                      <pre className="text-xs bg-status-error/10 border border-status-error/25 rounded p-2 overflow-auto max-h-40">
                        {JSON.stringify(
                          localizeAuditData(selectedEntry.oldData),
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  )}
                  {selectedEntry.newData && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Dữ liệu mới
                      </p>
                      <pre className="text-xs bg-status-success/10 border border-status-success/25 rounded p-2 overflow-auto max-h-40">
                        {JSON.stringify(
                          localizeAuditData(selectedEntry.newData),
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ListPageLayout>
  );
}
