"use client";

// Tồn kho — xem tồn kho per chi nhánh, lọc theo NVL/SKU, sắp xếp & tổng giá trị tồn

import { useEffect, useState, useCallback, useRef } from "react";
import { useDebounce } from "@/lib/utils/use-debounce";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  ActiveFiltersBar,
  type ActiveFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast, useBranchFilter, useAuth } from "@/lib/contexts";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import {
  getBranchStockPage,
  getBranchStockAggregates,
  getBranchStockRows,
  getBranches,
  getProductStockBreakdown,
  getProductStockMovements,
  getUOMConversions,
  getUOMConversionsByProductIds,
  adjustStockToValue,
  isInventoryLocked,
  setInventoryLocked,
} from "@/lib/services";
import type { BranchStockRow, BranchDetail } from "@/lib/services/supabase";
import type { StockMovement, UOMConversion } from "@/lib/types";
import { StockWithConversion } from "@/components/shared/stock-with-conversion";
import { Icon } from "@/components/ui/icon";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { initialStockExcelSchema, type InitialStockImportRow } from "@/lib/excel/schemas";
import { exportToExcelFromSchema } from "@/lib/excel";
import { bulkImportInitialStock } from "@/lib/services/supabase/excel-import";

type ProductTypeFilter = "all" | "nvl" | "sku";

