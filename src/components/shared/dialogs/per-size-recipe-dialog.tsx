"use client";

/**
 * PerSizeRecipeDialog — Công thức nguyên liệu theo TỪNG SIZE (FnB).
 * CEO 16/06/2026. Mở từ tab "Quy cách" của form SP.
 *
 * Mỗi size (variant) có 1 công thức (BOM) riêng: lưới Nguyên liệu × Size, mỗi ô
 * là lượng riêng (phi tuyến). Lưu = tạo/thay BOM cho từng variant (code = mã
 * size, variant_id). RPC bán (00147/00148) sẽ trừ kho đúng công thức của size.
 *
 * Nguyên liệu gắn "Mức đường/đá" (scale-target) → POS nhân hệ số theo lựa chọn.
 * Để trống scale-target = cố định. Topping/đá-ghi-chú KHÔNG nằm ở đây (là modifier).
 */

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import { getProducts, updateProduct } from "@/lib/services";
import {
  getBOMByCode,
  getBOMById,
  createBOM,
  deleteBOM,
} from "@/lib/services/supabase/bom";
import {
  getVariantsByProduct,
  updateVariant,
} from "@/lib/services/supabase/variants";
import {
  listModifierGroups,
  type ModifierGroup,
} from "@/lib/services/supabase/modifier-groups";
import type { Product, ProductVariant } from "@/lib/types";

interface IngredientRow {
  key: string;
  materialId: string;
  unit: string;
  /** id của modifier group để scale (vd "Mức đường") — null = cố định */
  scaleTarget: string | null;
  /** variantId → lượng */
  qty: Record<string, number>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  product: { id: string; code: string; name: string } | null;
  onSaved?: () => void;
}

let _k = 0;
const newKey = () => `r${++_k}`;
const sanitize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

