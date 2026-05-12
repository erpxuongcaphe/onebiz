"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
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
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { printDocument } from "@/lib/print-document";
import { buildInputInvoicePrintData } from "@/lib/print-templates";
import { getInputInvoices, getInputInvoiceStatuses, cancelInputInvoice, recordInputInvoice } from "@/lib/services";
import { CreateInputInvoiceDialog, ConfirmDialog } from "@/components/shared/dialogs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
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
  onDelete,
}: {
  item: InputInvoice;
  onClose: () => void;
  onDelete?: () => void;
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
            subtitle={item.branchName ? `Chi nhánh: ${item.branchName}` : undefined}
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{formatUser(item.createdByName, item.createdBy)}</strong>
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
              { label: "Chi nhánh", value: item.branchName ?? "---" },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền hàng", value: formatCurrency(item.totalAmount) },
              { label: "Thuế", value: formatCurrency(item.taxAmount) },
              { label: "Trạng thái", value: st.label },
              { label: "Người tạo", value: formatUser(item.createdByName, item.createdBy) },
            ]}
          />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="input_invoice" entityId={item.id} />,
    },
  ];
  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={onDelete}
    >
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
    accessorKey: "branchName",
    header: "Chi nhánh",
    size: 160,
    cell: ({ row }) => row.original.branchName ?? "---",
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
    cell: ({ row }) => formatUser(row.original.createdByName, row.original.createdBy),
  },
];

export default function HoaDonDauVaoPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const txPerms = useTxRowPermissions("input_invoice");
  const [data, setData] = useState<InputInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Phase 6.3 (CEO 12/05): hủy hoá đơn dùng `cancelInputInvoice` (soft-delete
  // + audit log + giữ lịch sử), thay vì `deleteInputInvoice` hard-delete.
  // Yêu cầu nhập lý do hủy ≥ 5 ký tự để tracking loss-prevention.
  const [deletingInvoice, setDeletingInvoice] = useState<InputInvoice | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Record
  const [recordingInvoice, setRecordingInvoice] = useState<InputInvoice | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);

  // Sprint UX-1 Stage 4: Audit log shortcut
  const [auditDialogTarget, setAuditDialogTarget] = useState<InputInvoice | null>(null);

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
        ...(activeBranchId && { branchId: activeBranchId }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, statusFilter, activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, statusFilter, activeBranchId]);

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

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="receipt_long" size={16} />}
          label="Tổng hóa đơn"
          value={total.toString()}
        />
        <SummaryCard
          icon={<Icon name="check_circle" size={16} />}
          label="Đã ghi sổ"
          value={data.filter((r) => r.status === "recorded").length.toString()}
        />
        <SummaryCard
          icon={<Icon name="warning" size={16} className="text-destructive" />}
          label="Chưa ghi sổ"
          value={data.filter((r) => r.status === "unrecorded").length.toString()}
          danger={data.filter((r) => r.status === "unrecorded").length > 0}
          hint={data.filter((r) => r.status === "unrecorded").length > 0 ? "Cần đối chiếu" : undefined}
        />
        <SummaryCard
          icon={<Icon name="payments" size={16} />}
          label="Tổng tiền hàng"
          value={formatCurrency(
            data.reduce((sum, r) => sum + (r.totalAmount ?? 0), 0),
          )}
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
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(item, onClose) => (
          <InputInvoiceDetail
            item={item}
            onClose={onClose}
            onDelete={() => setDeletingInvoice(item)}
          />
        )}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "input_invoice",
            permissions: txPerms,
            onView: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
            onPrint: () => printDocument(buildInputInvoicePrintData(row)),
            // Workflow: "Ghi nhận" cho HĐ chưa ghi sổ
            workflowActions:
              row.status === "unrecorded"
                ? [
                    {
                      label: "Ghi nhận",
                      icon: <Icon name="menu_book" size={16} />,
                      onClick: () => setRecordingInvoice(row),
                    },
                  ]
                : [],
            onAuditLog: () => setAuditDialogTarget(row),
            // Phase 6.3: cancel = soft-delete + audit log + lý do bắt buộc.
            onCancel: () => {
              setDeletingInvoice(row);
              setCancelReason("");
            },
          })
        }
      />

      {/* Phase 6.3 (CEO 12/05): Dialog hủy với textarea lý do bắt buộc */}
      <Dialog
        open={!!deletingInvoice}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingInvoice(null);
            setCancelReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-status-error">Hủy hoá đơn đầu vào</DialogTitle>
            <DialogDescription>
              Hủy hoá đơn{" "}
              <strong>{deletingInvoice?.code}</strong>
              {deletingInvoice?.supplierName && (
                <> · NCC: {deletingInvoice.supplierName}</>
              )}. Hệ thống ghi lý do vào lịch sử thao tác, không xoá cứng.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs font-medium text-foreground">
              Lý do hủy <span className="text-status-error">*</span>
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="VD: NCC giao sai mặt hàng, đã nhận lại hàng..."
              rows={3}
              disabled={deleteLoading}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {cancelReason.length > 0 && cancelReason.trim().length < 5 && (
              <p className="text-[11px] text-status-error">
                Lý do tối thiểu 5 ký tự.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteLoading}
              onClick={() => {
                setDeletingInvoice(null);
                setCancelReason("");
              }}
            >
              Đóng
            </Button>
            <Button
              variant="destructive"
              disabled={deleteLoading || cancelReason.trim().length < 5}
              onClick={async () => {
                if (!deletingInvoice) return;
                setDeleteLoading(true);
                try {
                  await cancelInputInvoice(deletingInvoice.id, cancelReason.trim());
                  toast({
                    title: "Đã hủy hoá đơn đầu vào",
                    description: `${deletingInvoice.code} — lý do: ${cancelReason.trim()}`,
                    variant: "success",
                  });
                  setDeletingInvoice(null);
                  setCancelReason("");
                  fetchData();
                } catch (err) {
                  toast({
                    title: "Lỗi hủy hoá đơn đầu vào",
                    description: err instanceof Error ? err.message : "Vui lòng thử lại",
                    variant: "error",
                  });
                } finally {
                  setDeleteLoading(false);
                }
              }}
            >
              {deleteLoading ? "Đang hủy..." : "Hủy hoá đơn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="input_invoice"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

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
