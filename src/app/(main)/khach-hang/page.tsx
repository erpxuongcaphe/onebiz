"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  ChipToggleFilter,
  PersonFilter,
} from "@/components/shared/filter-sidebar";
import type { DatePresetValue } from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { Badge } from "@/components/ui/badge";
import { CreateCustomerDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { customerExcelSchema } from "@/lib/excel/schemas";
import { bulkImportCustomers } from "@/lib/services/supabase/excel-import";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getCustomers,
  getCustomerGroups,
  deleteCustomer,
  getInvoicesForCustomer,
  getReturnsForCustomer,
  getLoyaltyTransactions,
  type CustomerReturn,
} from "@/lib/services";
import type { Customer, Invoice, LoyaltyTransaction } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

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
  const [data, setData] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Filters
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [debtFilter, setDebtFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Delete
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  const customerGroups = getCustomerGroups();

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
    {
      accessorKey: "currentDebt",
      header: "Nợ hiện tại",
      cell: ({ row }) => {
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
    },
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
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getCustomers({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedGroups.length > 0 && { group: selectedGroups }),
        ...(typeFilter !== "all" && { type: typeFilter }),
        ...(genderFilter !== "all" && { gender: genderFilter }),
        ...(debtFilter !== "all" && { debt: debtFilter }),
        ...(creatorFilter && { createdBy: creatorFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [
    page,
    pageSize,
    search,
    selectedGroups,
    typeFilter,
    genderFilter,
    debtFilter,
    creatorFilter,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, selectedGroups, typeFilter, genderFilter, debtFilter, creatorFilter]);

  /* ---- Summaries ---- */
  const totalDebt = data.reduce((sum, c) => sum + c.currentDebt, 0);
  const totalSales = data.reduce((sum, c) => sum + c.totalSales, 0);
  const totalSalesMinusReturns = data.reduce(
    (sum, c) => sum + c.totalSalesMinusReturns,
    0
  );

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã KH", key: "code", width: 12 },
      { header: "Tên khách hàng", key: "name", width: 25 },
      { header: "SĐT", key: "phone", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "Nợ hiện tại", key: "currentDebt", width: 15, format: (v: number) => v },
      { header: "Tổng bán", key: "totalSales", width: 15, format: (v: number) => v },
      { header: "Nhóm", key: "groupName", width: 20 },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-khach-hang");
    else exportToCsv(data, exportColumns, "danh-sach-khach-hang");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (customer: Customer, onClose: () => void) => (
    <CustomerDetailPanel customer={customer} onClose={onClose} />
  );

  /* ---- Render ---- */
  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
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

            <FilterGroup label="Thời gian">
              <DatePresetFilter
                value={datePreset}
                onChange={setDatePreset}
                from={dateFrom}
                to={dateTo}
                onFromChange={setDateFrom}
                onToChange={setDateTo}
                presets={[
                  { label: "Tất cả", value: "all" },
                  { label: "Hôm nay", value: "today" },
                  { label: "Hôm qua", value: "yesterday" },
                  { label: "Tuần này", value: "this_week" },
                  { label: "Tháng này", value: "this_month" },
                  { label: "Tháng trước", value: "last_month" },
                  { label: "Tùy chỉnh", value: "custom" },
                ]}
              />
            </FilterGroup>

            <FilterGroup label="Người tạo">
              <PersonFilter
                value={creatorFilter}
                onChange={setCreatorFilter}
                placeholder="Chọn người tạo"
                suggestions={[
                  { label: "Admin", value: "admin" },
                  { label: "Cao Thị Huyền Trang", value: "trang" },
                ]}
              />
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Khách hàng"
          searchPlaceholder="Theo mã, tên, SĐT"
          searchValue={search}
          onSearchChange={setSearch}
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

        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
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
            currentDebt: formatCurrency(totalDebt),
            totalSales: formatCurrency(totalSales),
            totalSalesMinusReturns: formatCurrency(totalSalesMinusReturns),
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
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
              onClick: () => setDeletingCustomer(row),
              variant: "destructive",
              separator: true,
            },
          ]}
        />
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

      <ConfirmDialog
        open={!!deletingCustomer}
        onOpenChange={(open) => { if (!open) setDeletingCustomer(null); }}
        title="Xóa khách hàng"
        description={`Xóa khách hàng ${deletingCustomer?.code} — ${deletingCustomer?.name}?`}
        confirmLabel="Xóa"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={async () => {
          if (!deletingCustomer) return;
          setDeleteLoading(true);
          try {
            await deleteCustomer(deletingCustomer.id);
            toast({ title: "Đã xóa khách hàng", description: `${deletingCustomer.code} — ${deletingCustomer.name}`, variant: "success" });
            setDeletingCustomer(null);
            fetchData();
          } catch (err) {
            toast({ title: "Lỗi xóa khách hàng", description: err instanceof Error ? err.message : "Vui lòng thử lại", variant: "error" });
          } finally {
            setDeleteLoading(false);
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
}: {
  customer: Customer;
  onClose: () => void;
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
    0
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
            { label: "Địa chỉ", value: customer.address || "", fullWidth: true },
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
  ];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailHeader
          title={customer.name}
          code={customer.code}
          subtitle={customer.groupName}
          meta={
            <span>
              Ngày tạo: {formatDate(customer.createdAt)}
            </span>
          }
        />
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}