export function PerSizeRecipeDialog({ open, onClose, product, onSaved }: Props) {
  const { toast } = useToast();
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [materials, setMaterials] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !product) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [vs, matRes, grps] = await Promise.all([
          getVariantsByProduct(product.id),
          getProducts({ page: 0, pageSize: 1000, filters: {} }).then((r) => r.data).catch(() => []),
          listModifierGroups().catch(() => [] as ModifierGroup[]),
        ]);
        if (cancelled) return;
        setVariants(vs);
        setMaterials(matRes);
        setGroups(grps);

        // Nạp công thức sẵn có của từng size → gộp vào lưới (key = NVL + scale).
        const rowMap = new Map<string, IngredientRow>();
        for (const v of vs) {
          if (!v.bomCode) continue;
          const boms = await getBOMByCode(v.bomCode);
          const bom = boms.find((b) => !b.branchId) ?? boms[0];
          if (!bom) continue;
          const full = await getBOMById(bom.id);
          for (const it of full.items ?? []) {
            const sk = it.modifierScaleTarget ?? "";
            const key = `${it.materialId}|${sk}`;
            let row = rowMap.get(key);
            if (!row) {
              row = {
                key: newKey(),
                materialId: it.materialId,
                unit: it.unit || "g",
                scaleTarget: it.modifierScaleTarget ?? null,
                qty: {},
              };
              rowMap.set(key, row);
            }
            row.qty[v.id] = it.quantity;
          }
        }
        if (cancelled) return;
        const loaded = [...rowMap.values()];
        setRows(loaded.length ? loaded : [emptyRow()]);
      } catch {
        if (!cancelled) setRows([emptyRow()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, product]);

  function emptyRow(): IngredientRow {
    return { key: newKey(), materialId: "", unit: "g", scaleTarget: null, qty: {} };
  }
  const addRow = () => setRows((r) => [...r, emptyRow()]);
  const removeRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));
  const patchRow = (key: string, patch: Partial<IngredientRow>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setQty = (key: string, vid: string, val: number) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, qty: { ...x.qty, [vid]: val } } : x)));

  // Gợi ý: copy lượng của size đầu sang các ô size khác còn trống (điểm bắt đầu).
  const suggestFromFirst = () => {
    if (variants.length < 2) return;
    const first = variants[0].id;
    setRows((r) =>
      r.map((row) => {
        const base = row.qty[first] ?? 0;
        if (base <= 0) return row;
        const nq = { ...row.qty };
        for (const v of variants) if (v.id !== first && !(nq[v.id] > 0)) nq[v.id] = base;
        return { ...row, qty: nq };
      }),
    );
  };

  const fnbGroups = useMemo(() => groups.filter((g) => g.channel === "fnb"), [groups]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!variants.length) return w;
    const valid = rows.filter((r) => r.materialId);
    const emptySizes = variants.filter((v) => !valid.some((r) => (r.qty[v.id] ?? 0) > 0));
    if (emptySizes.length)
      w.push(
        `${emptySizes.map((v) => v.name).join(", ")}: chưa nhập nguyên liệu → size này sẽ KẾ THỪA công thức SP cha`,
      );
    const seen = new Set<string>();
    for (const r of valid) {
      const k = `${r.materialId}|${r.scaleTarget ?? ""}`;
      if (seen.has(k)) {
        w.push("Có nguyên liệu bị lặp dòng — gộp lại 1 dòng cho gọn");
        break;
      }
      seen.add(k);
    }
    return w;
  }, [rows, variants]);

  async function handleSave() {
    if (!product) return;
    setSaving(true);
    try {
      const valid = rows.filter((r) => r.materialId);
      for (const v of variants) {
        const items = valid
          .map((r) => ({
            materialId: r.materialId,
            quantity: r.qty[v.id] ?? 0,
            unit: r.unit || "g",
            modifierScaleTarget: r.scaleTarget,
          }))
          .filter((it) => it.quantity > 0);

        const code = v.bomCode?.trim() || `${product.code}-${sanitize(v.name)}`;

        // Thay công thức: xoá-mềm mọi BOM cùng code rồi tạo lại (lookup theo code).
        const existing = await getBOMByCode(code);
        for (const b of existing) {
          try {
            await deleteBOM(b.id);
          } catch {
            /* bỏ qua */
          }
        }
        if (items.length > 0) {
          await createBOM({
            productId: product.id,
            variantId: v.id,
            code,
            name: `${product.name} ${v.name}`.trim(),
            items,
          });
          if (v.bomCode !== code) await updateVariant(v.id, { bomCode: code });
        } else if (v.bomCode) {
          // Size không nhập gì → bỏ liên kết để kế thừa công thức cha.
          await updateVariant(v.id, { bomCode: null });
        }
      }
      // SP phải has_bom=true để khi bán mới trừ NVL theo công thức.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateProduct(product.id, { hasBom: true } as any);

      toast({ variant: "success", title: "Đã lưu công thức theo size" });
      onSaved?.();
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lưu công thức thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Công thức theo size — {product?.name}</DialogTitle>
          <DialogDescription>
            Mỗi size nhập lượng nguyên liệu riêng. Bán size nào → trừ kho đúng công thức size đó.
            Topping &amp; mức đá (ghi chú) không nhập ở đây.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Đang tải…</div>
        ) : variants.length === 0 ? (
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-4 text-sm">
            Sản phẩm chưa có size nào. Vào tab <b>Quy cách</b> thêm size (M / L / XL…) trước, rồi
            quay lại nhập công thức.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={suggestFromFirst}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40"
              >
                <Icon name="auto_awesome" size={14} />
                Gợi ý: copy size {variants[0]?.name} sang size khác
              </button>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Icon name="add" size={14} className="mr-1" />
                Thêm nguyên liệu
              </Button>
            </div>

            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-container-low text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold min-w-[160px]">Nguyên liệu</th>
                    <th className="px-2 py-2 text-left font-semibold w-28">Theo modifier</th>
                    <th className="px-2 py-2 text-left font-semibold w-16">ĐVT</th>
                    {variants.map((v) => (
                      <th key={v.id} className="px-2 py-2 text-center font-semibold w-20">
                        {v.name}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        <select
                          value={row.materialId}
                          onChange={(e) => {
                            const id = e.target.value;
                            const m = materials.find((x) => x.id === id);
                            patchRow(row.key, {
                              materialId: id,
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              unit: (m as any)?.stockUnit || (m as any)?.unit || row.unit,
                            });
                          }}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          <option value="">— Chọn NVL —</option>
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} · {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={row.scaleTarget ?? ""}
                          onChange={(e) =>
                            patchRow(row.key, { scaleTarget: e.target.value || null })
                          }
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          <option value="">Cố định</option>
                          {fnbGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={row.unit}
                          onChange={(e) => patchRow(row.key, { unit: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </td>
                      {variants.map((v) => (
                        <td key={v.id} className="px-1 py-1.5">
                          <Input
                            type="number"
                            value={row.qty[v.id] || ""}
                            onChange={(e) => {
                              const n = parseFloat(e.target.value);
                              setQty(row.key, v.id, Number.isFinite(n) ? n : 0);
                            }}
                            className="h-9 text-right text-sm"
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Xoá nguyên liệu"
                        >
                          <Icon name="delete" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={variants.length + 4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Chưa có nguyên liệu — bấm “Thêm nguyên liệu”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-xs text-status-warning space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Mẹo: gắn “Theo modifier = Mức đường” cho nguyên liệu đường → khi khách chọn 70%, POS
              tự trừ 70%. Để “Cố định” cho cà phê/sữa/ly.
            </p>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || loading || variants.length === 0}>
            {saving ? "Đang lưu…" : "Lưu công thức"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
