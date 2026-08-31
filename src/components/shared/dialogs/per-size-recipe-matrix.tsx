"use client";

/**
 * PerSizeRecipeMatrix — lưới "Công thức theo size" (FnB), CONTROLLED.
 * CEO 17/06/2026 (Phương án B): gộp vào tab Quy cách, lưu chung 1 lần.
 *
 * Cha truyền: danh sách size (cột) + rows (value) + materials + groups.
 * Component chỉ render + onChange; KHÔNG tự load/save (cha lo, để 1 nút Lưu).
 *
 * Hiển thị đầy đủ: mã SKU + tên NVL (ô tìm-kiếm), ĐVT theo NVL, lượng riêng
 * từng size (nhận số lẻ), và GIÁ VỐN F&B tự tính theo size
 * (tong luong x gia ban Retail cua thanh phan).
 */

import { useMemo, useState } from "react";
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
import type {
  ModifierGroup,
  ModifierOption,
} from "@/lib/services/supabase/modifier-groups";
import { formatNumber } from "@/lib/format";
import type { UOMConversion } from "@/lib/types";
import {
  getDirectConversionFactor,
  getDirectConvertibleUnits,
} from "@/lib/format-uom";

export interface SizeCol {
  /** key ổn định để gắn lượng theo cột (kể cả size chưa lưu DB) */
  key: string;
  name: string;
}

export interface RecipeRow {
  key: string;
  materialId: string;
  unit: string;
  /** id nhóm lựa chọn có định lượng riêng (vd "Mức đường") — null = cố định */
  scaleTarget: string | null;
  /** sizeKey → lượng cố định, hoặc lượng của lựa chọn mặc định khi có target */
  qty: Record<string, number>;
  /** sizeKey → modifier option id → lượng pha chế đã cân thực tế. */
  exactQty: Record<string, Record<string, number>>;
}

let _k = 0;
export const newRecipeRow = (): RecipeRow => ({
  key: `rr${++_k}`,
  materialId: "",
  unit: "",
  scaleTarget: null,
  qty: {},
  exactQty: {},
});

const FIXED = "__fixed__";
const fmtMoney = (n: number) => formatNumber(Math.round(n || 0));

interface Props {
  sizes: SizeCol[];
  rows: RecipeRow[];
  onChange: (rows: RecipeRow[]) => void;
  materials: Product[];
  groups: ModifierGroup[];
  optionsByGroup: Record<string, ModifierOption[]>;
  conversionsByMaterial: Record<string, UOMConversion[]>;
  loading?: boolean;
}

export function getRecipeDefaultOption(
  row: RecipeRow,
  optionsByGroup: Record<string, ModifierOption[]>,
): ModifierOption | null {
  if (!row.scaleTarget) return null;
  const defaults = (optionsByGroup[row.scaleTarget] ?? []).filter(
    (option) => option.isDefault,
  );
  return defaults.length === 1 ? defaults[0] : null;
}

export function getRecipeQuantityForSize(
  row: RecipeRow,
  sizeKey: string,
  optionsByGroup: Record<string, ModifierOption[]>,
): number {
  if (!row.scaleTarget) return row.qty[sizeKey] ?? 0;
  const defaultOption = getRecipeDefaultOption(row, optionsByGroup);
  return defaultOption
    ? row.exactQty[sizeKey]?.[defaultOption.id] ?? 0
    : 0;
}

export function calculateRecipeCostBySize(
  sizes: SizeCol[],
  rows: RecipeRow[],
  materials: Product[],
  optionsByGroup: Record<string, ModifierOption[]>,
  conversionsByMaterial: Record<string, UOMConversion[]>,
): Record<string, number> {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  return Object.fromEntries(
    sizes.map((size) => {
      const cost = rows.reduce((sum, row) => {
        const material = materialById.get(row.materialId);
        if (!material) return sum;
        const stockUnit = material.stockUnit || material.unit || "";
        const factor = getDirectConversionFactor(
          stockUnit,
          row.unit,
          conversionsByMaterial[row.materialId] ?? [],
        );
        if (factor == null) return sum;
        return (
          sum +
          (material.sellPrice || 0) *
            getRecipeQuantityForSize(row, size.key, optionsByGroup) *
            factor
        );
      }, 0);
      return [size.key, cost];
    }),
  );
}

