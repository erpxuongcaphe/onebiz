import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { InventoryCategory } from '../lib/inventory';

export type InventoryProductFormValue = {
  sku: string;
  name: string;
  categoryId: string;
  sellingPrice: string;
  minStockLevel: string;
  imageUrl: string;
  initialQuantity: string;
};

export type InventoryProductFormMode = 'create' | 'edit';

type Props = {
  mode: InventoryProductFormMode;
  categories: InventoryCategory[];
  initial: Partial<InventoryProductFormValue>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (value: InventoryProductFormValue) => void;
};

function safeNumberString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return '';
}

const InventoryProductForm: React.FC<Props> = ({
  mode,
  categories,
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}) => {
  const [sku, setSku] = useState(initial.sku ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [sellingPrice, setSellingPrice] = useState(safeNumberString(initial.sellingPrice));
  const [minStockLevel, setMinStockLevel] = useState(safeNumberString(initial.minStockLevel));
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? '');
  const [initialQuantity, setInitialQuantity] = useState(safeNumberString(initial.initialQuantity));

  useEffect(() => {
    setSku(initial.sku ?? '');
    setName(initial.name ?? '');
    setCategoryId(initial.categoryId ?? '');
    setSellingPrice(safeNumberString(initial.sellingPrice));
    setMinStockLevel(safeNumberString(initial.minStockLevel));
    setImageUrl(initial.imageUrl ?? '');
    setInitialQuantity(safeNumberString(initial.initialQuantity));
  }, [initial]);

  const categoryOptions = useMemo(() => categories ?? [], [categories]);

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">SKU</div>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            placeholder="FUR-001"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Danh mục</div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          >
            <option value="">Khác</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tên sản phẩm</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          placeholder="Ghế Công Thái Học"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Giá bán (VND)</div>
          <input
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            inputMode="numeric"
            placeholder="4500000"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tồn tối thiểu</div>
          <input
            value={minStockLevel}
            onChange={(e) => setMinStockLevel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            inputMode="numeric"
            placeholder="10"
          />
        </label>
      </div>

      {mode === 'create' && (
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tồn ban đầu (kho mặc định)</div>
          <input
            value={initialQuantity}
            onChange={(e) => setInitialQuantity(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            inputMode="numeric"
            placeholder="0"
          />
        </label>
      )}

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Ảnh (URL)</div>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          placeholder="https://..."
        />
      </label>

      <div className="pt-2 flex gap-2">
        <button
          onClick={() => {
            onSubmit({
              sku: sku.trim(),
              name: name.trim(),
              categoryId,
              sellingPrice: sellingPrice.trim(),
              minStockLevel: minStockLevel.trim(),
              imageUrl: imageUrl.trim(),
              initialQuantity: initialQuantity.trim(),
            });
          }}
          disabled={Boolean(busy)}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
};

export default InventoryProductForm;
