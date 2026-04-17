"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { printDocument } from "@/lib/print-document";
import { buildInputInvoicePrintData } from "@/lib/print-templates";
import { getInputInvoices, getInputInvoiceStatuses, deleteInputInvoice, recordInputInvoice } from "@/lib/services";
import { CreateInputInvoiceDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { useToast } from "@/lib/contexts";
import type { InputInvoice } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// === Status config ===
const statusMap: Record<
  InputInvoice["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  recorded: { label: "Đã ghi sổ", variant: "default" },
  unrecorded: { label: "Chưa ghi sổ", variant: "secondary" },
};

const statusOptions = getInputInvoiceStatuses();

// === Inline Detail ===
function InputInvoiceDetail({
  item,
  onClose,
}: {
  item: InputInvoice;
  onClose: () => void;
}) {
  const st = statusMap[item.status];
  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Hóa đơn đầu vào ${item.code}`}
            code={item.code}
            status={{ label: st.label, variant: st.variant }}
            subtitle="Chi nhánh trung tâm"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{item.createdBy}</strong>
                </span>
                <span>
                  Ngày tạo: <strong>{formatDate(item.date)}</strong>
                </span>
              </div>
            }
          />
          <DetailInfoGrid
            fields={[
              { label: "Mã hóa đơn", value: item.code },
              { label: "Ngày hóa đơn", value: formatDate(item.date) },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền hàng", value: formatCurrency(item.totalAmount) },
              { label: "Thuế", value: formatCurrency(item.taxAmount) },
              { label: "Trạng thái", value: st.label },
              { label: "Người tạo", value: item.createdBy },
            ]}
          />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Chưa có lịch sử thay đổi
        </div>
      ),
    },
  ];
  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

// === Columns ===
const columns: ColumnDef<InputInvoice, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã hóa đơn",
    size: 140,
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
    accessorKey: "supplierName",
    header: "Nhà cung cấp",
    size: 220,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền hàng",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "taxAmount",
    header: "Thuế",
    cell: ({ row }) => formatCurrency(row.original.taxAmount),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    size: 130,
    cell: ({ row }) => {
      const { label, variant } = statusMap[row.original.status];
      return <Badge variant={variant}>{label}</Badge>;
    },
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 140,
  },
];

export default function HoaDonDauVaoPage() {
  const { toast } = useToast();
  const [data, setData] = useState<InputInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Delete
  const [deletingInvoice, setDeletingInvoice] = useState<InputInvoice | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Record
  const [recordingInvoice, setRecordingInvoice] = useState<InputInvoice | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getInputInvoices({
      page,
      pageSize,
      search,
      filters: {
        ...(statusFilter !== "all" && { status: statusFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, statusFilter]);

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <SelectFilter
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Thời gian">
            <DateRangeFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Hóa đơn đầu vào"
        searchPlaceholder="Theo mã HĐ, NCC"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => {
            const cols = [
              { header: "Mã HĐ", key: "code", width: 15 },
              { header: "Ngày", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "NCC", key: "supplierName", width: 25 },
              { header: "Tiền hàng", key: "totalAmount", width: 18, format: (v: number) => v },
              { header: "Thuế", key: "taxAmount", width: 15, format: (v: number) => v },
              { header: "Trạng thái", key: "statusName", width: 15 },
            ];
            exportToExcel(data, cols, "hoa-don-dau-vao");
          },
          csv: () => {
            const cols = [
              { header: "Mã HĐ", key: "code", width: 15 },
              { header: "Ngày", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "NCC", key: "supplierName", width: 25 },
              { header: "Tiền hàng", key: "totalAmount", width: 18, format: (v: number) => v },
              { header: "Thuế", key: "taxAmount", width: 15, format: (v: number) => v },
              { header: "Trạng thái", key: "statusName", width: 15 },
            ];
            exportToCsv(data, cols, "hoa-don-dau-vao");
          },
        }}
        actions={[
          { label: "Tạo mới", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
        ]}
      />

      <CreateInputInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
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
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(item, onClose) => (
          <InputInvoiceDetail item={item} onClose={onClose} />
        )}
        rowActions={(row) => [
          {
            label: "Xem chi tiết",
            icon: <Icon name="visibility" size={16} />,
            onClick: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
          },
          { label: "In phiếu", icon: <Icon name="print" size={16} />, onClick: () => printDocument(buildInputInvoicePrintData(row)) },
          { label: "Ghi nhận", icon: <Icon name="menu_book" size={16} />, onClick: () => setRecordingInvoice(row) },
          { label: "Xóa", icon: <Icon name="delete" size={16} />, onClick: () => setDeletingInvoice(row), variant: "destructive", separator: true },
        ]}
      />

      <ConfirmDialog
        open={!!deletingInvoice}
        onOpenChange={(open) => { if (!open) setDeletingInvoice(null); }}
        title="Xóa hoá đơn đầu vào"
        description={`Xóa hoá đơn đầu vào ${deletingInvoice?.code}?`}
        confirmLabel="Xóa"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={async () => {
          if (!deletingInvoice) return;
          setDeleteLoading(true);
          try {
            await deleteInputInvoice(deletingInvoice.id);
            toast({ title: "Đã xóa hoá đơn đầu vào", description: deletingInvoice.code, variant: "success" });
            setDeletingInvoice(null);
            fetchData();
          } catch (err) {
            toast({ title: "Lỗi xóa hoá đơn đầu vào", description: err instanceof Error ? err.message : "Vui lòng thử lại", variant: "error" });
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      <ConfirmDialog
        open={!!recordingInvoice}
        onOpenChange={(open) => { if (!open) setRecordingInvoice(null); }}
        title="Ghi nhận hoá đơn đầu vào"
        description={`Ghi nhận hoá đơn đầu vào ${recordingInvoice?.code ?? ""}?`}
        confirmLabel="Ghi nhận"
        cancelLabel="Đóng"
        loading={recordLoading}
        onConfirm={async () => {
          if (!recordingInvoice) return;
          setRecordLoading(true);
          try {
            await recordInputInvoice(recordingInvoice.id);
            toast({
              title: "Đã ghi nhận hoá đơn đầu vào",
              description: recordingInvoice.code,
              variant: "success",
            });
            setRecordingInvoice(null);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi ghi nhận hoá đơn",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setRecordLoading(false);
          }
        }}
      />
    </ListPageLayout>
  );
}
