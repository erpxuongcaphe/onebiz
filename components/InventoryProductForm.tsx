import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { InventoryCategory, InventoryUnit } from '../lib/inventory';

export type InventoryProductFormValue = {
  sku: string;
  barcode: string;
  name: string;
  categoryId: string;
  unitId: string;
  costPrice: string;
  sellingPrice: string;
  minStockLevel: string;
  imageUrl: string;
  initialQuantity: string;
  type: 'product' | 'material';
};

export type InventoryProductFormMode = 'create' | 'edit';

type Props = {
  mode: InventoryProductFormMode;
  categories: InventoryCategory[];
  units: InventoryUnit[];
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
  units,
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}) => {
  const [sku, setSku] = useState(initial.sku ?? '');
  const [barcode, setBarcode] = useState(initial.barcode ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [unitId, setUnitId] = useState(initial.unitId ?? '');
  const [costPrice, setCostPrice] = useState(safeNumberString(initial.costPrice));
  const [sellingPrice, setSellingPrice] = useState(safeNumberString(initial.sellingPrice));
  const [minStockLevel, setMinStockLevel] = useState(safeNumberString(initial.minStockLevel));
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? '');
  const [initialQuantity, setInitialQuantity] = useState(safeNumberString(initial.initialQuantity));
  const [type, setType] = useState<'product' | 'material'>(initial.type ?? 'product');

  useEffect(() => {
    setSku(initial.sku ?? '');
    setBarcode(initial.barcode ?? '');
    setName(initial.name ?? '');
    setCategoryId(initial.categoryId ?? '');
    setUnitId(initial.unitId ?? '');
    setCostPrice(safeNumberString(initial.costPrice));
    setSellingPrice(safeNumberString(initial.sellingPrice));
    setMinStockLevel(safeNumberString(initial.minStockLevel));
    setImageUrl(initial.imageUrl ?? '');
    setInitialQuantity(safeNumberString(initial.initialQuantity));
    setType(initial.type ?? 'product');
  }, [initial]);

  const categoryOptions = useMemo(() => categories ?? [], [categories]);
  const unitOptions = useMemo(() => units ?? [], [units]);

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="productType"
            checked={type === 'product'}
            onChange={() => setType('product')}
            className="text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Thành phẩm (Bán)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="productType"
            checked={type === 'material'}
            onChange={() => setType('material')}
            className="text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nguyên liệu (Pha chế)</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Mã SKU</div>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            placeholder="FUR-001"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Mã vạch (Barcode)</div>
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            placeholder="893..."
            autoComplete="off"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tên sản phẩm</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          placeholder="Ví dụ: Cà phê sữa đá"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Danh mục</div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          >
            <option value="">-- Chọn danh mục --</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Đơn vị tính</div>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          >
            <option value="">-- Chọn đơn vị --</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Giá vốn (Cost)</div>
          <input
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            inputMode="numeric"
            placeholder="0"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Giá bán (Selling)</div>
          <input
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            inputMode="numeric"
            placeholder="0"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

        {mode === 'create' && (
          <label className="block">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tồn ban đầu</div>
            <input
              value={initialQuantity}
              onChange={(e) => setInitialQuantity(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
              inputMode="numeric"
              placeholder="0"
            />
          </label>
        )}
      </div>

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
              barcode: barcode.trim(),
              name: name.trim(),
              categoryId,
              unitId,
              costPrice: costPrice.trim(),
              sellingPrice: sellingPrice.trim(),
              minStockLevel: minStockLevel.trim(),
              imageUrl: imageUrl.trim(),
              initialQuantity: initialQuantity.trim(),
              type,
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
