"use client";

import { useEffect, useState } from "react";
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
    if (!bomId) e.bomId = "Chọn công thức";
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
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo lệnh sản xuất</DialogTitle>
          <DialogDescription>
            Chọn công thức (BOM) và số lượng cần sản xuất. Hệ thống tự động tính NVL cần dùng.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Công thức (BOM) <span className="text-destructive">*</span>
              </label>
              <Select value={bomId} onValueChange={(v) => setBomId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn công thức..." />
                </SelectTrigger>
                <SelectContent>
                  {boms.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} — {b.productCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.bomId && <p className="text-xs text-destructive">{errors.bomId}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chi nhánh sản xuất <span className="text-destructive">*</span>
              </label>
              <Select value={branchId} onValueChange={(v) => setBranchId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn chi nhánh..." />
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
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Bắt đầu dự kiến</label>
              <Input
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Kết thúc dự kiến</label>
              <Input
                type="date"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
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
                              <span className="inline-flex items-center gap-1 text-green-600 text-xs">
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
                <div className="text-xs text-destructive flex items-center gap-1.5 bg-destructive/5 rounded p-2">
                  <Icon name="warning" size={14} />
                  Có NVL không đủ tồn kho — bạn vẫn có thể tạo lệnh nhưng cần nhập kho trước khi sản xuất
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring"
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
