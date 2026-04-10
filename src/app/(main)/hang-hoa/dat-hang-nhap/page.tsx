"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, PackagePlus, XCircle } from "lucide-react";
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
import { getPurchaseOrderEntries, getPurchaseEntryStatuses } from "@/lib/services";
import { CreatePurchaseEntryDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { useToast } from "@/lib/contexts";
import type { PurchaseOrderEntry } from "@/lib/types";

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
}: {
  item: PurchaseOrderEntry;
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
            title={`Đặt hàng nhập ${item.code}`}
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
              { label: "Mã đặt hàng", value: item.code },
              { label: "Ngày đặt", value: formatDate(item.date) },
              { label: "Nhà cung cấp", value: item.supplierName },
              { label: "Tổng tiền", value: formatCurrency(item.totalAmount) },
              { label: "Ngày dự kiến nhận", value: formatDate(item.expectedDate) },
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
        actions={[
          { label: "Đặt hàng", icon: <Plus className="h-4 w-4" />, variant: "default", onClick: () => setCreateOpen(true) },
        ]}
      />

      <CreatePurchaseEntryDialog
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
          <PurchaseOrderEntryDetail item={item} onClose={onClose} />
        )}
        rowActions={(row) => [
          {
            label: "Xem chi tiết",
            icon: <Eye className="h-4 w-4" />,
            onClick: () => {
              const idx = data.findIndex((d) => d.id === row.id);
              setExpandedRow(expandedRow === idx ? null : idx);
            },
          },
          { label: "Nhập hàng", icon: <PackagePlus className="h-4 w-4" />, onClick: () => { toast({ variant: "info", title: "Chuyển đến trang nhập hàng" }); router.push("/hang-hoa/nhap-hang"); } },
          ...(row.status !== "completed" && row.status !== "cancelled"
            ? [
                { label: "Hủy", icon: <XCircle className="h-4 w-4" />, onClick: () => setCancellingItem(row), variant: "destructive" as const, separator: true },
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
            // Mock data — toast success + refetch
            toast({
              title: "Đã hủy đơn đặt hàng nhập",
              description: `Đơn ${cancellingItem.code} đã được hủy thành công`,
              variant: "success",
            });
            await fetchData();
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />
    </ListPageLayout>
  );
}
