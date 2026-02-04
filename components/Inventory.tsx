import React, { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Plus, MoreHorizontal, AlertCircle, LayoutList, AlignJustify, Pencil, Boxes } from 'lucide-react';
import { formatCurrency } from '../constants';
import { Product, ViewMode } from '../types';
import Drawer from './Drawer';
import {
  archiveInventoryProduct,
  applyStockMovement,
  createInventoryProduct,
  ensureDefaultWarehouse,
  fetchInventoryCategories,
  fetchInventoryMovements,
  fetchInventoryProducts,
  fetchInventoryUnits,
  fetchInventoryWarehouses,
  restoreInventoryProduct,
  deleteInventoryProductPermanently,
  updateInventoryProduct,
  type InventoryCategory,
  type InventoryMovement,
  type InventoryWarehouse,
  type InventoryUnit,
} from '../lib/inventory';
import InventoryProductForm from './InventoryProductForm';
import InventoryAdjustStock from './InventoryAdjustStock';
import InventoryMasterData from './InventoryMasterData';
import InventoryDocuments from './InventoryDocuments';
import { useAuth } from '../lib/auth';

const Inventory: React.FC = () => {
  const { can } = useAuth();
  const [section, setSection] = useState<'products' | 'master' | 'documents'>('products');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([]);
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [timePreset, setTimePreset] = useState<'today' | 'month' | 'year' | 'range' | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);

  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const computeDatesForPreset = (preset: typeof timePreset) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    if (preset === 'today') {
      return { from: `${yyyy}-${mm}-${dd}`, to: `${yyyy}-${mm}-${dd}` };
    }
    if (preset === 'month') {
      const from = `${yyyy}-${mm}-01`;
      return { from, to: `${yyyy}-${mm}-${dd}` };
    }
    if (preset === 'year') {
      const from = `${yyyy}-01-01`;
      return { from, to: `${yyyy}-${mm}-${dd}` };
    }
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

  // Static data — fetch once on mount (categories, warehouses, units don't change with filters)
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      fetchInventoryCategories(),
      fetchInventoryWarehouses(),
      fetchInventoryUnits(),
    ]).then(([c, w, u]) => {
      if (!isMounted) return;
      setCategories(c);
      setWarehouses(w);
      setUnits(u);
    });
    return () => { isMounted = false; };
  }, []);

  // Dynamic data — refetch products when filters change
  useEffect(() => {
    let isMounted = true;
    fetchInventoryProducts({ includeInactive, fromDate, toDate, categoryId: categoryFilter || undefined })
      .then((p) => { if (isMounted) setProducts(p); });
    return () => { isMounted = false; };
  }, [includeInactive, fromDate, toDate, categoryFilter]);

  const reload = async () => {
    const p = await fetchInventoryProducts({ includeInactive, fromDate, toDate, categoryId: categoryFilter || undefined });
    setProducts(p);
  };

  useEffect(() => {
    if (!selectedProduct) {
      setMovements([]);
      return;
    }
    let isMounted = true;
    fetchInventoryMovements(selectedProduct.id).then((m) => {
      if (!isMounted) return;
      setMovements(m);
    });
    return () => {
      isMounted = false;
    };
  }, [selectedProduct]);

  const list = products ?? [];
  const filteredProducts = list.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categoryIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.name, c.id);
    return map;
  }, [categories]);

  const getStatusColor = (status: Product['status']) => {
    switch (status) {
      case 'In Stock': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-emerald-600/20';
      case 'Low Stock': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 ring-amber-600/20';
      case 'Out of Stock': return 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 ring-rose-600/20';
      default: return 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300';
    }
  };

  // Ultra compact padding matched to Dashboard
  const tablePadding = viewMode === 'comfort' ? 'px-4 py-3' : 'px-2 py-2 text-[11px] lg:text-xs';
  const tableHeadSize = viewMode === 'comfort' ? 'text-xs lg:text-sm' : 'text-[10px] lg:text-[11px]';
  const imgSize = viewMode === 'comfort' ? 'w-10 h-10' : 'w-7 h-7';

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Kho hàng</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Quản lý sản phẩm & tồn kho.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 flex">
            <button
              onClick={() => setSection('products')}
              className={`px-3 py-1.5 rounded-md transition-all text-[11px] font-bold ${section === 'products' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              title="Sản phẩm"
            >
              Sản phẩm
            </button>
            <button
              onClick={() => setSection('master')}
              className={`px-3 py-1.5 rounded-md transition-all text-[11px] font-bold ${section === 'master' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              title="Kho & Danh mục"
            >
              Kho & Danh mục
            </button>
            <button
              onClick={() => setSection('documents')}
              className={`px-3 py-1.5 rounded-md transition-all text-[11px] font-bold ${section === 'documents' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              title="Phiếu kho"
            >
              Phiếu kho
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 flex">
            <button
              onClick={() => setViewMode('comfort')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'comfort' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              title="Chế độ Thoáng"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('compact')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'compact' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              title="Chế độ Excel"
            >
              <AlignJustify className="w-4 h-4" />
            </button>
          </div>
          {section === 'products' && can('inventory.product.create') && (
            <button
              onClick={() => {
                setFormError(null);
                setIsCreateOpen(true);
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm shadow-indigo-200 dark:shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Thêm mới</span>
              <span className="sm:hidden">Thêm</span>
            </button>
          )}
        </div>
      </div>

      {section === 'master' ? (
        <InventoryMasterData categories={categories} warehouses={warehouses} units={units} onReload={reload} />
      ) : section === 'documents' ? (
        <InventoryDocuments />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
          {/* Compact Filters */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2 justify-between items-center bg-white dark:bg-slate-900">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm SKU, tên sản phẩm..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all placeholder:text-slate-400"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
              <button className="whitespace-nowrap flex items-center justify-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                <Filter className="w-3 h-3" />
                Lọc
              </button>

              <select
                value={timePreset}
                onChange={(e) => setTimePreset(e.target.value as any)}
                className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
                title="Lọc theo thời gian"
              >
                <option value="all">Tất cả thời gian</option>
                <option value="today">Hôm nay</option>
                <option value="month">Tháng này</option>
                <option value="year">Năm nay</option>
                <option value="range">Khoảng</option>
              </select>

              {timePreset === 'range' && (
                <div className="flex items-center gap-2">
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
                </div>
              )}

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
                title="Lọc theo danh mục"
              >
                <option value="">Tất cả danh mục</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setIncludeInactive((v) => !v)}
                className={`whitespace-nowrap px-3 py-1.5 border rounded-lg text-[11px] font-semibold transition-colors ${includeInactive ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                title="Hiện sản phẩm đã ẩn"
              >
                {includeInactive ? 'Đang hiện đã ẩn' : 'Hiện đã ẩn'}
              </button>
              <button className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Xuất Excel
              </button>
            </div>
          </div>

          {/* Table - Responsive Columns */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className={`bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 ${tableHeadSize}`}>
                <tr>
                  <th className={tablePadding}>Sản phẩm</th>
                  <th className={`${tablePadding} hidden sm:table-cell`}>SKU</th>
                  <th className={`${tablePadding} hidden md:table-cell`}>Danh mục</th>
                  <th className={`${tablePadding} text-right`}>Giá bán</th>
                  <th className={`${tablePadding} text-center`}>SL</th>
                  <th className={`${tablePadding} hidden sm:table-cell text-center`}>Trạng thái</th>
                  <th className={`${tablePadding} text-right`}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {products === null && (
                  <tr>
                    <td className={tablePadding} colSpan={7}>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu...</div>
                    </td>
                  </tr>
                )}
                {products !== null && filteredProducts.length === 0 && (
                  <tr>
                    <td className={tablePadding} colSpan={7}>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Không có dữ liệu.</div>
                    </td>
                  </tr>
                )}
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    onClick={() => setSelectedProduct(product)}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${product.archived ? 'opacity-60' : ''}`}
                  >
                    <td className={tablePadding}>
                      <div className="flex items-center gap-2.5">
                        <img src={product.image} alt={product.name} className={`${imgSize} rounded-md object-cover bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex-shrink-0`} />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate max-w-[140px] sm:max-w-xs">{product.name}</p>
                          <p className="text-[10px] text-slate-400 sm:hidden font-mono mt-0.5">{product.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className={`${tablePadding} hidden sm:table-cell text-slate-600 dark:text-slate-400 font-mono text-[10px] lg:text-[11px]`}>{product.sku}</td>
                    <td className={`${tablePadding} hidden md:table-cell text-slate-600 dark:text-slate-400`}>{product.category}</td>
                    <td className={`${tablePadding} text-right font-bold text-slate-900 dark:text-slate-200 whitespace-nowrap tabular-nums`}>{formatCurrency(product.price)}</td>
                    <td className={`${tablePadding} text-center`}>
                      <span className={`font-bold tabular-nums ${product.stock < 10 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                        {product.stock}
                      </span>
                    </td>
                    <td className={`${tablePadding} hidden sm:table-cell text-center`}>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ring-1 ring-inset ${getStatusColor(product.status)}`}>
                        {product.status === 'Low Stock' && <AlertCircle className="w-2.5 h-2.5 mr-1" />}
                        {product.status}
                      </span>
                      {product.archived && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ring-1 ring-inset bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-300/50 dark:ring-slate-700/60">
                          Đã ẩn
                        </span>
                      )}
                    </td>
                    <td className={`${tablePadding} text-right`}>
                      <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        title="Chi tiết sản phẩm"
      >
        {selectedProduct && (
          <div className="space-y-5">
            <div className="flex gap-3 items-start">
              <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
                <img src={selectedProduct.image} alt={selectedProduct.name} className="w-full h-full object-cover" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">{selectedProduct.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{selectedProduct.sku}</p>
                <div className="mt-1.5">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ring-1 ring-inset ${getStatusColor(selectedProduct.status)}`}>
                    {selectedProduct.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Giá bán</p>
                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{formatCurrency(selectedProduct.price)}</p>
              </div>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Tồn kho</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{selectedProduct.stock}</p>
              </div>
            </div>

            <div className="pt-1">
              <h4 className="font-bold text-slate-900 dark:text-white mb-2 text-xs">Lịch sử kho</h4>
              <div className="space-y-0 relative border-l border-slate-200 dark:border-slate-700 ml-1.5">
                {movements.length === 0 && (
                  <div className="ml-3.5 text-[11px] text-slate-500 dark:text-slate-400">Chưa có lịch sử.</div>
                )}
                {movements.map((m) => (
                  <div key={m.id} className="mb-3 ml-3.5">
                    <div className="absolute w-1.5 h-1.5 bg-slate-300 rounded-full -left-[3.5px] mt-1.5"></div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-700 dark:text-slate-300 font-medium truncate pr-3">
                        {m.movement_type}{m.notes ? ` (${m.notes})` : ''}
                      </span>
                      <span className={`${m.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'} font-bold tabular-nums whitespace-nowrap`}>{m.quantity >= 0 ? `+${m.quantity}` : `${m.quantity}`}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{new Date(m.created_at).toLocaleString('vi-VN')}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 mt-auto">
              <button
                onClick={() => {
                  setFormError(null);
                  setIsAdjustOpen(true);
                }}
                disabled={!can('inventory.stock.adjust')}
                className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Boxes className="w-4 h-4" />
                Điều chỉnh
              </button>
              <button
                onClick={() => {
                  setFormError(null);
                  setIsEditOpen(true);
                }}
                disabled={!can('inventory.product.update')}
                className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                Sửa
              </button>
            </div>

            <button
              onClick={async () => {
                setFormError(null);
                if (!selectedProduct.archived) {
                  const ok = window.confirm(`Xóa sản phẩm sẽ chuyển sang trạng thái ẩn (không mất dữ liệu).\n\nXác nhận ẩn: ${selectedProduct.sku} - ${selectedProduct.name}?`);
                  if (!ok) return;
                  setFormBusy(true);
                  try {
                    const res = await archiveInventoryProduct(selectedProduct.id);
                    if (!res.data) {
                      setFormError(res.error ?? 'Không xóa được.');
                      return;
                    }
                    await reload();
                    setSelectedProduct(null);
                  } finally {
                    setFormBusy(false);
                  }
                  return;
                }

                setFormBusy(true);
                try {
                  const res = await restoreInventoryProduct(selectedProduct.id);
                  if (!res.data) {
                    setFormError(res.error ?? 'Không khôi phục được.');
                    return;
                  }
                  await reload();
                  setSelectedProduct(null);
                } finally {
                  setFormBusy(false);
                }
              }}
              disabled={formBusy}
              className={`w-full py-2 rounded-lg text-xs font-bold transition-colors border ${selectedProduct.archived ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100/60 dark:hover:bg-rose-900/30'} `}
            >
              {selectedProduct.archived ? 'Khôi phục sản phẩm' : 'Xóa sản phẩm'}
            </button>

            <button
              onClick={async () => {
                setFormError(null);
                if (!selectedProduct.archived) {
                  setFormError('Vui lòng xóa (ẩn) sản phẩm trước khi xóa vĩnh viễn.');
                  return;
                }
                const ok = window.confirm(
                  `XÓA VĨNH VIỄN sẽ mất dữ liệu và không thể khôi phục.\n\nNếu sản phẩm đã phát sinh đơn hàng, hệ thống sẽ chặn.\n\nXác nhận xóa vĩnh viễn: ${selectedProduct.sku} - ${selectedProduct.name}?`
                );
                if (!ok) return;
                setFormBusy(true);
                try {
                  const res = await deleteInventoryProductPermanently(selectedProduct.id);
                  if (!res.data) {
                    setFormError(res.error ?? 'Không xóa vĩnh viễn được.');
                    return;
                  }
                  await reload();
                  setSelectedProduct(null);
                } finally {
                  setFormBusy(false);
                }
              }}
              disabled={formBusy || !can('inventory.product.delete.hard')}
              className="w-full py-2 rounded-lg text-xs font-bold transition-colors border bg-white dark:bg-slate-900 border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
            >
              Xóa vĩnh viễn
            </button>
          </div>
        )}
      </Drawer>

      <Drawer
        isOpen={isCreateOpen}
        onClose={() => {
          if (formBusy) return;
          setIsCreateOpen(false);
        }}
        title="Thêm sản phẩm"
      >
        <InventoryProductForm
          mode="create"
          categories={categories}
          units={units}
          busy={formBusy}
          error={formError}
          submitLabel="Tạo sản phẩm"
          initial={{
            sku: '',
            barcode: '',
            name: '',
            categoryId: '',
            unitId: '',
            costPrice: '0',
            sellingPrice: '',
            minStockLevel: '0',
            imageUrl: '',
            initialQuantity: '0',
            type: 'product',
          }}
          onSubmit={async (value) => {
            setFormError(null);
            if (!value.sku || !value.name) {
              setFormError('Vui lòng nhập SKU và tên sản phẩm.');
              return;
            }

            const skuDup = (products ?? []).some((p) => p.sku.toLowerCase() === value.sku.toLowerCase());
            if (skuDup) {
              setFormError('SKU đã tồn tại. Vui lòng chọn SKU khác.');
              return;
            }
            const price = Number.parseFloat(value.sellingPrice || '0');
            const cost = Number.parseFloat(value.costPrice || '0');
            const minStock = Number.parseFloat(value.minStockLevel || '0');
            const initialQty = Number.parseFloat(value.initialQuantity || '0');

            if (!Number.isFinite(price) || price < 0) {
              setFormError('Giá bán không hợp lệ.');
              return;
            }
            if (!Number.isFinite(minStock) || minStock < 0) {
              setFormError('Tồn tối thiểu không hợp lệ.');
              return;
            }
            if (!Number.isFinite(initialQty)) {
              setFormError('Tồn ban đầu không hợp lệ.');
              return;
            }

            setFormBusy(true);
            try {
              const created = await createInventoryProduct({
                sku: value.sku,
                barcode: value.barcode || null,
                name: value.name,
                category_id: value.categoryId || null,
                unit_id: value.unitId || null,
                cost_price: cost,
                selling_price: price,
                min_stock_level: minStock,
                image_url: value.imageUrl || null,
                type: value.type,
              });
              if (!created || created.error || !created.data?.id) {
                setFormError(created?.error ?? 'Không tạo được sản phẩm.');
                return;
              }

              const productId = created.data.id;

              if (initialQty !== 0) {
                let warehouseId = warehouses[0]?.id;
                if (!warehouseId) {
                  warehouseId = await ensureDefaultWarehouse();
                }
                if (warehouseId) {
                  const moved = await applyStockMovement({
                    productId,
                    warehouseId,
                    movementType: 'adjustment',
                    quantity: initialQty,
                    notes: 'Tồn ban đầu',
                  });
                  if (!moved.data) {
                    setFormError(moved.error ?? 'Không cập nhật tồn ban đầu.');
                    return;
                  }
                }
              }

              await reload();
              setIsCreateOpen(false);
            } finally {
              setFormBusy(false);
            }
          }}
        />
      </Drawer>

      <Drawer
        isOpen={isEditOpen}
        onClose={() => {
          if (formBusy) return;
          setIsEditOpen(false);
        }}
        title="Sửa sản phẩm"
      >
        {selectedProduct && (
          <InventoryProductForm
            mode="edit"
            categories={categories}
            units={units}
            busy={formBusy}
            error={formError}
            submitLabel="Lưu thay đổi"
            initial={{
              sku: selectedProduct.sku,
              barcode: selectedProduct.barcode ?? '',
              name: selectedProduct.name,
              categoryId: categoryIdByName.get(selectedProduct.category) ?? '',
              unitId: selectedProduct.unitId ?? '',
              costPrice: selectedProduct.costPrice ? String(selectedProduct.costPrice) : '0',
              sellingPrice: String(selectedProduct.price),
              minStockLevel: '',
              imageUrl: selectedProduct.image,
              type: (selectedProduct.type as any) ?? 'product',
            }}
            onSubmit={async (value) => {
              setFormError(null);
              if (!value.sku || !value.name) {
                setFormError('Vui lòng nhập SKU và tên sản phẩm.');
                return;
              }
              const price = Number.parseFloat(value.sellingPrice || '0');
              const cost = Number.parseFloat(value.costPrice || '0');
              const minStock = Number.parseFloat(value.minStockLevel || '0');
              if (!Number.isFinite(price) || price < 0) {
                setFormError('Giá bán không hợp lệ.');
                return;
              }
              if (!Number.isFinite(minStock) || minStock < 0) {
                setFormError('Tồn tối thiểu không hợp lệ.');
                return;
              }

              setFormBusy(true);
              try {
                const saved = await updateInventoryProduct(selectedProduct.id, {
                  sku: value.sku,
                  barcode: value.barcode || null,
                  name: value.name,
                  category_id: value.categoryId || null,
                  unit_id: value.unitId || null,
                  cost_price: cost,
                  selling_price: price,
                  min_stock_level: minStock,
                  image_url: value.imageUrl || null,
                  type: value.type,
                });
                if (!saved.data) {
                  setFormError(saved.error ?? 'Không lưu được.');
                  return;
                }
                await reload();
                setIsEditOpen(false);
              } finally {
                setFormBusy(false);
              }
            }}
          />
        )}
      </Drawer>

      <Drawer
        isOpen={isAdjustOpen}
        onClose={() => {
          if (formBusy) return;
          setIsAdjustOpen(false);
        }}
        title="Điều chỉnh tồn"
      >
        {selectedProduct && (
          <InventoryAdjustStock
            warehouses={warehouses}
            busy={formBusy}
            error={formError}
            onSubmit={async ({ warehouseId, quantityDelta, notes }) => {
              setFormError(null);
              if (!warehouseId) {
                setFormError('Chưa có kho.');
                return;
              }
              if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
                setFormError('Số lượng phải khác 0.');
                return;
              }
              setFormBusy(true);
              try {
                const moved = await applyStockMovement({
                  productId: selectedProduct.id,
                  warehouseId,
                  movementType: 'adjustment',
                  quantity: quantityDelta,
                  notes: notes || 'Điều chỉnh',
                });
                if (!moved.data) {
                  setFormError(moved.error ?? 'Không điều chỉnh được.');
                  return;
                }
                await reload();
                const m = await fetchInventoryMovements(selectedProduct.id);
                setMovements(m);
                setIsAdjustOpen(false);
              } finally {
                setFormBusy(false);
              }
            }}
          />
        )}
      </Drawer>
    </div>
  );
};

export default Inventory;
