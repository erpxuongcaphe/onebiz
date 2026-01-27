import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Filter, Loader2, Minus, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { formatCurrency } from '../constants';
import { useAuth } from '../lib/auth';
import { fetchBranches, fetchCurrentBranchId } from '../lib/branches';
import { fetchInventoryWarehouses } from '../lib/inventory';
import { createPosSale, fetchCatalogForWarehouse, fetchOpenShift, openShift, type PosCatalogItem } from '../lib/pos';

type TimePreset = 'today' | 'month' | 'year' | 'range' | 'all';

type CartLine = {
  item: PosCatalogItem;
  qty: number;
};

const POS: React.FC = () => {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [timePreset, setTimePreset] = useState<TimePreset>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState('');
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; branch_id?: string | null }>>([]);
  const [warehouseId, setWarehouseId] = useState('');

  const [catalog, setCatalog] = useState<PosCatalogItem[] | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'card' | 'momo' | 'zalopay' | 'other'>('cash');

  useEffect(() => {
    if (timePreset === 'range') return;
    if (timePreset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    if (timePreset === 'today') {
      const iso = `${yyyy}-${mm}-${dd}`;
      setFromDate(iso);
      setToDate(iso);
      return;
    }
    if (timePreset === 'month') {
      setFromDate(`${yyyy}-${mm}-01`);
      setToDate(`${yyyy}-${mm}-${dd}`);
      return;
    }
    if (timePreset === 'year') {
      setFromDate(`${yyyy}-01-01`);
      setToDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [timePreset]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const [b, current, w] = await Promise.all([
        fetchBranches(),
        fetchCurrentBranchId(),
        fetchInventoryWarehouses(),
      ]);
      if (!isMounted) return;
      setBranches(b.map((x) => ({ id: x.id, name: x.name })));
      setWarehouses(w);
      setBranchId(current ?? b[0]?.id ?? '');
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!branchId) return;
    const firstWh = warehouses.find((w) => (w.branch_id ?? null) === branchId) ?? warehouses[0];
    if (firstWh && !warehouseId) setWarehouseId(firstWh.id);
  }, [branchId, warehouses, warehouseId]);

  useEffect(() => {
    if (!branchId) return;
    setError(null);
    void fetchOpenShift(branchId).then((s) => setShiftId(s?.id ?? null));
  }, [branchId]);

  useEffect(() => {
    let isMounted = true;
    if (!warehouseId) {
      setCatalog([]);
      return;
    }
    setCatalog(null);
    fetchCatalogForWarehouse({ warehouseId, search, category })
      .then((data) => {
        if (!isMounted) return;
        setCatalog(data);
      });
    return () => {
      isMounted = false;
    };
  }, [warehouseId, search, category]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of catalog ?? []) set.add(i.category);
    return Array.from(set);
  }, [catalog]);

  const total = useMemo(() => {
    return cart.reduce((acc, l) => acc + l.qty * l.item.price, 0);
  }, [cart]);

  const addToCart = (item: PosCatalogItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.item.product_id === item.product_id);
      if (idx === -1) return [...prev, { item, qty: 1 }];
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      return next;
    });
  };

  const setQty = (productId: string, qty: number) => {
    setCart((prev) => {
      const next = prev
        .map((l) => (l.item.product_id === productId ? { ...l, qty } : l))
        .filter((l) => l.qty > 0);
      return next;
    });
  };

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Bán hàng POS</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Bán nhanh tại quầy, sẵn sàng cho nhiều chi nhánh.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900">
            <Calendar className="w-3.5 h-3.5" />
            Ca hôm nay
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900">
            <Filter className="w-3.5 h-3.5" />
            Bộ lọc
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-2">
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          disabled={!can('branch.read_all')}
          className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
        >
          {warehouses
            .filter((w) => !branchId || (w.branch_id ?? null) === branchId)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </select>

        <button
          disabled={!can('pos.shift.open') || busy}
          onClick={async () => {
            setError(null);
            if (shiftId) return;
            setBusy(true);
            try {
              const id = await openShift({ branchId, openingCash: 0 });
              if (!id) {
                setError('Không mở ca được (kiểm tra quyền).');
                return;
              }
              setShiftId(id);
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
        >
          {shiftId ? 'Ca đang mở' : 'Mở ca'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Catalog */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2 justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all placeholder:text-slate-400"
                placeholder="Tìm SKU, tên sản phẩm..."
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar">
              <select
                value={timePreset}
                onChange={(e) => setTimePreset(e.target.value as TimePreset)}
                className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              >
                <option value="today">Hôm nay</option>
                <option value="month">Tháng này</option>
                <option value="year">Năm nay</option>
                <option value="range">Khoảng</option>
                <option value="all">Tất cả</option>
              </select>
              {timePreset === 'range' && (
                <>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
                  />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
                  />
                </>
              )}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              >
                <option value="">Tất cả danh mục</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-2 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {catalog === null && (
              <div className="col-span-2 sm:col-span-3 xl:col-span-4 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang tải sản phẩm...
              </div>
            )}
            {(catalog ?? []).map((i) => (
              <button
                key={i.product_id}
                onClick={() => addToCart(i)}
                className="text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{i.sku}</div>
                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 mt-0.5 line-clamp-2">{i.name}</div>
                <div className="mt-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{formatCurrency(i.price)}</div>
                <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{i.category} • SL: {i.stock}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Cart */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-slate-400" />
              <div className="text-[11px] font-bold text-slate-900 dark:text-white">Giỏ hàng</div>
            </div>
            <button
              onClick={() => setCart([])}
              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
              title="Xóa giỏ"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="p-2 space-y-2 flex-1 overflow-y-auto custom-scrollbar">
            {cart.length === 0 && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Chưa có sản phẩm. Click bên trái để thêm.</div>
            )}
            {cart.map((l) => (
              <div key={l.item.product_id} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 truncate">{l.item.name}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{l.item.sku}</div>
                  </div>
                  <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 tabular-nums whitespace-nowrap">
                    {formatCurrency(l.item.price * l.qty)}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{formatCurrency(l.item.price)} / sp</div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQty(l.item.product_id, l.qty - 1)}
                      className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex items-center justify-center"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div className="w-10 text-center text-[11px] font-bold tabular-nums">{l.qty}</div>
                    <button
                      onClick={() => setQty(l.item.product_id, l.qty + 1)}
                      className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex items-center justify-center"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Tổng</div>
              <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{formatCurrency(total)}</div>
            </div>
            <div className="mt-2 flex gap-2">
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
              >
                <option value="cash">Tiền mặt</option>
                <option value="bank_transfer">Chuyển khoản</option>
                <option value="card">Thẻ</option>
                <option value="momo">MoMo</option>
                <option value="zalopay">ZaloPay</option>
                <option value="other">Khác</option>
              </select>
            </div>
            <button
              disabled={cart.length === 0 || busy || !can('pos.order.create') || !can('pos.payment.record') || !shiftId}
              className="mt-2 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors"
              onClick={async () => {
                setError(null);
                if (!shiftId) {
                  setError('Chưa mở ca.');
                  return;
                }
                if (!warehouseId) {
                  setError('Chưa chọn kho.');
                  return;
                }
                setBusy(true);
                try {
                  const orderId = await createPosSale({
                    branchId,
                    warehouseId,
                    shiftId,
                    lines: cart.map((l) => ({
                      product_id: l.item.product_id,
                      quantity: l.qty,
                      unit_price: l.item.price,
                    })),
                    paymentMethod,
                    paymentAmount: total,
                  });
                  if (!orderId) {
                    setError('Không thanh toán được (kiểm tra quyền/tồn kho).');
                    return;
                  }
                  setCart([]);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Đang xử lý...' : 'Thanh toán'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default POS;
