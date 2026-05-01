"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
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
import { CreateInvoiceDialog, EditInvoiceDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { RecordPaymentDialog } from "@/components/shared/dialogs/record-payment-dialog";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getInvoices,
  getInvoiceStatuses,
  cancelInvoice,
  getInvoiceItems,
  getTenantBusinessInfo,
  type InvoiceItemRow,
  type TenantBusinessInfo,
} from "@/lib/services";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { buildInvoicePrintData } from "@/lib/print-templates";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import type { Invoice } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

const statusMap: Record<
  Invoice["status"],
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  processing: { label: "Đang xử lý", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
  delivery_failed: { label: "Giao thất bại", variant: "destructive" },
};

const invoiceTypeOptions = [
  { label: "Không giao hàng", value: "no_delivery" },
  { label: "Giao hàng", value: "delivery" },
];

function InvoiceDetail({
  invoice,
  onClose,
  onEdit,
  onDelete,
}: {
  invoice: Invoice;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const status = statusMap[invoice.status];

  // Lazy fetch line items thay vì hardcode "Sản phẩm mẫu" (P0 audit fix).
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    getInvoiceItems(invoice.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.id]);

  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const itemDiscountSum = items.reduce((s, it) => s + it.discount, 0);

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
      deleteLabel="Hủy"
    >
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={invoice.customerName}
                  code={invoice.code}
                  status={{
                    label: status.label,
                    variant: status.variant,
                    className:
                      status.variant === "default"
                        ? "bg-status-success/10 text-status-success border-status-success/25"
                        : undefined,
                  }}
                  subtitle={invoice.branchName || "—"}
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo:{" "}
                        <strong>{formatUser(undefined, invoice.createdBy)}</strong>
                      </span>
                      <span>
                        Ngày bán:{" "}
                        <strong>{formatDate(invoice.date)}</strong>
                      </span>
                      {invoice.customerCode && (
                        <span>
                          Mã KH: <strong>{invoice.customerCode}</strong>
                        </span>
                      )}
                    </div>
                  }
                />

                {itemsLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải sản phẩm...
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Hóa đơn này không có sản phẩm hoặc dữ liệu lô bị mất.
                  </div>
                ) : (
                  <DetailItemsTable
                    columns={[
                      { header: "Mã hàng", accessor: "productCode" as never },
                      { header: "Tên hàng", accessor: "productName" as never },
                      {
                        header: "Đơn vị",
                        accessor: (item: Record<string, unknown>) =>
                          (item.unit as string) ?? "—",
                      },
                      {
                        header: "SL",
                        accessor: "quantity" as never,
                        align: "right",
                      },
                      {
                        header: "Đơn giá",
                        accessor: (item: Record<string, unknown>) =>
                          formatCurrency(item.unitPrice as number),
                        align: "right",
                      },
                      {
                        header: "Giảm",
                        accessor: (item: Record<string, unknown>) =>
                          formatCurrency(item.discount as number),
                        align: "right",
                      },
                      {
                        header: "Thành tiền",
                        accessor: (item: Record<string, unknown>) => (
                          <span className="text-primary font-semibold">
                            {formatCurrency(item.total as number)}
                          </span>
                        ),
                        align: "right",
                      },
                    ]}
                    items={items as unknown as Record<string, unknown>[]}
                    summary={[
                      {
                        label: `Tổng tiền hàng (${items.length})`,
                        value: formatCurrency(subtotal),
                      },
                      {
                        label: "Giảm giá dòng",
                        value: formatCurrency(itemDiscountSum),
                      },
                      {
                        label: "Giảm giá hóa đơn",
                        value: formatCurrency(invoice.discount),
                      },
                      {
                        label: "Khách cần trả",
                        value: formatCurrency(invoice.totalAmount),
                        className: "font-bold text-base",
                      },
                      {
                        label: "Khách đã trả",
                        value: formatCurrency(invoice.paid),
                      },
                      ...((invoice.debt ?? 0) > 0
                        ? [
                            {
                              label: "Còn nợ",
                              value: (
                                <span className="text-destructive font-semibold">
                                  {formatCurrency(invoice.debt)}
                                </span>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}

                {/* Notes area */}
                <div className="border rounded-md p-3">
                  <textarea
                    placeholder="Ghi chú..."
                    className="w-full text-sm resize-none bg-transparent outline-none min-h-[60px]"
                  />
                </div>
              </div>
            ),
          },
          {
            id: "payment_history",
            label: "Lịch sử",
            content: <AuditHistoryTab entityType="invoice" entityId={invoice.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

export default function HoaDonPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const router = useRouter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const [data, setData] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Invoice | null>(null);
  const [cancellingItem, setCancellingItem] = useState<Invoice | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [payingItem, setPayingItem] = useState<Invoice | null>(null);

  // Tenant business info — load 1 lần khi page mount để in hóa đơn có
  // MST + địa chỉ pháp lý (HT-2 wire).
  const [businessInfo, setBusinessInfo] = useState<TenantBusinessInfo | null>(null);
  useEffect(() => {
    getTenantBusinessInfo()
      .then(setBusinessInfo)
      .catch(() => setBusinessInfo(null));
  }, []);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "processing",
    "completed",
  ]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "no_delivery",
    "delivery",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");

  const statuses = getInvoiceStatuses();

  // Convert datePreset → ISO range để pass vào filters. Trước đây datePreset
  // tồn tại trong UI nhưng không gửi xuống service → filter giả.
  const dateRange = useCallback(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const toISO = (d: Date) => d.toISOString();
    switch (datePreset) {
      case "today":
        return { from: toISO(today), to: toISO(today) };
      case "yesterday": {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return { from: toISO(y), to: toISO(y) };
      }
      case "this_week": {
        const dow = today.getDay() || 7;
        const start = new Date(today);
        start.setDate(start.getDate() - dow + 1);
        return { from: toISO(start), to: toISO(today) };
      }
      case "this_month": {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: toISO(start), to: toISO(today) };
      }
      case "last_month": {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { from: toISO(start), to: toISO(end) };
      }
      default:
        return { from: undefined, to: undefined };
    }
  }, [datePreset]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const range = dateRange();
    const filters: Record<string, string | string[]> = {};
    if (selectedStatuses.length > 0) filters.status = selectedStatuses;
    if (range.from) filters.dateFrom = range.from;
    if (range.to) filters.dateTo = range.to;
    const result = await getInvoices({
      page,
      pageSize,
      search,
      branchId: activeBranchId,
      filters,
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, activeBranchId, dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, selectedTypes, datePreset]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalAmount = data.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalDiscount = data.reduce((sum, inv) => sum + inv.discount, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã HD", key: "code", width: 15 },
      {
        header: "Thời gian",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
      { header: "Khách hàng", key: "customerName", width: 25 },
      {
        header: "Tổng tiền",
        key: "totalAmount",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Giảm giá",
        key: "discount",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Trạng thái",
        key: "status",
        width: 15,
        format: (v: Invoice["status"]) => statusMap[v]?.label ?? v,
      },
    ];
    if (type === "excel")
      exportToExcel(data, exportColumns, "danh-sach-hoa-don");
    else exportToCsv(data, exportColumns, "danh-sach-hoa-don");
  };

  const columns: ColumnDef<Invoice, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 36,
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
      header: "Mã hóa đơn",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "returnCode",
      header: "Mã trả hàng",
      size: 120,
      cell: ({ row }) => row.original.returnCode ?? "—",
    },
    {
      accessorKey: "customerCode",
      header: "Mã KH",
      size: 100,
      cell: ({ row }) =>
        (row.original as Invoice & { customerCode?: string }).customerCode ??
        "—",
    },
    {
      accessorKey: "customerName",
      header: "Khách hàng",
      size: 180,
    },
    {
      accessorKey: "totalAmount",
      header: "Tổng tiền hàng",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      accessorKey: "discount",
      header: "Giảm giá",
      cell: ({ row }) => {
        const discount = row.original.discount;
        return discount > 0 ? (
          <span className="text-status-warning text-right block">
            {formatCurrency(discount)}
          </span>
        ) : (
          <span className="text-right block">{formatCurrency(0)}</span>
        );
      },
    },
    {
      accessorKey: "debt",
      header: "Công nợ",
      cell: ({ row }) => {
        const debt = row.original.debt;
        return debt > 0 ? (
          <span className="text-destructive font-medium text-right block">
            {formatCurrency(debt)}
          </span>
        ) : (
          <span className="text-status-success text-right block">Đã TT</span>
        );
      },
    },
  ];

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Thời gian">
              <DatePresetFilter
                value={datePreset}
                onChange={setDatePreset}
              />
            </FilterGroup>

            <FilterGroup label="Loại hóa đơn">
              <CheckboxFilter
                options={invoiceTypeOptions}
                selected={selectedTypes}
                onChange={setSelectedTypes}
              />
            </FilterGroup>

            <FilterGroup label="Trạng thái hóa đơn">
              <CheckboxFilter
                options={statuses}
                selected={selectedStatuses}
                onChange={setSelectedStatuses}
              />
            </FilterGroup>

            <FilterGroup label="Trạng thái giao hàng">
              <CheckboxFilter
                options={[
                  { label: "Chờ lấy hàng", value: "pending" },
                  { label: "Đã lấy hàng", value: "picked_up" },
                  { label: "Đang giao", value: "in_transit" },
                  { label: "Đã giao", value: "delivered" },
                  { label: "Đã hoàn", value: "returned" },
                  { label: "Đã hủy", value: "cancelled" },
                ]}
                selected={[]}
                onChange={() => {}}
              />
            </FilterGroup>

            <FilterGroup label="Đối tác giao hàng">
              <select className="w-full h-8 text-sm border rounded-md px-2 bg-white">
                <option value="">Chọn đối tác giao hàng</option>
              </select>
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Hóa đơn"
          searchPlaceholder="Theo mã hóa đơn"
          searchValue={search}
          onSearchChange={setSearch}
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          onImport={() => {}}
          showColumnToggle
          showSettings
          showHelp
          actions={[
            {
              label: "Tạo mới",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
          ]}
        />

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
          <SummaryCard
            icon={<Icon name="receipt" size={16} />}
            label="Tổng HĐ"
            value={total.toString()}
          />
          <SummaryCard
            icon={<Icon name="check_circle" size={16} />}
            label="Hoàn thành"
            value={data.filter((r) => r.status === "completed").length.toString()}
          />
          <SummaryCard
            icon={<Icon name="warning" size={16} className="text-destructive" />}
            label="Giao thất bại"
            value={data.filter((r) => r.status === "delivery_failed").length.toString()}
            danger={data.filter((r) => r.status === "delivery_failed").length > 0}
            hint={data.filter((r) => r.status === "delivery_failed").length > 0 ? "Cần xử lý" : undefined}
          />
          <SummaryCard
            icon={<Icon name="payments" size={16} />}
            label="Tổng doanh thu"
            value={formatCurrency(totalAmount - totalDiscount)}
          />
        </div>

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
            totalAmount: formatCurrency(totalAmount),
            discount: formatCurrency(totalDiscount),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(invoice, onClose) => (
            <InvoiceDetail
              invoice={invoice}
              onClose={onClose}
              onEdit={
                invoice.status === "processing"
                  ? () => setEditingItem(invoice)
                  : undefined
              }
              onDelete={
                invoice.status !== "completed" && invoice.status !== "cancelled"
                  ? () => setCancellingItem(invoice)
                  : undefined
              }
            />
          )}
          rowActions={(row) => [
            {
              label: "In hóa đơn",
              icon: <Icon name="print" size={16} />,
              onClick: () =>
                printWithPicker(
                  buildInvoicePrintData(row, businessInfo ?? undefined),
                  "In hóa đơn",
                ),
            },
            ...(row.status === "processing"
              ? [
                  {
                    label: "Sửa",
                    icon: <Icon name="edit" size={16} />,
                    onClick: () => setEditingItem(row),
                  },
                ]
              : []),
            ...(row.debt > 0
              ? [
                  {
                    label: "Thu nợ",
                    icon: <Icon name="payments" size={16} />,
                    onClick: () => setPayingItem(row),
                  },
                ]
              : []),
            {
              label: "Trả hàng",
              icon: <Icon name="undo" size={16} />,
              onClick: () => { toast({ variant: "info", title: "Chuyển đến trang trả hàng" }); router.push("/don-hang/tra-hang"); },
            },
            ...(row.status !== "completed" && row.status !== "cancelled"
              ? [
                  {
                    label: "Hủy",
                    icon: <Icon name="cancel" size={16} />,
                    onClick: () => setCancellingItem(row),
                    variant: "destructive" as const,
                    separator: true,
                  },
                ]
              : []),
          ]}
        />
      </ListPageLayout>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <EditInvoiceDialog
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
        invoice={editingItem}
        onSuccess={fetchData}
      />

      {printerDialog}

      {payingItem && (
        <RecordPaymentDialog
          open={!!payingItem}
          onOpenChange={(open) => { if (!open) setPayingItem(null); }}
          onSuccess={fetchData}
          type="invoice"
          referenceId={payingItem.id}
          referenceCode={payingItem.code}
          counterpartyName={payingItem.customerName}
          currentDebt={payingItem.debt}
        />
      )}

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy hoá đơn"
        description={`Bạn có chắc muốn hủy hoá đơn ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
        confirmLabel="Hủy hoá đơn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            await cancelInvoice(cancellingItem.id);
            toast({
              title: "Đã hủy hoá đơn",
              description: `Hoá đơn ${cancellingItem.code} đã được hủy thành công`,
              variant: "success",
            });
            await fetchData();
          } catch (err) {
            toast({
              title: "Lỗi hủy hoá đơn",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />
    </>
  );
}
