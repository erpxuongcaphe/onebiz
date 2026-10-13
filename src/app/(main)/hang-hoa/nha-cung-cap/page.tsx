"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { ListMetric } from "@/components/shared/list-metric";
import {
  FilterChips,
  type ListFilterChip,
} from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
  CheckboxFilter,
  SelectFilter,
  DatePresetFilter,
  RangeFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL,
} from "@/lib/utils/list-date-preset-range";
import { VN_PROVINCES } from "@/lib/data/vn-provinces";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/dialogs";
// PERF (CEO 23/05/2026): Lazy-load CreateSupplierDialog.
import dynamic from "next/dynamic";
const CreateSupplierDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-supplier-dialog").then(
      (m) => m.CreateSupplierDialog,
    ),
  { ssr: false },
);
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { supplierExcelSchema } from "@/lib/excel/schemas";
import { bulkImportSuppliers } from "@/lib/services/supabase/excel-import";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { SupplierImportRow } from "@/lib/excel/schemas";
import {
  getSupplierListWorkspace,
  deleteSupplier,
  getPurchaseOrdersForSupplier,
  getPurchaseOrderStatusMeta,
} from "@/lib/services";
import { useToast, useBranchFilter } from "@/lib/contexts";
import type { Supplier, PurchaseOrder } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { PartyCashHistory } from "@/components/shared/party-cash-history";
import { getSupplierReturnHistory, type SupplierReturnHistoryRow } from "@/lib/services/supabase/supplier-return-history";

