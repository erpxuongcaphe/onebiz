"use client";

/**
 * Chuyển kho — Inter-branch Stock Transfer page — Sprint 7
 *
 * Features:
 *   - View existing transfers (stock_transfers table)
 *   - Create new transfer (dialog with product picker)
 *   - Complete / Cancel transfer actions
 */

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import { FilterSidebar, FilterGroup } from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { useToast } from "@/lib/contexts";
import { formatDate } from "@/lib/format";
import { getBranches, getBranchStockRows } from "@/lib/services";
import {
  getStockTransfers,
  getStockTransferById,
  createStockTransfer,
  completeStockTransfer,
  cancelStockTransfer,
  updateTransferStatus,
  getTransferStatusMeta,
} from "@/lib/services/supabase/transfers";
import type {
  StockTransfer,
  StockTransferStatus,
  StockTransferItem,
} from "@/lib/services/supabase/transfers";
import { formatUser } from "@/lib/format";
import type { BranchDetail } from "@/lib/services/supabase/branches";
import { Icon } from "@/components/ui/icon";

const STATUS_META = getTransferStatusMeta();
const PAGE_SIZE = 25;

export default function ChuyenKhoPage() {
  const { toast } = useToast();
  const [data, setData] = useState<StockTransfer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Branches for dialog
  const [branches, setBranches] = useState<BranchDetail[]>([]);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Confirm dialog state cho action huỷ / hoàn thành / bắt đầu chuyển
  // Mỗi action đều thao tác tồn kho thật (OUT / IN) — cần xác nhận trước khi fire.
  type ConfirmAction = "start" | "complete" | "cancel";
  const [pendingAction, setPendingAction] = useState<{
    type: ConfirmAction;
    transfer: StockTransfer;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getStockTransfers({
        page,
        pageSize: PAGE_SIZE,
        search,
        filters: { status: statusFilter },
      });
      setData(result.data);
      setTotal(result.total);
    } catch {
      toast({ variant: "error", title: "Lỗi tải dữ liệu chuyển kho" });
    } finally {
      setLoading(false);
    }
  }, [search, page, statusFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    getBranches().then(setBranches).catch(() => {});
  }, []);

  // Mở ConfirmDialog cho action tương ứng — không fire action thật ở đây.
  const requestStartTransit = (t: StockTransfer) =>
    setPendingAction({ type: "start", transfer: t });
  const requestComplete = (t: StockTransfer) =>
    setPendingAction({ type: "complete", transfer: t });
  const requestCancel = (t: StockTransfer) =>
    setPendingAction({ type: "cancel", transfer: t });

  // Thực thi sau khi user xác nhận trong ConfirmDialog.
  const executePendingAction = async () => {
    if (!pendingAction) return;
    const { type, transfer } = pendingAction;
    setActionBusy(true);
    try {
      if (type === "start") {
        await updateTransferStatus(transfer.id, "in_transit");
        toast({
          title: "Đã bắt đầu vận chuyển",
          description: "Hàng đang trên đường tới kho nhận",
          variant: "success",
        });
      } else if (type === "complete") {
        await completeStockTransfer(transfer.id);
        toast({ title: "Đã hoàn thành chuyển kho", variant: "success" });
      } else {
        await cancelStockTransfer(transfer.id);
        toast({ title: "Đã huỷ phiếu chuyển kho", variant: "success" });
      }
      setPendingAction(null);
      fetchData();
    } catch (err) {
      const titleByType: Record<ConfirmAction, string> = {
        start: "Lỗi cập nhật trạng thái",
        complete: "Lỗi hoàn thành",
        cancel: "Lỗi huỷ phiếu",
      };
      toast({
        title: titleByType[type],
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setActionBusy(false);
    }
  };

  const pendingDialogConfig = (() => {
    if (!pendingAction) return null;
    const { type, transfer } = pendingAction;
    const route = `${transfer.fromBranchName} → ${transfer.toBranchName}`;
    if (type === "start") {
      return {
        title: "Bắt đầu vận chuyển?",
        description: `Phiếu ${transfer.code} (${route}): hàng sẽ rời kho xuất và ghi nhận trạng thái “đang chuyển”. Bạn có chắc chắn?`,
        confirmLabel: "Bắt đầu vận chuyển",
        variant: "default" as const,
      };
    }
    if (type === "complete") {
      return {
        title: "Xác nhận đã nhận hàng?",
        description: `Phiếu ${transfer.code} (${route}): hệ thống sẽ trừ tồn kho xuất và cộng tồn kho nhận. Thao tác không thể hoàn tác — chỉ xác nhận khi đã nhận đủ hàng.`,
        confirmLabel: "Hoàn thành nhập kho",
        variant: "default" as const,
      };
    }
    return {
      title: "Huỷ phiếu chuyển kho?",
      description:
        transfer.status === "in_transit"
          ? `Phiếu ${transfer.code}: HÀNG ĐÃ RỜI KHO XUẤT. Huỷ phiếu sẽ không tự động trả hàng về — cần xử lý thủ công. Bạn có chắc chắn?`
          : `Phiếu ${transfer.code} (${route}) sẽ bị huỷ. Thao tác không thể hoàn tác.`,
      confirmLabel: "Huỷ phiếu",
      variant: "destructive" as const,
    };
  })();

  const columns: ColumnDef<StockTransfer, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary font-medium">
          {row.original.code}
        </span>
      ),
    },
    {
      id: "route",
      header: "Từ → Đến",
      size: 280,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium truncate max-w-[120px]">
            {row.original.fromBranchName}
          </span>
          <Icon name="arrow_forward" size={14} className="text-muted-foreground shrink-0" />
          <span className="font-medium truncate max-w-[120px]">
            {row.original.toBranchName}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "totalItems",
      header: "Sản phẩm",
      size: 90,
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono">
          {row.original.totalItems}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 120,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return (
          <Badge
            variant="secondary"
            style={{ backgroundColor: meta.color + "20", color: meta.color }}
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
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "note",
      header: "Ghi chú",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground truncate max-w-[180px] block">
          {row.original.note || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 140,
      cell: ({ row }) => {
        const st = row.original.status;
        if (st === "completed" || st === "cancelled") return null;
        return (
          <div className="flex items-center gap-1">
            {st === "draft" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-primary hover:text-primary"
                onClick={() => requestStartTransit(row.original)}
                title="Bắt đầu vận chuyển — hàng rời kho xuất"
              >
                <Icon name="local_shipping" size={14} />
              </Button>
            )}
            {st === "in_transit" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-status-success hover:text-status-success"
                onClick={() => requestComplete(row.original)}
                title="Xác nhận đã nhận hàng — hoàn thành nhập kho"
              >
                <Icon name="check_circle" size={14} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-status-error hover:text-status-error"
              onClick={() => requestCancel(row.original)}
              title={st === "in_transit" ? "Huỷ — hàng đã rời kho, cần xử lý thủ công" : "Huỷ phiếu"}
            >
              <Icon name="cancel" size={14} />
            </Button>
          </div>
        );
      },
    },
  ];

  const pageCount = Math.ceil(total / PAGE_SIZE);

  const statusOptions = Object.entries(STATUS_META).map(([val, m]) => ({
    value: val,
    label: m.label,
  }));

  // KPI stats tính trên trang hiện tại (data đã load) — nhanh, không call extra query.
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  const kpi = {
    total,
    inTransit: data.filter((t) => t.status === "in_transit").length,
    completedThisWeek: data.filter(
      (t) => t.status === "completed" && new Date(t.createdAt).getTime() >= weekAgo,
    ).length,
    stuckTransit: data.filter(
      (t) =>
        t.status === "in_transit" &&
        now - new Date(t.createdAt).getTime() > sevenDaysMs,
    ).length,
  };

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <div className="space-y-1">
              <button
                onClick={() => { setStatusFilter("all"); setPage(0); }}
                className={`w-full text-left text-xs px-2 py-1.5 rounded ${statusFilter === "all" ? "bg-primary text-white" : "hover:bg-muted"}`}
              >
                Tất cả
              </button>
              {statusOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setStatusFilter(opt.value); setPage(0); }}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded ${statusFilter === opt.value ? "bg-primary text-white" : "hover:bg-muted"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Chuyển kho"
        searchPlaceholder="Tìm theo mã phiếu, ghi chú..."
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        actions={[
          {
            label: "Tạo phiếu chuyển kho",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setShowCreate(true),
          },
        ]}
      />

      {kpi.stuckTransit > 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <Icon name="warning" size={20} className="text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-destructive">
                Có {kpi.stuckTransit} phiếu chuyển kho đang vận chuyển quá 7 ngày
              </div>
              <div className="text-muted-foreground mt-0.5">
                Cần kiểm tra với đối tác vận chuyển hoặc chi nhánh nhận để xác nhận tình trạng
                — hàng có thể đã nhận nhưng chưa ghi nhận vào hệ thống.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="swap_horiz" size={16} />}
          label="Tổng phiếu"
          value={kpi.total.toString()}
        />
        <SummaryCard
          icon={<Icon name="local_shipping" size={16} />}
          label="Đang chuyển"
          value={kpi.inTransit.toString()}
          highlight={kpi.inTransit > 0}
        />
        <SummaryCard
          icon={<Icon name="check_circle" size={16} />}
          label="Hoàn thành trong tuần"
          value={kpi.completedThisWeek.toString()}
        />
        <SummaryCard
          icon={<Icon name="warning" size={16} className="text-destructive" />}
          label="Quá hạn (>7 ngày)"
          value={kpi.stuckTransit.toString()}
          danger={kpi.stuckTransit > 0}
          hint={kpi.stuckTransit > 0 ? "Cần kiểm tra gấp" : undefined}
        />
      </div>

      <div className="flex-1 min-h-0 px-4 pt-2 pb-4">
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          pageIndex={page}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          onPageChange={setPage}
          onPageSizeChange={() => {}}
          getRowId={(r) => r.id}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(item, onClose) => (
            <TransferDetail item={item} onClose={onClose} />
          )}
        />
      </div>

      {/* Create Transfer Dialog */}
      <CreateTransferDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        branches={branches}
        creating={creating}
        onSubmit={async (input) => {
          setCreating(true);
          try {
            const result = await createStockTransfer(input);
            toast({
              title: `Đã tạo phiếu ${result.code}`,
              variant: "success",
            });
            setShowCreate(false);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi tạo phiếu",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setCreating(false);
          }
        }}
      />

      {/* Confirm destructive transfer actions (start / complete / cancel).
          Ba action này đều ảnh hưởng tồn kho thật nên luôn yêu cầu xác nhận. */}
      {pendingDialogConfig && (
        <ConfirmDialog
          open={pendingAction !== null}
          onOpenChange={(o) => {
            if (!o) setPendingAction(null);
          }}
          title={pendingDialogConfig.title}
          description={pendingDialogConfig.description}
          confirmLabel={pendingDialogConfig.confirmLabel}
          cancelLabel="Đóng"
          variant={pendingDialogConfig.variant}
          loading={actionBusy}
          onConfirm={executePendingAction}
        />
      )}
    </ListPageLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Transfer Detail Panel                                               */
