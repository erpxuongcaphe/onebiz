import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Loader2, Save } from 'lucide-react';
import type { InventoryWarehouse } from '../lib/inventory';

type Props = {
  warehouses: InventoryWarehouse[];
  busy?: boolean;
  error?: string | null;
  onSubmit: (params: { warehouseId: string; quantityDelta: number; notes: string }) => void;
};

const InventoryAdjustStock: React.FC<Props> = ({ warehouses, busy, error, onSubmit }) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [delta, setDelta] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  const quantityDelta = Number.parseFloat(delta || '0');
  const isInbound = quantityDelta >= 0;

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Kho</div>
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Số lượng thay đổi</div>
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${isInbound ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400'}`}>
            {isInbound ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          </div>
          <input
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            inputMode="numeric"
            placeholder="VD: +10 hoặc -2"
          />
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
          Dương là nhập, âm là xuất/giảm.
        </div>
      </label>

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Ghi chú</div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          placeholder="VD: kiểm kho / hư hỏng / điều chỉnh"
        />
      </label>

      <button
        onClick={() => {
          onSubmit({
            warehouseId,
            quantityDelta: Number.isFinite(quantityDelta) ? quantityDelta : 0,
            notes: notes.trim(),
          });
        }}
        disabled={Boolean(busy)}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Lưu điều chỉnh
      </button>
    </div>
  );
};

export default InventoryAdjustStock;
