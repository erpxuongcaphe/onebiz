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
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
// CEO 06/06/2026 Phase 4: migrate khỏi legacy DateRangeFilter sang
// DatePresetFilter + STANDARD_LIST_PRESETS_WITH_ALL (12 option).
import { STANDARD_LIST_PRESETS_WITH_ALL } from "@/lib/utils/list-date-preset-range";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { getPurchaseReturns, getPurchaseReturnStatuses, getPurchaseReturnItems } from "@/lib/services";
import type { PurchaseReturn } from "@/lib/types";
import { CreatePurchaseReturnDialog } from "@/components/shared/dialogs";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocumentWithTemplate } from "@/lib/print-apply-template";
import { buildPurchaseReturnPrintData, toPrintLines } from "@/lib/print-templates";
import { Icon } from "@/components/ui/icon";

// === Status config ===
const statusMap: Record<
  PurchaseReturn["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  draft: { label: "Phiếu tạm", variant: "secondary" },
};

const statusOptions = getPurchaseReturnStatuses();

// === Inline Detail ===
function PurchaseReturnDetail({
  item,
  onClose,
}: {
  item: PurchaseReturn;
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
            title={`Trả hàng nhập ${item.code}`}
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
              { label: "Mã trả hàng", value: item.code },
              { label: "Ngày trả", value: formatDate(item.date) },
              { label: "Chi nhánh", value: item.branchName ?? "---" },
              { label: "Mã nhập hàng", value: item.importCode },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền trả", value: formatCurrency(item.totalAmount) },
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
      content: <AuditHistoryTab entityType="purchase_return" entityId={item.id} />,
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
const columns: ColumnDef<PurchaseReturn, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã trả hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "importCode",
    header: "Mã nhập hàng",
    size: 130,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.importCode}</span>
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
    accessorKey: "branchName",
    header: "Chi nhánh",
    size: 160,
    cell: ({ row }) => row.original.branchName ?? "---",
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền trả",
    cell: ({ row }) => formatCurrency(row.original.totalAmount),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    size: 120,
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

export default function TraHangNhapPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const txPerms = useTxRowPermissions("purchase_return");
  const [data, setData] = useState<PurchaseReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<PurchaseReturn | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getPurchaseReturns({
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
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
              presets={STANDARD_LIST_PRESETS_WITH_ALL}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Trả hàng nhập"
        searchPlaceholder="Theo mã phiếu"
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          { label: "Tạo phiếu trả", icon: <Icon name="add" size={16} />, variant: "default", onClick: () => setCreateOpen(true) },
        ]}
      />

      {/* KPI row — tính trên trang hiện tại, không call extra query */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="undo" size={16} />}
          label="Tổng phiếu"
          value={total.toString()}
        />
        <SummaryCard
          icon={<Icon name="check_circle" size={16} />}
          label="Hoàn thành"
          value={data.filter((r) => r.status === "completed").length.toString()}
        />
        <SummaryCard
          icon={<Icon name="edit_note" size={16} />}
          label="Phiếu tạm"
          value={data.filter((r) => r.status === "draft").length.toString()}
          highlight={data.filter((r) => r.status === "draft").length > 0}
        />
        <SummaryCard
          icon={<Icon name="payments" size={16} />}
          label="Tổng giá trị"
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
          <PurchaseReturnDetail item={item} onClose={onClose} />
        )}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "purchase_return",
            permissions: txPerms,
            onView: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
            onPrint: async () => {
              const items = await getPurchaseReturnItems(row.id);
              await printDocumentWithTemplate({
                channel: "backoffice",
                docType: "purchase_return",
                branchId: row.branchId ?? activeBranchId ?? null,
                base: buildPurchaseReturnPrintData(row, toPrintLines(items)),
              });
            },
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
          })
        }
      />

      <CreatePurchaseReturnDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
      {auditDialogTarget && (
        <AuditLogDialog
          entityType="purchase_return"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}
    </ListPageLayout>
  );
}
