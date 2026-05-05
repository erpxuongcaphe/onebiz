"use client";

/**
 * MOCKUP — List Page Redesign Showcase
 * Route: /mockup/list-redesign
 *
 * CEO 04/05/2026: preview comprehensive list page rebuild với foundation đầy đủ.
 * Sau khi CEO duyệt → apply pattern này cho 9 list page (hóa đơn, sổ quỹ,
 * công nợ, đặt hàng nhập, nhập kho, chuyển kho, kiểm kho, xuất hủy, xuất nội bộ).
 *
 * Demo: Danh sách Hóa đơn fake với data 30 row.
 *
 * Tính năng mới (vs current):
 * 1. Search DEBOUNCED (300ms) — không thrash server mỗi keystroke
 * 2. URL state — filter/sort/page/search persist trong URL → reload OK + share link OK
 * 3. SavedViewsBar — quick filter combo (Hôm nay / Tháng này / Khách lẻ / + Lưu mới)
 * 4. ActiveFiltersBar — chip remove + clear all (đã có nhưng chưa page nào dùng)
 * 5. Sort columns — server-side sort (DataTable sẵn có nhưng chưa wire)
 * 6. Column toggle wired (icon ở DataTable, persist localStorage)
 * 7. Bulk actions — Xuất Excel selected, In hàng loạt, Hủy đơn (có confirm)
 * 8. Inline detail panel với edit-in-place (button Sửa/Lưu/Hủy)
 * 9. KPI summary row server aggregate (không reduce client)
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table/data-table";
import { PageHeader } from "@/components/shared/page-header";
import {
  FilterSidebar,
  FilterGroup,
  ActiveFiltersBar,
} from "@/components/shared/filter-sidebar";
import { CheckboxFilter } from "@/components/shared/filter-sidebar/checkbox-filter";
import { DatePresetFilter } from "@/components/shared/filter-sidebar/date-preset-filter";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";

// ─────────────────────────────────────────
// Sample data — 30 invoices
// ─────────────────────────────────────────
type Invoice = {
  id: string;
  code: string;
  date: string;
  customerCode: string;
  customerName: string;
  branchName: string;
  total: number;
  paid: number;
  debt: number;
  status: "completed" | "draft" | "cancelled";
  createdByName: string;
  itemCount: number;
};

const SAMPLE_INVOICES: Invoice[] = Array.from({ length: 30 }, (_, i) => {
  const total = 100000 + Math.floor(Math.random() * 5000000);
  const paid = Math.random() > 0.2 ? total : Math.floor(total * Math.random());
  const statuses: Invoice["status"][] = ["completed", "completed", "completed", "draft", "cancelled"];
  return {
    id: `inv-${i + 1}`,
    code: `HD${String(10000 + i).padStart(6, "0")}`,
    date: new Date(Date.now() - i * 3600000 * (Math.random() * 24)).toISOString(),
    customerCode: i % 3 === 0 ? "KL-VL" : `KH${String(i + 100).padStart(4, "0")}`,
    customerName: i % 3 === 0 ? "Khách lẻ" : ["Bùi Thị Hồng", "Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"][i % 5],
    branchName: ["Kho Tổng", "Quán Thủ Đức", "Quán Q5", "Xưởng Rang"][i % 4],
    total,
    paid,
    debt: Math.max(0, total - paid),
    status: statuses[i % statuses.length],
    createdByName: ["Anh Đinh", "Cashier B", "Cashier C"][i % 3],
    itemCount: 1 + Math.floor(Math.random() * 8),
  };
});

// ─────────────────────────────────────────
// Saved views — mock
// ─────────────────────────────────────────
type SavedView = {
  id: string;
  name: string;
  filters: Partial<{ status: string[]; preset: string; branch: string }>;
};

const SAMPLE_VIEWS: SavedView[] = [
  { id: "all", name: "Tất cả", filters: {} },
  { id: "today", name: "Hôm nay", filters: { preset: "today" } },
  { id: "month", name: "Tháng này", filters: { preset: "this_month" } },
  { id: "debt", name: "Còn nợ", filters: { status: ["completed"] } },
  { id: "draft", name: "Đang nháp", filters: { status: ["draft"] } },
];

// ─────────────────────────────────────────
// Custom hook — debounced search + URL state
// ─────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─────────────────────────────────────────
// Main page (Suspense wrap để useSearchParams safe trong Next.js 15)
// ─────────────────────────────────────────
export default function ListRedesignMockupPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Đang tải mockup...</div>}>
      <ListRedesignMockupInner />
    </Suspense>
  );
}

function ListRedesignMockupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── State (URL-persisted) ──
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebounce(search, 300);

  const [statusFilter, setStatusFilter] = useState<string[]>(() => {
    const s = searchParams.get("status");
    return s ? s.split(",") : [];
  });
  const [branchFilter, setBranchFilter] = useState<string[]>([]);
  const [pagePresetFilter, setPagePresetFilter] = useState<string>("all");

  const [sortBy, setSortBy] = useState<{ id: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [activeViewId, setActiveViewId] = useState("all");
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // ── Sync URL ──
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (statusFilter.length) params.set("status", statusFilter.join(","));
    if (branchFilter.length) params.set("branch", branchFilter.join(","));
    if (pagePresetFilter !== "all") params.set("preset", pagePresetFilter);
    if (sortBy) params.set("sort", `${sortBy.id}:${sortBy.desc ? "desc" : "asc"}`);
    if (page > 0) params.set("page", String(page));
    if (pageSize !== 20) params.set("size", String(pageSize));
    const url = params.toString() ? `?${params.toString()}` : "";
    router.replace(`/mockup/list-redesign${url}`, { scroll: false });
  }, [debouncedSearch, statusFilter, branchFilter, pagePresetFilter, sortBy, page, pageSize, router]);

  // ── Filter + sort + paginate ──
  const filtered = useMemo(() => {
    let data = SAMPLE_INVOICES;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      data = data.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.customerCode.toLowerCase().includes(q),
      );
    }
    if (statusFilter.length > 0) {
      data = data.filter((r) => statusFilter.includes(r.status));
    }
    if (branchFilter.length > 0) {
      data = data.filter((r) => branchFilter.includes(r.branchName));
    }
    if (sortBy) {
      data = [...data].sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortBy.id];
        const bVal = (b as Record<string, unknown>)[sortBy.id];
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const cmp = String(aVal).localeCompare(String(bVal), "vi", { numeric: true });
        return sortBy.desc ? -cmp : cmp;
      });
    }
    return data;
  }, [debouncedSearch, statusFilter, branchFilter, sortBy]);

  const total = filtered.length;
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // ── KPI summary (server aggregate trong production) ──
  const kpi = useMemo(() => {
    return {
      totalAmount: filtered.reduce((s, r) => s + r.total, 0),
      totalPaid: filtered.reduce((s, r) => s + r.paid, 0),
      totalDebt: filtered.reduce((s, r) => s + r.debt, 0),
      count: filtered.length,
    };
  }, [filtered]);

  // ── Active filters chips ──
  const activeFilters = useMemo(() => {
    const items: Array<{ key: string; label: string; value: string; onClear: () => void }> = [];
    if (statusFilter.length > 0) {
      items.push({
        key: "status",
        label: "Trạng thái",
        value: statusFilter.map(statusLabel).join(", "),
        onClear: () => setStatusFilter([]),
      });
    }
    if (branchFilter.length > 0) {
      items.push({
        key: "branch",
        label: "Chi nhánh",
        value: branchFilter.join(", "),
        onClear: () => setBranchFilter([]),
      });
    }
    if (pagePresetFilter !== "all") {
      items.push({
        key: "preset",
        label: "Thời gian",
        value: pagePresetFilter,
        onClear: () => setPagePresetFilter("all"),
      });
    }
    return items;
  }, [statusFilter, branchFilter, pagePresetFilter]);

  // ── Apply saved view ──
  const applyView = (view: SavedView) => {
    setActiveViewId(view.id);
    setStatusFilter(view.filters.status ?? []);
    setPagePresetFilter(view.filters.preset ?? "all");
    setBranchFilter([]);
    setPage(0);
  };

  // ── Bulk action handlers (mock) ──
  const handleBulkExport = (rows: Invoice[]) => {
    alert(`📤 Mock: Xuất Excel ${rows.length} hóa đơn — ${rows.map((r) => r.code).join(", ")}`);
  };
  const handleBulkPrint = (rows: Invoice[]) => {
    alert(`🖨️ Mock: In hàng loạt ${rows.length} hóa đơn`);
  };
  const handleBulkCancel = (rows: Invoice[]) => {
    if (confirm(`⚠️ Hủy ${rows.length} hóa đơn? Hành động không thể hoàn tác.`)) {
      alert(`Đã hủy ${rows.length} hóa đơn (mock)`);
    }
  };

  // ── Columns ──
  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: "code",
      header: ({ column }) => (
        <SortHeader label="Mã HĐ" sorted={sortBy?.id === "code" ? sortBy.desc : undefined} onClick={() => toggleSort("code")} />
      ),
      cell: ({ row }) => <span className="font-mono font-semibold">{row.original.code}</span>,
      meta: { pinLeft: true, pinWidth: 120 },
    },
    {
      accessorKey: "date",
      header: () => <SortHeader label="Ngày" sorted={sortBy?.id === "date" ? sortBy.desc : undefined} onClick={() => toggleSort("date")} />,
      cell: ({ row }) => <span className="text-xs">{formatDate(row.original.date)}</span>,
    },
    {
      accessorKey: "customerName",
      header: () => <SortHeader label="Khách hàng" sorted={sortBy?.id === "customerName" ? sortBy.desc : undefined} onClick={() => toggleSort("customerName")} />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.customerName}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{row.original.customerCode}</div>
        </div>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      cell: ({ row }) => <span className="text-xs">{row.original.branchName}</span>,
    },
    {
      accessorKey: "itemCount",
      header: () => <SortHeader label="Số SP" sorted={sortBy?.id === "itemCount" ? sortBy.desc : undefined} onClick={() => toggleSort("itemCount")} alignRight />,
      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.itemCount}</div>,
    },
    {
      accessorKey: "total",
      header: () => <SortHeader label="Tổng tiền" sorted={sortBy?.id === "total" ? sortBy.desc : undefined} onClick={() => toggleSort("total")} alignRight />,
      cell: ({ row }) => <div className="text-right font-semibold tabular-nums">{formatCurrency(row.original.total)}đ</div>,
    },
    {
      accessorKey: "debt",
      header: () => <SortHeader label="Còn nợ" sorted={sortBy?.id === "debt" ? sortBy.desc : undefined} onClick={() => toggleSort("debt")} alignRight />,
      cell: ({ row }) => (
        <div className={cn("text-right tabular-nums", row.original.debt > 0 && "text-status-warning font-semibold")}>
          {row.original.debt > 0 ? formatCurrency(row.original.debt) + "đ" : "—"}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      accessorKey: "createdByName",
      header: "Người tạo",
      cell: ({ row }) => <span className="text-xs">{row.original.createdByName}</span>,
    },
  ];

  const toggleSort = (id: string) => {
    setSortBy((prev) => {
      if (!prev || prev.id !== id) return { id, desc: false };
      if (!prev.desc) return { id, desc: true };
      return null;
    });
  };

  // ── Sidebar ──
  const sidebar = (
    <FilterSidebar>
      {activeFilters.length > 0 && (
        <ActiveFiltersBar
          filters={activeFilters}
          onClearAll={() => {
            setStatusFilter([]);
            setBranchFilter([]);
            setPagePresetFilter("all");
            setActiveViewId("all");
          }}
        />
      )}
      <FilterGroup label="Thời gian" activeHint={pagePresetFilter !== "all" ? "1" : undefined}>
        <DatePresetFilter
          value={pagePresetFilter as "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all"}
          onChange={(v) => setPagePresetFilter(v)}
          presets={[
            { label: "Hôm nay", value: "today" },
            { label: "Hôm qua", value: "yesterday" },
            { label: "Tuần này", value: "this_week" },
            { label: "Tháng này", value: "this_month" },
            { label: "Tháng trước", value: "last_month" },
            { label: "Tất cả", value: "all" },
          ]}
        />
      </FilterGroup>
      <FilterGroup label="Trạng thái" activeHint={statusFilter.length > 0 ? String(statusFilter.length) : undefined}>
        <CheckboxFilter
          selected={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "completed", label: "Hoàn thành" },
            { value: "draft", label: "Đang nháp" },
            { value: "cancelled", label: "Đã hủy" },
          ]}
        />
      </FilterGroup>
      <FilterGroup label="Chi nhánh" activeHint={branchFilter.length > 0 ? String(branchFilter.length) : undefined}>
        <CheckboxFilter
          selected={branchFilter}
          onChange={setBranchFilter}
          options={[
            { value: "Kho Tổng", label: "Kho Tổng" },
            { value: "Quán Thủ Đức", label: "Quán Thủ Đức" },
            { value: "Quán Q5", label: "Quán Q5" },
            { value: "Xưởng Rang", label: "Xưởng Rang" },
          ]}
        />
      </FilterGroup>
    </FilterSidebar>
  );

  return (
    <div className="flex flex-col h-screen bg-surface-container-low">
      {/* Page header — search debounced + actions */}
      <PageHeader
        title="Hóa đơn (Mockup redesign)"
        searchValue={search}
        searchPlaceholder="Tìm theo mã HĐ / tên KH / mã KH..."
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tạo hoá đơn",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => alert("Mock: tạo hoá đơn"),
          },
        ]}
        onExport={{
          excel: () => alert("Mock: export all to Excel"),
          csv: () => alert("Mock: export all to CSV"),
        }}
      />

      {/* SavedViewsBar — quick filter chips */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-border overflow-x-auto">
        <span className="text-xs text-muted-foreground shrink-0">Lưu view:</span>
        {SAMPLE_VIEWS.map((view) => (
          <button
            key={view.id}
            onClick={() => applyView(view)}
            className={cn(
              "shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors",
              activeViewId === view.id
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
            )}
          >
            {view.name}
          </button>
        ))}
        <button
          onClick={() => setShowSaveViewDialog(true)}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border border-dashed border-primary/40 text-primary hover:bg-primary-fixed/30"
          title="Lưu filter hiện tại thành view mới"
        >
          <Icon name="add" size={12} /> Lưu view
        </button>
      </div>

      {/* KPI summary row — server aggregate trong production */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-2 bg-white border-b border-border">
        <KpiCard label="Số HĐ" value={kpi.count.toString()} />
        <KpiCard label="Tổng tiền" value={formatCurrency(kpi.totalAmount) + "đ"} />
        <KpiCard label="Đã thu" value={formatCurrency(kpi.totalPaid) + "đ"} color="success" />
        <KpiCard label="Còn nợ" value={formatCurrency(kpi.totalDebt) + "đ"} color="warning" />
      </div>

      {/* Body — sidebar + table */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ListPageLayout sidebar={sidebar}>
          <div className="flex flex-col h-full">
            <DataTable
              columns={columns}
              data={paginated}
              total={total}
              pageIndex={page}
              pageSize={pageSize}
              pageCount={Math.ceil(total / pageSize)}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              selectable
              columnToggle
              expandedRow={expandedRow}
              onExpandedRowChange={setExpandedRow}
              renderDetail={(row, onClose) => <InlineDetail invoice={row} onClose={onClose} />}
              bulkActions={[
                {
                  label: "Xuất Excel",
                  icon: <Icon name="download" size={14} />,
                  onClick: handleBulkExport,
                },
                {
                  label: "In hàng loạt",
                  icon: <Icon name="print" size={14} />,
                  onClick: handleBulkPrint,
                },
                {
                  label: "Hủy đơn",
                  icon: <Icon name="cancel" size={14} />,
                  onClick: handleBulkCancel,
                  variant: "destructive",
                },
              ]}
              rowActions={(row) => [
                {
                  label: "Xem chi tiết",
                  icon: <Icon name="visibility" size={14} />,
                  onClick: () => alert(`Mock: xem ${row.code}`),
                },
                {
                  label: "In hóa đơn",
                  icon: <Icon name="print" size={14} />,
                  onClick: () => alert(`Mock: in ${row.code}`),
                },
                {
                  label: "Sao chép",
                  icon: <Icon name="content_copy" size={14} />,
                  onClick: () => alert(`Mock: copy ${row.code}`),
                },
                {
                  label: "Hủy đơn",
                  icon: <Icon name="cancel" size={14} />,
                  onClick: () => alert(`Mock: cancel ${row.code}`),
                  variant: "destructive",
                  separator: true,
                },
              ]}
            />
          </div>
        </ListPageLayout>
      </div>

      {/* Save view dialog (mock) */}
      {showSaveViewDialog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-5 w-96 max-w-full">
            <h3 className="text-lg font-bold mb-3">Lưu view hiện tại</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Sẽ lưu các filter hiện tại (search + status + branch + thời gian + sort) thành view có thể chọn nhanh sau này.
            </p>
            <Input placeholder="Tên view (vd: Đơn nợ tháng này)" className="mb-3" />
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" /> Đặt làm view mặc định khi mở trang
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSaveViewDialog(false)}>
                Hủy
              </Button>
              <Button onClick={() => { setShowSaveViewDialog(false); alert("Mock: đã lưu view"); }}>
                Lưu view
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────
function SortHeader({
  label,
  sorted,
  onClick,
  alignRight,
}: {
  label: string;
  sorted?: boolean;
  onClick: () => void;
  alignRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 hover:text-primary transition-colors w-full",
        alignRight && "justify-end",
      )}
    >
      {label}
      <Icon
        name={sorted === undefined ? "unfold_more" : sorted ? "expand_more" : "expand_less"}
        size={12}
        className={cn(sorted === undefined ? "text-muted-foreground/50" : "text-primary")}
      />
    </button>
  );
}

function StatusPill({ status }: { status: Invoice["status"] }) {
  const config = {
    completed: { label: "Hoàn thành", className: "bg-status-success/15 text-status-success" },
    draft: { label: "Đang nháp", className: "bg-status-warning/15 text-status-warning" },
    cancelled: { label: "Đã hủy", className: "bg-status-error/15 text-status-error" },
  };
  const { label, className } = config[status];
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold", className)}>
      {label}
    </span>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color?: "success" | "warning" }) {
  return (
    <div className="bg-surface-container-low rounded-lg px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div
        className={cn(
          "text-base font-bold tabular-nums mt-0.5",
          color === "success" && "text-status-success",
          color === "warning" && "text-status-warning",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function InlineDetail({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("(Ghi chú cho hóa đơn này)");

  return (
    <div className="bg-surface-container-low p-4 border-y-2 border-primary/20">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-bold">{invoice.code}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {invoice.customerName} ({invoice.customerCode}) · {invoice.branchName} ·{" "}
            {formatDate(invoice.date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Icon name="edit" size={14} className="mr-1" /> Sửa
              </Button>
              <Button size="sm" variant="outline">
                <Icon name="print" size={14} className="mr-1" /> In
              </Button>
              <Button size="sm" variant="outline">
                <Icon name="content_copy" size={14} className="mr-1" /> Sao chép
              </Button>
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-surface-container text-muted-foreground"
                title="Đóng"
              >
                <Icon name="close" size={16} />
              </button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setNote("(Ghi chú cho hóa đơn này)");
                }}
              >
                Hủy
              </Button>
              <Button size="sm" onClick={() => { setEditing(false); alert("Mock: đã lưu thay đổi"); }}>
                <Icon name="save" size={14} className="mr-1" /> Lưu
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 border-b border-border mb-3">
        <button className="text-sm font-semibold text-primary border-b-2 border-primary pb-1.5">
          Sản phẩm ({invoice.itemCount})
        </button>
        <button className="text-sm text-muted-foreground hover:text-foreground pb-1.5">
          Thanh toán
        </button>
        <button className="text-sm text-muted-foreground hover:text-foreground pb-1.5">
          Lịch sử
        </button>
      </div>

      {/* Items table mock */}
      <div className="bg-white rounded border border-border mb-3">
        <table className="w-full text-xs">
          <thead className="bg-surface-container-low border-b border-border">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Tên SP</th>
              <th className="text-right px-3 py-1.5 font-semibold w-16">SL</th>
              <th className="text-right px-3 py-1.5 font-semibold w-24">Đơn giá</th>
              <th className="text-right px-3 py-1.5 font-semibold w-28">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: invoice.itemCount }).map((_, i) => {
              const qty = 1 + Math.floor(Math.random() * 5);
              const price = 50000 + Math.floor(Math.random() * 200000);
              return (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">
                    Cà phê Phin Truyền Thống {i + 1}
                  </td>
                  <td className="text-right px-3 py-1.5 tabular-nums">{qty}</td>
                  <td className="text-right px-3 py-1.5 tabular-nums">{formatCurrency(price)}</td>
                  <td className="text-right px-3 py-1.5 tabular-nums font-semibold">
                    {formatCurrency(qty * price)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Note section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Ghi chú</label>
          {editing ? (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded resize-none"
              rows={3}
            />
          ) : (
            <p className="text-sm text-foreground">{note}</p>
          )}
        </div>
        <div className="text-right space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tổng tiền:</span>
            <span className="tabular-nums">{formatCurrency(invoice.total)}đ</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Đã thu:</span>
            <span className="tabular-nums text-status-success">{formatCurrency(invoice.paid)}đ</span>
          </div>
          {invoice.debt > 0 && (
            <div className="flex justify-between font-bold">
              <span>Còn nợ:</span>
              <span className="tabular-nums text-status-warning">{formatCurrency(invoice.debt)}đ</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Helper
// ─────────────────────────────────────────
function statusLabel(s: string): string {
  return s === "completed" ? "Hoàn thành" : s === "draft" ? "Đang nháp" : "Đã hủy";
}
