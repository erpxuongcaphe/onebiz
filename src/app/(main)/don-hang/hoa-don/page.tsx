"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, Printer, Undo2, XCircle, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
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
} from "@/components/shared/inline-detail-panel";
import { CreateInvoiceDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { RecordPaymentDialog } from "@/components/shared/dialogs/record-payment-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getInvoices, getInvoiceStatuses, cancelInvoice } from "@/lib/services";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocument } from "@/lib/print-document";
import { buildInvoicePrintData } from "@/lib/print-templates";
import type { Invoice } from "@/lib/types";

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
}: {
  invoice: Invoice;
  onClose: () => void;
}) {
  const status = statusMap[invoice.status];

  return (
    <InlineDetailPanel open onClose={onClose}>
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
                        ? "bg-green-100 text-green-700 border-green-200"
                        : undefined,
                  }}
                  subtitle="Chi nhánh trung tâm"
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo:{" "}
                        <strong>{invoice.createdBy}</strong>
                      </span>
                      <span>
                        Người bán:{" "}
                        <strong>{invoice.createdBy}</strong>
                      </span>
                      <span>
                        Ngày bán:{" "}
                        <strong>{formatDate(invoice.date)}</strong>
                      </span>
                      <span>
                        Kênh bán: <strong>Bán trực tiếp</strong>
                      </span>
                      <span>
                        Bảng giá: <strong>Bảng giá chung</strong>
                      </span>
                    </div>
                  }
                />

                <DetailItemsTable
                  columns={[
                    { header: "Mã hàng", accessor: "code" as never },
                    { header: "Tên hàng", accessor: "name" as never },
                    {
                      header: "Số lượng",
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
                      header: "Giảm giá",
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
                  items={
                    [
                      {
                        code: "SP001",
                        name: "Sản phẩm mẫu",
                        quantity: 1,
                        unitPrice: invoice.totalAmount,
                        discount: invoice.discount,
                        total: invoice.totalAmount - invoice.discount,
                      },
                    ] as Record<string, unknown>[]
                  }
                  summary={[
                    {
                      label: `Tổng tiền hàng (1)`,
                      value: formatCurrency(invoice.totalAmount),
                    },
                    {
                      label: "Giảm giá hóa đơn",
                      value: formatCurrency(invoice.discount),
                    },
                    {
                      label: "Khách cần trả",
                      value: formatCurrency(
                        invoice.totalAmount - invoice.discount
                      ),
                      className: "font-bold text-base",
                    },
                    {
                      label: "Khách đã trả",
                      value: formatCurrency(
                        invoice.totalAmount - invoice.discount
                      ),
                    },
                  ]}
                />

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
            label: "Lịch sử thanh toán",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có lịch sử thanh toán
              </div>
            ),
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
  const [data, setData] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<Invoice | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [payingItem, setPayingItem] = useState<Invoice | null>(null);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getInvoices({
      page,
      pageSize,
      search,
      branchId: activeBranchId,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, activeBranchId]);

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
          <span className="text-orange-600 text-right block">
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
          <span className="text-emerald-600 text-right block">Đã TT</span>
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
                  { label: "Chờ giao", value: "pending" },
                  { label: "Đang giao", value: "shipping" },
                  { label: "Đã giao", value: "delivered" },
                  { label: "Giao thất bại", value: "failed" },
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
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => setCreateOpen(true),
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
            totalAmount: formatCurrency(totalAmount),
            discount: formatCurrency(totalDiscount),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(invoice, onClose) => (
            <InvoiceDetail invoice={invoice} onClose={onClose} />
          )}
          rowActions={(row) => [
            {
              label: "In hóa đơn",
              icon: <Printer className="h-4 w-4" />,
              onClick: () => printDocument(buildInvoicePrintData(row)),
            },
            ...(row.debt > 0
              ? [
                  {
                    label: "Thu nợ",
                    icon: <Banknote className="h-4 w-4" />,
                    onClick: () => setPayingItem(row),
                  },
                ]
              : []),
            {
              label: "Trả hàng",
              icon: <Undo2 className="h-4 w-4" />,
              onClick: () => { toast({ variant: "info", title: "Chuyển đến trang trả hàng" }); router.push("/don-hang/tra-hang"); },
            },
            ...(row.status !== "completed" && row.status !== "cancelled"
              ? [
                  {
                    label: "Hủy",
                    icon: <XCircle className="h-4 w-4" />,
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
