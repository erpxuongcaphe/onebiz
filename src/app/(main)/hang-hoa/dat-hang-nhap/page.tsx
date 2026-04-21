"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import { printDocument } from "@/lib/print-document";
import { buildPurchaseEntryPrintData } from "@/lib/print-templates";
import {
  getPurchaseOrderEntries,
  getPurchaseOrdersForExport,
  getPurchaseEntryStatuses,
  cancelPurchaseOrderEntry,
} from "@/lib/services";
import { CreatePurchaseEntryDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { purchaseOrderExcelSchema } from "@/lib/excel/schemas";
import { bulkImportPurchaseOrders } from "@/lib/services/supabase/excel-import";
import { useToast } from "@/lib/contexts";
import type { PurchaseOrderEntry } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// === Status config ===
const statusMap: Record<
  PurchaseOrderEntry["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Chờ nhập", variant: "secondary" },
  partial: { label: "Nhập một phần", variant: "outline" },
  completed: { label: "Hoàn thành", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = getPurchaseEntryStatuses();

// === Inline Detail ===
function PurchaseOrderEntryDetail({
  item,
  onClose,
  onDelete,
}: {
  item: PurchaseOrderEntry;
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
            title={`Đặt hàng nhập ${item.code}`}
            code={item.code}
            status={{ label: st.label, variant: st.variant }}
            subtitle="Chi nhánh trung tâm"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{formatUser(undefined, item.createdBy)}</strong>
                </span>
                <span>
                  Ngày tạo: <strong>{formatDate(item.date)}</strong>
                </span>
              </div>
            }
          />
          <DetailInfoGrid
            fields={[
              { label: "Mã đặt hàng", value: item.code },
              { label: "Ngày đặt", value: formatDate(item.date) },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền", value: formatCurrency(item.totalAmount) },
              { label: "Ngày dự kiến nhận", value: formatDate(item.expectedDate) },
              { label: "Trạng thái", value: st.label },
              { label: "Người tạo", value: formatUser(undefined, item.createdBy) },
            ]}
          />
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="purchase_order" entityId={item.id} />,
    },
  ];
  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={onDelete}
      deleteLabel="Hủy"
    >
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

// === Columns ===
const columns: ColumnDef<PurchaseOrderEntry, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã đặt hàng",
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
    accessorKey: "supplierName",
    header: "NCC",
    size: 220,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "expectedDate",
    header: "Ngày dự kiến nhận",
    size: 150,
    cell: ({ row }) => formatDate(row.original.expectedDate),
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

export default function DatHangNhapPage() {
  const [data, setData] = useState<PurchaseOrderEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [cancellingItem, setCancellingItem] = useState<PurchaseOrderEntry | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "this_month" | "all" | "custom">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getPurchaseOrderEntries({
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

  /* ---- KPI row (outstanding orders = CEO attention) ---- */
  const kpiOutstanding = data.filter(
    (d) => d.status === "pending" || d.status === "partial",
  ).length;
  const kpiOutstandingValue = data
    .filter((d) => d.status === "pending" || d.status === "partial")
    .reduce((sum, d) => sum + (d.totalAmount ?? 0), 0);
  const kpiCompleted = data.filter((d) => d.status === "completed").length;
  const kpiCancelled = data.filter((d) => d.status === "cancelled").length;

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
        title="Đặt hàng nhập"
        searchPlaceholder="Theo mã, NCC"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: async () => {
            // Export theo schema Import → mỗi dòng = 1 line item, gộp theo "code"
            // User có thể edit + upload lại mà không mất field nào (round-trip)
            try {
              toast({
                title: "Đang chuẩn bị file Excel…",
                description: "Tải tất cả dòng hàng theo bộ lọc hiện tại",
                variant: "info",
              });
              const rows = await getPurchaseOrdersForExport({
                search: search || undefined,
                status: statusFilter !== "all" ? statusFilter : undefined,
              });
              if (rows.length === 0) {
                toast({ title: "Không có dữ liệu để xuất", variant: "info" });
                return;
              }
              exportToExcelFromSchema(rows, purchaseOrderExcelSchema);
            } catch (err) {
              toast({
                title: "Lỗi xuất Excel",
                description: err instanceof Error ? err.message : "Vui lòng thử lại",
                variant: "error",
              });
            }
          },
          csv: () => {
            const cols = [
              { header: "Mã", key: "code", width: 15 },
              { header: "Ngày", key: "date", width: 18, format: (v: string) => formatDate(v) },
              { header: "NCC", key: "supplierName", width: 25 },
              { header: "Tổng tiền", key: "totalAmount", width: 18, format: (v: number) => v },
              { header: "Trạng thái", key: "statusName", width: 15 },
            ];
            exportToCsv(data, cols, "dat-hang-nhap");
          },
        }}
        actions={[
          { label: "Đặt hàng", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
          { label: "Nhập Excel", icon: <Icon name="upload_file" size={16} />, variant: "outline", onClick: () => setImportOpen(true) },
        ]}
      />

      <CreatePurchaseEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      {!loading && data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
          <SummaryCard
            icon={<Icon name="shopping_cart" size={16} />}
            label="Tổng đơn đặt"
            value={total.toString()}
          />
          <SummaryCard
            icon={<Icon name="hourglass_top" size={16} />}
            label="Chờ / Đang nhập"
            value={kpiOutstanding.toString()}
            hint={formatCurrency(kpiOutstandingValue)}
            highlight={kpiOutstanding > 0}
          />
          <SummaryCard
            icon={<Icon name="check_circle" size={16} />}
            label="Đã hoàn tất"
            value={kpiCompleted.toString()}
          />
          <SummaryCard
            icon={<Icon name="cancel" size={16} />}
            label="Đã huỷ"
            value={kpiCancelled.toString()}
            danger={kpiCancelled > 0}
          />
        </div>
      )}

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
          <PurchaseOrderEntryDetail
            item={item}
            onClose={onClose}
            onDelete={
              item.status !== "completed" && item.status !== "cancelled"
                ? () => setCancellingItem(item)
                : undefined
            }
          />
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
          { label: "In phiếu", icon: <Icon name="print" size={16} />, onClick: () => printDocument(buildPurchaseEntryPrintData(row)) },
          { label: "Nhập hàng", icon: <Icon name="add_box" size={16} />, onClick: () => { toast({ variant: "info", title: "Chuyển đến trang nhập hàng" }); router.push("/hang-hoa/nhap-hang"); } },
          ...(row.status !== "completed" && row.status !== "cancelled"
            ? [
                { label: "Hủy", icon: <Icon name="cancel" size={16} />, onClick: () => setCancellingItem(row), variant: "destructive" as const, separator: true },
              ]
            : []),
        ]}
      />

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy đơn đặt hàng nhập"
        description={`Bạn có chắc muốn hủy đơn đặt hàng nhập ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
        confirmLabel="Hủy đơn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            await cancelPurchaseOrderEntry(cancellingItem.id);
            toast({
              title: "Đã hủy đơn đặt hàng nhập",
              description: `Đơn ${cancellingItem.code} đã được hủy thành công`,
              variant: "success",
            });
            await fetchData();
          } catch (err) {
            toast({
              title: "Không thể hủy đơn",
              description: err instanceof Error ? err.message : "Đã xảy ra lỗi khi hủy đơn",
              variant: "error",
            });
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={purchaseOrderExcelSchema}
        onCommit={bulkImportPurchaseOrders}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách đơn nhập đã được cập nhật.",
            variant: "success",
          });
        }}
      />
    </ListPageLayout>
  );
}
