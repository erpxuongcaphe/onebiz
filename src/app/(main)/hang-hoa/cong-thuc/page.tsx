"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { SummaryCard } from "@/components/shared/summary-card";
import { BOMEditorDialog } from "@/components/shared/dialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast, useBranchFilter } from "@/lib/contexts";
import {
  getAllBOMs,
  getBOMById,
  getBOMProductionHistory,
  calculateBOMCost,
  deleteBOM,
  getBranches,
} from "@/lib/services";
import type { BranchDetail } from "@/lib/services/supabase";
import { formatDate, formatCurrency, formatNumber } from "@/lib/format";
import type { BOM, BOMCostBreakdown } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// ---------------------------------------------------------------------------
// BOM detail slide-over — xem công thức + nguyên vật liệu + lịch sử sản xuất
// ---------------------------------------------------------------------------
function BOMDetail({
  bomId,
  onClose,
  onEdit,
  onDelete,
}: {
  bomId: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [bom, setBom] = useState<BOM | null>(null);
  const [cost, setCost] = useState<BOMCostBreakdown | null>(null);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      code: string;
      branchId: string;
      branchName?: string;
      plannedQty: number;
      completedQty: number;
      status: string;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [fullBom, costBreakdown, hist] = await Promise.all([
          getBOMById(bomId),
          calculateBOMCost(bomId).catch(() => null),
          getBOMProductionHistory(bomId, 30).catch(() => []),
        ]);
        if (cancelled) return;
        setBom(fullBom);
        setCost(costBreakdown);
        setHistory(hist);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bomId]);

  if (loading || !bom) {
    return (
      <InlineDetailPanel open onClose={onClose}>
        <div className="p-6 text-center text-muted-foreground">Đang tải...</div>
      </InlineDetailPanel>
    );
  }

  const completedCount = history.filter((h) => h.status === "completed").length;

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
    >
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={bom.name}
                  code={bom.code ?? `BOM-${bom.id.slice(0, 6)}`}
                  subtitle={`${bom.productCode ?? ""} — ${bom.productName ?? ""}`}
                />
                <DetailInfoGrid
                  fields={[
                    { label: "Phiên bản", value: `v${bom.version}` },
                    {
                      label: "SKU đầu ra",
                      value: `${bom.productCode} — ${bom.productName}`,
                    },
                    {
                      label: "Sản lượng / batch",
                      value: `${bom.yieldQty} ${bom.yieldUnit}`,
                    },
                    { label: "Batch size", value: `${bom.batchSize}` },
                    {
                      label: "Tổng giá vốn NVL",
                      value: cost
                        ? <span className="font-semibold">{formatCurrency(cost.totalCost)}</span>
                        : "—",
                    },
                    {
                      label: "Giá vốn / đơn vị",
                      value: cost && bom.yieldQty > 0
                        ? formatCurrency(cost.totalCost / bom.yieldQty)
                        : "—",
                    },
                    {
                      label: "Lần sản xuất",
                      value: `${history.length} (hoàn thành ${completedCount})`,
                    },
                    { label: "Tạo lúc", value: formatDate(bom.createdAt) },
                    { label: "Ghi chú", value: bom.note ?? "—" },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "materials",
            label: `Nguyên vật liệu (${bom.items?.length ?? 0})`,
            content: (
              <div className="space-y-2">
                {(bom.items ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa có NVL trong công thức.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">NVL</th>
                          <th className="text-right p-2 font-medium">Định lượng</th>
                          <th className="text-right p-2 font-medium">Hao hụt</th>
                          <th className="text-right p-2 font-medium">Giá vốn NVL</th>
                          <th className="text-right p-2 font-medium">Chi phí dòng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(bom.items ?? []).map((item) => {
                          const costItem = cost?.items.find(
                            (c) => c.materialId === item.materialId,
                          );
                          return (
                            <tr key={item.id} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">
                                  {item.materialName ?? costItem?.materialName ?? "—"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.materialCode ?? costItem?.materialCode ?? ""}
                                </div>
                              </td>
                              <td className="p-2 text-right tabular-nums">
                                {item.quantity} {item.unit}
                              </td>
                              <td className="p-2 text-right tabular-nums text-muted-foreground">
                                {item.wastePercent}%
                              </td>
                              <td className="p-2 text-right tabular-nums">
                                {costItem ? formatCurrency(costItem.costPrice) : "—"}
                              </td>
                              <td className="p-2 text-right tabular-nums font-medium">
                                {costItem ? formatCurrency(costItem.lineCost) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                        {cost && (
                          <tr className="border-t bg-muted/20 font-semibold">
                            <td colSpan={4} className="p-2 text-right">
                              Tổng cộng
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {formatCurrency(cost.totalCost)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "history",
            label: `Lịch sử SX (${history.length})`,
            content: (
              <div className="space-y-2">
                {history.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Công thức này chưa được dùng trong lệnh sản xuất nào.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">Mã phiếu</th>
                          <th className="text-left p-2 font-medium">Chi nhánh</th>
                          <th className="text-right p-2 font-medium">KH / Thực tế</th>
                          <th className="text-left p-2 font-medium">Trạng thái</th>
                          <th className="text-left p-2 font-medium">Ngày</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id} className="border-t">
                            <td className="p-2 font-medium text-primary">{h.code}</td>
                            <td className="p-2 text-xs">{h.branchName ?? "—"}</td>
                            <td className="p-2 text-right tabular-nums">
                              {h.plannedQty} / {h.completedQty}
                            </td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs capitalize">
                                {h.status.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {formatDate(h.createdAt)}
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
          {
            id: "audit",
            label: "Nhật ký",
            content: <AuditHistoryTab entityType="bom" entityId={bom.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

export default function CongThucPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Sync branch filter với global activeBranchId khi user đổi chi nhánh ở header.
  // Mặc định "all" (không filter) để tránh ẩn BOM mới (chưa có production order).
  useEffect(() => {
    if (activeBranchId) setBranchFilter(activeBranchId);
  }, [activeBranchId]);

  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAllBOMs({
        usedAtBranchId: branchFilter !== "all" ? branchFilter : undefined,
      });
      setData(all);
    } catch (err) {
      toast({
        title: "Lỗi tải BOM",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, branchFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, branchFilter]);

  const filtered = data.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.name?.toLowerCase().includes(q) ||
      b.code?.toLowerCase().includes(q) ||
      b.productName?.toLowerCase().includes(q) ||
      b.productCode?.toLowerCase().includes(q)
    );
  });

  const pagedData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Xóa công thức "${name}"?`)) return;
      try {
        await deleteBOM(id);
        toast({ title: "Đã xóa công thức", variant: "success" });
        setExpandedRow(null);
        fetchData();
      } catch (err) {
        toast({
          title: "Lỗi xóa",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    },
    [toast, fetchData],
  );

  const columns: ColumnDef<BOM, unknown>[] = [
    {
      accessorKey: "name",
      header: "Tên công thức",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.code && (
            <div className="text-xs text-muted-foreground">{row.original.code}</div>
          )}
        </div>
      ),
    },
    {
      id: "product",
      header: "SKU đầu ra",
      size: 260,
      cell: ({ row }) => (
        <div>
          <div className="text-primary font-medium">{row.original.productCode}</div>
          <div className="text-xs text-muted-foreground">{row.original.productName}</div>
        </div>
      ),
    },
    {
      id: "yield",
      header: "Sản lượng",
      size: 140,
      cell: ({ row }) => (
        <span>
          {row.original.yieldQty} {row.original.yieldUnit}
          <span className="text-xs text-muted-foreground">
            {" "}
            / batch {row.original.batchSize}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "version",
      header: "Phiên bản",
      size: 90,
      cell: ({ row }) => `v${row.original.version}`,
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 120,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ];

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Chi nhánh sử dụng">
              <SelectFilter
                options={[
                  { label: "Tất cả", value: "all" },
                  ...branches.map((b) => ({ label: b.name, value: b.id })),
                ]}
                value={branchFilter}
                onChange={setBranchFilter}
                placeholder="Tất cả"
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Chỉ hiện BOM đã dùng trong lệnh sản xuất tại chi nhánh này.
              </div>
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Công thức sản xuất (BOM)"
          searchPlaceholder="Theo tên công thức, SKU..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: "Tạo công thức",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => {
                setEditingId(undefined);
                setEditorOpen(true);
              },
            },
          ]}
        />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 pt-3 pb-1">
          <SummaryCard
            icon={<Icon name="science" size={16} />}
            label="Tổng công thức"
            value={formatNumber(data.length)}
          />
          <SummaryCard
            icon={<Icon name="factory" size={16} />}
            label="Đang sử dụng"
            value={formatNumber(filtered.length)}
            highlight
          />
          <SummaryCard
            icon={<Icon name="schedule" size={16} />}
            label="Phiên bản mới nhất"
            value={
              data.length > 0
                ? `v${Math.max(...data.map((b) => b.version))}`
                : "—"
            }
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Đang tải...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Icon name="science" size={48} className="mb-3 opacity-30" />
            <p className="text-sm">
              {branchFilter !== "all"
                ? "Chi nhánh này chưa dùng công thức nào."
                : "Chưa có công thức nào"}
            </p>
            {branchFilter === "all" && (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => {
                  setEditingId(undefined);
                  setEditorOpen(true);
                }}
              >
                <Icon name="add" size={16} className="mr-1" />
                Tạo công thức đầu tiên
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={pagedData}
            loading={false}
            total={filtered.length}
            pageIndex={page}
            pageSize={pageSize}
            pageCount={Math.ceil(filtered.length / pageSize)}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            getRowId={(row) => row.id}
            expandedRow={expandedRow}
            onExpandedRowChange={setExpandedRow}
            renderDetail={(row, onClose) => (
              <BOMDetail
                bomId={row.id}
                onClose={onClose}
                onEdit={() => {
                  setEditingId(row.id);
                  setEditorOpen(true);
                }}
                onDelete={() => handleDelete(row.id, row.name)}
              />
            )}
            rowActions={(row) => [
              {
                label: "Sửa",
                icon: <Icon name="edit" size={16} />,
                onClick: () => {
                  setEditingId(row.id);
                  setEditorOpen(true);
                },
              },
              {
                label: "Xóa",
                icon: <Icon name="delete" size={16} />,
                onClick: () => handleDelete(row.id, row.name),
                variant: "destructive",
                separator: true,
              },
            ]}
          />
        )}
      </ListPageLayout>

      <BOMEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        bomId={editingId}
        onSuccess={fetchData}
      />
    </>
  );
}