// ---------------------------------------------------------------------------
// Inline detail panel — hiển thị khi click 1 row tồn kho
//   • Tab "Tồn các chi nhánh" — breakdown cross-branch cho SP này
//   • Tab "Lịch sử xuất nhập" — 50 movement gần nhất cho SP này
// ---------------------------------------------------------------------------
function StockRowDetail({
  row,
  onClose,
  onAdjusted,
  locked = false,
}: {
  row: BranchStockRow;
  onClose: () => void;
  /** CEO 28/05/2026: gọi sau khi điều chỉnh tồn thành công → parent refetch list. */
  onAdjusted?: () => void;
  /** CEO 28/05/2026: tồn kho đang khóa → disable nút điều chỉnh. */
  locked?: boolean;
}) {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canAdjust = hasPermission("inventory.adjust");

  const [branches, setBranches] = useState<
    Array<{
      branchId: string;
      branchName: string;
      branchCode?: string;
      quantity: number;
      reserved: number;
      available: number;
      updatedAt: string;
    }>
  >([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [conversions, setConversions] = useState<UOMConversion[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);

  // CEO 28/05/2026: state cho dialog "Điều chỉnh tồn" (2 bước: nhập → cảnh báo).
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [newQtyInput, setNewQtyInput] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);
  // CEO 28/05/2026: bước xác nhận — true = đang hiện popup cảnh báo hậu quả.
  const [adjustConfirming, setAdjustConfirming] = useState(false);

  const handleOpenAdjust = () => {
    setNewQtyInput(String(row.quantity));
    setAdjustReason("");
    setAdjustConfirming(false);
    setAdjustOpen(true);
  };

  // Bước 1: validate input → chuyển sang bước cảnh báo (KHÔNG lưu ngay).
  const handleProceedAdjust = () => {
    const newQty = Number(newQtyInput.replace(/,/g, "."));
    if (!Number.isFinite(newQty) || newQty < 0) {
      toast({ title: "Số tồn không hợp lệ", description: "Nhập số ≥ 0.", variant: "error" });
      return;
    }
    if (!adjustReason.trim()) {
      toast({ title: "Thiếu lý do", description: "Nhập lý do điều chỉnh để lưu lịch sử.", variant: "error" });
      return;
    }
    if (Math.abs(newQty - row.quantity) < 1e-9) {
      toast({ title: "Không thay đổi", description: "Số tồn mới trùng số hiện tại.", variant: "default" });
      return;
    }
    setAdjustConfirming(true);
  };

  // Bước 2: user đã đọc cảnh báo + bấm "Xác nhận cập nhật" → ghi thật.
  const handleSaveAdjust = async () => {
    const newQty = Number(newQtyInput.replace(/,/g, "."));
    setAdjustSaving(true);
    try {
      await adjustStockToValue({
        productId: row.productId,
        branchId: row.branchId,
        currentQty: row.quantity,
        newQty,
        reason: adjustReason.trim(),
      });
      toast({
        title: "Đã điều chỉnh tồn",
        description: `${row.productName}: ${formatNumber(row.quantity)} → ${formatNumber(newQty)} ${row.unit ?? ""}`,
        variant: "success",
      });
      setAdjustOpen(false);
      setAdjustConfirming(false);
      onAdjusted?.();
    } catch (err) {
      toast({
        title: "Lỗi điều chỉnh tồn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setAdjustSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingBranches(true);
      try {
        const bk = await getProductStockBreakdown(row.productId);
        if (!cancelled) setBranches(bk);
      } catch {
        if (!cancelled) setBranches([]);
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    })();
    (async () => {
      setLoadingMovements(true);
      try {
        const res = await getProductStockMovements(row.productId, {
          page: 0,
          pageSize: 50,
        });
        if (!cancelled) setMovements(res.data);
      } catch {
        if (!cancelled) setMovements([]);
      } finally {
        if (!cancelled) setLoadingMovements(false);
      }
    })();
    // Day 19/05/2026 (CEO Smart Hybrid): load UOM conversions để hiển thị
    // quy đổi (vd "24 hộp = 2 thùng") trong detail panel + movements tab.
    (async () => {
      try {
        const conv = await getUOMConversions(row.productId);
        if (!cancelled) setConversions(conv);
      } catch {
        if (!cancelled) setConversions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.productId]);

  const totalQty = branches.reduce((s, b) => s + b.quantity, 0);
  const totalReserved = branches.reduce((s, b) => s + b.reserved, 0);

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
                  title={row.productName}
                  code={row.productCode}
                  subtitle={row.variantName ?? row.branchName}
                />
                {/* CEO 28/05/2026: nút điều chỉnh tồn nhanh — chỉ user có quyền
                    inventory.adjust (owner luôn thấy). Sửa tồn về giá trị mới,
                    có ghi lý do + lịch sử (tab "Lịch sử xuất nhập"). */}
                {canAdjust && (
                  <div className="flex justify-end items-center gap-2">
                    {locked && (
                      <span className="inline-flex items-center gap-1 text-xs text-status-warning">
                        <Icon name="lock" size={13} />
                        Tồn đã khóa
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleOpenAdjust}
                      disabled={locked}
                      title={locked ? "Tồn kho đang khóa — mở khóa để điều chỉnh" : undefined}
                      className="gap-1"
                    >
                      <Icon name={locked ? "lock" : "edit"} size={14} />
                      Điều chỉnh tồn
                    </Button>
                  </div>
                )}
                <DetailInfoGrid
                  fields={[
                    { label: "Loại", value: (row.productType ?? "—").toUpperCase() },
                    { label: "Đơn vị", value: row.unit ?? "—" },
                    {
                      label: "Tồn tại chi nhánh này",
                      value: (
                        <StockWithConversion
                          quantity={row.quantity}
                          unit={row.unit ?? ""}
                          conversions={conversions}
                          variant="inline"
                        />
                      ),
                    },
                    {
                      label: "Đặt trước",
                      value: (
                        <StockWithConversion
                          quantity={row.reserved}
                          unit={row.unit ?? ""}
                          conversions={conversions}
                          variant="inline"
                        />
                      ),
                    },
                    {
                      label: "Khả dụng",
                      value: (
                        <StockWithConversion
                          quantity={row.available}
                          unit={row.unit ?? ""}
                          conversions={conversions}
                          variant="inline"
                        />
                      ),
                    },
                    {
                      label: "Định mức",
                      value:
                        row.minStock !== undefined ? (
                          <StockWithConversion
                            quantity={row.minStock}
                            unit={row.unit ?? ""}
                            conversions={conversions}
                            variant="inline"
                          />
                        ) : (
                          "—"
                        ),
                    },
                    {
                      label: "Giá vốn",
                      value: row.costPrice ? formatCurrency(row.costPrice) : "—",
                    },
                    {
                      label: "Giá trị tồn",
                      value: formatCurrency(row.stockValue),
                    },
                    { label: "Cập nhật", value: formatDate(row.updatedAt) },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "branches",
            label: `Tồn các chi nhánh (${branches.length})`,
            content: (
              <div className="space-y-3">
                {loadingBranches ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải...
                  </div>
                ) : branches.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa ghi nhận tồn ở chi nhánh nào.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">Chi nhánh</th>
                          <th className="text-right p-2 font-medium">Tồn</th>
                          <th className="text-right p-2 font-medium">Đặt trước</th>
                          <th className="text-right p-2 font-medium">Khả dụng</th>
                          <th className="text-right p-2 font-medium">Cập nhật</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => (
                          <tr key={b.branchId} className="border-t">
                            <td className="p-2">
                              <div className="font-medium">{b.branchName}</div>
                              {b.branchCode && (
                                <div className="text-xs text-muted-foreground">
                                  {b.branchCode}
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              <StockWithConversion
                                quantity={b.quantity}
                                unit={row.unit ?? ""}
                                conversions={conversions}
                                variant="inline"
                              />
                            </td>
                            <td className="p-2 text-right tabular-nums text-muted-foreground">
                              {b.reserved}
                            </td>
                            <td className="p-2 text-right">
                              <StockWithConversion
                                quantity={b.available}
                                unit={row.unit ?? ""}
                                conversions={conversions}
                                variant="inline"
                              />
                            </td>
                            <td className="p-2 text-right text-xs text-muted-foreground">
                              {formatDate(b.updatedAt)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t bg-muted/20 font-semibold">
                          <td className="p-2">Tổng toàn hệ thống</td>
                          <td className="p-2 text-right">
                            <StockWithConversion
                              quantity={totalQty}
                              unit={row.unit ?? ""}
                              conversions={conversions}
                              variant="inline"
                            />
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {totalReserved}
                          </td>
                          <td className="p-2 text-right">
                            <StockWithConversion
                              quantity={totalQty - totalReserved}
                              unit={row.unit ?? ""}
                              conversions={conversions}
                              variant="inline"
                            />
                          </td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "movements",
            label: `Lịch sử xuất nhập (${movements.length})`,
            content: (
              <div className="space-y-2">
                {loadingMovements ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải...
                  </div>
                ) : movements.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa có lịch sử xuất nhập cho sản phẩm này.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left p-2 font-medium">Thời gian</th>
                          <th className="text-left p-2 font-medium">Loại</th>
                          <th className="text-right p-2 font-medium">Số lượng</th>
                          <th className="text-left p-2 font-medium">Người tạo</th>
                          <th className="text-left p-2 font-medium">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m) => (
                          <tr key={m.id} className="border-t">
                            <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                              {formatDate(m.date)}
                            </td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">
                                {m.typeName}
                              </Badge>
                            </td>
                            <td className="p-2 text-right">
                              <StockWithConversion
                                quantity={m.quantity}
                                unit={row.unit ?? ""}
                                conversions={conversions}
                                variant="movement"
                                isInflow={m.type !== "export"}
                              />
                            </td>
                            <td className="p-2 text-xs">
                              {m.createdByName || "—"}
                            </td>
                            <td className="p-2 text-xs text-muted-foreground max-w-[240px] truncate">
                              {m.note ?? "—"}
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

      {/* CEO 28/05/2026: Dialog điều chỉnh tồn nhanh */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {adjustConfirming
                ? "⚠️ Xác nhận điều chỉnh tồn"
                : `Điều chỉnh tồn — ${row.productName}`}
            </DialogTitle>
          </DialogHeader>

          {!adjustConfirming ? (
            // ───────── BƯỚC 1: Form nhập ─────────
            <>
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-surface-container-low p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Chi nhánh</span>
                    <span className="font-medium">{row.branchName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tồn hiện tại</span>
                    <span className="font-semibold tabular-nums">
                      {formatNumber(row.quantity)} {row.unit ?? ""}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Tồn mới <span className="text-status-error">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={newQtyInput}
                      onChange={(e) => setNewQtyInput(e.target.value)}
                      placeholder="Nhập số tồn mới"
                      className="flex-1"
                      autoFocus
                    />
                    <span className="text-sm text-muted-foreground shrink-0">
                      {row.unit ?? ""}
                    </span>
                  </div>
                  {Number.isFinite(Number(newQtyInput.replace(/,/g, "."))) &&
                    newQtyInput.trim() !== "" && (
                      <p className="text-xs text-muted-foreground">
                        Chênh lệch:{" "}
                        <span
                          className={
                            Number(newQtyInput.replace(/,/g, ".")) - row.quantity >= 0
                              ? "text-status-success font-medium"
                              : "text-status-error font-medium"
                          }
                        >
                          {Number(newQtyInput.replace(/,/g, ".")) - row.quantity >= 0 ? "+" : ""}
                          {formatNumber(
                            Number(newQtyInput.replace(/,/g, ".")) - row.quantity,
                          )}{" "}
                          {row.unit ?? ""}
                        </span>
                      </p>
                    )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Lý do điều chỉnh <span className="text-status-error">*</span>
                  </label>
                  <Input
                    type="text"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="VD: Sửa sai migrate KG→Gram, kiểm kê thực tế..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAdjustOpen(false)}>
                  Huỷ
                </Button>
                <Button onClick={handleProceedAdjust}>Tiếp tục</Button>
              </DialogFooter>
            </>
          ) : (
            // ───────── BƯỚC 2: Popup cảnh báo hậu quả ─────────
            (() => {
              const newQty = Number(newQtyInput.replace(/,/g, "."));
              const delta = newQty - row.quantity;
              const isIncrease = delta > 0;
              const oldValue = row.quantity * (row.costPrice ?? 0);
              const newValue = newQty * (row.costPrice ?? 0);
              const unit = row.unit ?? "";
              return (
                <>
                  <div className="space-y-3 py-2 text-sm">
                    {/* Banner cảnh báo */}
                    <div className="flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3">
                      <Icon name="warning" size={18} className="text-status-warning shrink-0 mt-0.5" />
                      <p className="text-foreground">
                        Khi bấm <b>Xác nhận cập nhật</b>, hệ thống sẽ thực hiện
                        các thay đổi sau cho <b>{row.productName}</b> tại{" "}
                        <b>{row.branchName}</b>:
                      </p>
                    </div>

                    {/* Tóm tắt thay đổi */}
                    <div className="rounded-lg bg-surface-container-low p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Tồn kho</span>
                        <span className="font-semibold tabular-nums">
                          {formatNumber(row.quantity)} →{" "}
                          <span className="text-primary">{formatNumber(newQty)}</span> {unit}{" "}
                          <span className={isIncrease ? "text-status-success" : "text-status-error"}>
                            ({isIncrease ? "+" : ""}{formatNumber(delta)})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Giá trị tồn</span>
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(oldValue)} →{" "}
                          <span className="text-primary">{formatCurrency(newValue)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Danh sách hậu quả */}
                    <ul className="space-y-1.5">
                      <li className="flex items-start gap-2">
                        <Icon name="check_circle" size={16} className="text-status-success shrink-0 mt-0.5" />
                        <span>Đặt tồn về <b>{formatNumber(newQty)} {unit}</b> (ghi đè số hiện tại).</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Icon name="receipt_long" size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                        <span>Tạo 1 bút toán <b>{isIncrease ? "nhập" : "xuất"} điều chỉnh</b> {formatNumber(Math.abs(delta))} {unit} trong sổ kho.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Icon name="history" size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                        <span>Ghi vào <b>Lịch sử xuất nhập</b>: người sửa + thời gian + lý do.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Icon name="error" size={16} className="text-status-error shrink-0 mt-0.5" />
                        <span className="text-status-error font-medium">KHÔNG tự hoàn tác được — nếu sai phải điều chỉnh lại lần nữa.</span>
                      </li>
                    </ul>

                    {/* Lý do đã nhập */}
                    <div className="rounded-lg border border-border p-2.5">
                      <span className="text-xs text-muted-foreground">Lý do: </span>
                      <span className="text-sm font-medium">{adjustReason.trim()}</span>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setAdjustConfirming(false)}
                      disabled={adjustSaving}
                    >
                      Quay lại
                    </Button>
                    <Button onClick={handleSaveAdjust} disabled={adjustSaving}>
                      {adjustSaving ? "Đang lưu..." : "Xác nhận cập nhật"}
                    </Button>
                  </DialogFooter>
                </>
              );
            })()
          )}
        </DialogContent>
      </Dialog>
    </InlineDetailPanel>
  );
}

export default function TonKhoPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  // Day 19/05/2026 (CEO Smart Hybrid Phase 2): batch UOM conversions cho
  // list view. Load 1 query khi rows đổi, lookup map cho từng cell render.
  const [conversionsMap, setConversionsMap] = useState<
    Map<string, UOMConversion[]>
  >(new Map());
  const [search, setSearch] = useState("");
  // CEO 28/05/2026: debounce search 300ms — trước đây mỗi keystroke gọi server
  // (gõ "xưởng đặc biệt" = 14 request). Mạng PA chập chờn → vài request fail →
  // spam toast "Lỗi tải tồn kho". Debounce → 1 request sau khi ngừng gõ.
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  // Request sequencing — bỏ kết quả/toast của request cũ khi đã có request mới
  // (tránh race + dồn toast lỗi khi gõ nhanh).
  const reqIdRef = useRef(0);

  // Default branch filter theo branch đang active của user.
  // User có thể override sang "all" qua dropdown nếu là owner/admin.
  const [branchFilter, setBranchFilter] = useState<string>(activeBranchId ?? "all");

  // Sync khi user switch branch ở global selector (header).
  useEffect(() => {
    if (activeBranchId) setBranchFilter(activeBranchId);
  }, [activeBranchId]);
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>("all");
  const [lowStockOnly, setLowStockOnly] = useState<string>("all"); // all | low

  const [importOpen, setImportOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // CEO 28/05/2026: khóa cập nhật tồn kho đầu kỳ.
  const { hasPermission } = useAuth();
  const canLock = hasPermission("inventory.lock");
  const [inventoryLocked, setInvLocked] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  const loadLockState = useCallback(async () => {
    try {
      setInvLocked(await isInventoryLocked());
    } catch {
      /* fail-soft — coi như chưa khóa nếu lỗi đọc */
    }
  }, []);
  useEffect(() => {
    loadLockState();
  }, [loadLockState]);

  const handleToggleLock = async () => {
    setLockBusy(true);
    try {
      const next = !inventoryLocked;
      await setInventoryLocked(next);
      setInvLocked(next);
      setLockConfirmOpen(false);
      toast({
        title: next ? "Đã khóa tồn kho đầu kỳ" : "Đã mở khóa tồn kho",
        description: next
          ? "Nhập đầu kỳ + Điều chỉnh tồn đã bị khóa."
          : "Có thể nhập/điều chỉnh tồn lại. Nhớ khóa lại sau khi xong.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi khóa/mở tồn kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLockBusy(false);
    }
  };

  const fetchData = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const filters = {
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        productType: typeFilter !== "all" ? typeFilter : undefined,
        search: debouncedSearch || undefined,
      };
      // Parallel: page rows + aggregates (server-side)
      const [pageResult, aggregates] = await Promise.all([
        getBranchStockPage({
          ...filters,
          lowStockOnly: lowStockOnly === "low",
          offset: page * pageSize,
          limit: pageSize,
        }),
        getBranchStockAggregates(filters),
      ]);
      // Bỏ qua nếu đã có request mới hơn (tránh flicker + ghi đè data mới).
      if (reqId !== reqIdRef.current) return;
      setRows(pageResult.rows);
      setTotalRows(pageResult.total);
      setTotalQty(aggregates.totalQty);
      setTotalValue(aggregates.totalValue);
      setLowStockCount(aggregates.lowStockCount);
    } catch (err) {
      // Chỉ toast cho request mới nhất → tránh spam 10+ toast khi gõ nhanh
      // gặp mạng chập chờn.
      if (reqId !== reqIdRef.current) return;
      toast({
        title: "Lỗi tải tồn kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [branchFilter, typeFilter, debouncedSearch, lowStockOnly, page, pageSize, toast]);

  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch((err: unknown) => {
        console.error("[ton-kho] load branches failed:", err);
        setBranches([]);
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [debouncedSearch, branchFilter, typeFilter, lowStockOnly]);

  // Day 19/05/2026 (CEO Smart Hybrid Phase 2): batch load UOM conversions
  // cho các productId hiện ra trong page → hiển thị quy đổi cột "Tồn".
  useEffect(() => {
    if (rows.length === 0) {
      setConversionsMap(new Map());
      return;
    }
    const ids = Array.from(new Set(rows.map((r) => r.productId)));
    let cancelled = false;
    getUOMConversionsByProductIds(ids)
      .then((m) => {
        if (!cancelled) setConversionsMap(m);
      })
      .catch(() => {
        if (!cancelled) setConversionsMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const columns: ColumnDef<BranchStockRow, unknown>[] = [
    {
      accessorKey: "productCode",
      header: "Mã hàng",
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium text-primary">
          {row.original.productCode}
        </span>
      ),
    },
    {
      accessorKey: "productName",
      header: "Tên hàng",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName}</div>
          {row.original.variantName && (
            <div className="text-xs text-muted-foreground">
              {row.original.variantName}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "productType",
      header: "Loại",
      size: 80,
      cell: ({ row }) => {
        const t = row.original.productType;
        if (!t) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge
            variant="outline"
            className={
              t === "nvl"
                ? "bg-status-warning/10 text-status-warning border-status-warning/25"
                : "bg-primary-fixed text-primary border-primary-fixed"
            }
          >
            {t.toUpperCase()}
          </Badge>
        );
      },
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 150,
    },
    {
      // CEO 28/05/2026: tách ĐVT thành cột riêng → cột Tồn/Khả dụng chỉ còn
      // số + quy đổi (hideUnit), không dính đơn vị.
      accessorKey: "unit",
      header: "ĐVT",
      size: 70,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.unit ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "quantity",
      header: "Tồn kho",
      size: 150,
      cell: ({ row }) => {
        const r = row.original;
        const isLow =
          r.minStock !== undefined && r.quantity <= (r.minStock ?? 0);
        return (
          <span className={isLow ? "text-destructive" : ""}>
            <StockWithConversion
              quantity={r.quantity}
              unit={r.unit ?? ""}
              conversions={conversionsMap.get(r.productId) ?? null}
              variant="inline"
              hideUnit
            />
          </span>
        );
      },
    },
    {
      accessorKey: "reserved",
      header: "Đang giữ",
      size: 90,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {formatNumber(row.original.reserved)}
        </span>
      ),
    },
    {
      accessorKey: "available",
      header: "Khả dụng",
      size: 150,
      cell: ({ row }) => (
        <StockWithConversion
          quantity={row.original.available}
          unit={row.original.unit ?? ""}
          conversions={conversionsMap.get(row.original.productId) ?? null}
          variant="inline"
          hideUnit
        />
      ),
    },
    {
      accessorKey: "minStock",
      header: "Tồn tối thiểu",
      size: 100,
      cell: ({ row }) =>
        row.original.minStock !== undefined
          ? formatNumber(row.original.minStock)
          : "—",
    },
    {
      accessorKey: "stockValue",
      header: "Giá trị tồn",
      size: 140,
      cell: ({ row }) => (
        <span className="font-medium text-right block">
          {formatCurrency(row.original.stockValue)}
        </span>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: "Cập nhật",
      size: 120,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.updatedAt)}
        </span>
      ),
    },
  ];

  // Active filter chips data — UX cải thiện cho user thấy đang lọc gì.
  const activeFilters: ActiveFilter[] = [];
  if (branchFilter !== "all") {
    const branchName = branches.find((b) => b.id === branchFilter)?.name ?? branchFilter;
    activeFilters.push({
      key: "branch",
      label: "Chi nhánh",
      value: branchName,
      onClear: () => setBranchFilter("all"),
    });
  }
  if (typeFilter !== "all") {
    activeFilters.push({
      key: "type",
      label: "Loại",
      value: typeFilter === "nvl" ? "NVL" : "SKU",
      onClear: () => setTypeFilter("all"),
    });
  }
  if (lowStockOnly !== "all") {
    activeFilters.push({
      key: "low",
      label: "Định mức",
      value: "Dưới định mức",
      onClear: () => setLowStockOnly("all"),
    });
  }
  const handleClearAllFilters = () => {
    setBranchFilter("all");
    setTypeFilter("all");
    setLowStockOnly("all");
  };

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <ActiveFiltersBar
            filters={activeFilters}
            onClearAll={handleClearAllFilters}
          />

          <FilterGroup
            label="Chi nhánh"
            activeHint={
              branchFilter !== "all"
                ? branches.find((b) => b.id === branchFilter)?.name?.slice(0, 12)
                : undefined
            }
          >
            <SelectFilter
              options={[
                { label: "Tất cả chi nhánh", value: "all" },
                ...branches.map((b) => ({
                  label: b.name,
                  value: b.id,
                })),
              ]}
              value={branchFilter}
              onChange={setBranchFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup
            label="Loại hàng"
            activeHint={typeFilter !== "all" ? typeFilter.toUpperCase() : undefined}
          >
            <SelectFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "NVL — Nguyên vật liệu", value: "nvl" },
                { label: "SKU — Hàng bán", value: "sku" },
              ]}
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as ProductTypeFilter)}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup
            label="Định mức"
            activeHint={lowStockOnly === "low" ? "Dưới ĐM" : undefined}
          >
            <SelectFilter
              options={[
                { label: "Tất cả", value: "all" },
                { label: "Dưới định mức", value: "low" },
              ]}
              value={lowStockOnly}
              onChange={setLowStockOnly}
              placeholder="Tất cả"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Tồn kho"
        searchPlaceholder="Theo mã hàng, tên hàng..."
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tải mẫu tồn kho đầu kỳ",
            icon: <Icon name="description" size={16} />,
            variant: "ghost",
            onClick: () => downloadTemplate(initialStockExcelSchema),
          },
          {
            // CEO 28/05/2026: disable khi tồn kho đã khóa.
            label: inventoryLocked
              ? "Nhập tồn đầu kỳ (đã khóa)"
              : "Nhập tồn kho đầu kỳ",
            icon: <Icon name={inventoryLocked ? "lock" : "upload"} size={16} />,
            onClick: () => setImportOpen(true),
            disabled: inventoryLocked,
          },
          // CEO 28/05/2026: nút Chốt & khóa / Mở khóa — chỉ ai có quyền inventory.lock.
          ...(canLock
            ? [
                {
                  label: inventoryLocked
                    ? "Mở khóa tồn kho"
                    : "Chốt & khóa tồn",
                  icon: (
                    <Icon
                      name={inventoryLocked ? "lock_open" : "lock"}
                      size={16}
                    />
                  ),
                  variant: (inventoryLocked ? "outline" : "default") as
                    | "outline"
                    | "default",
                  onClick: () => setLockConfirmOpen(true),
                },
              ]
            : []),
        ]}
        onExport={{
          excel: async () => {
            // Fetch full dataset (no pagination) for export
            const all = await getBranchStockRows({
              branchId: branchFilter !== "all" ? branchFilter : undefined,
              productType: typeFilter !== "all" ? typeFilter : undefined,
              search: search || undefined,
              lowStockOnly: lowStockOnly === "low",
            });
            const stockRows: InitialStockImportRow[] = all
              .filter((r) => r.branchCode)
              .map((r) => ({
                productCode: r.productCode,
                productName: r.productName,
                branchCode: r.branchCode ?? "",
                quantity: r.quantity,
                costPrice: r.costPrice ?? 0,
                note: `Xuất từ tồn kho hiện tại — giá trị ${r.stockValue}`,
              }));
            exportToExcelFromSchema(stockRows, initialStockExcelSchema);
          },
          csv: async () => {
            const all = await getBranchStockRows({
              branchId: branchFilter !== "all" ? branchFilter : undefined,
              productType: typeFilter !== "all" ? typeFilter : undefined,
              search: search || undefined,
              lowStockOnly: lowStockOnly === "low",
            });
            const cols = [
              { header: "Mã hàng", key: "productCode", width: 15 },
              { header: "Tên hàng", key: "productName", width: 30 },
              { header: "Chi nhánh", key: "branchName", width: 20 },
              { header: "Tồn kho", key: "quantity", width: 12, format: (v: number) => v },
              { header: "Khả dụng", key: "available", width: 12, format: (v: number) => v },
              { header: "Giá trị tồn", key: "stockValue", width: 15, format: (v: number) => v },
            ];
            exportToCsv(all, cols, "ton-kho");
          },
        }}
      />

      {/* Summary cards — Responsive Sprint B5 (CEO 25/05/2026):
          Trước: grid-cols-[repeat(3,minmax(150px,1fr))] → mobile 3 col chật.
          Sau: 1 col mobile, 2 col sm:, 3 col md:. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 px-4 pt-4 pb-1">
        <SummaryCard
          icon={<Icon name="inventory" size={16} />}
          label="Tổng SP"
          value={totalRows.toString()}
        />
        <SummaryCard
          icon={<Icon name="inventory" size={16} />}
          label="Tổng giá trị tồn"
          value={formatCurrency(totalValue)}
          highlight
        />
        <SummaryCard
          icon={<Icon name="warning" size={16} className="text-destructive" />}
          label="Dưới định mức"
          value={lowStockCount.toString()}
          danger={lowStockCount > 0}
        />
      </div>

      {/* CEO 28/05/2026: banner trạng thái khóa — mọi người đều thấy. */}
      {inventoryLocked && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm">
          <Icon name="lock" size={16} className="text-status-warning shrink-0" />
          <span className="text-foreground">
            <b>Tồn kho đầu kỳ đã khóa.</b> Không thể nhập đầu kỳ / điều chỉnh tồn.
            {canLock
              ? " Bấm “Mở khóa tồn kho” để sửa."
              : " Liên hệ người có quyền để mở khóa."}
          </span>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        total={totalRows}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(totalRows / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        columnToggle
        // CEO 28/05/2026: "Đang giữ" (reserved) + "Tồn tối thiểu" ít dùng →
        // ẩn mặc định, user bật qua "Hiển thị cột" khi cần.
        defaultColumnVisibility={{ reserved: false, minStock: false }}
        summaryRow={{
          // CEO 28/05/2026: format số tổng — phân ngàn + tối đa 2 thập phân
          // (trước đây `${totalQty}` ra "26193.490000000005" do float JS).
          quantity: formatNumber(totalQty),
          stockValue: formatCurrency(totalValue),
        }}
        getRowId={(r) => r.id}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(stockRow, onClose) => (
          <StockRowDetail
            row={stockRow}
            onClose={onClose}
            onAdjusted={fetchData}
            locked={inventoryLocked}
          />
        )}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={initialStockExcelSchema}
        onCommit={bulkImportInitialStock}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập tồn kho đầu kỳ hoàn tất",
            description: "Tồn kho các sản phẩm đã được cập nhật theo chi nhánh.",
            variant: "success",
          });
        }}
      />

      {/* CEO 28/05/2026: Dialog xác nhận khóa / mở khóa tồn kho */}
      <Dialog open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {inventoryLocked
                ? "Mở khóa tồn kho đầu kỳ?"
                : "🔒 Chốt & khóa tồn kho đầu kỳ?"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            {inventoryLocked ? (
              <>
                <p>Khi mở khóa, sẽ cho phép lại:</p>
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2">
                    <Icon name="lock_open" size={16} className="text-status-success shrink-0 mt-0.5" />
                    <span>Nhập tồn kho đầu kỳ (ghi đè) + Điều chỉnh tồn.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="warning" size={16} className="text-status-warning shrink-0 mt-0.5" />
                    <span className="text-status-warning font-medium">
                      Nhớ <b>khóa lại</b> sau khi sửa xong để bảo vệ số liệu.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="history" size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                    <span>Ghi lịch sử: ai mở, khi nào.</span>
                  </li>
                </ul>
              </>
            ) : (
              <>
                <p>Khi khóa, hệ thống sẽ:</p>
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2">
                    <Icon name="block" size={16} className="text-status-error shrink-0 mt-0.5" />
                    <span><b>Chặn "Nhập tồn kho đầu kỳ"</b> (ghi đè).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="block" size={16} className="text-status-error shrink-0 mt-0.5" />
                    <span><b>Chặn "Điều chỉnh tồn"</b> từng sản phẩm.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="lock" size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                    <span>Chỉ người có quyền mới mở khóa lại được. Ghi lịch sử ai khóa.</span>
                  </li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Mục đích: chốt số tồn đầu kỳ, tránh sửa nhầm sau khi đã cân đối.
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLockConfirmOpen(false)} disabled={lockBusy}>
              Huỷ
            </Button>
            <Button onClick={handleToggleLock} disabled={lockBusy}>
              {lockBusy
                ? "Đang xử lý..."
                : inventoryLocked
                  ? "Xác nhận mở khóa"
                  : "Xác nhận khóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListPageLayout>
  );
}
