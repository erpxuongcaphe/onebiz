"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
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
import type { ItemColumn } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import {
  getInternalSales,
  getInternalSaleById,
  getInternalSalesForExport,
  cancelInternalSale,
} from "@/lib/services";
import { CreateInternalSaleDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { internalSaleExcelSchema } from "@/lib/excel/schemas";
import { bulkImportInternalSales } from "@/lib/services/supabase/excel-import";
import { exportToExcelFromSchema } from "@/lib/excel";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildInternalSalePrintData, toPrintLines } from "@/lib/print-templates";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface InternalSaleRow {
  id: string;
  code: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  subtotal: number;
  taxAmount: number;
  total: number;
  note?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

interface InternalSaleItemDetail {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  amount: number;
}

/* ------------------------------------------------------------------ */
/*  Status config — Stitch tokens thay vì hex                           */
/* ------------------------------------------------------------------ */

type StatusKey = "draft" | "confirmed" | "completed" | "cancelled";

const STATUS_META: Record<
  StatusKey,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    // Dùng utility class thay vì inline hex để theo Stitch tokens.
    badgeClass: string;
  }
> = {
  draft: {
    label: "Nháp",
    variant: "outline",
    badgeClass: "bg-muted text-muted-foreground border-muted-foreground/25",
  },
  confirmed: {
    label: "Xác nhận",
    variant: "outline",
    badgeClass: "bg-primary-fixed text-primary border-primary/30",
  },
  completed: {
    label: "Hoàn thành",
    variant: "outline",
    badgeClass: "bg-status-success/10 text-status-success border-status-success/25",
  },
  cancelled: {
    label: "Đã hủy",
    variant: "outline",
    badgeClass: "bg-destructive/10 text-destructive border-destructive/25",
  },
};

const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const PAGE_SIZE = 20;

/* ------------------------------------------------------------------ */
/*  Detail panel                                                        */
/* ------------------------------------------------------------------ */

function InternalSaleDetail({
  item,
  onClose,
  onCancel,
}: {
  item: InternalSaleRow;
  onClose: () => void;
  onCancel?: () => void;
}) {
  const meta = STATUS_META[item.status];

  const [detail, setDetail] = useState<{ items?: InternalSaleItemDetail[] } | null>(null);
  useEffect(() => {
    getInternalSaleById(item.id)
      .then((d) => setDetail(d as { items?: InternalSaleItemDetail[] }))
      .catch(() => {});
  }, [item.id]);

  const itemColumns: ItemColumn<InternalSaleItemDetail>[] = [
    {
      header: "Sản phẩm",
      accessor: (it) => (
        <div>
          <div className="font-medium">{it.productName}</div>
          <div className="text-xs text-muted-foreground">
            {it.productCode} · {it.unit}
          </div>
        </div>
      ),
    },
    { header: "SL", accessor: "quantity", align: "right", className: "w-16" },
    {
      header: "Đơn giá",
      accessor: (it) => formatCurrency(it.unitPrice),
      align: "right",
      className: "w-28",
    },
    {
      header: "VAT",
      accessor: (it) => `${it.vatRate}%`,
      align: "right",
      className: "w-16",
    },
    {
      header: "Thành tiền",
      accessor: (it) => (
        <span className="font-medium">{formatCurrency(it.amount)}</span>
      ),
      align: "right",
      className: "w-32",
    },
  ];

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={`Đơn nội bộ ${item.code}`}
            code={item.code}
            status={{
              label: meta.label,
              variant: meta.variant,
              className: meta.badgeClass,
            }}
            subtitle={`${item.fromBranchName || "—"} → ${item.toBranchName || "—"}`}
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo:{" "}
                  <strong>{formatUser(item.createdByName, item.createdBy)}</strong>
                </span>
                <span>
                  Thời gian: <strong>{formatDate(item.createdAt)}</strong>
                </span>
              </div>
            }
          />
          <DetailInfoGrid
            fields={[
              { label: "Mã đơn", value: item.code },
              { label: "Trạng thái", value: meta.label },
              { label: "Bên bán", value: item.fromBranchName || "—" },
              { label: "Bên mua", value: item.toBranchName || "—" },
              { label: "Tạm tính", value: formatCurrency(item.subtotal) },
              { label: "Thuế VAT", value: formatCurrency(item.taxAmount) },
              { label: "Tổng cộng", value: formatCurrency(item.total) },
              { label: "Ghi chú", value: item.note || "—" },
            ]}
          />
        </div>
      ),
    },
    {
      id: "items",
      label: `Sản phẩm${detail?.items ? ` (${detail.items.length})` : ""}`,
      content: detail?.items ? (
        <DetailItemsTable
          columns={itemColumns}
          items={detail.items}
          summary={[
            { label: "Tạm tính", value: formatCurrency(item.subtotal) },
            { label: "Thuế VAT", value: formatCurrency(item.taxAmount) },
            {
              label: "Tổng cộng",
              value: formatCurrency(item.total),
              className: "text-base font-bold text-primary",
            },
          ]}
        />
      ) : (
        <div className="p-4 text-center text-sm text-muted-foreground">
          Đang tải sản phẩm...
        </div>
      ),
    },
    {
      id: "history",
      label: "Lịch sử",
      content: <AuditHistoryTab entityType="internal_sale" entityId={item.id} />,
    },
  ];

  const canCancel =
    (item.status === "draft" || item.status === "confirmed") && !!onCancel;

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onDelete={canCancel ? onCancel : undefined}
      deleteLabel="Hủy đơn"
    >
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page component                                                      */
/* ------------------------------------------------------------------ */

