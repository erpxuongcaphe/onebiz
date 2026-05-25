"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";
import {
  getAllBOMs,
  getBOMById,
  getBOMsByProduct,
  getBranches,
  createProductionOrder,
  getProductById,
} from "@/lib/services";
import { formatCurrency } from "@/lib/format";
import type { BOM } from "@/lib/types";
import type { BranchDetail } from "@/lib/services/supabase/branches";
import { Icon } from "@/components/ui/icon";

interface CreateProductionOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface MaterialNeed {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  perBatch: number;
  needed: number;
  available: number;
  shortage: boolean;
}

export function CreateProductionOrderDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateProductionOrderDialogProps) {
  const { toast } = useToast();

  const [boms, setBoms] = useState<BOM[]>([]);
  const [branches, setBranches] = useState<BranchDetail[]>([]);

  // CEO 25/05/2026: Đổi UX — primary picker là Sản phẩm cần SX, BOM tự
  // lookup theo SP. Nếu SP có nhiều BOM thì show sub-picker (rare case).
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [bomsOfProduct, setBomsOfProduct] = useState<BOM[]>([]);
  const [bomId, setBomId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [plannedQty, setPlannedQty] = useState("1");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [notes, setNotes] = useState("");

  const [selectedBom, setSelectedBom] = useState<BOM | null>(null);
  const [materials, setMaterials] = useState<MaterialNeed[]>([]);
  const [computing, setComputing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load options
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [bomList, brList] = await Promise.all([getAllBOMs(), getBranches()]);
        setBoms(bomList);
        setBranches(brList);
        // Default to first factory branch
        const factory = brList.find((b) => b.branchType === "factory") ?? brList[0];
        if (factory) setBranchId(factory.id);
      } catch (err) {
        toast({
          title: "Lỗi tải dữ liệu",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    })();
  }, [open, toast]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setProductId("");
      setProductSearch("");
      setShowProductDropdown(false);
      setBomsOfProduct([]);
      setBomId("");
      setPlannedQty("1");
      setPlannedStart("");
      setPlannedEnd("");
      setNotes("");
      setSelectedBom(null);
      setMaterials([]);
      setErrors({});
    }
  }, [open]);

  // Khi user chọn SP → fetch BOMs của SP đó. Auto-select BOM đầu tiên
  // nếu chỉ có 1 (common case). Nếu nhiều BOM → show sub-picker.
  useEffect(() => {
    if (!productId) {
      setBomsOfProduct([]);
      setBomId("");
      return;
    }
    (async () => {
      try {
        const list = await getBOMsByProduct(productId);
        const actives = list.filter((b) => b.isActive !== false);
        setBomsOfProduct(actives);
        if (actives.length === 1) {
          setBomId(actives[0].id);
        } else if (actives.length === 0) {
          setBomId("");
          toast({
            title: "Sản phẩm chưa có công thức BOM",
            description:
              "Tạo BOM trong /hang-hoa/cong-thuc trước khi lên lệnh SX.",
            variant: "warning",
          });
        } else {
          // Nhiều BOM — để user chọn
          setBomId("");
        }
      } catch (err) {
        console.error("[CreateProductionOrder] load BOMs by product", err);
        setBomsOfProduct([]);
        setBomId("");
      }
    })();
  }, [productId, toast]);

  // Danh sách SP unique từ boms list (sản phẩm có ít nhất 1 BOM active).
  const productOptions = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const b of boms) {
      if (!b.productId) continue;
      if (b.isActive === false) continue;
      if (!map.has(b.productId)) {
        map.set(b.productId, {
          id: b.productId,
          code: b.productCode ?? "",
          name: b.productName ?? "",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.code || "").localeCompare(b.code || ""),
    );
  }, [boms]);

  // Filter SP theo search query (CEO 25/05/2026): mã hoặc tên SP
  const filteredProductOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return productOptions;
    return productOptions.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q),
    );
  }, [productOptions, productSearch]);

  const selectedProductLabel = useMemo(() => {
    if (!productId) return "";
    const p = productOptions.find((x) => x.id === productId);
    return p ? `${p.code} — ${p.name}` : "";
  }, [productId, productOptions]);

  // When BOM or qty changes → recompute material needs
  useEffect(() => {
    if (!bomId) {
      setSelectedBom(null);
      setMaterials([]);
      return;
    }
    setComputing(true);
    (async () => {
      try {
        const bom = await getBOMById(bomId);
        setSelectedBom(bom);

        const qty = Number(plannedQty) || 0;
        const batches = bom.yieldQty > 0 ? qty / bom.yieldQty : 0;

        const needs: MaterialNeed[] = await Promise.all(
          (bom.items ?? []).map(async (item) => {
            const perBatch = item.quantity * (1 + (item.wastePercent ?? 0) / 100);
            const needed = perBatch * batches;
            // Fetch current stock
            let available = 0;
            try {
              const prod = await getProductById(item.materialId);
              available = prod?.stock ?? 0;
            } catch {
              // ignore
            }
            return {
              productId: item.materialId,
              productCode: item.materialCode ?? "",
              productName: item.materialName ?? "",
              unit: item.unit,
              perBatch,
              needed,
              available,
              shortage: available < needed,
            };
          })
        );
        setMaterials(needs);
      } catch (err) {
        toast({
          title: "Lỗi tính NVL",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      } finally {
        setComputing(false);
      }
    })();
  }, [bomId, plannedQty, toast]);

  const hasShortage = materials.some((m) => m.shortage);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!productId) e.productId = "Chọn sản phẩm cần SX";
    if (!bomId) e.bomId = "Sản phẩm chưa có BOM hợp lệ";
    if (!branchId) e.branchId = "Chọn chi nhánh";
    if (!plannedQty || Number(plannedQty) <= 0) e.plannedQty = "Số lượng phải > 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    if (!selectedBom) return;
    setSaving(true);
    try {
      await createProductionOrder({
        branchId,
        bomId,
        productId: selectedBom.productId,
        plannedQty: Number(plannedQty),
        plannedStart: plannedStart || undefined,
        plannedEnd: plannedEnd || undefined,
        notes: notes || undefined,
        materials: materials.map((m) => ({
          productId: m.productId,
          plannedQty: m.needed,
          unit: m.unit,
        })),
      });
      toast({
        title: "Tạo lệnh sản xuất thành công",
        description: `${plannedQty} ${selectedBom.yieldUnit} ${selectedBom.productName ?? ""}`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo lệnh sản xuất",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo lệnh sản xuất</DialogTitle>
          <DialogDescription>
            Chọn sản phẩm cần sản xuất. Hệ thống tự động lấy công thức BOM
            của sản phẩm + tính NVL cần dùng.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Sản phẩm cần sản xuất <span className="text-destructive">*</span>
              </label>
              {/* CEO 25/05/2026: thay Select bằng input search để gõ tìm SP
                  nhanh (mã hoặc tên). Click input → show dropdown filtered. */}
              <div className="relative">
                <Icon
                  name="search"
                  size={16}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  className="pl-8 pr-8"
                  placeholder="Gõ mã hoặc tên sản phẩm..."
                  value={productId ? selectedProductLabel : productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setShowProductDropdown(true);
                    if (productId) setProductId(""); // user gõ lại → clear chọn cũ
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  onBlur={() => {
                    // Delay để onClick item kịp chạy trước onBlur
                    setTimeout(() => setShowProductDropdown(false), 150);
                  }}
                />
                {productId && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductId("");
                      setProductSearch("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Xóa chọn"
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
                {showProductDropdown && (
                  <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-border bg-white shadow-lg">
                    {productOptions.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Chưa có SP nào có BOM. Tạo BOM ở{" "}
                        <span className="font-mono">/hang-hoa/cong-thuc</span>{" "}
                        trước.
                      </div>
                    )}
                    {productOptions.length > 0 &&
                      filteredProductOptions.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          Không tìm thấy SP &quot;{productSearch}&quot;
                        </div>
                      )}
                    {filteredProductOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setProductId(p.id);
                          setProductSearch("");
                          setShowProductDropdown(false);
                        }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
                      >
                        <span className="font-mono text-xs text-primary">
                          {p.code}
                        </span>
                        <span className="mx-1 text-muted-foreground">—</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Sub-picker BOM — chỉ hiện khi SP có nhiều BOM (rare) */}
              {productId && bomsOfProduct.length > 1 && (
                <div className="mt-1 space-y-1">
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Sản phẩm có {bomsOfProduct.length} công thức — chọn 1
                  </label>
                  <Select
                    value={bomId || null}
                    onValueChange={(v) => setBomId(v ?? "")}
                    items={bomsOfProduct.map((b) => ({
                      value: b.id,
                      label: b.name,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Chọn công thức...">
                        {(v) => bomsOfProduct.find((b) => b.id === v)?.name ?? "Chọn công thức..."}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {bomsOfProduct.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Hiển thị BOM auto-picked khi chỉ có 1 */}
              {productId && bomsOfProduct.length === 1 && selectedBom && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Icon name="auto_awesome" size={12} className="text-primary" />
                  Công thức áp dụng: <b>{selectedBom.name}</b> (1 mẻ ra{" "}
                  {selectedBom.yieldQty} {selectedBom.yieldUnit})
                </div>
              )}
              {errors.productId && <p className="text-xs text-destructive">{errors.productId}</p>}
              {errors.bomId && <p className="text-xs text-destructive">{errors.bomId}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Chi nhánh sản xuất <span className="text-destructive">*</span>
              </label>
              <Select
                value={branchId || null}
                onValueChange={(v) => setBranchId(v ?? "")}
                items={branches.map((b) => ({ value: b.id, label: b.name }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn chi nhánh...">
                    {(v) => branches.find((b) => b.id === v)?.name ?? "Chọn chi nhánh..."}
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
              {errors.branchId && <p className="text-xs text-destructive">{errors.branchId}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Số lượng <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={plannedQty}
                  onChange={(e) => setPlannedQty(e.target.value)}
                />
                {selectedBom && (
                  <span className="flex items-center text-sm text-muted-foreground">
                    {selectedBom.yieldUnit}
                  </span>
                )}
              </div>
              {errors.plannedQty && (
                <p className="text-xs text-destructive">{errors.plannedQty}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Ngày bắt đầu sản xuất
              </label>
              <Input
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Khi nào bắt đầu làm? (để trống = bắt đầu ngay khi tạo lệnh)
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Ngày dự kiến hoàn thành
              </label>
              <Input
                type="date"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Khi nào làm xong? (để trống nếu chưa rõ — có thể cập nhật sau)
              </p>
            </div>
          </div>

          {/* Material needs */}
          {bomId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">NVL cần dùng</h3>
                {computing && (
                  <Icon name="progress_activity" size={14} className="animate-spin text-muted-foreground" />
                )}
              </div>

              {materials.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left p-2 font-medium">NVL</th>
                        <th className="text-right p-2 font-medium w-28">Cần</th>
                        <th className="text-right p-2 font-medium w-28">Tồn kho</th>
                        <th className="text-center p-2 font-medium w-24">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((m) => (
                        <tr key={m.productId} className="border-t">
                          <td className="p-2">
                            <div className="font-medium">{m.productName}</div>
                            <div className="text-xs text-muted-foreground">{m.productCode}</div>
                          </td>
                          <td className="p-2 text-right">
                            <span className="font-medium">{formatCurrency(m.needed)}</span>{" "}
                            <span className="text-xs text-muted-foreground">{m.unit}</span>
                          </td>
                          <td className="p-2 text-right">
                            <span
                              className={
                                m.shortage ? "text-destructive font-medium" : "text-foreground"
                              }
                            >
                              {formatCurrency(m.available)}
                            </span>{" "}
                            <span className="text-xs text-muted-foreground">{m.unit}</span>
                          </td>
                          <td className="p-2 text-center">
                            {m.shortage ? (
                              <span className="inline-flex items-center gap-1 text-destructive text-xs">
                                <Icon name="warning" size={14} />
                                Thiếu
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-status-success text-xs">
                                <Icon name="check_circle" size={14} />
                                Đủ
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {hasShortage && (
                <div className="text-xs text-destructive flex items-center gap-2 bg-destructive/5 rounded p-2">
                  <Icon name="warning" size={14} />
                  Có NVL không đủ tồn kho — bạn vẫn có thể tạo lệnh nhưng cần nhập kho trước khi sản xuất
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving || computing}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Tạo lệnh sản xuất
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
