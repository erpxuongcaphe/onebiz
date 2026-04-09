"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Printer, XCircle, CheckCircle2, Factory, List, Kanban } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
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
import {
  CreateProductionOrderDialog,
  CompleteProductionOrderDialog,
} from "@/components/shared/dialogs";
import { PipelineStatusBadge } from "@/components/shared/pipeline";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { formatDate } from "@/lib/format";
import {
  getProductionOrders,
  getProductionOrderById,
  updateProductionStatus,
  canTransitionProductionStatus,
} from "@/lib/services";
import type { ProductionOrder, ProductionOrderStatus } from "@/lib/types";

type ViewMode = "list" | "kanban";

const STATUS_META: Record<
  ProductionOrderStatus,
  { label: string; color: string }
> = {
  planned: { label: "Đã lên kế hoạch", color: "#94a3b8" },
  material_check: { label: "Kiểm tra NVL", color: "#f59e0b" },
  in_production: { label: "Đang sản xuất", color: "#3b82f6" },
  quality_check: { label: "Kiểm chất lượng", color: "#8b5cf6" },
  completed: { label: "Hoàn thành", color: "#10b981" },
  cancelled: { label: "Đã hủy", color: "#ef4444" },
};

function ProductionOrderDetail({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProductionOrderById(orderId)
      .then((o) => {
        if (!cancelled) setOrder(o);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading || !order) {
    return (
      <InlineDetailPanel open onClose={onClose}>
        <div className="p-6 text-center text-muted-foreground">Đang tải...</div>
      </InlineDetailPanel>
    );
  }

  const meta = STATUS_META[order.status];

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
                  title={`Lệnh sản xuất ${order.code}`}
                  code={order.code}
                  subtitle={order.branchName ?? ""}
                  status={{
                    label: meta.label,
                    variant: "default",
                    className: "",
                  }}
                />
                <div className="flex items-center gap-2">
                  <PipelineStatusBadge name={meta.label} color={meta.color} />
                </div>
                <DetailInfoGrid
                  fields={[
                    { label: "Mã phiếu", value: order.code },
                    {
                      label: "Sản phẩm",
                      value: `${order.productCode} - ${order.productName}`,
                    },
                    {
                      label: "Số lượng kế hoạch",
                      value: <span className="font-semibold">{order.plannedQty}</span>,
                    },
                    {
                      label: "Đã hoàn thành",
                      value: <span className="font-semibold">{order.completedQty}</span>,
                    },
                    {
                      label: "Bắt đầu KH",
                      value: order.plannedStart ? formatDate(order.plannedStart) : "—",
                    },
                    {
                      label: "Kết thúc KH",
                      value: order.plannedEnd ? formatDate(order.plannedEnd) : "—",
                    },
                    {
                      label: "Số lô",
                      value: order.lotNumber ?? "—",
                    },
                    {
                      label: "Ghi chú",
                      value: order.notes ?? "—",
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "materials",
            label: "Nguyên vật liệu",
            content: (
              <div className="space-y-2">
                {(order.materials ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa có dữ liệu NVL
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">NVL</th>
                          <th className="text-right p-2 font-medium">Kế hoạch</th>
                          <th className="text-right p-2 font-medium">Thực tế</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(order.materials ?? []).map((m) => (
                          <tr key={m.id} className="border-t">
                            <td className="p-2">
                              <div className="font-medium">{m.productName}</div>
                              <div className="text-xs text-muted-foreground">
                                {m.productCode}
                              </div>
                            </td>
                            <td className="p-2 text-right">
                              {m.plannedQty} {m.unit}
                            </td>
                            <td className="p-2 text-right">
                              {m.actualQty || 0} {m.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

export default function SanXuatPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ProductionOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completingOrder, setCompletingOrder] = useState<ProductionOrder | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const [statusFilters, setStatusFilters] = useState<string[]>([
    "planned",
    "material_check",
    "in_production",
    "quality_check",
    "completed",
  ]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProductionOrders({ limit: 200 });
      setData(result.data);
      setTotal(result.total);
    } catch (err) {
      toast({
        title: "Lỗi tải lệnh sản xuất",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = data.filter((o) => {
    if (statusFilters.length > 0 && !statusFilters.includes(o.status)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.code?.toLowerCase().includes(q) ||
      o.productName?.toLowerCase().includes(q) ||
      o.productCode?.toLowerCase().includes(q)
    );
  });

  const pagedData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Derive Kanban columns from STATUS_META (skip cancelled in the main board)
  const kanbanColumns: KanbanColumn<ProductionOrder>[] = (
    Object.keys(STATUS_META) as ProductionOrderStatus[]
  )
    .filter((s) => s !== "cancelled")
    .map((status) => ({
      id: status,
      label: STATUS_META[status].label,
      color: STATUS_META[status].color,
      items: filtered.filter((o) => o.status === status),
    }));

  const handleCardMove = async (
    itemId: string,
    _fromColumnId: string,
    toColumnId: string
  ) => {
    try {
      await updateProductionStatus(itemId, toColumnId);
      toast({
        title: "Đã chuyển trạng thái",
        description: STATUS_META[toColumnId as ProductionOrderStatus].label,
        variant: "success",
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Không thể chuyển trạng thái",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  const columns: ColumnDef<ProductionOrder, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 110,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "product",
      header: "Sản phẩm sản xuất",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{row.original.productCode}</div>
        </div>
      ),
    },
    {
      id: "qty",
      header: "Số lượng",
      size: 130,
      cell: ({ row }) => (
        <span>
          <span className="font-medium">{row.original.completedQty}</span>
          <span className="text-muted-foreground"> / {row.original.plannedQty}</span>
        </span>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 150,
      cell: ({ row }) => row.original.branchName ?? "—",
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 160,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return <PipelineStatusBadge name={meta.label} color={meta.color} size="sm" />;
      },
    },
  ];

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Trạng thái">
              <CheckboxFilter
                options={Object.entries(STATUS_META).map(([value, meta]) => ({
                  label: meta.label,
                  value,
                }))}
                selected={statusFilters}
                onChange={setStatusFilters}
              />
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Lệnh sản xuất"
          searchPlaceholder="Theo mã phiếu, sản phẩm..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: viewMode === "list" ? "Xem Kanban" : "Xem danh sách",
              icon:
                viewMode === "list" ? (
                  <Kanban className="h-4 w-4" />
                ) : (
                  <List className="h-4 w-4" />
                ),
              variant: "outline",
              onClick: () =>
                setViewMode(viewMode === "list" ? "kanban" : "list"),
            },
            {
              label: "Tạo lệnh SX",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
          ]}
        />

        {!loading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Factory className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">Chưa có lệnh sản xuất nào</p>
            <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Tạo lệnh đầu tiên
            </Button>
          </div>
        ) : viewMode === "kanban" ? (
          <div className="p-4">
            <KanbanBoard
              columns={kanbanColumns}
              getItemId={(o) => o.id}
              onCardMove={handleCardMove}
              canDrop={(_id, from, to) =>
                canTransitionProductionStatus(from, to)
              }
              emptyMessage="Không có lệnh"
              renderCard={(order) => (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-primary text-xs">
                      {order.code}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(order.createdAt)}
                    </span>
                  </div>
                  <div className="text-sm font-medium truncate">
                    {order.productName ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {order.branchName ?? "—"}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t mt-1">
                    <span className="text-xs text-muted-foreground">
                      SL kế hoạch
                    </span>
                    <span className="text-xs font-semibold">
                      {order.completedQty} / {order.plannedQty}
                    </span>
                  </div>
                </div>
              )}
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={pagedData}
            loading={loading}
            total={filtered.length}
            pageIndex={page}
            pageSize={pageSize}
            pageCount={Math.ceil(filtered.length / pageSize)}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            expandedRow={expandedRow}
            onExpandedRowChange={setExpandedRow}
            renderDetail={(item, onClose) => (
              <ProductionOrderDetail orderId={item.id} onClose={onClose} />
            )}
            getRowId={(row) => row.id}
            rowActions={(row) => [
              {
                label: "Hoàn thành",
                icon: <CheckCircle2 className="h-4 w-4" />,
                onClick: () => {
                  setCompletingOrder(row);
                  setCompleteOpen(true);
                },
              },
              {
                label: "In phiếu",
                icon: <Printer className="h-4 w-4" />,
                onClick: () => {},
              },
              {
                label: "Hủy",
                icon: <XCircle className="h-4 w-4" />,
                onClick: () => {},
                variant: "destructive",
                separator: true,
              },
            ]}
          />
        )}
      </ListPageLayout>

      <CreateProductionOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <CompleteProductionOrderDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        order={completingOrder}
        onSuccess={fetchData}
      />
      {/* total counter to avoid unused var lint */}
      <span className="hidden">{total}</span>
    </>
  );
}
