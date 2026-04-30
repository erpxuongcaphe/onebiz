"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  SelectFilter,
  DatePresetFilter,
  RangeFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
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
import { CreateSupplierDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { supplierExcelSchema } from "@/lib/excel/schemas";
import { bulkImportSuppliers } from "@/lib/services/supabase/excel-import";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { SupplierImportRow } from "@/lib/excel/schemas";
import {
  getSuppliers,
  deleteSupplier,
  getPurchaseOrdersForSupplier,
  getPurchaseOrderStatusMeta,
} from "@/lib/services";
import { useToast } from "@/lib/contexts";
import type { Supplier, PurchaseOrder } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Inline detail                                                      */
/* ------------------------------------------------------------------ */
function SupplierDetail({
  supplier,
  onClose,
  onEdit,
  onDelete,
}: {
  supplier: Supplier;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const statusMeta = getPurchaseOrderStatusMeta();

  useEffect(() => {
    let cancelled = false;
    setOrdersLoading(true);
    getPurchaseOrdersForSupplier(supplier.id, 30)
      .then((rows) => {
        if (cancelled) return;
        setOrders(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setOrders([]);
      })
      .finally(() => {
        if (cancelled) return;
        setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supplier.id]);

  const outstandingOrders = orders.filter((o) => o.amountOwed > 0);
  const totalOrders = orders.length;
  const totalOrderValue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalPaidAll = orders.reduce((sum, o) => sum + o.paid, 0);
  const totalOwedAll = orders.reduce((sum, o) => sum + o.amountOwed, 0);

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
            { label: "Địa chỉ", value: supplier.address || "", fullWidth: true },
            {
              label: "Nợ cần trả hiện tại",
              value: (
                <span
                  className={
                    supplier.currentDebt > 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {formatCurrency(supplier.currentDebt)}
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
      content: ordersLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Đang tải lịch sử mua hàng...
        </div>
      ) : (
        <DetailItemsTable<PurchaseOrder>
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
                    label: "Tổng giá trị",
                    value: formatCurrency(totalOrderValue),
                  },
                  {
                    label: "Đã thanh toán",
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
                label: "Nợ cần trả hiện tại",
                value: (
                  <span
                    className={
                      supplier.currentDebt > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {formatCurrency(supplier.currentDebt)}
                  </span>
                ),
              },
              {
                label: "Tổng mua",
                value: formatCurrency(supplier.totalPurchases),
              },
            ]}
          />
          {ordersLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Đang tải danh sách đơn còn nợ...
            </div>
          ) : outstandingOrders.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Đơn còn nợ NCC
              </div>
              <DetailItemsTable<PurchaseOrder>
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
      id: "audit",
      label: "Lịch sử thay đổi",
      content: <AuditHistoryTab entityType="supplier" entityId={supplier.id} />,
    },
  ];

  return (
    <InlineDetailPanel open onClose={onClose} onEdit={onEdit} onDelete={onDelete}>
      <div className="p-4 space-y-4">
        <DetailHeader
          title={supplier.name}
          code={supplier.code}
          subtitle={supplier.phone}
          meta={
            <span>
              Ngày tạo: {formatDate(supplier.createdAt)}
            </span>
          }
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Delete
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Filters
  const [supplierGroupFilter, setSupplierGroupFilter] = useState("all");
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
      header: "Nợ cần trả hiện tại",
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
      accessorKey: "totalPurchases",
      header: "Tổng mua",
      cell: ({ row }) => formatCurrency(row.original.totalPurchases),
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getSuppliers({
      page,
      pageSize,
      search,
      filters: {
        ...(supplierGroupFilter !== "all" && { group: supplierGroupFilter }),
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
        ...(debtFrom && { debtFrom }),
        ...(debtTo && { debtTo }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [
    page,
    pageSize,
    search,
    supplierGroupFilter,
    selectedStatuses,
    debtFrom,
    debtTo,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, supplierGroupFilter, selectedStatuses, datePreset, totalBuyFrom, totalBuyTo, debtFrom, debtTo]);

  /* ---- Summary ---- */
  const totalDebt = data.reduce((sum, s) => sum + s.currentDebt, 0);
  const totalPurchases = data.reduce((sum, s) => sum + s.totalPurchases, 0);
  const debtSupplierCount = data.filter((s) => s.currentDebt > 0).length;

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    if (type === "excel") {
      const rows: SupplierImportRow[] = data.map((s) => ({
        code: s.code,
        name: s.name,
        phone: s.phone,
        email: s.email,
        address: s.address,
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
      { header: "Nợ cần trả hiện tại", key: "currentDebt", width: 18, format: (v: number) => v },
      { header: "Tổng mua", key: "totalPurchases", width: 15, format: (v: number) => v },
    ];
    exportToCsv(data, exportColumns, "danh-sach-nha-cung-cap");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (supplier: Supplier, onClose: () => void) => (
    <SupplierDetail
      supplier={supplier}
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
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Nhóm NCC">
              <SelectFilter
                options={[
                  { label: "Nhóm mặc định", value: "default" },
                ]}
                value={supplierGroupFilter}
                onChange={setSupplierGroupFilter}
                placeholder="Tất cả các nhóm"
              />
            </FilterGroup>

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
          </FilterSidebar>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon="local_shipping"
            label="Tổng NCC"
            value={total.toLocaleString("vi-VN")}
          />
          <SummaryCard
            icon="trending_up"
            label="Tổng mua hàng"
            value={formatCurrency(totalPurchases)}
          />
          <SummaryCard
            icon="account_balance_wallet"
            label="Tổng công nợ"
            value={formatCurrency(totalDebt)}
            danger={totalDebt > 0}
            hint={debtSupplierCount > 0 ? `${debtSupplierCount} NCC còn nợ` : undefined}
          />
          <SummaryCard
            icon="verified"
            label="Hiển thị"
            value={data.length.toLocaleString("vi-VN")}
            hint={`Trang ${page + 1}`}
          />
        </div>

        <PageHeader
          title="Nhà cung cấp"
          searchPlaceholder="Theo mã, tên, SĐT NCC"
          searchValue={search}
          onSearchChange={setSearch}
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
            totalPurchases: formatCurrency(totalPurchases),
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
        onOpenChange={(open) => { if (!open) setDeletingSupplier(null); }}
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
            toast({ title: "Đã xóa nhà cung cấp", description: `${deletingSupplier.code} — ${deletingSupplier.name}`, variant: "success" });
            setDeletingSupplier(null);
            fetchData();
          } catch (err) {
            toast({ title: "Lỗi xóa nhà cung cấp", description: err instanceof Error ? err.message : "Vui lòng thử lại", variant: "error" });
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
