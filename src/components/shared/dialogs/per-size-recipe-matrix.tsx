"use client";

/**
 * PerSizeRecipeMatrix — lưới "Công thức theo size" (FnB), CONTROLLED.
 * CEO 17/06/2026 (Phương án B): gộp vào tab Quy cách, lưu chung 1 lần.
 *
 * Cha truyền: danh sách size (cột) + rows (value) + materials + groups.
 * Component chỉ render + onChange; KHÔNG tự load/save (cha lo, để 1 nút Lưu).
 *
 * Hiển thị đầy đủ: mã SKU + tên NVL (ô tìm-kiếm), ĐVT theo NVL, lượng riêng
 * từng size (nhận số lẻ), và GIÁ VỐN tự tính theo size (Σ lượng × giá vốn NVL).
 */

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { Product } from "@/lib/types";
import type { ModifierGroup } from "@/lib/services/supabase/modifier-groups";

export interface SizeCol {
  /** key ổn định để gắn lượng theo cột (kể cả size chưa lưu DB) */
  key: string;
  name: string;
}

export interface RecipeRow {
  key: string;
  materialId: string;
  unit: string;
  /** id modifier group để scale (vd "Mức đường") — null = cố định */
  scaleTarget: string | null;
  /** sizeKey → lượng */
  qty: Record<string, number>;
}

let _k = 0;
export const newRecipeRow = (): RecipeRow => ({
  key: `rr${++_k}`,
  materialId: "",
  unit: "",
  scaleTarget: null,
  qty: {},
});

const FIXED = "__fixed__";
const fmtMoney = (n: number) => Math.round(n || 0).toLocaleString("vi-VN");

interface Props {
  sizes: SizeCol[];
  rows: RecipeRow[];
  onChange: (rows: RecipeRow[]) => void;
  materials: Product[];
  groups: ModifierGroup[];
  loading?: boolean;
}

