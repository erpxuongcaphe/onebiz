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
import { FilterSidebar, FilterGroup } from "@/components/shared/filter-sidebar";
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
import { useToast } from "@/lib/contexts";
import { formatDate } from "@/lib/format";
import { getBranches, getProducts } from "@/lib/services";
import {
  getStockTransfers,
  createStockTransfer,
  completeStockTransfer,
  cancelStockTransfer,
  getTransferStatusMeta,
} from "@/lib/services/supabase/transfers";
import type {
  StockTransfer,
  StockTransferStatus,
  StockTransferItem,
} from "@/lib/services/supabase/transfers";
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

  // Branches for dialog
  const [branches, setBranches] = useState<BranchDetail[]>([]);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const handleComplete = async (id: string) => {
    try {
      await completeStockTransfer(id);
      toast({ title: "Đã hoàn thành chuyển kho", variant: "success" });
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi hoàn thành",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelStockTransfer(id);
      toast({ title: "Đã hủy phiếu chuyển kho", variant: "success" });
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi hủy phiếu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  const columns: ColumnDef<StockTransfer, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-blue-600 font-medium">
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
      size: 100,
      cell: ({ row }) => {
        const st = row.original.status;
        if (st === "completed" || st === "cancelled") return null;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-emerald-600 hover:text-emerald-700"
              onClick={() => handleComplete(row.original.id)}
              title="Hoàn thành"
            >
              <Icon name="check_circle" size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-red-500 hover:text-red-600"
              onClick={() => handleCancel(row.original.id)}
              title="Hủy"
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

      <div className="px-4 pt-3">
        <Badge variant="secondary" className="font-mono">
          {total} phiếu chuyển kho
        </Badge>
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
    </ListPageLayout>
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
    setSearching(true);
    try {
      const result = await getProducts({
        page: 0,
        pageSize: 10,
        search: productSearch,
      });
      setSearchResults(
        result.data.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          unit: p.unit ?? undefined,
          stock: p.stock ?? 0,
        }))
      );
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [productSearch]);

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
      prev.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(1, qty) } : item
      )
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSubmit = () => {
    if (!fromBranch || !toBranch) return;
    if (items.length === 0) return;
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

  const isValid = fromBranch && toBranch && fromBranch !== toBranch && items.length > 0;

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
              <Select value={fromBranch} onValueChange={(v) => setFromBranch(v ?? "")}>
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
                placeholder="Tìm theo mã, tên sản phẩm..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
              {searching && (
                <Icon name="progress_activity" size={16} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
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
                  {items.map((item) => (
                    <tr key={item.id} className="border-t">
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
                      <td className="text-center text-xs text-muted-foreground">
                        {item.stock} {item.unit ?? ""}
                      </td>
                      <td className="text-center px-2">
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateQuantity(item.id, parseInt(e.target.value) || 1)
                          }
                          className="h-7 text-center text-xs w-20 mx-auto"
                        />
                      </td>
                      <td className="px-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                          onClick={() => removeItem(item.id)}
                        >
                          <Icon name="delete" size={12} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
