"use client";

/**
 * Lịch sử thao tác (Audit Log) — Sprint 7
 * Real DataTable with filters, pagination, detail viewer.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast, useBranchFilter } from "@/lib/contexts";
import {
  getOperationHistory,
  getProfilesForPersonFilter,
  getActionOptions,
  getEntityTypeOptions,
  localizeAuditData,
} from "@/lib/services/supabase/audit";
import type { AuditLogEntry } from "@/lib/services/supabase/audit";
import { Icon } from "@/components/ui/icon";
import { useDebounce } from "@/lib/utils/use-debounce";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL,
} from "@/lib/utils/list-date-preset-range";

const PAGE_SIZE = 25;
const SOURCE_LABELS = { fnb: "F&B", retail: "Retail", other: "Khác / chưa xác định" };
const KIND_LABELS = { audit: "Thao tác", exception: "Ngoại lệ", approval: "Cấp mã duyệt" };
function historyTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
/** datetime-local uses the store's Vietnam time, independent of device zone. */
function auditTime(date: string, time: string, end = false) {
  if (!date) return undefined;
  if (!time) return date;
  const value = new Date(`${date}T${time}:00+07:00`);
  return new Date(value.getTime() + (end ? 60_000 : 0)).toISOString();
}

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
  const { activeBranchId, branchLabel, branches, isReady } = useBranchFilter();
  const requestSequence = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  // Filters
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("current");
  const [actorFilter, setActorFilter] = useState("all");
  const [approverFilter, setApproverFilter] = useState("all");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [people, setPeople] = useState<{ label: string; value: string }[]>([]);
  const scopedBranch = branchFilter === "current" ? activeBranchId : branchFilter === "all" ? undefined : branchFilter;

  // Detail dialog
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(
    null,
  );

  const actionOpts = getActionOptions();
  const entityOpts = getEntityTypeOptions();
  useEffect(() => { if (isReady) void getProfilesForPersonFilter().then(setPeople); }, [isReady]);
  useEffect(() => { setPage(0); }, [activeBranchId]);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const logRes = await getOperationHistory({
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          filters: {
            action: actionFilter,
            entityType: entityFilter,
            dateFrom: auditTime(dateFrom, timeFrom), dateTo: auditTime(dateTo, timeTo, true),
            source: sourceFilter === "all" ? undefined : sourceFilter as "fnb" | "retail" | "other",
            branchId: scopedBranch,
            actorId: actorFilter === "all" ? undefined : actorFilter,
            approverId: approverFilter === "all" ? undefined : approverFilter,
          },
        });
      if (sequence !== requestSequence.current) return;
      setData(logRes.data);
      setTotal(logRes.total);
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      const message = err instanceof Error ? err.message : "Vui lòng thử lại";
      setLoadError(message);
      setData([]);
      setTotal(0);
      toast({
        title: "Lỗi tải lịch sử thao tác",
        description: message,
        variant: "error",
      });
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [page, debouncedSearch, actionFilter, entityFilter, dateFrom, dateTo, timeFrom, timeTo, sourceFilter, scopedBranch, actorFilter, approverFilter, isReady, toast]);

  useEffect(() => {
    void fetchData();
    return () => { requestSequence.current++; };
  }, [fetchData]);

  const columns: ColumnDef<AuditLogEntry, unknown>[] = [
    {
      accessorKey: "createdAt",
      header: "Thời gian",
      size: 155,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground font-mono">
          {historyTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "source", header: "Phân hệ / nguồn", size: 155,
      cell: ({ row }) => <div className="text-xs"><span className="font-semibold text-primary">{SOURCE_LABELS[row.original.source ?? "other"]}</span><p className="text-muted-foreground">{KIND_LABELS[row.original.recordKind ?? "audit"]}</p></div>,
    },
    { accessorKey: "branchName", header: "Chi nhánh", size: 160 },
    { accessorKey: "approverName", header: "Người duyệt", size: 140, cell: ({ row }) => row.original.approverName || "—" },
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
          aria-label={`Xem thao tác ${row.original.entityName || row.original.actionLabel}`}
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
    for (const [key, label, value, options, clear] of [
      ["source", "Phân hệ", sourceFilter, Object.entries(SOURCE_LABELS).map(([value,label])=>({value,label})), () => setSourceFilter("all")],
      ["branch", "Chi nhánh", branchFilter, [{value:"current",label:branchLabel}, ...branches.map(b=>({value:b.id,label:b.name}))], () => setBranchFilter("current")],
      ["actor", "Người thực hiện", actorFilter, people, () => setActorFilter("all")],
      ["approver", "Người duyệt", approverFilter, people, () => setApproverFilter("all")],
    ] as const) {
      if (value !== "all" && !(key === "branch" && value === "current")) chips.push({ key, label, value: options.find(o=>o.value===value)?.label ?? value, onClear: clear });
    }
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
            ? `${dateFrom || "..."} ${timeFrom} đến ${dateTo || "..."} ${timeTo}`
            : (presetLabel ?? "Tùy chỉnh"),
        onClear: () => {
          setDatePreset("all");
          setDateFrom("");
          setDateTo("");
          setTimeFrom(""); setTimeTo("");
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
    sourceFilter, branchFilter, branchLabel, branches, actorFilter, approverFilter, people, timeFrom, timeTo,
  ]);

  function clearFilters() {
    setActionFilter("all");
    setEntityFilter("all");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setTimeFrom(""); setTimeTo(""); setSourceFilter("all"); setBranchFilter("current"); setActorFilter("all"); setApproverFilter("all");
    setPage(0);
  }

  function handleDatePreset(value: DatePresetValue) {
    setDatePreset(value);
    setTimeFrom(""); setTimeTo("");
    if (value === "custom") {
      setPage(0);
      return;
    }
    const storeDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const range = computeListPresetRange(value, new Date(`${storeDate}T12:00:00`));
    setDateFrom(range.from ?? "");
    setDateTo(range.to ?? "");
    setPage(0);
  }

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Lịch sử thao tác"
        density="compact"
        searchPlaceholder="Tìm mã bill, người thực hiện hoặc hành động…"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
      />

      <div className="flex-1 min-h-0 px-3 pt-2 pb-3">
        <p className="mb-2 text-xs text-muted-foreground">{branchFilter === "current" ? branchLabel : branchFilter === "all" ? "Các chi nhánh được phép" : branches.find(b=>b.id===branchFilter)?.name} · Giờ Việt Nam (UTC+7). Số đếm là bản ghi; cấp OTP chưa có nghĩa thao tác đã hoàn tất.</p>
        {loadError ? <div role="alert" className="rounded-md border border-status-error/30 bg-status-error/5 p-3 text-sm"><p className="font-semibold text-status-error">Chưa tải được nhật ký</p><p className="break-words">{loadError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void fetchData()}>Tải lại</Button></div> :
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          density="compact"
          columnToggle
          toolbarMetrics={
            <>
              <ListMetric icon={<Icon name="monitoring" size={16} />} label="Theo bộ lọc" value={total.toString()} loading={loading} />
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
        />}
      </div>

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={clearFilters}
        title="Bộ lọc lịch sử thao tác"
      >
        <FilterGroup label="Phân hệ"><SelectFilter value={sourceFilter} onChange={v=>{setSourceFilter(v);setPage(0);}} options={Object.entries(SOURCE_LABELS).map(([value,label])=>({value,label}))} placeholder="Tất cả phân hệ" /></FilterGroup>
        <FilterGroup label="Chi nhánh"><SelectFilter value={branchFilter} onChange={v=>{setBranchFilter(v);setPage(0);}} options={[{value:"current",label:`Đang chọn: ${branchLabel}`},...branches.map(b=>({value:b.id,label:b.name}))]} placeholder="Các chi nhánh được phép" /></FilterGroup>
        <FilterGroup label="Người thực hiện"><SelectFilter value={actorFilter} onChange={v=>{setActorFilter(v);setPage(0);}} options={people} placeholder="Tất cả người thực hiện" /></FilterGroup>
        <FilterGroup label="Người duyệt"><SelectFilter value={approverFilter} onChange={v=>{setApproverFilter(v);setPage(0);}} options={people} placeholder="Tất cả người duyệt" /></FilterGroup>
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
        {datePreset === "custom" && <FilterGroup label="Giờ Việt Nam (UTC+7)"><div className="grid grid-cols-2 gap-2"><label className="text-xs">Từ giờ<input aria-label="Từ giờ" type="time" disabled={!dateFrom} value={timeFrom} onChange={e=>{setTimeFrom(e.target.value);setPage(0);}} className="mt-1 w-full rounded-md border bg-surface p-2" /></label><label className="text-xs">Đến hết phút<input aria-label="Đến hết phút" type="time" disabled={!dateTo} value={timeTo} onChange={e=>{setTimeTo(e.target.value);setPage(0);}} className="mt-1 w-full rounded-md border bg-surface p-2" /></label></div></FilterGroup>}
      </FilterPanel>

      {/* Detail dialog */}
      <Dialog
        open={!!selectedEntry}
        onOpenChange={() => setSelectedEntry(null)}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="file_present" />
              Chi tiết thao tác
            </DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <DialogBody className="space-y-3">
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
                    {historyTime(selectedEntry.createdAt)}
                  </p>
                </div>
                <div><span className="text-xs text-muted-foreground">Phân hệ / nguồn</span><p className="font-semibold text-primary">{SOURCE_LABELS[selectedEntry.source ?? "other"]} · {KIND_LABELS[selectedEntry.recordKind ?? "audit"]}</p></div>
                <div><span className="text-xs text-muted-foreground">Chi nhánh</span><p>{selectedEntry.branchName}</p></div>
                <div><span className="text-xs text-muted-foreground">Người duyệt</span><p>{selectedEntry.approverName || "—"}</p></div>
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
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </ListPageLayout>
  );
}
