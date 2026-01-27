import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

type Props = {
  title: string;
  initial: { name: string; code: string; address: string };
  busy?: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (value: { name: string; code: string; address: string }) => void;
};

const InventoryWarehouseForm: React.FC<Props> = ({ title, initial, busy, error, submitLabel, onSubmit }) => {
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);
  const [address, setAddress] = useState(initial.address);

  useEffect(() => {
    setName(initial.name);
    setCode(initial.code);
    setAddress(initial.address);
  }, [initial]);

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold text-slate-900 dark:text-white">{title}</div>
      {error && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tên kho</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
            placeholder="Kho trung tâm"
          />
        </label>
        <label className="block">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Mã kho</div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono"
            placeholder="KHO-CT"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Địa chỉ (tùy chọn)</div>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          placeholder="TP. Ho Chi Minh"
        />
      </label>

      <button
        onClick={() => onSubmit({ name: name.trim(), code: code.trim(), address: address.trim() })}
        disabled={Boolean(busy)}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {submitLabel}
      </button>
    </div>
  );
};

export default InventoryWarehouseForm;