/* ------------------------------------------------------------------ */
/*  Inline detail                                                      */
/* ------------------------------------------------------------------ */
function SupplierDetail({
  supplier,
  onClose,
  onEdit,
  onDelete,
  onChanged,
}: {
  supplier: Supplier;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onChanged?: () => void;
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [returns, setReturns] = useState<SupplierReturnHistoryRow[]>([]);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const { activeBranchId } = useBranchFilter();
  const statusMeta = getPurchaseOrderStatusMeta();

  useEffect(() => {
    let cancelled = false;
    setOrdersLoading(true);
    setOrdersError(null); setReturnsError(null); setOrders([]); setReturns([]);
    Promise.allSettled([getPurchaseOrdersForSupplier(supplier.id, null, activeBranchId),getSupplierReturnHistory(supplier.id,activeBranchId)])
      .then(([rows,returned]) => {
        if (cancelled) return;
        if (rows.status === "fulfilled") setOrders(rows.value);
        else setOrdersError(rows.reason instanceof Error ? rows.reason.message : "Không tải được lịch sử mua hàng.");
        if (returned.status === "fulfilled") setReturns(returned.value);
        else setReturnsError(returned.reason instanceof Error ? returned.reason.message : "Không tải được lịch sử trả hàng nhập.");
      })
      .catch((err) => {
        if (cancelled) return;
        setOrdersError(err instanceof Error ? err.message : "Không tải được lịch sử mua hàng.");
      })
      .finally(() => {
        if (cancelled) return;
        setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supplier.id, activeBranchId, historyRevision, supplier.currentDebt]);

  const outstandingOrders = orders.filter((o) => ["completed", "partial"].includes(o.status) && o.amountOwed > 0);
  const totalOrders = orders.length;
  const postedOrders = orders.filter(o => ["completed", "partial"].includes(o.status));
  const totalOrderValue = postedOrders.reduce((sum, o) => sum + o.total, 0);
  const totalPaidAll = postedOrders.reduce((sum, o) => sum + o.paid, 0);
  const totalOwedAll = outstandingOrders.reduce((sum, o) => sum + o.amountOwed, 0);

  const statusBadge = (status: PurchaseOrder["status"]) => {
    const meta = statusMeta[status];
    if (!meta) return <span className="text-muted-foreground">{status}</span>;
    return (
      <Badge
        style={{
          backgroundColor: `${meta.color}20`,
          color: meta.color,
          border: `1px solid ${meta.color}40`,
        }}
        className="font-medium"
      >
        {meta.label}
      </Badge>
    );
  };

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <DetailInfoGrid
          columns={3}
          fields={[
            { label: "Mã NCC", value: supplier.code },
            { label: "Tên NCC", value: supplier.name },
            { label: "Điện thoại", value: supplier.phone },
            { label: "Email", value: supplier.email || "" },
            {
              label: "Địa chỉ",
              value: supplier.address || "",
              fullWidth: true,
            },
            {
              label: supplier.currentDebt < 0 ? "NCC đang giữ" : "Còn phải trả",
              value: (
                <span
                  className={
                    supplier.currentDebt > 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {formatCurrency(Math.abs(supplier.currentDebt))}
                </span>
              ),
            },
            {
              label: "Tổng mua",
              value: formatCurrency(supplier.totalPurchases),
            },
            { label: "Ngày tạo", value: formatDate(supplier.createdAt) },
          ]}
        />
      ),
    },
    {
      id: "purchase_history",
      label: `Lịch sử mua hàng${totalOrders > 0 ? ` (${totalOrders})` : ""}`,
      content: ordersError ? <div role="alert" className="text-sm text-destructive space-y-2"><p>{ordersError}</p><Button variant="outline" onClick={() => setHistoryRevision(v => v + 1)}>Thử lại</Button></div> : ordersLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Đang tải lịch sử mua hàng...
        </div>
      ) : (
        <DetailItemsTable<PurchaseOrder>
          pageSize={25}
          items={orders}
          columns={[
            {
              header: "Mã PO",
              accessor: (o) => (
                <span className="font-medium text-primary">{o.code}</span>
              ),
            },
            {
              header: "Ngày",
              accessor: (o) => formatDate(o.date),
            },
            {
              header: "Tổng tiền",
              align: "right",
              accessor: (o) => formatCurrency(o.total),
            },
            {
              header: "Đã trả",
              align: "right",
              accessor: (o) => formatCurrency(o.paid),
            },
            {
              header: "Còn nợ",
              align: "right",
              accessor: (o) => (
                <span
                  className={
                    o.amountOwed > 0
                      ? "text-destructive font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {formatCurrency(o.amountOwed)}
                </span>
              ),
            },
            {
              header: "Trạng thái",
              align: "center",
              accessor: (o) => statusBadge(o.status),
            },
          ]}
          summary={
            orders.length > 0
              ? [
                  {
                    label: "Giá trị phiếu đã nhập",
                    value: formatCurrency(totalOrderValue),
                  },
                  {
                    label: "Đã trả cho phiếu đã nhập",
                    value: formatCurrency(totalPaidAll),
                  },
                  {
                    label: "Còn nợ",
                    value: (
                      <span
                        className={
                          totalOwedAll > 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {formatCurrency(totalOwedAll)}
                      </span>
                    ),
                  },
                ]
              : undefined
          }
        />
      ),
    },
    {
      id: "debt",
      label: `Công nợ${outstandingOrders.length > 0 ? ` (${outstandingOrders.length})` : ""}`,
      content: (
        <div className="space-y-4">
          <DetailInfoGrid
            columns={2}
            fields={[
              {
                label: supplier.currentDebt < 0 ? "NCC đang giữ" : "Còn phải trả",
                value: (
                  <span
                    className={
                      supplier.currentDebt > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {formatCurrency(Math.abs(supplier.currentDebt))}
                  </span>
                ),
              },
              {
                label: "Tổng mua",
                value: formatCurrency(supplier.totalPurchases),
              },
            ]}
          />
          {ordersError ? <p role="alert" className="text-sm text-destructive">{ordersError}</p> : ordersLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Đang tải danh sách đơn còn nợ...
            </div>
          ) : outstandingOrders.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Đơn còn nợ NCC
              </div>
              <DetailItemsTable<PurchaseOrder>
                pageSize={25}
                items={outstandingOrders}
                columns={[
                  {
                    header: "Mã PO",
                    accessor: (o) => (
                      <span className="font-medium text-primary">{o.code}</span>
                    ),
                  },
                  {
                    header: "Ngày",
                    accessor: (o) => formatDate(o.date),
                  },
                  {
                    header: "Tổng",
                    align: "right",
                    accessor: (o) => formatCurrency(o.total),
                  },
                  {
                    header: "Đã trả",
                    align: "right",
                    accessor: (o) => formatCurrency(o.paid),
                  },
                  {
                    header: "Còn nợ",
                    align: "right",
                    accessor: (o) => (
                      <span className="text-destructive font-medium">
                        {formatCurrency(o.amountOwed)}
                      </span>
                    ),
                  },
                  {
                    header: "Trạng thái",
                    align: "center",
                    accessor: (o) => statusBadge(o.status),
                  },
                ]}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Không có đơn còn nợ
            </div>
          )}
        </div>
      ),
    },
    {
      id: "return_history",
      label: `Trả hàng nhập (${returns.length})`,
      content: returnsError ? <div role="alert" className="text-sm text-destructive"><p>{returnsError}</p><Button variant="outline" onClick={()=>setHistoryRevision(v=>v+1)}>Thử lại</Button></div> : ordersLoading ? <p>Đang tải lịch sử trả hàng nhập...</p> : <DetailItemsTable pageSize={25} items={returns} columns={[
        {header:"Mã phiếu trả",accessor:"code"},{header:"Ngày",accessor:r=>formatDate(r.date)},
        {header:"Giá trị trả",align:"right",accessor:r=>formatCurrency(r.totalAmount)},
        {header:"Trạng thái",accessor:r=>r.status === "cancelled" ? "Đã hủy" : r.status === "completed" ? "Hoàn thành" : "Chưa hoàn tất"},
      ]} />,
    },
    {
      id: "audit",
      label: "Lịch sử thay đổi",
      content: <AuditHistoryTab entityType="supplier" entityId={supplier.id} />,
    },
    { id: "cash", label: "Thu chi", content: <PartyCashHistory mode="supplier" partyId={supplier.id} partyName={supplier.name} onChanged={onChanged} /> },
  ];

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
    >
      <div className="p-4 space-y-4">
        <DetailHeader
          title={supplier.name}
          code={supplier.code}
          subtitle={supplier.phone}
          meta={<span>Ngày tạo: {formatDate(supplier.createdAt)}</span>}
        />
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function NhaCungCapPage() {
  const { toast } = useToast();
  const [data, setData] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // CEO 04/07: ô "Tìm theo" — "all" = gộp mã+tên+SĐT như cũ.
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Delete
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Filters
  const [totalBuyFrom, setTotalBuyFrom] = useState("");
  const [totalBuyTo, setTotalBuyTo] = useState("");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [debtFrom, setDebtFrom] = useState("");
  const [debtTo, setDebtTo] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "active",
    "inactive",
  ]);
  // Day 17/05/2026: filter Tỉnh/TP
  const [provinceFilter, setProvinceFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [summary, setSummary] = useState({
    totalPurchases: 0,
    totalDebt: 0,
    suppliersWithDebt: 0,
  });

  /* ---- Columns ---- */
  const columns: ColumnDef<Supplier, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã NCC",
      size: 110,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên NCC",
      size: 280,
    },
    {
      accessorKey: "phone",
      header: "Điện thoại",
      size: 130,
    },
    {
      accessorKey: "email",
      header: "Email",
      size: 200,
      cell: ({ row }) => row.original.email || "—",
    },
    {
      accessorKey: "currentDebt",
      header: "Số dư công nợ",
      cell: ({ row }) => {
        const debt = row.original.currentDebt;
        return (
          <span
            className={debt > 0 ? "text-destructive tabular-nums" : debt < 0 ? "text-status-success tabular-nums" : "text-muted-foreground tabular-nums"}
          >
            {formatCurrency(debt)}
            {debt < 0 && <span className="block text-xs">NCC đang giữ</span>}
          </span>
        );
      },
    },
    {
      accessorKey: "totalPurchases",
      header: "Tổng mua",
      cell: ({ row }) => formatCurrency(row.original.totalPurchases),
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true);
    // Không có try/finally thì truy vấn lỗi là cờ loading không bao giờ tắt →
    // trang treo mãi ở vòng xoay, người dùng không biết vì sao.
    try {
      const presetRange = computeListPresetRange(datePreset);
      const effectiveDateFrom =
        datePreset === "custom" ? dateFrom : presetRange.from;
      const effectiveDateTo = datePreset === "custom" ? dateTo : presetRange.to;
      const result = await getSupplierListWorkspace({
        page,
        pageSize,
        search,
        searchField,
        statuses: selectedStatuses,
        debtFrom,
        debtTo,
        totalPurchaseFrom: totalBuyFrom,
        totalPurchaseTo: totalBuyTo,
        dateFrom: effectiveDateFrom,
        dateTo: effectiveDateTo,
        province: provinceFilter,
      });
      setData(result.data);
      setTotal(result.total);
      setSummary(result.summary);
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách nhà cung cấp",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    search,
    searchField,
    selectedStatuses,
    debtFrom,
    debtTo,
    datePreset,
    dateFrom,
    dateTo,
    totalBuyFrom,
    totalBuyTo,
    provinceFilter,
    toast,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CEO 23/05/2026: refetch khi tab visible/focus lại → fix bug F5 stale
  useRevalidateOnFocus(fetchData);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [
    search,
    selectedStatuses,
    datePreset,
    dateFrom,
    dateTo,
    totalBuyFrom,
    totalBuyTo,
    debtFrom,
    debtTo,
    provinceFilter,
  ]);

  /* ---- Summary ---- */
  const pageTotalDebt = data.reduce((sum, s) => sum + s.currentDebt, 0);
  const pageTotalPurchases = data.reduce((sum, s) => sum + s.totalPurchases, 0);
  const datePresetLabel = useMemo(() => {
    if (datePreset === "all") return "Tất cả thời gian";
    if (datePreset === "custom")
      return !dateFrom && !dateTo
        ? "Tùy chỉnh"
        : `${dateFrom || "..."} đến ${dateTo || "..."}`;
    return (
      STANDARD_LIST_PRESETS_WITH_ALL.find((item) => item.value === datePreset)
        ?.label ?? "Thời gian"
    );
  }, [dateFrom, datePreset, dateTo]);
  const clearListFilters = useCallback(() => {
    setTotalBuyFrom("");
    setTotalBuyTo("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setDebtFrom("");
    setDebtTo("");
    setProvinceFilter("all");
    setSelectedStatuses(["active", "inactive"]);
  }, []);
  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (totalBuyFrom || totalBuyTo)
      chips.push({
        key: "purchase",
        label: "Tổng mua",
        value: `${totalBuyFrom || "0"} đến ${totalBuyTo || "..."}`,
        onClear: () => {
          setTotalBuyFrom("");
          setTotalBuyTo("");
        },
      });
    if (datePreset !== "all")
      chips.push({
        key: "date",
        label: "Thời gian",
        value: datePresetLabel,
        onClear: () => {
          setDatePreset("all");
          setDateFrom("");
          setDateTo("");
        },
      });
    if (debtFrom || debtTo)
      chips.push({
        key: "debt",
        label: "Nợ hiện tại",
        value: `${debtFrom || "0"} đến ${debtTo || "..."}`,
        onClear: () => {
          setDebtFrom("");
          setDebtTo("");
        },
      });
    if (provinceFilter !== "all")
      chips.push({
        key: "province",
        label: "Tỉnh / Thành phố",
        value: provinceFilter,
        onClear: () => setProvinceFilter("all"),
      });
    if (selectedStatuses.length !== 2)
      chips.push({
        key: "status",
        label: "Trạng thái",
        value:
          selectedStatuses.length === 0
            ? "Tất cả"
            : selectedStatuses
                .map((value) =>
                  value === "active" ? "Đang giao dịch" : "Ngừng giao dịch",
                )
                .join(", "),
        onClear: () => setSelectedStatuses(["active", "inactive"]),
      });
    return chips;
  }, [
    datePreset,
    datePresetLabel,
    debtFrom,
    debtTo,
    provinceFilter,
    selectedStatuses,
    totalBuyFrom,
    totalBuyTo,
  ]);
  const emptyState =
    search.trim() || filterChips.length > 0 ? "no-results" : "no-data";

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    if (type === "excel") {
      const rows: SupplierImportRow[] = data.map((s) => ({
        code: s.code,
        name: s.name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        taxCode: s.taxCode,
        note: s.note,
        isActive: true,
      }));
      exportToExcelFromSchema(rows, supplierExcelSchema);
      return;
    }
    const exportColumns = [
      { header: "Mã NCC", key: "code", width: 12 },
      { header: "Tên NCC", key: "name", width: 25 },
      { header: "Điện thoại", key: "phone", width: 15 },
      { header: "Email", key: "email", width: 25 },
      {
        header: "Số dư công nợ",
        key: "currentDebt",
        width: 18,
        format: (v: number) => v,
      },
      {
        header: "Tổng mua",
        key: "totalPurchases",
        width: 15,
        format: (v: number) => v,
      },
    ];
    exportToCsv(data, exportColumns, "danh-sach-nha-cung-cap");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (supplier: Supplier, onClose: () => void) => (
    <SupplierDetail
      supplier={supplier}
      onChanged={() => { void fetchData({ background: true }); }}
      onClose={onClose}
      onEdit={() => {
        setEditingSupplier(supplier);
        setCreateOpen(true);
      }}
      onDelete={() => setDeletingSupplier(supplier)}
    />
  );

  /* ---- Render ---- */
  return (
    <>
      <ListPageLayout sidebar={null}>
        <PageHeader
          title="Nhà cung cấp"
          density="compact"
          searchPlaceholder="Theo mã, tên, SĐT NCC"
          searchValue={search}
          onSearchChange={setSearch}
          searchFields={[
            { value: "all", label: "Tất cả" },
            { value: "code", label: "Mã NCC" },
            { value: "name", label: "Tên" },
            { value: "phone", label: "SĐT" },
          ]}
          searchField={searchField}
          onSearchFieldChange={(v) => {
            setSearchField(v);
            setPage(0);
          }}
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          actions={[
            {
              label: "Nhà cung cấp",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
            {
              label: "Tải mẫu",
              icon: <Icon name="description" size={16} />,
              variant: "ghost",
              onClick: () => downloadTemplate(supplierExcelSchema),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload" size={16} />,
              onClick: () => setImportOpen(true),
            },
          ]}
        />

        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          density="compact"
          columnToggle
          toolbarMetrics={
            <>
              <ListMetric
                icon={<Icon name="local_shipping" size={15} />}
                label="Kết quả"
                value={formatNumber(total)}
                hint="Tổng số NCC theo bộ lọc"
              />
              <ListMetric
                icon={<Icon name="trending_up" size={15} />}
                label="Tổng mua"
                value={formatCurrency(summary.totalPurchases)}
                hint="Toàn bộ kết quả đang lọc"
              />
              <ListMetric
                icon={<Icon name="account_balance_wallet" size={15} />}
                label="Số dư công nợ"
                value={formatCurrency(summary.totalDebt)}
                hint={
                  summary.suppliersWithDebt > 0
                    ? `${summary.suppliersWithDebt} NCC còn nợ`
                    : summary.totalDebt < 0 ? "NCC đang giữ tiền" : "Không có nợ"
                }
                tone={summary.totalDebt > 0 ? "danger" : "default"}
              />
              <ListMetric
                icon={<Icon name="verified" size={15} />}
                label="Đang hiển thị"
                value={formatNumber(data.length)}
                hint={`Trang ${page + 1}`}
              />
            </>
          }
          toolbarActions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
                onClick={() => setFilterOpen(true)}
              >
                <Icon name="calendar_today" size={15} />
                <span className="hidden sm:inline">{datePresetLabel}</span>
              </Button>
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
            </>
          }
          toolbarFooter={
            <FilterChips
              filters={filterChips}
              onClearAll={filterChips.length > 1 ? clearListFilters : undefined}
            />
          }
          emptyState={emptyState}
          emptyTitle={
            emptyState === "no-results"
              ? "Không tìm thấy nhà cung cấp"
              : "Chưa có nhà cung cấp"
          }
          emptyDescription={
            emptyState === "no-results"
              ? "Thử thay đổi tổng mua, thời gian, công nợ, tỉnh thành, trạng thái hoặc nội dung tìm kiếm."
              : 'Bấm "Tạo mới" để thêm nhà cung cấp hoặc dùng "Nhập Excel" để nhập danh sách.'
          }
          emptyIcon="local_shipping"
          pageIndex={page}
          pageSize={pageSize}
          pageCount={Math.ceil(total / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          selectable
          summaryRow={{
            currentDebt: formatCurrency(pageTotalDebt),
            totalPurchases: formatCurrency(pageTotalPurchases),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={renderDetail}
          getRowId={(row) => row.id}
          rowActions={(row) => [
            {
              label: "Sửa",
              icon: <Icon name="edit" size={16} />,
              onClick: () => {
                setEditingSupplier(row);
                setCreateOpen(true);
              },
            },
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
              onClick: () => setDeletingSupplier(row),
              variant: "destructive",
              separator: true,
            },
          ]}
        />

        <FilterPanel
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={filterChips.length}
          onClearAll={clearListFilters}
          title="Bộ lọc nhà cung cấp"
        >
          <FilterGroup label="Tổng mua">
            <RangeFilter
              fromValue={totalBuyFrom}
              toValue={totalBuyTo}
              onFromChange={setTotalBuyFrom}
              onToChange={setTotalBuyTo}
              fromPlaceholder="Giá trị"
              toPlaceholder="Giá trị"
            />
          </FilterGroup>
          <FilterGroup label="Thời gian" activeHint={datePresetLabel}>
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              presets={STANDARD_LIST_PRESETS_WITH_ALL}
            />
          </FilterGroup>
          <FilterGroup label="Nợ hiện tại">
            <RangeFilter
              fromValue={debtFrom}
              toValue={debtTo}
              onFromChange={setDebtFrom}
              onToChange={setDebtTo}
              fromPlaceholder="Nhập giá trị"
              toPlaceholder="Nhập giá trị"
            />
          </FilterGroup>
          <FilterGroup
            label="Tỉnh / Thành phố"
            activeHint={provinceFilter !== "all" ? provinceFilter : undefined}
          >
            <SelectFilter
              value={provinceFilter}
              onChange={setProvinceFilter}
              options={[
                { label: "Tất cả tỉnh/thành", value: "all" },
                ...VN_PROVINCES.map((p) => ({ label: p.name, value: p.name })),
              ]}
              placeholder="Chọn tỉnh/thành"
            />
          </FilterGroup>
          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={[
                { label: "Đang giao dịch", value: "active" },
                { label: "Ngừng giao dịch", value: "inactive" },
              ]}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>
        </FilterPanel>
      </ListPageLayout>

      <CreateSupplierDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditingSupplier(null);
        }}
        onSuccess={fetchData}
        initialData={editingSupplier ?? undefined}
      />

      <ConfirmDialog
        open={!!deletingSupplier}
        onOpenChange={(open) => {
          if (!open) setDeletingSupplier(null);
        }}
        title="Xóa nhà cung cấp"
        description={`Xóa nhà cung cấp ${deletingSupplier?.code} — ${deletingSupplier?.name}?`}
        confirmLabel="Xóa"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={async () => {
          if (!deletingSupplier) return;
          setDeleteLoading(true);
          try {
            await deleteSupplier(deletingSupplier.id);
            toast({
              title: "Đã xóa nhà cung cấp",
              description: `${deletingSupplier.code} — ${deletingSupplier.name}`,
              variant: "success",
            });
            setDeletingSupplier(null);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi xóa nhà cung cấp",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={supplierExcelSchema}
        onCommit={bulkImportSuppliers}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách nhà cung cấp đã được cập nhật.",
            variant: "success",
          });
        }}
      />
    </>
  );
}