function MaterialSearchCell({
  value,
  materials,
  onSelect,
}: {
  value: string;
  materials: Product[];
  onSelect: (product: Product) => void;
}) {
  const selected = materials.find((product) => product.id === value);
  const [query, setQuery] = useState(selected ? `${selected.code} · ${selected.name}` : "");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return materials
      .filter(
        (product) =>
          !normalized ||
          product.code.toLocaleLowerCase("vi").includes(normalized) ||
          product.name.toLocaleLowerCase("vi").includes(normalized),
      )
      .slice(0, 40);
  }, [materials, query]);

  return (
    <div className="min-w-[230px]">
      {selected && !open ? (
        <button
          type="button"
          title={`${selected.code} · ${selected.name}`}
          aria-label={`Đổi nguyên liệu ${selected.code} · ${selected.name}`}
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
          className="flex min-h-10 w-full flex-col justify-center rounded-md border border-input bg-transparent px-3 py-1.5 text-left hover:bg-muted/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="whitespace-normal break-words text-sm font-medium leading-tight">
            {selected.name}
          </span>
          <span className="mt-0.5 text-xs text-muted-foreground">
            {selected.code} · {selected.stockUnit || selected.unit || "Chưa có ĐVT"}
          </span>
        </button>
      ) : (
        <Input
          autoFocus={Boolean(selected)}
          value={query}
          onFocus={() => {
            setOpen(true);
            if (selected && query) setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              onSelect(results[0]);
              setOpen(false);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder="Nhập mã hoặc tên nguyên liệu..."
          className="h-10"
        />
      )}
      {open && (
        <div className="mt-1 max-h-48 min-w-[280px] overflow-y-auto rounded-md border bg-popover shadow-sm">
          {results.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">Không tìm thấy nguyên liệu.</p>
          ) : (
            results.map((product) => (
              <button
                key={product.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(product);
                  setOpen(false);
                }}
                className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
              >
                <span className="block truncate text-sm font-medium">{product.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {product.code} · {product.stockUnit || product.unit || "Chưa có ĐVT"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function PerSizeRecipeMatrix({
  sizes,
  rows,
  onChange,
  materials,
  groups,
  optionsByGroup,
  conversionsByMaterial,
  loading,
}: Props) {
  const fnbGroups = useMemo(
    () => groups.filter((g) => g.channel === "fnb" || g.channel === "all"),
    [groups],
  );
  const matById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of materials) m.set(p.id, p);
    return m;
  }, [materials]);

  const patch = (key: string, p: Partial<RecipeRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setScaleTarget = (key: string, scaleTarget: string | null) =>
    onChange(
      rows.map((row) =>
        row.key === key
          ? {
              ...row,
              scaleTarget,
              // Exact values belong to one group only. Clearing them prevents
              // an accidental reuse after an operator switches to another group.
              exactQty: row.scaleTarget === scaleTarget ? row.exactQty : {},
            }
          : row,
      ),
    );
  const setQty = (key: string, sk: string, val: number) =>
    onChange(
      rows.map((r) =>
        r.key === key ? { ...r, qty: { ...r.qty, [sk]: val } } : r,
      ),
    );
  const setExactQty = (
    key: string,
    sizeKey: string,
    optionId: string,
    value: number,
  ) =>
    onChange(
      rows.map((row) =>
        row.key === key
          ? {
              ...row,
              exactQty: {
                ...row.exactQty,
                [sizeKey]: {
                  ...(row.exactQty[sizeKey] ?? {}),
                  [optionId]: value,
                },
              },
            }
          : row,
      ),
    );
  const addRow = () => onChange([...rows, newRecipeRow()]);
  const removeRow = (key: string) => onChange(rows.filter((r) => r.key !== key));

  const getGroupOptions = (groupId: string | null) =>
    groupId ? optionsByGroup[groupId] ?? [] : [];
  const getDefaultOption = (row: RecipeRow) =>
    getRecipeDefaultOption(row, optionsByGroup);
  const getQuantityForSize = (row: RecipeRow, sizeKey: string) =>
    getRecipeQuantityForSize(row, sizeKey, optionsByGroup);

  // Gợi ý: copy lượng size đầu sang các size khác còn trống.
  const copyFirst = () => {
    if (sizes.length < 2) return;
    const first = sizes[0].key;
    onChange(
      rows.map((r) => {
        if (r.scaleTarget) {
          const source = r.exactQty[first] ?? {};
          if (Object.keys(source).length === 0) return r;
          const nextExactQty = { ...r.exactQty };
          for (const size of sizes) {
            if (size.key === first) continue;
            const current = { ...(nextExactQty[size.key] ?? {}) };
            for (const [optionId, quantity] of Object.entries(source)) {
              if (!(current[optionId] >= 0)) current[optionId] = quantity;
            }
            nextExactQty[size.key] = current;
          }
          return { ...r, exactQty: nextExactQty };
        }
        const base = r.qty[first] ?? 0;
        if (base <= 0) return r;
        const nq = { ...r.qty };
        for (const s of sizes)
          if (s.key !== first && !(nq[s.key] > 0)) nq[s.key] = base;
        return { ...r, qty: nq };
      }),
    );
  };

  // Cost is normalized to the material stock unit before multiplication.
  // Example: 16 G × 0.001 Kg/G × cost/Kg, never 16 × cost/Kg.
  const costBySize = useMemo(() => {
    return calculateRecipeCostBySize(
      sizes,
      rows,
      materials,
      optionsByGroup,
      conversionsByMaterial,
    );
  }, [sizes, rows, materials, optionsByGroup, conversionsByMaterial]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!sizes.length) return w;
    const valid = rows.filter((r) => r.materialId);
    const emptySizes = sizes.filter(
      (s) =>
        !valid.some(
          (r) => getRecipeQuantityForSize(r, s.key, optionsByGroup) > 0,
        ),
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

      const material = matById.get(r.materialId);
      if (material) {
        const stockUnit = material.stockUnit || material.unit || "";
        if (
          getDirectConversionFactor(
            stockUnit,
            r.unit,
            conversionsByMaterial[r.materialId] ?? [],
          ) == null
        ) {
          w.push(
            `${material.name}: chưa có quy đổi từ ${r.unit || "ĐVT pha chế"} sang ${stockUnit || "ĐVT tồn"}`,
          );
        }
      }
    }
    return w;
  }, [rows, sizes, optionsByGroup, matById, conversionsByMaterial]);

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
              const material = matById.get(row.materialId);
              const stockUnit = material?.stockUnit || material?.unit || "";
              const unitOptions = getDirectConvertibleUnits(
                stockUnit,
                conversionsByMaterial[row.materialId] ?? [],
              );
              return (
                <tr key={row.key} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <MaterialSearchCell
                      value={row.materialId}
                      materials={materials.filter(
                        (material) =>
                          material.id === row.materialId ||
                          !rows.some((other) => other.key !== row.key && other.materialId === material.id),
                      )}
                      onSelect={(material) =>
                        patch(row.key, {
                          materialId: material.id,
                          unit: material.stockUnit || material.unit || row.unit,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={row.scaleTarget ?? FIXED}
                      onValueChange={(v) =>
                        setScaleTarget(
                          row.key,
                          !v || v === FIXED ? null : v,
                        )
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
                    <Select
                      value={row.unit}
                      onValueChange={(unit) => {
                        if (unit) patch(row.key, { unit });
                      }}
                      items={unitOptions.map((unit) => ({ value: unit, label: unit }))}
                      disabled={!row.materialId || unitOptions.length === 0}
                    >
                      <SelectTrigger className="h-10 min-w-20">
                        <SelectValue placeholder="ĐVT" />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  {sizes.map((s) => (
                    <td key={s.key} className="px-1 py-1.5">
                      {row.scaleTarget ? (
                        <div className="min-h-10 rounded-md border bg-muted/30 px-2 py-1.5 text-right text-xs tabular-nums">
                          {getDefaultOption(row)
                            ? `${formatNumber(getQuantityForSize(row, s.key))} ${row.unit || ""}`
                            : "Chọn nhóm có mặc định"}
                        </div>
                      ) : (
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
                      )}
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
                  Giá vốn F&B / cỡ (theo giá bán Retail)
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

      {rows
        .filter((row) => row.materialId && row.scaleTarget)
        .map((row) => {
          const material = matById.get(row.materialId);
          const group = fnbGroups.find((candidate) => candidate.id === row.scaleTarget);
          const options = getGroupOptions(row.scaleTarget);
          const defaultCount = options.filter((option) => option.isDefault).length;
          const missingExactCount = sizes.reduce(
            (count, size) =>
              count +
              options.filter(
                (option) => row.exactQty[size.key]?.[option.id] === undefined,
              ).length,
            0,
          );
          return (
            <section key={`${row.key}-exact`} className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b bg-muted/25 px-3 py-2">
                <p className="text-sm font-medium">
                  Định lượng riêng: {material?.name || "Nguyên liệu"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Nhập số đã cân cho từng cỡ và từng mức {group?.name || "lựa chọn"}.
                  Lượng mặc định hiển thị ở bảng công thức và dùng làm giá vốn cơ sở.
                </p>
              </div>
              {options.length === 0 ? (
                <p className="px-3 py-3 text-xs text-destructive">
                  Nhóm này chưa có lựa chọn đang bật hoặc chưa được áp dụng cho món.
                </p>
              ) : defaultCount !== 1 ? (
                <div className="px-3 py-3 text-xs text-destructive">
                  Nhóm {group?.name || "lựa chọn"} đang có {defaultCount} lựa chọn mặc định.
                  Vào Danh mục → Tùy chọn món FnB và chỉ giữ đúng một mặc định rồi quay lại lưu món.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low text-xs text-muted-foreground">
                      <tr>
                        <th className="min-w-28 px-3 py-2 text-left font-semibold">Lựa chọn</th>
                        {sizes.map((size) => (
                          <th key={size.key} className="min-w-32 px-2 py-2 text-left font-semibold">
                            {size.name || "—"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {options.map((option) => (
                        <tr key={option.id} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {option.label}
                            {option.isDefault && (
                              <span className="ml-1.5 text-xs font-normal text-primary">mặc định</span>
                            )}
                          </td>
                          {sizes.map((size) => (
                            <td key={size.key} className="px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  inputMode="decimal"
                                  value={row.exactQty[size.key]?.[option.id] ?? ""}
                                  onChange={(event) => {
                                    const quantity = parseFloat(event.target.value);
                                    setExactQty(
                                      row.key,
                                      size.key,
                                      option.id,
                                      Number.isFinite(quantity) ? quantity : 0,
                                    );
                                  }}
                                  className="h-9 min-w-0 text-right text-sm"
                                  aria-label={`${material?.name || "Nguyên liệu"} ${option.label} cỡ ${size.name}`}
                                />
                                <span className="shrink-0 text-xs text-muted-foreground">{row.unit}</span>
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {missingExactCount > 0 && (
                    <div className="flex items-start gap-1.5 border-t border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
                      <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
                      <span>
                        Còn {missingExactCount} ô chưa nhập. Nhập 0 nếu mức đó không dùng nguyên liệu.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

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
        Lượng cố định hoặc lượng đã cân theo từng lựa chọn đều nhập bằng <b>đơn vị pha chế</b>.
        Hệ thống tự quy đổi về đơn vị tồn khi tính giá vốn, trừ kho và hoàn kho.
        Với đường/syrup, chọn nhóm ở cột “Theo tùy chọn” rồi nhập từng mức ngay bên dưới.
        {loading ? " · Đang tải nguyên liệu…" : ""}
      </p>
    </div>
  );
}
