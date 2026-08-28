"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { ListMetric } from "@/components/shared/list-metric";
import {
  FilterChips,
  type ListFilterChip,
} from "@/components/shared/filter-chips";
import { SavedViewsTabs } from "@/components/shared/saved-views-tabs";
import type { CustomerFilters } from "@/lib/services/supabase/customer-saved-views";
import {
  FilterPanel,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  ChipToggleFilter,
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import { VN_PROVINCES } from "@/lib/data/vn-provinces";
import type { DatePresetValue } from "@/components/shared/filter-sidebar";
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL,
} from "@/lib/utils/list-date-preset-range";
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
import {
  ChangeCustomerCodeDialog,
  ConfirmDialog,
} from "@/components/shared/dialogs";
// PERF (CEO 23/05/2026): Lazy-load CreateCustomerDialog (534 dòng).
import dynamic from "next/dynamic";
const CreateCustomerDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-customer-dialog").then(
      (m) => m.CreateCustomerDialog,
    ),
  { ssr: false },
);
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { customerExcelSchema } from "@/lib/excel/schemas";
import { bulkImportCustomers } from "@/lib/services/supabase/excel-import";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { OtpApprovalDialog } from "@/components/shared/dialogs/otp-approval-dialog";
import { OTP_ACTION_CODES } from "@/lib/services/supabase/manager-otp";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { CustomerImportRow } from "@/lib/excel/schemas";
import {
  getCustomerListWorkspace,
  getCustomerGroupsAsync,
  deleteCustomer,
  getInvoicesForCustomer,
  getReturnsForCustomer,
  getLoyaltyTransactions,
  type CustomerReturn,
} from "@/lib/services";
import type { Customer, Invoice, LoyaltyTransaction } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Starred set (local state — could be persisted to backend later)   */
/* ------------------------------------------------------------------ */
function useStarredSet() {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { starred, toggle };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function KhachHangPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady: branchScopeReady } = useBranchFilter();

  // Sprint S2 Phase 1 + 3a (CEO 12/05): defense-in-depth permission cho xoá KH.
  //   - canDeleteCustomer = true  → bấm Xoá → ConfirmDialog → service trực tiếp
  //   - canDeleteCustomer = false → bấm Xoá → ConfirmDialog → mở OTP dialog
  //     → manager cấp OTP từ /manager/otp → cashier nhập → service với otpId
  const { hasPermission } = usePermissions();
  const canDeleteCustomer = hasPermission(PERMISSIONS.CUSTOMERS_DELETE);
  const canEditCustomer = hasPermission(PERMISSIONS.CUSTOMERS_EDIT);
  // Sprint A.2: cashier KHÔNG được thấy công nợ KH (leak business data).
  const canViewDebt = hasPermission(PERMISSIONS.CUSTOMERS_VIEW_DEBT);

  // OTP delegation state
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpTargetCustomer, setOtpTargetCustomer] = useState<Customer | null>(
    null,
  );
  const [data, setData] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // CEO 04/07: ô "Tìm theo" — "all" = gộp mã+tên+SĐT như cũ.
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summary, setSummary] = useState({
    totalSales: 0,
    totalReturns: 0,
    netSales: 0,
    totalDebt: 0,
    customersWithDebt: 0,
  });

  // Filters
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [debtFilter, setDebtFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // CEO 06/06/2026 Phase 3: auto-set dateFrom/dateTo từ preset.
  // Trước đây chỉ "Tùy chỉnh" mới filter — preset khác là decoration.
  // Giờ chọn preset bất kỳ → fetchData tự pass range xuống service.
  useEffect(() => {
    if (datePreset === "custom") return; // user tự nhập date picker
    const range = computeListPresetRange(datePreset);
    setDateFrom(range.from ?? "");
    setDateTo(range.to ?? "");
  }, [datePreset]);
  // Day 17/05/2026: filter theo Tỉnh/TP (34 tỉnh sau sáp nhập)
  const [provinceFilter, setProvinceFilter] = useState("all");
  // CEO 06/06/2026 (research Sapo + Square + Toast + HubSpot):
  // 4 filter mới chuẩn ngành FnB: LTV (tổng chi tiêu) + Tần suất (số lần mua)
  const [salesRangeFilter, setSalesRangeFilter] = useState("all");
  const [ordersRangeFilter, setOrdersRangeFilter] = useState("all");
  // CEO 06/06/2026 Phase 3 (sau migration 00131):
  const [lastPurchaseFilter, setLastPurchaseFilter] = useState("all");
  const [birthdayMonthFilter, setBirthdayMonthFilter] = useState("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [changingCodeCustomer, setChangingCodeCustomer] =
    useState<Customer | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Delete
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Customer groups load từ DB (async). Trước đây dùng `getCustomerGroups()`
  // sync stub trả `[]` → filter sidebar luôn rỗng dù DB có nhóm.
  const [customerGroups, setCustomerGroups] = useState<
    { label: string; value: string; count: number }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    getCustomerGroupsAsync()
      .catch(() => [])
      .then((groups) => {
        if (cancelled) return;
        setCustomerGroups(groups);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Columns (defined inside component so we can access starred) ---- */
  const columns: ColumnDef<Customer, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 40,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <StarCell
          starred={starred.has(row.original.id)}
          onToggle={() => toggleStar(row.original.id)}
        />
      ),
    },
    {
      accessorKey: "code",
      header: "Mã KH",
      size: 110,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên KH",
      size: 240,
    },
    {
      accessorKey: "phone",
      header: "Điện thoại",
      size: 130,
    },
    // Sprint A.2: column "Nợ hiện tại" chỉ hiện với customers.view_debt
    ...(canViewDebt
      ? [
          {
            accessorKey: "currentDebt",
            header: "Nợ hiện tại",
            cell: ({ row }: { row: { original: Customer } }) => {
              const debt = row.original.currentDebt;
              return (
                <span
                  className={
                    debt > 0 ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {formatCurrency(debt)}
                </span>
              );
            },
          } as ColumnDef<Customer, unknown>,
        ]
      : []),
    {
      accessorKey: "totalSales",
      header: "Tổng bán",
      cell: ({ row }) => formatCurrency(row.original.totalSales),
    },
    {
      accessorKey: "totalSalesMinusReturns",
      header: "Tổng bán trừ trả hàng",
      cell: ({ row }) => formatCurrency(row.original.totalSalesMinusReturns),
    },
    {
      accessorKey: "loyaltyPoints",
      header: "Điểm / Hạng",
      size: 160,
      cell: ({ row }) => {
        const pts = row.original.loyaltyPoints ?? 0;
        const tierName = row.original.loyaltyTierName;
        return (
          <div className="flex items-center gap-2">
            <span
              className={
                pts > 0
                  ? "font-medium text-status-success tabular-nums"
                  : "text-muted-foreground tabular-nums"
              }
            >
              {formatNumber(pts)}
            </span>
            {tierName && (
              <Badge
                variant="outline"
                className="bg-primary-fixed/15 text-primary border-primary/25 text-[10px] uppercase font-semibold"
              >
                {tierName}
              </Badge>
            )}
          </div>
        );
      },
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!branchScopeReady) return;
    if (!background) setLoading(true);
    // Không có try/finally thì truy vấn lỗi là cờ loading không bao giờ tắt →
    // trang treo mãi ở vòng xoay, người dùng không biết vì sao.
    try {
      const presetRange = computeListPresetRange(datePreset);
      const effectiveDateFrom =
        datePreset === "custom" ? dateFrom : presetRange.from;
      const effectiveDateTo = datePreset === "custom" ? dateTo : presetRange.to;
      const result = await getCustomerListWorkspace({
        page,
        pageSize,
        branchId: activeBranchId ?? undefined,
        search,
        searchField,
        groupIds: selectedGroups,
        customerType: typeFilter,
        gender: genderFilter,
        debtFilter: canViewDebt ? debtFilter : "all",
        salesRange: salesRangeFilter,
        ordersRange: ordersRangeFilter,
        lastPurchase: lastPurchaseFilter,
        birthdayMonth: birthdayMonthFilter,
        tags: selectedTags,
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
        title: "Không tải được danh sách khách hàng",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    activeBranchId,
    branchScopeReady,
    search,
    searchField,
    selectedGroups,
    typeFilter,
    genderFilter,
    debtFilter,
    salesRangeFilter,
    ordersRangeFilter,
    lastPurchaseFilter,
    birthdayMonthFilter,
    selectedTags,
    canViewDebt,
    datePreset,
    dateFrom,
    dateTo,
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
    // Reset expanded row khi filter/search đổi: vì `expandedRow` là INDEX
    // (DataTable không support id-based), nếu giữ → row bị mở chuyển sang
    // KH khác (index cũ trỏ đến record mới sau filter). Pattern này đồng
    // bộ với nha-cung-cap/page.tsx.
    setExpandedRow(null);
  }, [
    search,
    activeBranchId,
    selectedGroups,
    typeFilter,
    genderFilter,
    debtFilter,
    salesRangeFilter,
    ordersRangeFilter,
    lastPurchaseFilter,
    birthdayMonthFilter,
    selectedTags,
    dateFrom,
    dateTo,
    provinceFilter,
  ]);

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
    setSelectedGroups([]);
    setTypeFilter("all");
    setGenderFilter("all");
    setDebtFilter("all");
    setSalesRangeFilter("all");
    setOrdersRangeFilter("all");
    setLastPurchaseFilter("all");
    setBirthdayMonthFilter("all");
    setSelectedTags([]);
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setProvinceFilter("all");
  }, []);

  const filterChips = useMemo<ListFilterChip[]>(() => {
    const chips: ListFilterChip[] = [];
    if (selectedGroups.length > 0)
      chips.push({
        key: "groups",
        label: "Nhóm",
        value: selectedGroups
          .map(
            (id) =>
              customerGroups.find((group) => group.value === id)?.label ?? id,
          )
          .join(", "),
        onClear: () => setSelectedGroups([]),
      });
    if (typeFilter !== "all")
      chips.push({
        key: "type",
        label: "Loại",
        value: typeFilter === "individual" ? "Cá nhân" : "Công ty",
        onClear: () => setTypeFilter("all"),
      });
    if (genderFilter !== "all")
      chips.push({
        key: "gender",
        label: "Giới tính",
        value: genderFilter === "male" ? "Nam" : "Nữ",
        onClear: () => setGenderFilter("all"),
      });
    if (canViewDebt && debtFilter !== "all")
      chips.push({
        key: "debt",
        label: "Công nợ",
        value: debtFilter === "has_debt" ? "Còn nợ" : "Đã trả đủ",
        onClear: () => setDebtFilter("all"),
      });
    if (salesRangeFilter !== "all")
      chips.push({
        key: "sales",
        label: "Tổng chi tiêu",
        value: salesRangeFilter,
        onClear: () => setSalesRangeFilter("all"),
      });
    if (ordersRangeFilter !== "all")
      chips.push({
        key: "orders",
        label: "Số lần mua",
        value: ordersRangeFilter,
        onClear: () => setOrdersRangeFilter("all"),
      });
    if (lastPurchaseFilter !== "all")
      chips.push({
        key: "last-purchase",
        label: "Lần mua cuối",
        value: lastPurchaseFilter,
        onClear: () => setLastPurchaseFilter("all"),
      });
    if (birthdayMonthFilter !== "all")
      chips.push({
        key: "birthday",
        label: "Sinh nhật",
        value: `Tháng ${birthdayMonthFilter}`,
        onClear: () => setBirthdayMonthFilter("all"),
      });
    if (selectedTags.length > 0)
      chips.push({
        key: "tags",
        label: "Tags",
        value: selectedTags.join(", "),
        onClear: () => setSelectedTags([]),
      });
    if (datePreset !== "all")
      chips.push({
        key: "date",
        label: "Thời gian tạo",
        value: datePresetLabel,
        onClear: () => {
          setDatePreset("all");
          setDateFrom("");
          setDateTo("");
        },
      });
    if (provinceFilter !== "all")
      chips.push({
        key: "province",
        label: "Tỉnh / Thành phố",
        value: provinceFilter,
        onClear: () => setProvinceFilter("all"),
      });
    return chips;
  }, [
    birthdayMonthFilter,
    canViewDebt,
    customerGroups,
    datePreset,
    datePresetLabel,
    debtFilter,
    genderFilter,
    lastPurchaseFilter,
    ordersRangeFilter,
    provinceFilter,
    salesRangeFilter,
    selectedGroups,
    selectedTags,
    typeFilter,
  ]);
  const emptyState =
    search.trim() || filterChips.length > 0 ? "no-results" : "no-data";

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    if (type === "excel") {
      // Xuất theo schema import → user edit rồi upload lại không mất field
      const rows: CustomerImportRow[] = data.map((c) => ({
        code: c.code,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        customerType: c.type,
        gender: c.gender,
        groupCode: c.groupName, // bulk service match nhóm theo TÊN (không có code)
        isActive: true,
      }));
      exportToExcelFromSchema(rows, customerExcelSchema);
      return;
    }
    const exportColumns = [
      { header: "Mã KH", key: "code", width: 12 },
      { header: "Tên khách hàng", key: "name", width: 25 },
      { header: "SĐT", key: "phone", width: 15 },
      { header: "Email", key: "email", width: 25 },
      {
        header: "Nợ hiện tại",
        key: "currentDebt",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Tổng bán",
        key: "totalSales",
        width: 15,
        format: (v: number) => v,
      },
      { header: "Nhóm", key: "groupName", width: 20 },
    ];
    exportToCsv(data, exportColumns, "danh-sach-khach-hang");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (customer: Customer, onClose: () => void) => (
    <CustomerDetailPanel
      customer={customer}
      onClose={onClose}
      onEdit={() => {
        setEditingCustomer(customer);
        setCreateOpen(true);
      }}
      // Phase 3a: button "Xoá" luôn hiện. Cashier không có quyền sẽ được
      // chuyển sang OTP flow trong ConfirmDialog onConfirm.
      onDelete={() => setDeletingCustomer(customer)}
    />
  );

  /* ---- Render ---- */
  return (
    <>
      <ListPageLayout sidebar={null}>
        <PageHeader
          title="Khách hàng"
          density="compact"
          searchPlaceholder="Theo mã, tên, SĐT"
          searchValue={search}
          onSearchChange={setSearch}
          searchFields={[
            { value: "all", label: "Tất cả" },
            { value: "code", label: "Mã KH" },
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
              label: "Tạo mới",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
            {
              label: "Tải mẫu",
              icon: <Icon name="description" size={16} />,
              variant: "ghost",
              onClick: () => downloadTemplate(customerExcelSchema),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload" size={16} />,
              onClick: () => setImportOpen(true),
            },
          ]}
        />

        {/* CEO 06/06/2026 — Phase 4 Saved Views (pattern Sapo/HubSpot) */}
        <SavedViewsTabs
          currentFilters={{
            debt: debtFilter,
            salesRange: salesRangeFilter,
            ordersRange: ordersRangeFilter,
            lastPurchase: lastPurchaseFilter,
            birthdayMonth: birthdayMonthFilter,
            tags: selectedTags,
            type: typeFilter,
            gender: genderFilter,
            groups: selectedGroups,
            province: provinceFilter,
          }}
          onApply={(f: CustomerFilters) => {
            // Reset tất cả về "all" trước, sau đó apply các field từ view
            setDebtFilter(f.debt ?? "all");
            setSalesRangeFilter(f.salesRange ?? "all");
            setOrdersRangeFilter(f.ordersRange ?? "all");
            setLastPurchaseFilter(f.lastPurchase ?? "all");
            setBirthdayMonthFilter(f.birthdayMonth ?? "all");
            setSelectedTags(Array.isArray(f.tags) ? f.tags : []);
            setTypeFilter(f.type ?? "all");
            setGenderFilter(f.gender ?? "all");
            setSelectedGroups(Array.isArray(f.groups) ? f.groups : []);
            setProvinceFilter(f.province ?? "all");
            setPage(0);
          }}
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
                icon={<Icon name="group" size={15} />}
                label="Kết quả"
                value={formatNumber(total)}
                hint="Toàn bộ khách theo bộ lọc"
              />
              <ListMetric
                icon={<Icon name="point_of_sale" size={15} />}
                label="Doanh số"
                value={formatCurrency(summary.totalSales)}
                hint="Toàn bộ kết quả đang lọc"
              />
              <ListMetric
                icon={<Icon name="sell" size={15} />}
                label="Doanh số ròng"
                value={formatCurrency(summary.netSales)}
                hint={`Đã trừ ${formatCurrency(summary.totalReturns)} trả hàng`}
              />
              {canViewDebt && (
                <ListMetric
                  icon={<Icon name="account_balance" size={15} />}
                  label="Công nợ"
                  value={formatCurrency(summary.totalDebt)}
                  hint={
                    summary.customersWithDebt > 0
                      ? `${summary.customersWithDebt} khách còn nợ`
                      : "Không có nợ"
                  }
                  tone={summary.totalDebt > 0 ? "danger" : "default"}
                />
              )}
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
          pageIndex={page}
          pageSize={pageSize}
          pageCount={Math.ceil(total / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          // CEO 22/05/2026 (UX P0 #1): empty state context-aware
          emptyState={emptyState}
          emptyIcon="person_add"
          emptyTitle={
            emptyState === "no-results"
              ? "Không tìm thấy khách hàng"
              : "Chưa có khách hàng nào"
          }
          emptyDescription={
            emptyState === "no-results"
              ? "Thử thay đổi nhóm, loại khách, giới tính, công nợ, doanh số, số lần mua, thời gian hoặc nội dung tìm kiếm."
              : 'Bấm "Tạo mới" để thêm khách hoặc dùng "Nhập Excel" để nhập danh sách.'
          }
          selectable
          bulkActions={[
            {
              label: "Xuất Excel",
              icon: <Icon name="download" size={16} />,
              onClick: (selectedRows) => {
                const rows: CustomerImportRow[] = selectedRows.map((c) => ({
                  code: c.code,
                  name: c.name,
                  phone: c.phone,
                  email: c.email,
                  address: c.address,
                  customerType: c.type,
                  gender: c.gender,
                  groupCode: c.groupName,
                  isActive: true,
                }));
                exportToExcelFromSchema(rows, customerExcelSchema);
                toast({
                  title: "Đã xuất Excel",
                  description: `${selectedRows.length} khách hàng`,
                  variant: "success",
                });
              },
            },
            {
              label: "Xóa hàng loạt",
              icon: <Icon name="delete" size={16} />,
              variant: "destructive",
              onClick: async (selectedRows) => {
                if (
                  !window.confirm(
                    `Xóa ${selectedRows.length} khách hàng? Thao tác này không thể hoàn tác.`,
                  )
                )
                  return;
                try {
                  await Promise.all(
                    selectedRows.map((r) => deleteCustomer(r.id)),
                  );
                  toast({
                    title: `Đã xóa ${selectedRows.length} khách hàng`,
                    variant: "success",
                  });
                  await fetchData();
                } catch (err) {
                  toast({
                    title: "Lỗi xóa hàng loạt",
                    description:
                      err instanceof Error ? err.message : "Vui lòng thử lại",
                    variant: "error",
                  });
                }
              },
            },
          ]}
          summaryRow={{
            ...(canViewDebt && {
              currentDebt: formatCurrency(
                data.reduce((sum, customer) => sum + customer.currentDebt, 0),
              ),
            }),
            totalSales: formatCurrency(
              data.reduce((sum, customer) => sum + customer.totalSales, 0),
            ),
            totalSalesMinusReturns: formatCurrency(
              data.reduce(
                (sum, customer) => sum + customer.totalSalesMinusReturns,
                0,
              ),
            ),
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
                setEditingCustomer(row);
                setCreateOpen(true);
              },
            },
            ...(canEditCustomer && !row.isInternal && row.code !== "KL-VL"
              ? [
                  {
                    label: "Đổi mã khách hàng",
                    icon: <Icon name="badge" size={16} />,
                    onClick: () => setChangingCodeCustomer(row),
                  },
                ]
              : []),
            // Phase 3a: luôn hiện row action "Xoá". Permission check chuyển
            // sang ConfirmDialog onConfirm — không có quyền sẽ mở OTP dialog.
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
              onClick: () => setDeletingCustomer(row),
              variant: "destructive" as const,
              separator: true,
            },
          ]}
        />

        <FilterPanel
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={filterChips.length}
          onClearAll={clearListFilters}
          title="Bộ lọc khách hàng"
        >
          <FilterGroup label="Nhóm khách hàng">
            <CheckboxFilter
              options={customerGroups}
              selected={selectedGroups}
              onChange={setSelectedGroups}
            />
          </FilterGroup>
          <FilterGroup label="Loại khách hàng">
            <ChipToggleFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Cá nhân", value: "individual" },
                { label: "Công ty", value: "company" },
              ]}
              value={typeFilter}
              onChange={setTypeFilter}
            />
          </FilterGroup>
          <FilterGroup label="Giới tính">
            <ChipToggleFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Nam", value: "male" },
                { label: "Nữ", value: "female" },
              ]}
              value={genderFilter}
              onChange={setGenderFilter}
            />
          </FilterGroup>
          {canViewDebt && (
            <FilterGroup label="Công nợ">
              <ChipToggleFilter
                options={[
                  { label: "Tất cả", value: "all" },
                  { label: "Còn nợ", value: "has_debt" },
                  { label: "Đã trả đủ", value: "no_debt" },
                ]}
                value={debtFilter}
                onChange={setDebtFilter}
              />
            </FilterGroup>
          )}
          <FilterGroup label="Tổng chi tiêu">
            <ChipToggleFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Mới (<1M)", value: "tier_new" },
                { label: "Thường (1–10M)", value: "tier_regular" },
                { label: "Thân thiết (10–50M)", value: "tier_loyal" },
                { label: "VIP (≥50M)", value: "tier_vip" },
              ]}
              value={salesRangeFilter}
              onChange={setSalesRangeFilter}
            />
          </FilterGroup>
          <FilterGroup label="Số lần mua">
            <ChipToggleFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Chưa mua", value: "no_purchase" },
                { label: "1 lần", value: "first_time" },
                { label: "2–5 lần", value: "occasional" },
                { label: "≥6 lần", value: "frequent" },
              ]}
              value={ordersRangeFilter}
              onChange={setOrdersRangeFilter}
            />
          </FilterGroup>
          <FilterGroup label="Lần mua cuối">
            <ChipToggleFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Hôm nay", value: "today" },
                { label: "7 ngày", value: "week" },
                { label: "30 ngày", value: "month" },
                { label: "90 ngày", value: "3months" },
                { label: "Đã rời (>90 ngày)", value: "churned" },
                { label: "Chưa mua bao giờ", value: "never" },
              ]}
              value={lastPurchaseFilter}
              onChange={setLastPurchaseFilter}
            />
          </FilterGroup>
          <FilterGroup label="Sinh nhật tháng">
            <SelectFilter
              value={birthdayMonthFilter}
              onChange={setBirthdayMonthFilter}
              options={[
                { label: "Tất cả", value: "all" },
                ...Array.from({ length: 12 }, (_, index) => ({
                  label: `Tháng ${index + 1}`,
                  value: String(index + 1),
                })),
              ]}
              placeholder="Chọn tháng sinh nhật"
            />
          </FilterGroup>
          <FilterGroup label="Tags">
            <input
              type="text"
              value={selectedTags.join(", ")}
              onChange={(event) =>
                setSelectedTags(
                  event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
              placeholder="VD: VIP, Shopee"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </FilterGroup>
          <FilterGroup label="Thời gian tạo" activeHint={datePresetLabel}>
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
          <FilterGroup label="Tỉnh / Thành phố">
            <SelectFilter
              value={provinceFilter}
              onChange={setProvinceFilter}
              options={[
                { label: "Tất cả tỉnh/thành", value: "all" },
                ...VN_PROVINCES.map((province) => ({
                  label: province.name,
                  value: province.name,
                })),
              ]}
              placeholder="Chọn tỉnh/thành"
            />
          </FilterGroup>
        </FilterPanel>
      </ListPageLayout>

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditingCustomer(null);
        }}
        onSuccess={fetchData}
        initialData={editingCustomer ?? undefined}
      />

      <ChangeCustomerCodeDialog
        customer={changingCodeCustomer}
        onOpenChange={(open) => {
          if (!open) setChangingCodeCustomer(null);
        }}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!deletingCustomer}
        onOpenChange={(open) => {
          if (!open) setDeletingCustomer(null);
        }}
        title="Xóa khách hàng"
        description={
          canDeleteCustomer
            ? `Xóa khách hàng ${deletingCustomer?.code} — ${deletingCustomer?.name}?`
            : `Bạn không có quyền xoá. Sau khi xác nhận sẽ yêu cầu OTP từ quản lý duyệt cho khách hàng ${deletingCustomer?.code} — ${deletingCustomer?.name}.`
        }
        confirmLabel={canDeleteCustomer ? "Xóa" : "Xin OTP duyệt"}
        variant="destructive"
        loading={deleteLoading}
        onConfirm={async () => {
          if (!deletingCustomer) return;
          if (!canDeleteCustomer) {
            // Phase 3a: cashier không có quyền → chuyển sang OTP delegation flow.
            setOtpTargetCustomer(deletingCustomer);
            setDeletingCustomer(null);
            setOtpDialogOpen(true);
            return;
          }
          setDeleteLoading(true);
          try {
            await deleteCustomer(deletingCustomer.id);
            toast({
              title: "Đã xóa khách hàng",
              description: `${deletingCustomer.code} — ${deletingCustomer.name}`,
              variant: "success",
            });
            setDeletingCustomer(null);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi xóa khách hàng",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      {/* OTP delegation dialog (Phase 3a, CEO 12/05) */}
      <OtpApprovalDialog
        open={otpDialogOpen}
        onOpenChange={(o) => {
          setOtpDialogOpen(o);
          if (!o) setOtpTargetCustomer(null);
        }}
        actionCode={OTP_ACTION_CODES.CRM_DELETE_CUSTOMER}
        targetMeta={
          otpTargetCustomer
            ? {
                entity_type: "customer",
                entity_id: otpTargetCustomer.id,
                code: otpTargetCustomer.code,
              }
            : undefined
        }
        contextLabel={
          otpTargetCustomer
            ? `Xoá khách hàng ${otpTargetCustomer.code} — ${otpTargetCustomer.name}`
            : undefined
        }
        onApproved={async (verified) => {
          if (!otpTargetCustomer) return;
          try {
            await deleteCustomer(otpTargetCustomer.id, verified.otpId);
            toast({
              title: "Đã xoá khách hàng",
              description: `${otpTargetCustomer.code} — ${otpTargetCustomer.name} (duyệt qua OTP)`,
              variant: "success",
            });
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi xoá khách hàng",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setOtpTargetCustomer(null);
          }
        }}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={customerExcelSchema}
        onCommit={bulkImportCustomers}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách khách hàng đã được cập nhật.",
            variant: "success",
          });
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  CustomerDetailPanel — inline detail với lazy fetch các tab         */
/* ------------------------------------------------------------------ */
function CustomerDetailPanel({
  customer,
  onClose,
  onEdit,
  onDelete,
}: {
  customer: Customer;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [returns, setReturns] = useState<CustomerReturn[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyTransaction[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSalesLoading(true);
    Promise.all([
      getInvoicesForCustomer(customer.id, 30).catch(() => []),
      getReturnsForCustomer(customer.id, 30).catch(() => []),
    ])
      .then(([inv, ret]) => {
        if (cancelled) return;
        setInvoices(inv);
        setReturns(ret);
      })
      .finally(() => {
        if (!cancelled) setSalesLoading(false);
      });

    setLoyaltyLoading(true);
    getLoyaltyTransactions({
      page: 0,
      pageSize: 30,
      customerId: customer.id,
    })
      .then((res) => {
        if (cancelled) return;
        setLoyalty(res.data);
      })
      .catch(() => {
        if (!cancelled) setLoyalty([]);
      })
      .finally(() => {
        if (!cancelled) setLoyaltyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  const outstandingInvoices = invoices.filter((i) => (i.debt ?? 0) > 0);
  const totalOutstanding = outstandingInvoices.reduce(
    (s, i) => s + (i.debt ?? 0),
    0,
  );

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <DetailInfoGrid
          columns={3}
          fields={[
            { label: "Mã khách hàng", value: customer.code },
            { label: "Tên khách hàng", value: customer.name },
            { label: "Điện thoại", value: customer.phone },
            { label: "Email", value: customer.email || "" },
            {
              label: "Địa chỉ",
              value: customer.address || "",
              fullWidth: true,
            },
            { label: "Nhóm khách hàng", value: customer.groupName || "" },
            {
              label: "Loại khách hàng",
              value: customer.type === "company" ? "Công ty" : "Cá nhân",
            },
            {
              label: "Giới tính",
              value:
                customer.gender === "male"
                  ? "Nam"
                  : customer.gender === "female"
                    ? "Nữ"
                    : "",
            },
            {
              label: "Điểm tích lũy",
              value: (
                <span
                  className={
                    (customer.loyaltyPoints ?? 0) > 0
                      ? "font-semibold text-status-success"
                      : "text-muted-foreground"
                  }
                >
                  {formatNumber(customer.loyaltyPoints ?? 0)} điểm
                </span>
              ),
            },
            {
              label: "Hạng thành viên",
              value: customer.loyaltyTierName ? (
                <span className="inline-flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-primary-fixed/15 text-primary border-primary/25 text-[10px] uppercase font-semibold"
                  >
                    {customer.loyaltyTierName}
                  </Badge>
                  {typeof customer.loyaltyTierDiscount === "number" &&
                    customer.loyaltyTierDiscount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        (giảm {customer.loyaltyTierDiscount}%)
                      </span>
                    )}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  — Chưa có hạng —
                </span>
              ),
            },
            {
              label: "Mua gần nhất",
              // Tính từ invoices đã fetch (ở tab Lịch sử) — invoices[0]
              // đã sort DESC theo created_at trong getInvoicesForCustomer.
              value: invoices[0]?.date
                ? formatDate(invoices[0].date)
                : "— Chưa có giao dịch —",
            },
            { label: "Ngày tạo", value: formatDate(customer.createdAt) },
          ]}
        />
      ),
    },
    {
      id: "address",
      label: "Địa chỉ nhận hàng",
      content: (
        <div className="text-sm text-muted-foreground py-4">
          {customer.address || "Chưa có địa chỉ nhận hàng nào."}
        </div>
      ),
    },
    {
      id: "sales-history",
      label: `Lịch sử bán/trả hàng (${invoices.length + returns.length})`,
      content: salesLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Đang tải lịch sử...
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Hoá đơn bán hàng ({invoices.length})
            </p>
            <DetailItemsTable
              items={invoices}
              columns={[
                {
                  header: "Mã HĐ",
                  accessor: (r) => (
                    <span className="font-mono text-primary text-xs">
                      {r.code}
                    </span>
                  ),
                },
                {
                  header: "Ngày",
                  accessor: (r) => formatDate(r.date),
                },
                {
                  header: "Tổng tiền",
                  align: "right",
                  accessor: (r) => formatCurrency(r.totalAmount),
                },
                {
                  header: "Đã trả",
                  align: "right",
                  accessor: (r) => formatCurrency(r.paid),
                },
                {
                  header: "Còn nợ",
                  align: "right",
                  accessor: (r) =>
                    (r.debt ?? 0) > 0 ? (
                      <span className="text-destructive font-semibold">
                        {formatCurrency(r.debt ?? 0)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
                {
                  header: "Trạng thái",
                  accessor: (r) => (
                    <Badge
                      variant={
                        r.status === "completed"
                          ? "default"
                          : r.status === "cancelled"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {r.status === "completed"
                        ? "Hoàn thành"
                        : r.status === "cancelled"
                          ? "Đã hủy"
                          : "Đang xử lý"}
                    </Badge>
                  ),
                },
              ]}
            />
          </div>

          {returns.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Phiếu trả hàng ({returns.length})
              </p>
              <DetailItemsTable
                items={returns}
                columns={[
                  {
                    header: "Mã trả",
                    accessor: (r) => (
                      <span className="font-mono text-primary text-xs">
                        {r.code}
                      </span>
                    ),
                  },
                  {
                    header: "HĐ gốc",
                    accessor: (r) => (
                      <span className="text-xs text-muted-foreground">
                        {r.invoiceCode}
                      </span>
                    ),
                  },
                  {
                    header: "Ngày",
                    accessor: (r) => formatDate(r.date),
                  },
                  {
                    header: "Tổng tiền trả",
                    align: "right",
                    accessor: (r) => formatCurrency(r.totalAmount),
                  },
                  {
                    header: "Trạng thái",
                    accessor: (r) => (
                      <Badge
                        variant={
                          r.status === "completed" ? "default" : "secondary"
                        }
                      >
                        {r.status === "completed" ? "Hoàn thành" : "Phiếu tạm"}
                      </Badge>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      ),
    },
    {
      id: "debt",
      label: "Nợ cần thu từ khách",
      content: (
        <div className="space-y-4">
          <DetailInfoGrid
            columns={2}
            fields={[
              {
                label: "Nợ hiện tại",
                value: (
                  <span
                    className={
                      customer.currentDebt > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {formatCurrency(customer.currentDebt)}
                  </span>
                ),
              },
              {
                label: "Tổng bán",
                value: formatCurrency(customer.totalSales),
              },
            ]}
          />
          {!salesLoading && outstandingInvoices.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Hoá đơn còn nợ ({outstandingInvoices.length})
              </p>
              <DetailItemsTable
                items={outstandingInvoices}
                columns={[
                  {
                    header: "Mã HĐ",
                    accessor: (r) => (
                      <span className="font-mono text-primary text-xs">
                        {r.code}
                      </span>
                    ),
                  },
                  {
                    header: "Ngày",
                    accessor: (r) => formatDate(r.date),
                  },
                  {
                    header: "Tổng",
                    align: "right",
                    accessor: (r) => formatCurrency(r.totalAmount),
                  },
                  {
                    header: "Đã trả",
                    align: "right",
                    accessor: (r) => formatCurrency(r.paid),
                  },
                  {
                    header: "Còn nợ",
                    align: "right",
                    accessor: (r) => (
                      <span className="text-destructive font-semibold">
                        {formatCurrency(r.debt ?? 0)}
                      </span>
                    ),
                  },
                ]}
                summary={[
                  {
                    label: "Tổng nợ từ các hoá đơn",
                    value: (
                      <span className="text-destructive">
                        {formatCurrency(totalOutstanding)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}
          {!salesLoading && outstandingInvoices.length === 0 && (
            <div className="text-sm text-muted-foreground py-2 text-center">
              Không có hoá đơn nào còn nợ.
            </div>
          )}
        </div>
      ),
    },
    {
      id: "points",
      label: `Lịch sử tích điểm${loyalty.length > 0 ? ` (${loyalty.length})` : ""}`,
      content: loyaltyLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Đang tải điểm tích luỹ...
        </div>
      ) : loyalty.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Chưa có lịch sử tích điểm.
        </div>
      ) : (
        <DetailItemsTable
          items={loyalty}
          columns={[
            {
              header: "Ngày",
              accessor: (r) => formatDate(r.createdAt),
            },
            {
              header: "Loại",
              accessor: (r) => (
                <Badge
                  variant={
                    r.type === "earn"
                      ? "default"
                      : r.type === "redeem"
                        ? "secondary"
                        : r.type === "expire"
                          ? "destructive"
                          : "outline"
                  }
                >
                  {r.type === "earn"
                    ? "Tích"
                    : r.type === "redeem"
                      ? "Dùng"
                      : r.type === "expire"
                        ? "Hết hạn"
                        : "Điều chỉnh"}
                </Badge>
              ),
            },
            {
              header: "Điểm",
              align: "right",
              accessor: (r) => (
                <span
                  className={
                    r.points > 0
                      ? "text-status-success font-semibold"
                      : "text-destructive font-semibold"
                  }
                >
                  {r.points > 0 ? `+${r.points}` : r.points}
                </span>
              ),
            },
            {
              header: "Tồn",
              align: "right",
              accessor: (r) => r.balanceAfter,
            },
            {
              header: "Ghi chú",
              accessor: (r) => (
                <span className="text-xs text-muted-foreground">
                  {r.note ?? "—"}
                </span>
              ),
            },
          ]}
        />
      ),
    },
    {
      id: "audit",
      label: "Lịch sử thay đổi",
      content: <AuditHistoryTab entityType="customer" entityId={customer.id} />,
    },
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
          title={customer.name}
          code={customer.code}
          subtitle={customer.groupName}
          meta={<span>Ngày tạo: {formatDate(customer.createdAt)}</span>}
        />
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}
