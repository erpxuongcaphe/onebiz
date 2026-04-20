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
  CheckboxFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { getInternalSales, getInternalSaleById, getInternalSalesForExport } from "@/lib/services";
import { CreateInternalSaleDialog } from "@/components/shared/dialogs";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { internalSaleExcelSchema } from "@/lib/excel/schemas";
import { bulkImportInternalSales } from "@/lib/services/supabase/excel-import";
import { exportToExcelFromSchema } from "@/lib/excel";
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

/* ------------------------------------------------------------------ */
/*  Status config                                                       */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Nháp", color: "#6b7280" },
  confirmed: { label: "Xác nhận", color: "#004AC6" },
  completed: { label: "Hoàn thành", color: "#22c55e" },
  cancelled: { label: "Đã huỷ", color: "#ef4444" },
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
}: {
  item: InternalSaleRow;
  onClose: () => void;
}) {
  const meta = STATUS_META[item.status] ?? STATUS_META.draft;

  const [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    getInternalSaleById(item.id).then(setDetail).catch(() => {});
  }, [item.id]);

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
              variant: "outline",
              className: `border`,
            }}
            subtitle={`${item.fromBranchName} → ${item.toBranchName}`}
          />
          <div className="flex items-center gap-4 flex-wrap text-xs px-1">
            <span>
              Người tạo: <strong>{item.createdByName || item.createdBy}</strong>
            </span>
            <span>
              Thời gian: <strong>{formatDate(item.createdAt)}</strong>
            </span>
          </div>
          <DetailInfoGrid
            fields={[
              { label: "Bên bán", value: item.fromBranchName },
              { label: "Bên mua", value: item.toBranchName },
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
      label: "Sản phẩm",
      content: (
        <div className="overflow-x-auto">
          {detail?.items && detail.items.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Sản phẩm</th>
                  <th className="text-right p-2">SL</th>
                  <th className="text-right p-2">Đơn giá</th>
                  <th className="text-right p-2">VAT</th>
                  <th className="text-right p-2">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it: any) => (
                  <tr key={it.id} className="border-t">
                    <td className="p-2">
                      <div className="font-medium">{it.productName}</div>
                      <div className="text-xs text-muted-foreground">{it.productCode} · {it.unit}</div>
                    </td>
                    <td className="p-2 text-right">{it.quantity}</td>
                    <td className="p-2 text-right">{formatCurrency(it.unitPrice)}</td>
                    <td className="p-2 text-right">{it.vatRate}%</td>
                    <td className="p-2 text-right font-medium">{formatCurrency(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-center text-muted-foreground">Đang tải...</div>
          )}
        </div>
      ),
    },
  ];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <DetailTabs tabs={tabs} />
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page component                                                      */
/* ------------------------------------------------------------------ */

export default function InternalSalePage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<InternalSaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<InternalSaleRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await getInternalSales({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        status: statusFilter.length === 1 ? statusFilter[0] : undefined,
        branchId: activeBranchId || undefined,
      });
      setData(result.data as InternalSaleRow[]);
      setTotal(result.total);
    } catch {
      toast({ title: "Lỗi tải dữ liệu", variant: "error" });
    }
  }, [page, search, statusFilter, activeBranchId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnDef<InternalSaleRow>[] = [
    {
      accessorKey: "code",
      header: "Mã đơn",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary cursor-pointer">{row.original.code}</span>
      ),
    },
    {
      id: "flow",
      header: "Luồng",
      size: 250,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">{row.original.fromBranchName}</span>
          <Icon name="swap_horiz" size={14} className="text-muted-foreground shrink-0" />
          <span className="font-medium">{row.original.toBranchName}</span>
        </div>
      ),
    },
    {
      accessorKey: "total",
      header: "Tổng tiền",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium">{formatCurrency(row.original.total)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 120,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status] ?? STATUS_META.draft;
        return (
          <Badge
            variant="outline"
            style={{ backgroundColor: meta.color + "20", color: meta.color, borderColor: meta.color + "40" }}
          >
            {meta.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 140,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      accessorKey: "createdByName",
      header: "Người tạo",
      size: 140,
    },
  ];

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
        <DataTable
          columns={columns}
          data={data}
          pageSize={PAGE_SIZE}
          pageIndex={page - 1}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          onPageChange={(idx) => setPage(idx + 1)}
          onRowClick={(row) => setSelected(row)}
          renderDetail={
            selected
              ? (_row, onClose) => (
                  <InternalSaleDetail item={selected} onClose={onClose} />
                )
              : undefined
          }
        />
      </ListPageLayout>

      <CreateInternalSaleDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSuccess={fetchData}
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
    </>
  );
}