/* ------------------------------------------------------------------ */

function TransferDetail({
  item,
  onClose,
}: {
  item: StockTransfer;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StockTransferItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingItems(true);
    getStockTransferById(item.id)
      .then((res) => {
        if (cancelled) return;
        setItems(res?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const meta = STATUS_META[item.status];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailTabs
          defaultTab="info"
          tabs={[
            {
              id: "info",
              label: "Thông tin",
              content: (
                <div className="space-y-4">
                  <DetailHeader
                    title={`Phiếu chuyển kho ${item.code}`}
                    code={item.code}
                    status={{
                      label: meta.label,
                      variant: "secondary",
                      className: "",
                    }}
                    subtitle={`${item.fromBranchName} → ${item.toBranchName}`}
                    meta={
                      <div className="flex items-center gap-4 flex-wrap text-xs">
                        <span>
                          Người tạo:{" "}
                          <strong>{formatUser(undefined, item.createdBy)}</strong>
                        </span>
                        <span>
                          Ngày tạo: <strong>{formatDate(item.createdAt)}</strong>
                        </span>
                      </div>
                    }
                  />
                  <DetailInfoGrid
                    fields={[
                      { label: "Mã phiếu", value: item.code },
                      { label: "Kho xuất", value: item.fromBranchName },
                      { label: "Kho nhận", value: item.toBranchName },
                      { label: "Trạng thái", value: meta.label },
                      {
                        label: "Số mặt hàng",
                        value: String(item.totalItems),
                      },
                      {
                        label: "Ngày hoàn thành",
                        value: item.completedAt
                          ? formatDate(item.completedAt)
                          : "—",
                      },
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
                <div className="space-y-2">
                  {loadingItems ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                      <Icon
                        name="progress_activity"
                        size={16}
                        className="animate-spin mr-2"
                      />
                      Đang tải...
                    </div>
                  ) : !items || items.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                      Phiếu chưa có sản phẩm
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="text-left p-2 font-medium">Sản phẩm</th>
                            <th className="text-right p-2 font-medium w-24">
                              Số lượng
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, idx) => (
                            <tr key={`${it.productId}-${idx}`} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{it.productName}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {it.productCode}
                                </div>
                              </td>
                              <td className="p-2 text-right tabular-nums">
                                {it.quantity} {it.unit ?? ""}
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
              id: "history",
              label: "Lịch sử",
              content: (
                <AuditHistoryTab entityType="stock_transfer" entityId={item.id} />
              ),
            },
          ]}
        />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Transfer Dialog                                             */
/* ------------------------------------------------------------------ */

interface CreateTransferDialogProps {
  open: boolean;
  onClose: () => void;
  branches: BranchDetail[];
  creating: boolean;
  onSubmit: (input: {
    fromBranchId: string;
    toBranchId: string;
    items: StockTransferItem[];
    note?: string;
  }) => void;
}

interface ProductSearchResult {
  id: string;
  code: string;
  name: string;
  unit?: string;
  stock: number;
}

function CreateTransferDialog({
  open,
  onClose,
  branches,
  creating,
  onSubmit,
}: CreateTransferDialogProps) {
  const [fromBranch, setFromBranch] = useState("");
  const [toBranch, setToBranch] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<
    (StockTransferItem & { id: string; stock: number })[]
  >([]);

  // Product search
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!productSearch.trim()) {
      setSearchResults([]);
      return;
    }
    if (!fromBranch) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // Filter by fromBranch stock — chỉ show SP có tồn > 0 tại chi nhánh xuất
      const rows = await getBranchStockRows({
        branchId: fromBranch,
        search: productSearch,
      });
      const inStock = rows
        .filter((r) => r.quantity > 0)
        .slice(0, 10)
        .map((r) => ({
          id: r.productId,
          code: r.productCode,
          name: r.productName,
          unit: r.unit ?? undefined,
          stock: r.quantity,
        }));
      setSearchResults(inStock);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [productSearch, fromBranch]);

  useEffect(() => {
    const timer = setTimeout(handleSearch, 300);
    return () => clearTimeout(timer);
  }, [handleSearch]);

  const addProduct = (prod: ProductSearchResult) => {
    if (items.some((i) => i.id === prod.id)) return;
    setItems((prev) => [
      ...prev,
      {
        id: prod.id,
        productId: prod.id,
        productName: prod.name,
        productCode: prod.code,
        unit: prod.unit,
        quantity: 1,
        stock: prod.stock,
      },
    ]);
    setProductSearch("");
    setSearchResults([]);
  };

  const updateQuantity = (id: string, qty: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        // Cap [1 .. stock] — không cho user type số lớn hơn tồn tại chi nhánh xuất.
        // Nếu stock = 0 (edge case: vừa bị chuyển hết trước đó), giữ ở mức 1 để
        // user thấy rõ warning "vượt tồn" thay vì silent lock ở 0.
        const maxQty = Math.max(1, Math.floor(item.stock));
        const bounded = Math.min(Math.max(1, Math.floor(qty) || 1), maxQty);
        return { ...item, quantity: bounded };
      }),
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Các item có qty > stock — thường xảy ra khi stock bị thay đổi ngoài
  // (user khác chuyển kho song song) hoặc khi item mới add với stock = 0.
  const overStockItems = items.filter((i) => i.quantity > i.stock);

  const handleSubmit = () => {
    if (!fromBranch || !toBranch) return;
    if (items.length === 0) return;
    if (overStockItems.length > 0) return;
    onSubmit({
      fromBranchId: fromBranch,
      toBranchId: toBranch,
      items: items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        productCode: i.productCode,
        unit: i.unit,
        quantity: i.quantity,
      })),
      note: note || undefined,
    });
  };

  const reset = () => {
    setFromBranch("");
    setToBranch("");
    setNote("");
    setItems([]);
    setProductSearch("");
    setSearchResults([]);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const isValid =
    Boolean(fromBranch) &&
    Boolean(toBranch) &&
    fromBranch !== toBranch &&
    items.length > 0 &&
    overStockItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="swap_horiz" />
            Tạo phiếu chuyển kho
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Branch selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Kho xuất</Label>
              <Select
                value={fromBranch}
                onValueChange={(v) => {
                  setFromBranch(v ?? "");
                  // Reset items — SP từ branch cũ có thể không còn valid ở branch mới
                  setItems([]);
                  setProductSearch("");
                  setSearchResults([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn chi nhánh xuất" />
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
            <div>
              <Label className="text-xs">Kho nhận</Label>
              <Select value={toBranch} onValueChange={(v) => setToBranch(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn chi nhánh nhận" />
                </SelectTrigger>
                <SelectContent>
                  {branches
                    .filter((b) => b.id !== fromBranch)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {fromBranch === toBranch && fromBranch && (
            <p className="text-xs text-destructive">
              Chi nhánh xuất và nhận không được trùng nhau
            </p>
          )}

          {/* Product search */}
          <div>
            <Label className="text-xs">Thêm sản phẩm</Label>
            <div className="relative">
              <Input
                placeholder={fromBranch ? "Tìm theo mã, tên sản phẩm..." : "Chọn kho xuất trước"}
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                disabled={!fromBranch}
              />
              {searching && (
                <Icon name="progress_activity" size={16} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            {fromBranch && (
              <p className="text-xs text-muted-foreground mt-1">
                Chỉ hiển thị mặt hàng có tồn kho tại chi nhánh xuất.
              </p>
            )}
            {fromBranch && productSearch.trim() && !searching && searchResults.length === 0 && (
              <p className="text-xs text-destructive mt-1">
                Không tìm thấy mặt hàng còn tồn tại chi nhánh này.
              </p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-1 border rounded-md max-h-40 overflow-auto bg-background shadow-sm">
                {searchResults.map((prod) => (
                  <button
                    key={prod.id}
                    onClick={() => addProduct(prod)}
                    disabled={items.some((i) => i.id === prod.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between disabled:opacity-50"
                  >
                    <div>
                      <span className="font-medium">{prod.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({prod.code})
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Tồn: {prod.stock} {prod.unit ?? ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium">
                      Sản phẩm
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium w-20">
                      Tồn
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium w-28">
                      Số lượng
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const overStock = item.quantity > item.stock;
                    return (
                      <tr
                        key={item.id}
                        className={`border-t ${overStock ? "bg-status-error/5" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Icon name="inventory_2" size={14} className="text-muted-foreground" />
                            <div>
                              <p className="font-medium text-xs">
                                {item.productName}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {item.productCode}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td
                          className={`text-center text-xs ${overStock ? "text-status-error font-medium" : "text-muted-foreground"}`}
                        >
                          {item.stock} {item.unit ?? ""}
                        </td>
                        <td className="text-center px-2">
                          <Input
                            type="number"
                            min={1}
                            max={Math.max(1, item.stock)}
                            value={item.quantity}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              updateQuantity(item.id, parseInt(e.target.value) || 1)
                            }
                            className={`h-7 text-center text-xs w-20 mx-auto ${overStock ? "border-status-error focus-visible:ring-status-error" : ""}`}
                            aria-invalid={overStock || undefined}
                          />
                        </td>
                        <td className="px-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-status-error hover:text-status-error"
                            onClick={() => removeItem(item.id)}
                          >
                            <Icon name="delete" size={12} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {overStockItems.length > 0 && (
                <div className="px-3 py-2 bg-status-error/10 border-t border-status-error/30 text-xs text-status-error flex items-start gap-1.5">
                  <Icon name="warning" size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Có {overStockItems.length} mặt hàng vượt tồn kho tại chi nhánh
                    xuất. Vui lòng giảm số lượng trước khi tạo phiếu.
                  </span>
                </div>
              )}
            </div>
          )}

          {items.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg border-dashed">
              Chưa có sản phẩm. Tìm và thêm sản phẩm cần chuyển kho.
            </div>
          )}

          {/* Note */}
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Lý do chuyển kho..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Hủy
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || creating}>
            {creating && <Icon name="progress_activity" size={16} className="animate-spin mr-1.5" />}
            Tạo phiếu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
