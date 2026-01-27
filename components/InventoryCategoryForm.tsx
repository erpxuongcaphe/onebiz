import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

type Props = {
  title: string;
  initial: { name: string; code: string };
  busy?: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (value: { name: string; code: string }) => void;
};

const InventoryCategoryForm: React.FC<Props> = ({ title, initial, busy, error, submitLabel, onSubmit }) => {
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);

  useEffect(() => {
    setName(initial.name);
    setCode(initial.code);
  }, [initial]);

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold text-slate-900 dark:text-white">{title}</div>
      {error && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tên danh mục</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          placeholder="Nội thất"
        />
      </label>

      <label className="block">
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Mã (tùy chọn)</div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono"
          placeholder="NOI-THAT"
        />
      </label>

      <button
        onClick={() => onSubmit({ name: name.trim(), code: code.trim() })}
        disabled={Boolean(busy)}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {submitLabel}
      </button>
    </div>
  );
};

export default InventoryCategoryForm;