export function PerSizeRecipeMatrix({
  sizes,
  rows,
  onChange,
  materials,
  groups,
  loading,
}: Props) {
  const fnbGroups = useMemo(
    () => groups.filter((g) => g.channel === "fnb"),
    [groups],
  );
  const matById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of materials) m.set(p.id, p);
    return m;
  }, [materials]);

  const patch = (key: string, p: Partial<RecipeRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setQty = (key: string, sk: string, val: number) =>
    onChange(
      rows.map((r) =>
        r.key === key ? { ...r, qty: { ...r.qty, [sk]: val } } : r,
      ),
    );
  const addRow = () => onChange([...rows, newRecipeRow()]);
  const removeRow = (key: string) => onChange(rows.filter((r) => r.key !== key));

  // Gợi ý: copy lượng size đầu sang các size khác còn trống.
  const copyFirst = () => {
    if (sizes.length < 2) return;
    const first = sizes[0].key;
    onChange(
      rows.map((r) => {
        const base = r.qty[first] ?? 0;
        if (base <= 0) return r;
        const nq = { ...r.qty };
        for (const s of sizes)
          if (s.key !== first && !(nq[s.key] > 0)) nq[s.key] = base;
        return { ...r, qty: nq };
      }),
    );
  };

  // Giá vốn tự tính theo từng size = Σ (giá vốn NVL × lượng).
  const costBySize = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of sizes) {
      let sum = 0;
      for (const r of rows) {
        if (!r.materialId) continue;
        const cost =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (matById.get(r.materialId) as any)?.costPrice ?? 0;
        sum += (cost || 0) * (r.qty[s.key] ?? 0);
      }
      out[s.key] = sum;
    }
    return out;
  }, [sizes, rows, matById]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!sizes.length) return w;
    const valid = rows.filter((r) => r.materialId);
    const emptySizes = sizes.filter(
      (s) => !valid.some((r) => (r.qty[s.key] ?? 0) > 0),
    );
    if (emptySizes.length)
      w.push(
        `${emptySizes
          .map((s) => s.name || "?")
          .join(", ")}: chưa nhập nguyên liệu — nhớ nhập đủ để bán cỡ này trừ kho đúng`,
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
  }, [rows, sizes]);

  if (sizes.filter((s) => s.name.trim()).length === 0) {
    return (
      <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm">
        Thêm ít nhất 1 cỡ (đặt tên ở phần trên) rồi nhập công thức cho từng cỡ.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={copyFirst}
          disabled={sizes.length < 2}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40 disabled:opacity-40"
        >
          <Icon name="auto_awesome" size={14} />
          Gợi ý: chép lượng cỡ {sizes[0]?.name || ""} sang các cỡ khác
        </button>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Icon name="add" size={14} className="mr-1" />
          Thêm nguyên liệu
        </Button>
      </div>

      <div className="max-h-[44vh] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-container-low text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left font-semibold min-w-[210px]">
                Nguyên liệu (mã · tên)
              </th>
              <th className="px-2 py-2 text-left font-semibold w-28">
                Theo tùy chọn
              </th>
              <th className="px-2 py-2 text-left font-semibold w-14">ĐVT</th>
              {sizes.map((s) => (
                <th
                  key={s.key}
                  className="px-2 py-2 text-center font-semibold w-24"
                >
                  {s.name || "—"}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              return (
                <tr key={row.key} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <Select
                      value={row.materialId || null}
                      onValueChange={(v) => {
                        const id = v ?? "";
                        const m = matById.get(id);
                        patch(row.key, {
                          materialId: id,
                          unit:
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (m as any)?.stockUnit ||
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (m as any)?.unit ||
                            row.unit,
                        });
                      }}
                      items={materials.map((m) => ({
                        value: m.id,
                        label: `${m.code} · ${m.name}`,
                      }))}
                    >
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue placeholder="— Tìm / chọn nguyên liệu —">
                          {(v) => {
                            const m = matById.get(v as string);
                            return m ? `${m.code} · ${m.name}` : "— Tìm / chọn nguyên liệu —";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {materials.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.code} · {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={row.scaleTarget ?? FIXED}
                      onValueChange={(v) =>
                        patch(row.key, {
                          scaleTarget: !v || v === FIXED ? null : v,
                        })
                      }
                      items={[
                        { value: FIXED, label: "Cố định" },
                        ...fnbGroups.map((g) => ({ value: g.id, label: g.name })),
                      ]}
                    >
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue placeholder="Cố định">
                          {(v) => {
                            if (!v || v === FIXED) return "Cố định";
                            const g = fnbGroups.find((x) => x.id === v);
                            return g ? g.name : "Cố định";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FIXED}>Cố định</SelectItem>
                        {fnbGroups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={row.unit}
                      onChange={(e) => patch(row.key, { unit: e.target.value })}
                      className="h-10 text-sm text-center px-1"
                      placeholder="ĐVT"
                    />
                  </td>
                  {sizes.map((s) => (
                    <td key={s.key} className="px-1 py-1.5">
                      <Input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={row.qty[s.key] ?? ""}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          setQty(row.key, s.key, Number.isFinite(n) ? n : 0);
                        }}
                        className="h-10 text-right text-sm"
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
                      <Icon name="delete" size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={sizes.length + 4}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Chưa có nguyên liệu — bấm “Thêm nguyên liệu”.
                </td>
              </tr>
            )}
          </tbody>
          {rows.some((r) => r.materialId) && (
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-container-low/60 text-xs">
                <td
                  colSpan={3}
                  className="px-2 py-2 text-right font-medium text-muted-foreground"
                >
                  Giá vốn / cỡ (tự tính)
                </td>
                {sizes.map((s) => (
                  <td
                    key={s.key}
                    className="px-2 py-2 text-center font-semibold tabular-nums"
                  >
                    {fmtMoney(costBySize[s.key] ?? 0)} đ
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
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

      <p className="text-xs text-muted-foreground leading-relaxed">
        <Icon name="info" size={13} className="inline-block mr-1 align-text-bottom" />
        Lượng nhập theo <b>đơn vị kho</b> của nguyên liệu (cột ĐVT tự hiện, sửa được).
        Cho phép số lẻ (vd 0,5). Với nguyên liệu đường, chọn “Theo tùy chọn = Mức đường”
        để khi khách chọn 70% thì tự trừ 70%.
        {loading ? " · Đang tải nguyên liệu…" : ""}
      </p>
    </div>
  );
}
