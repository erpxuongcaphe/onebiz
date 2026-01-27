import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, Pencil, ArchiveRestore } from 'lucide-react';
import Drawer from './Drawer';
import type { InventoryCategory, InventoryWarehouse } from '../lib/inventory';
import {
  archiveInventoryWarehouse,
  createInventoryCategory,
  createInventoryWarehouse,
  deleteInventoryCategory,
  deleteInventoryWarehouse,
  restoreInventoryWarehouse,
  updateInventoryCategory,
  updateInventoryWarehouse,
} from '../lib/inventory';
import InventoryCategoryForm from './InventoryCategoryForm';
import InventoryWarehouseForm from './InventoryWarehouseForm';
import { useAuth } from '../lib/auth';

type Props = {
  categories: InventoryCategory[];
  warehouses: InventoryWarehouse[];
  onReload: () => Promise<void>;
};

type Mode = 'categories' | 'warehouses';

const InventoryMasterData: React.FC<Props> = ({ categories, warehouses, onReload }) => {
  const { can } = useAuth();
  const [mode, setMode] = useState<Mode>('categories');
  const [q, setQ] = useState('');
  const [timePreset, setTimePreset] = useState<'today' | 'month' | 'year' | 'range' | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [includeInactiveWh, setIncludeInactiveWh] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKind, setDrawerKind] = useState<'catCreate' | 'catEdit' | 'whCreate' | 'whEdit'>('catCreate');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCat, setSelectedCat] = useState<InventoryCategory | null>(null);
  const [selectedWh, setSelectedWh] = useState<InventoryWarehouse | null>(null);

  const computeDatesForPreset = (preset: typeof timePreset) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    if (preset === 'today') return { from: `${yyyy}-${mm}-${dd}`, to: `${yyyy}-${mm}-${dd}` };
    if (preset === 'month') return { from: `${yyyy}-${mm}-01`, to: `${yyyy}-${mm}-${dd}` };
    if (preset === 'year') return { from: `${yyyy}-01-01`, to: `${yyyy}-${mm}-${dd}` };
    return { from: '', to: '' };
  };

  useEffect(() => {
    if (timePreset === 'range') return;
    if (timePreset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    const d = computeDatesForPreset(timePreset);
    setFromDate(d.from);
    setToDate(d.to);
  }, [timePreset]);

  const withinRange = (iso?: string) => {
    if (!iso) return true;
    const d = iso.slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  };

  const filteredCats = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (categories ?? []).filter((c) => {
      if (!withinRange(c.created_at)) return false;
      if (!t) return true;
      return (c.name ?? '').toLowerCase().includes(t) || String(c.code ?? '').toLowerCase().includes(t);
    });
  }, [categories, q, fromDate, toDate]);

  const filteredWh = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (warehouses ?? []).filter((w) => {
      if (!includeInactiveWh && (w.status ?? 'active') === 'inactive') return false;
      if (!withinRange(w.created_at)) return false;
      if (!t) return true;
      return (w.name ?? '').toLowerCase().includes(t) || String(w.code ?? '').toLowerCase().includes(t);
    });
  }, [warehouses, q, fromDate, toDate, includeInactiveWh]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row gap-2 justify-between items-start lg:items-center">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <button
              onClick={() => setMode('categories')}
              className={`px-3 py-1.5 text-[11px] font-bold ${mode === 'categories' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}
            >
              Danh mục
            </button>
            <button
              onClick={() => setMode('warehouses')}
              className={`px-3 py-1.5 text-[11px] font-bold ${mode === 'warehouses' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}
            >
              Kho
            </button>
          </div>

          {mode === 'warehouses' && (
            <button
              onClick={() => setIncludeInactiveWh((v) => !v)}
              className={`px-3 py-1.5 border rounded-lg text-[11px] font-semibold transition-colors ${includeInactiveWh ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              {includeInactiveWh ? 'Đang hiện đã ẩn' : 'Hiện đã ẩn'}
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all placeholder:text-slate-400"
              placeholder="Tìm theo tên/mã..."
            />
          </div>

          <div className="flex gap-2">
            <select
              value={timePreset}
              onChange={(e) => setTimePreset(e.target.value as any)}
              className="px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
              title="Lọc theo thời gian"
            >
              <option value="all">Tất cả</option>
              <option value="today">Hôm nay</option>
              <option value="month">Tháng này</option>
              <option value="year">Năm nay</option>
              <option value="range">Khoảng</option>
            </select>

            {timePreset === 'range' && (
              <>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
                  title="Từ ngày"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
                  title="Đến ngày"
                />
              </>
            )}
          </div>

          <button
            onClick={() => {
              setError(null);
              if (mode === 'categories') {
                setSelectedCat(null);
                setDrawerKind('catCreate');
              } else {
                setSelectedWh(null);
                setDrawerKind('whCreate');
              }
              setDrawerOpen(true);
            }}
            disabled={mode === 'categories' ? !can('inventory.category.create') : !can('inventory.warehouse.create')}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm mới
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {mode === 'categories' ? (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 text-[10px] lg:text-[11px]">
              <tr>
                <th className="px-2 py-2">Tên</th>
                <th className="px-2 py-2">Mã</th>
                <th className="px-2 py-2 hidden sm:table-cell">Ngày tạo</th>
                <th className="px-2 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCats.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-200">{c.name}</td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-400 font-mono text-[10px] lg:text-[11px]">{c.code ?? '-'}</td>
                  <td className="px-2 py-2 hidden sm:table-cell text-slate-600 dark:text-slate-400 text-[11px] tabular-nums">{c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '-'}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => {
                        setSelectedCat(c);
                        setError(null);
                        setDrawerKind('catEdit');
                        setDrawerOpen(true);
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                      title="Sửa"
                      disabled={!can('inventory.category.update')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        const ok = window.confirm(`Xóa danh mục: ${c.name}?`);
                        if (!ok) return;
                        setBusy(true);
                        setError(null);
                        try {
                          const res = await deleteInventoryCategory(c.id);
                          if (!res.data) {
                            setError(res.error ?? 'Không xóa được.');
                            return;
                          }
                          await onReload();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                      title="Xóa"
                      style={!can('inventory.category.delete') ? { display: 'none' } : undefined}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 text-[10px] lg:text-[11px]">
              <tr>
                <th className="px-2 py-2">Kho</th>
                <th className="px-2 py-2">Mã</th>
                <th className="px-2 py-2 hidden md:table-cell">Địa chỉ</th>
                <th className="px-2 py-2 hidden sm:table-cell">Trạng thái</th>
                <th className="px-2 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredWh.map((w) => {
                const inactive = (w.status ?? 'active') === 'inactive';
                return (
                  <tr key={w.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${inactive ? 'opacity-60' : ''}`}>
                    <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-200">{w.name}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400 font-mono text-[10px] lg:text-[11px]">{w.code}</td>
                    <td className="px-2 py-2 hidden md:table-cell text-slate-600 dark:text-slate-400 text-[11px]">{w.address ?? '-'}</td>
                    <td className="px-2 py-2 hidden sm:table-cell">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ring-1 ring-inset ${inactive ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-300/40 dark:ring-slate-700/60' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-emerald-600/20'}`}>
                        {inactive ? 'Đã ẩn' : 'Hoạt động'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                      onClick={() => {
                          setSelectedWh(w);
                          setError(null);
                          setDrawerKind('whEdit');
                          setDrawerOpen(true);
                        }}
                        disabled={!can('inventory.warehouse.update')}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        title="Sửa"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>

                      <button
                      onClick={async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const res = inactive ? await restoreInventoryWarehouse(w.id) : await archiveInventoryWarehouse(w.id);
                            if (!res.data) {
                              setError(res.error ?? 'Không cập nhật được.');
                              return;
                            }
                            await onReload();
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy || !can('inventory.warehouse.update')}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        title={inactive ? 'Khôi phục' : 'Ẩn'}
                      >
                        <ArchiveRestore className="w-4 h-4" />
                      </button>

                      <button
                      onClick={async () => {
                          const ok = window.confirm(`Xóa kho vĩnh viễn: ${w.name}?\n\nLưu ý: nếu kho có tồn hoặc lịch sử phát sinh, có thể không xóa được.`);
                          if (!ok) return;
                          setBusy(true);
                          setError(null);
                          try {
                            const res = await deleteInventoryWarehouse(w.id);
                            if (!res.data) {
                              setError(res.error ?? 'Không xóa được.');
                              return;
                            }
                            await onReload();
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy || !can('inventory.warehouse.delete.hard')}
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                        title="Xóa vĩnh viễn"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        isOpen={drawerOpen}
        onClose={() => {
          if (busy) return;
          setDrawerOpen(false);
        }}
        title={mode === 'categories' ? 'Danh mục' : 'Kho'}
      >
        {drawerKind === 'catCreate' && (
          <InventoryCategoryForm
            title="Thêm danh mục"
            initial={{ name: '', code: '' }}
            busy={busy}
            error={error}
            submitLabel="Tạo danh mục"
            onSubmit={async ({ name, code }) => {
              setError(null);
              if (!name) {
                setError('Vui lòng nhập tên danh mục.');
                return;
              }
              setBusy(true);
              try {
                const res = await createInventoryCategory({ name, code: code || null });
                if (!res.data) {
                  setError(res.error ?? 'Không tạo được.');
                  return;
                }
                await onReload();
                setDrawerOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {drawerKind === 'catEdit' && selectedCat && (
          <InventoryCategoryForm
            title="Sửa danh mục"
            initial={{ name: selectedCat.name ?? '', code: String(selectedCat.code ?? '') }}
            busy={busy}
            error={error}
            submitLabel="Lưu"
            onSubmit={async ({ name, code }) => {
              setError(null);
              if (!name) {
                setError('Vui lòng nhập tên danh mục.');
                return;
              }
              setBusy(true);
              try {
                const res = await updateInventoryCategory(selectedCat.id, { name, code: code || null });
                if (!res.data) {
                  setError(res.error ?? 'Không lưu được.');
                  return;
                }
                await onReload();
                setDrawerOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {drawerKind === 'whCreate' && (
          <InventoryWarehouseForm
            title="Thêm kho"
            initial={{ name: '', code: '', address: '' }}
            busy={busy}
            error={error}
            submitLabel="Tạo kho"
            onSubmit={async ({ name, code, address }) => {
              setError(null);
              if (!name || !code) {
                setError('Vui lòng nhập tên kho và mã kho.');
                return;
              }
              setBusy(true);
              try {
                const res = await createInventoryWarehouse({ name, code, address: address || null });
                if (!res.data) {
                  setError(res.error ?? 'Không tạo được.');
                  return;
                }
                await onReload();
                setDrawerOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {drawerKind === 'whEdit' && selectedWh && (
          <InventoryWarehouseForm
            title="Sửa kho"
            initial={{ name: selectedWh.name ?? '', code: selectedWh.code ?? '', address: String(selectedWh.address ?? '') }}
            busy={busy}
            error={error}
            submitLabel="Lưu"
            onSubmit={async ({ name, code, address }) => {
              setError(null);
              if (!name || !code) {
                setError('Vui lòng nhập tên kho và mã kho.');
                return;
              }
              setBusy(true);
              try {
                const res = await updateInventoryWarehouse(selectedWh.id, { name, code, address: address || null });
                if (!res.data) {
                  setError(res.error ?? 'Không lưu được.');
                  return;
                }
                await onReload();
                setDrawerOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </Drawer>
    </div>
  );
};

export default InventoryMasterData;
