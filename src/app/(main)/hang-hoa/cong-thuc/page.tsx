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
// PERF (CEO 23/05/2026): Lazy-load BOMEditorDialog (572 dòng).
import dynamic from "next/dynamic";
const BOMEditorDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/bom-editor-dialog").then(
      (m) => m.BOMEditorDialog,
    ),
  { ssr: false },
);
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate, exportToExcelFromSchema } from "@/lib/excel";
import { bomExcelSchema, type BOMImportRow } from "@/lib/excel/schemas";
import { bulkImportBOMs } from "@/lib/services/supabase/excel-import";
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
  cloneBOMForBranch,
} from "@/lib/services";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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
  // Day 20/05/2026 (CEO Phase 3): Excel import/export cho BOM standalone
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  // Day 18/05/2026 (CEO): clone BOM global → riêng quán
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneSourceBom, setCloneSourceBom] = useState<BOM | null>(null);
  const [cloneTargetBranchId, setCloneTargetBranchId] = useState<string>("");
  const [cloneLoading, setCloneLoading] = useState(false);

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
      id: "branchScope",
      header: "Áp dụng",
      size: 180,
      cell: ({ row }) =>
        row.original.branchId ? (
          <Badge variant="secondary" className="bg-status-warning/10 text-status-warning border-status-warning/30">
            <Icon name="storefront" size={12} className="mr-1" />
            {row.original.branchName ?? "Chi nhánh"}
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/30">
            <Icon name="public" size={12} className="mr-1" />
            Tất cả chi nhánh
          </Badge>
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
              <div className="text-xs text-muted-foreground mt-1">
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
          onExport={{
            excel: () => {
              // Day 20/05/2026 (CEO Phase 3): Xuất BOM hiện có ra Excel format
              // chuẩn (1 sheet phẳng) — backup hoặc edit ngoài Excel.
              const rows: BOMImportRow[] = [];
              for (const b of data) {
                const items = b.items ?? [];
                if (items.length === 0) {
                  // BOM rỗng — vẫn xuất 1 row master (items trống)
                  rows.push({
                    bomCode: b.code ?? "",
                    bomName: b.name,
                    branchCode: undefined,
                    materialCode: "",
                    quantity: 0,
                    unit: "",
                    yieldQty: b.yieldQty,
                    yieldUnit: b.yieldUnit,
                    note: b.note,
                  });
                } else {
                  for (const it of items) {
                    rows.push({
                      bomCode: b.code ?? "",
                      bomName: b.name,
                      branchCode: undefined, // TODO: lookup branch code khi có
                      materialCode: it.materialCode ?? "",
                      quantity: it.quantity,
                      unit: it.unit,
                      yieldQty: b.yieldQty,
                      yieldUnit: b.yieldUnit,
                      note: it.note,
                    });
                  }
                }
              }
              exportToExcelFromSchema(rows, bomExcelSchema);
            },
            csv: () => {
              // CSV — chỉ export master info, không phẳng
              const csvRows = data.map((b) => ({
                code: b.code ?? "",
                name: b.name,
                items: b.items?.length ?? 0,
                createdAt: b.createdAt,
              }));
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              import("@/lib/utils/export").then((m) => {
                m.exportToCsv(csvRows, [
                  { header: "Mã BOM", key: "code", width: 18 },
                  { header: "Tên BOM", key: "name", width: 30 },
                  { header: "Số NVL", key: "items", width: 10 },
                  { header: "Ngày tạo", key: "createdAt", width: 18 },
                ], "danh-sach-bom");
              });
            },
          }}
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
            {
              label: "Tải mẫu",
              icon: <Icon name="description" size={16} />,
              variant: "ghost",
              onClick: () => downloadTemplate(bomExcelSchema),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload" size={16} />,
              onClick: () => setImportOpen(true),
            },
          ]}
        />

        <ImportExcelDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          schema={bomExcelSchema}
          onCommit={async (rows) => {
            const result = await bulkImportBOMs(rows);
            // Refresh list sau khi import
            try {
              const refreshed = await getAllBOMs();
              setData(refreshed);
            } catch {
              /* fail silent */
            }
            return result;
          }}
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
            rowActions={(row) => {
              // Day 18/05/2026 (CEO): row action "Tạo BOM riêng cho quán"
              // chỉ hiển thị khi BOM hiện tại là global (branchId = null) và
              // còn ít nhất 1 chi nhánh chưa có BOM riêng cho SP đó.
              const isGlobal = !row.branchId;
              return [
                {
                  label: "Sửa",
                  icon: <Icon name="edit" size={16} />,
                  onClick: () => {
                    setEditingId(row.id);
                    setEditorOpen(true);
                  },
                },
                ...(isGlobal
                  ? [
                      {
                        label: "Tạo BOM riêng cho quán",
                        icon: <Icon name="content_copy" size={16} />,
                        onClick: () => {
                          setCloneSourceBom(row);
                          setCloneDialogOpen(true);
                        },
                      },
                    ]
                  : []),
                {
                  label: "Xóa",
                  icon: <Icon name="delete" size={16} />,
                  onClick: () => handleDelete(row.id, row.name),
                  variant: "destructive" as const,
                  separator: true,
                },
              ];
            }}
          />
        )}
      </ListPageLayout>

      <BOMEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        bomId={editingId}
        onSuccess={fetchData}
      />

      {/* Day 18/05/2026 (CEO): Dialog clone BOM global → riêng quán */}
      <Dialog
        open={cloneDialogOpen}
        onOpenChange={(o) => {
          if (cloneLoading) return;
          setCloneDialogOpen(o);
          if (!o) {
            setCloneSourceBom(null);
            setCloneTargetBranchId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Icon name="content_copy" size={20} className="inline-block mr-2 align-text-bottom" />
              Tạo BOM riêng cho chi nhánh
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Sao chép BOM <b>{cloneSourceBom?.name}</b> sang 1 chi nhánh
                cụ thể. Chi nhánh đó sẽ dùng BOM mới (override BOM global).
              </span>
              <span className="block text-xs text-on-surface-variant">
                BOM global gốc giữ nguyên, các chi nhánh khác vẫn dùng global.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <label className="text-sm font-medium">Chọn chi nhánh đích</label>
            <Select
              value={cloneTargetBranchId || null}
              onValueChange={(v) => setCloneTargetBranchId(v ?? "")}
              items={branches.map((b) => ({
                value: b.id,
                label: `${b.name}${b.branchType ? ` (${b.branchType})` : ""}`,
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn chi nhánh...">
                  {(v) => {
                    const match = branches.find((b) => b.id === v);
                    return match ? match.name : "Chọn chi nhánh...";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={cloneLoading}
              onClick={() => setCloneDialogOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              disabled={cloneLoading || !cloneTargetBranchId}
              onClick={async () => {
                if (!cloneSourceBom || !cloneTargetBranchId) return;
                setCloneLoading(true);
                try {
                  const cloned = await cloneBOMForBranch(
                    cloneSourceBom.id,
                    cloneTargetBranchId,
                  );
                  toast({
                    variant: "success",
                    title: "Đã tạo BOM riêng",
                    description: `${cloned.name} — chi nhánh ${
                      branches.find((b) => b.id === cloneTargetBranchId)?.name
                    } sẽ dùng BOM này thay BOM global.`,
                    duration: 8000,
                  });
                  setCloneDialogOpen(false);
                  setCloneSourceBom(null);
                  setCloneTargetBranchId("");
                  await fetchData();
                } catch (err) {
                  toast({
                    variant: "error",
                    title: "Không sao chép được BOM",
                    description: err instanceof Error ? err.message : "Lỗi không xác định",
                  });
                } finally {
                  setCloneLoading(false);
                }
              }}
            >
              {cloneLoading ? "Đang sao chép..." : "Tạo BOM riêng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