export default function InternalSalePage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch } = useBranchFilter();
  const txPerms = useTxRowPermissions("internal_sale");
  const [data, setData] = useState<InternalSaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<InternalSaleRow | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<InternalSaleRow | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  // Sprint UX-1 Stage 4: Audit log shortcut + In phiếu (anomaly fix)
  const [auditDialogTarget, setAuditDialogTarget] = useState<InternalSaleRow | null>(null);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const commonFilters = {
        search: search || undefined,
        status: statusFilter.length === 1 ? statusFilter[0] : undefined,
      };
      const branchScope = viewAllBranches ? undefined : activeBranchId || undefined;
      const result = await getInternalSales({
        page,
        pageSize: PAGE_SIZE,
        ...commonFilters,
        branchId: branchScope,
      });
      setData(result.data as InternalSaleRow[]);
      setTotal(result.total);
      // Bảng trống vì lọc chi nhánh? Đếm phiếu ở chi nhánh khác để gợi ý (cùng bộ
      // lọc, bỏ branch). Chỉ khi đang lọc theo 1 chi nhánh cụ thể.
      if (result.data.length === 0 && !viewAllBranches && activeBranchId) {
        const all = await getInternalSales({
          page: 1,
          pageSize: 1,
          ...commonFilters,
          branchId: undefined,
        });
        setOtherBranchCount(all.total);
      } else {
        setOtherBranchCount(0);
      }
    } catch {
      toast({ title: "Lỗi tải dữ liệu", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, activeBranchId, viewAllBranches, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // KPI row — tính nhẹ dựa trên trang hiện tại (quick feedback, không phải toàn dataset).
  // Khi CEO muốn số chính xác toàn cục, Sprint KHO-3 sẽ thêm RPC count riêng.
  const kpis = useMemo(() => {
    const draft = data.filter((d) => d.status === "draft").length;
    const confirmed = data.filter((d) => d.status === "confirmed").length;
    const completed = data.filter((d) => d.status === "completed").length;
    const totalRevenue = data
      .filter((d) => d.status === "completed")
      .reduce((s, d) => s + d.total, 0);
    return { draft, confirmed, completed, totalRevenue };
  }, [data]);

  const columns: ColumnDef<InternalSaleRow>[] = [
    {
      accessorKey: "code",
      header: "Mã đơn",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 140,
      cell: ({ row }) => (
        <span className="text-sm">{formatDate(row.original.createdAt)}</span>
      ),
    },
    {
      id: "flow",
      header: "Chi nhánh bán → mua",
      size: 280,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium truncate max-w-[110px]" title={row.original.fromBranchName}>
            {row.original.fromBranchName || "—"}
          </span>
          <Icon name="arrow_forward" size={14} className="text-muted-foreground shrink-0" />
          <span className="font-medium truncate max-w-[110px]" title={row.original.toBranchName}>
            {row.original.toBranchName || "—"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "subtotal",
      header: "Tạm tính",
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm">{formatCurrency(row.original.subtotal)}</span>
      ),
    },
    {
      accessorKey: "taxAmount",
      header: "VAT",
      size: 110,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatCurrency(row.original.taxAmount)}
        </span>
      ),
    },
    {
      accessorKey: "total",
      header: "Tổng tiền",
      size: 130,
      cell: ({ row }) => (
        <span className="font-semibold">{formatCurrency(row.original.total)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 120,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return (
          <Badge variant={meta.variant} className={meta.badgeClass}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdByName",
      header: "Người tạo",
      size: 140,
      cell: ({ row }) => (
        <span className="text-sm">
          {formatUser(row.original.createdByName, row.original.createdBy)}
        </span>
      ),
    },
  ];

  async function handleCancel() {
    if (!cancellingItem) return;
    setCancelLoading(true);
    try {
      await cancelInternalSale(cancellingItem.id);
      toast({
        title: "Đã hủy đơn nội bộ",
        description: `Đơn ${cancellingItem.code} đã được hủy thành công.`,
        variant: "success",
      });
      await fetchData();
    } catch (err) {
      toast({
        title: "Lỗi hủy đơn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setCancelLoading(false);
      setCancellingItem(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Bán hàng nội bộ"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm mã đơn..."
        onExport={{
          // Export theo schema Import → round-trip edit & re-upload không mất field
          excel: async () => {
            try {
              toast({
                title: "Đang chuẩn bị file Excel…",
                description: "Tải tất cả dòng hàng theo bộ lọc hiện tại",
                variant: "info",
              });
              const rows = await getInternalSalesForExport({
                search: search || undefined,
                status: statusFilter.length === 1 ? statusFilter[0] : undefined,
                branchId: activeBranchId || undefined,
              });
              if (rows.length === 0) {
                toast({ title: "Không có dữ liệu để xuất", variant: "info" });
                return;
              }
              exportToExcelFromSchema(rows, internalSaleExcelSchema);
            } catch (err) {
              toast({
                title: "Lỗi xuất Excel",
                description: err instanceof Error ? err.message : "Vui lòng thử lại",
                variant: "error",
              });
            }
          },
        }}
        actions={[
          {
            label: "Tạo đơn nội bộ",
            icon: <Icon name="add" size={16} />,
            onClick: () => setShowCreate(true),
          },
          {
            label: "Nhập Excel",
            icon: <Icon name="upload_file" size={16} />,
            variant: "outline",
            onClick: () => setImportOpen(true),
          },
        ]}
      />

      {/* KPI row — nhanh gọn, tính theo page hiện tại */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-3">
        <Card size="sm" className="px-4">
          <div className="text-xs text-muted-foreground">Nháp</div>
          <div className="text-xl font-bold">{kpis.draft}</div>
        </Card>
        <Card size="sm" className="px-4">
          <div className="text-xs text-muted-foreground">Xác nhận</div>
          <div className="text-xl font-bold text-primary">{kpis.confirmed}</div>
        </Card>
        <Card size="sm" className="px-4">
          <div className="text-xs text-muted-foreground">Hoàn thành</div>
          <div className="text-xl font-bold text-status-success">{kpis.completed}</div>
        </Card>
        <Card size="sm" className="px-4">
          <div className="text-xs text-muted-foreground">Doanh thu nội bộ</div>
          <div className="text-xl font-bold">{formatCurrency(kpis.totalRevenue)}</div>
        </Card>
      </div>

      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Trạng thái">
              <CheckboxFilter
                options={STATUS_OPTIONS}
                selected={statusFilter}
                onChange={setStatusFilter}
              />
            </FilterGroup>
          </FilterSidebar>
        }
      >
        {viewAllBranches && (
          <AllBranchesBanner
            branchName={currentBranch?.name}
            onBackToBranch={() => setViewAllBranches(false)}
          />
        )}

        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          emptyBranchHint={{
            otherBranchCount,
            onViewAllBranches: () => setViewAllBranches(true),
            entityLabel: "phiếu bán nội bộ",
          }}
          pageSize={PAGE_SIZE}
          pageIndex={page - 1}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          onPageChange={(idx) => setPage(idx + 1)}
          onRowClick={(row) => setSelected(row)}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(row, onClose) => (
            <InternalSaleDetail
              item={row}
              onClose={onClose}
              onCancel={
                row.status !== "completed" && row.status !== "cancelled"
                  ? () => setCancellingItem(row)
                  : undefined
              }
            />
          )}
          rowActions={(row) =>
            buildTransactionRowActions({
              row,
              kind: "internal_sale",
              permissions: txPerms,
              onView: () => {
                const idx = data.findIndex((d) => d.id === row.id);
                setExpandedRow(expandedRow === idx ? null : idx);
                setSelected(row);
              },
              // Anomaly fix Stage 5c: thêm In phiếu (trước đây thiếu)
              // Nạp chi tiết hàng trước rồi mới in (item dùng field `amount`).
              onPrint: async () => {
                const detail = await getInternalSaleById(row.id);
                const lines = toPrintLines(
                  detail.items.map((it) => ({ ...it, total: it.amount })),
                );
                await printDocumentWithTemplate({
                  channel: "backoffice",
                  docType: "internal_sale",
                  branchId: activeBranchId ?? null,
                  base: buildInternalSalePrintData(row, lines),
                });
              },
              onAuditLog: () => setAuditDialogTarget(row),
              onCancel:
                row.status !== "completed" && row.status !== "cancelled"
                  ? () => setCancellingItem(row)
                  : undefined,
            })
          }
        />
      </ListPageLayout>

      <CreateInternalSaleDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => {
          if (!open && !cancelLoading) setCancellingItem(null);
        }}
        title="Hủy đơn nội bộ"
        description={`Bạn có chắc muốn hủy đơn ${cancellingItem?.code ?? ""}? Chỉ đơn nháp hoặc đã xác nhận mới được hủy; thao tác này không làm thay đổi tồn kho.`}
        confirmLabel="Hủy đơn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={handleCancel}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={internalSaleExcelSchema}
        onCommit={bulkImportInternalSales}
        onFinished={() => {
          setPage(1);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Danh sách đơn bán nội bộ đã được cập nhật.",
            variant: "success",
          });
        }}
      />

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="internal_sale"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}
    </>
  );
}
