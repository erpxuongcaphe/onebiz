import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Filter, Loader2, Minus, Plus, Search, ShoppingCart, Trash2, WifiOff, Wifi } from 'lucide-react';
import { formatCurrency } from '../constants';
import { useAuth } from '../lib/auth';
import { fetchBranches, fetchCurrentBranchId } from '../lib/branches';
import { fetchInventoryWarehouses } from '../lib/inventory';
import { createPosSale, fetchCatalogForWarehouse, fetchOpenShift, openShift, fetchPosReceipt, createInvoiceFromOrderHelper, type PosCatalogItem } from '../lib/pos';
import { CloseShiftModal } from './pos/CloseShiftModal';
import { OrderSearchModal } from './pos/OrderSearchModal';
import { OpenShiftModal } from './pos/OpenShiftModal';
import { ensureDefaultTemplates, fetchDocumentTemplates, getActiveTemplate, type DocumentTemplate, type PaperSize } from '../lib/documentTemplates';
import { renderDocumentHtml, openPrintWindow, downloadPdf, exportToExcel } from '../lib/documentPrint';
import { buildPaymentSlipPayload, buildPosInvoicePayload } from '../lib/documentPayloads';
import { createDocumentPrint } from '../lib/documentPrintStore';
import { createCustomer, fetchCustomers, getWalkInCustomer, type CustomerRow } from '../lib/sales';
import { fetchSalesOrders, type SalesOrder } from '../lib/salesOrders';
import { useOnlineStatus } from '../lib/networkStatus';
import { saveOfflineOrder, cacheProducts, getCachedProducts, getPendingOrders, markOrderSynced } from '../lib/offlineDB';

type TimePreset = 'today' | 'month' | 'year' | 'range' | 'all';

type CartLine = {
  item: PosCatalogItem;
  qty: number;
};

type SaleMode = 'pos' | 'pick';

const POS: React.FC = () => {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [timePreset, setTimePreset] = useState<TimePreset>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleMode, setSaleMode] = useState<SaleMode>('pos');

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState('');
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; branch_id?: string | null }>>([]);
  const [warehouseId, setWarehouseId] = useState('');

  const [catalog, setCatalog] = useState<PosCatalogItem[] | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'card' | 'momo' | 'zalopay' | 'other'>('cash');
  const [dueDate, setDueDate] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [pickList, setPickList] = useState<SalesOrder[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [invoicePaperSize, setInvoicePaperSize] = useState<PaperSize>('A5');
  const [slipPaperSize, setSlipPaperSize] = useState<PaperSize>('80mm');
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

  // Offline POS states
  const isOnline = useOnlineStatus();
  const [offlineMode, setOfflineMode] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);

  // Modal states
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [showOrderSearchModal, setShowOrderSearchModal] = useState(false);
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);

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

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

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
    let isMounted = true;
    const loadTemplates = async () => {
      await ensureDefaultTemplates();
      const list = await fetchDocumentTemplates();
      if (isMounted) setTemplates(list);
    };
    void loadTemplates();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadCustomers = async () => {
      const list = await fetchCustomers();
      const walkin = await getWalkInCustomer();
      const merged = walkin ? [walkin, ...list.filter((c) => c.id !== walkin.id)] : list;
      if (!isMounted) return;
      setCustomers(merged);
      if (walkin && !selectedCustomerId) setSelectedCustomerId(walkin.id);
      if (!walkin && list[0] && !selectedCustomerId) setSelectedCustomerId(list[0].id);
    };
    void loadCustomers();
    return () => {
      isMounted = false;
    };
  }, [selectedCustomerId]);

  useEffect(() => {
    if (saleMode !== 'pick') return;
    let isMounted = true;
    const loadPickList = async () => {
      // Fetch orders with status 'waiting_pick' (or 'confirmed' if waiting_pick is not used yet)
      // Assuming 'confirmed' orders are ready to be picked/processed in POS for now if strict workflow not set
      // Or if the plan is strictly 'waiting_pick', use that. Let's use 'confirmed' as it's the standard "new order" status.
      // Wait, standard workflow: Draft -> Confirmed -> Picking?
      // Let's assume 'confirmed' orders appear here to be processed.
      const rows = await fetchSalesOrders({ status: 'confirmed' });
      if (isMounted) setPickList(rows);
    };
    void loadPickList();
    return () => {
      isMounted = false;
    };
  }, [saleMode]);

  const printPosDocument = async (mode: 'print' | 'pdf' | 'excel', docType: 'invoice' | 'payment_slip') => {
    if (!lastOrderId) return;
    setPrintBusy(true);
    try {
      const receipt = await fetchPosReceipt(lastOrderId);
      if (!receipt) {
        setError('Không lấy được dữ liệu hóa đơn.');
        return;
      }
      const templateType = docType === 'invoice' ? 'invoice_sale' : 'payment_slip';
      const size = docType === 'invoice' ? invoicePaperSize : slipPaperSize;
      const template = getActiveTemplate(templates, templateType, size);
      if (!template) {
        setError('Chưa có mẫu chứng từ phù hợp. Vui lòng tạo trong Cài đặt.');
        return;
      }

      const company = {
        name: template.settings.company_name,
        tax_code: template.settings.company_tax_code,
        address: template.settings.company_address,
        phone: template.settings.company_phone,
        logo_url: template.settings.logo_url ?? null,
      };

      const payload = docType === 'invoice'
        ? buildPosInvoicePayload(receipt, company)
        : buildPaymentSlipPayload(receipt, company);

      const html = renderDocumentHtml(payload, {
        paperSize: template.paper_size,
        layout: template.layout,
        settings: template.settings,
      });

      if (mode === 'excel') {
        await exportToExcel(payload, `${payload.doc_no}.xlsx`);
        return;
      }

      if (mode === 'pdf') {
        await downloadPdf(html, `${payload.doc_no}.pdf`, template.paper_size);
        return;
      }

      openPrintWindow(html, payload.doc_no);
      if (docType === 'payment_slip') {
        await createDocumentPrint({
          template_id: template.id,
          template_type: template.template_type,
          paper_size: template.paper_size,
          source_type: 'pos_payment',
          source_id: lastOrderId,
          payload,
        });
      }
    } finally {
      setPrintBusy(false);
    }
  };

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

  // Cache products when online and load from cache when offline
  useEffect(() => {
    let isMounted = true;
    if (!warehouseId) {
      setCatalog([]);
      return;
    }

    if (isOnline) {
      // Online: Fetch from server and cache
      setCatalog(null);
      fetchCatalogForWarehouse({ warehouseId, search: debouncedSearch, category })
        .then(async (data) => {
          if (!isMounted) return;
          setCatalog(data);

          // Cache products to IndexedDB for offline use
          if (data && data.length > 0) {
            try {
              await cacheProducts(data.map(item => ({
                id: item.product_id,
                name: item.name,
                price: item.price,
                stock: item.stock,
                category: item.category,
                image_url: item.image_url || null,
                cached_at: new Date().toISOString()
              })));
            } catch (err) {
              console.error('Failed to cache products:', err);
            }
          }
        });
    } else {
      // Offline: Load from cache
      setOfflineMode(true);
      getCachedProducts().then((cached) => {
        if (!isMounted) return;
        // Convert cached products back to PosCatalogItem format
        setCatalog(cached.map(p => ({
          product_id: p.id,
          name: p.name,
          price: p.price,
          stock: p.stock,
          category: p.category,
          image_url: p.image_url,
          variant_id: null,
          variant_name: null,
          sku: ''
        })));
      });
    }

    return () => {
      isMounted = false;
    };
  }, [warehouseId, debouncedSearch, category, isOnline]);

  // Auto-refresh catalog after successful sale to update stock
  useEffect(() => {
    if (lastOrderId && warehouseId && isOnline) {
      const timer = setTimeout(() => {
        fetchCatalogForWarehouse({ warehouseId, search: debouncedSearch, category })
          .then(data => {
            if (data) setCatalog(data);
          })
          .catch(err => {
            console.error('Failed to refresh catalog:', err);
          });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [lastOrderId, warehouseId, isOnline, debouncedSearch, category]);

  // Track online/offline status
  useEffect(() => {
    if (isOnline) {
      setOfflineMode(false);
    } else {
      setOfflineMode(true);
    }
  }, [isOnline]);

  // Load pending orders count on mount
  useEffect(() => {
    getPendingOrders().then((pending) => {
      setPendingOrdersCount(pending.length);
    });
  }, []);

  // Sync pending orders when back online
  useEffect(() => {
    if (isOnline && pendingOrdersCount > 0) {
      syncPendingOrders();
    }
  }, [isOnline]);

  async function syncPendingOrders() {
    const pending = await getPendingOrders();
    let synced = 0;

    for (const order of pending) {
      try {
        // Create sale online
        await createPosSale({
          branchId: branchId,
          warehouseId: warehouseId,
          shiftId: shiftId || '',
          customerId: order.customer_id || '',
          lines: order.cart.map(item => ({
            product_id: item.item.product_id,
            quantity: item.qty,
            unit_price: item.item.price
          })),
          paymentMethod: order.payment_method as any
        });

        // Mark as synced
        await markOrderSynced(order.id);
        synced++;
      } catch (err) {
        console.error('Sync failed for order:', order.id, err);
      }
    }

    if (synced > 0) {
      alert(`✅ Đã đồng bộ ${synced}/${pending.length} đơn hàng offline`);
    }

    // Refresh count
    const remaining = await getPendingOrders();
    setPendingOrdersCount(remaining.length);
  }

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
          {shiftId ? (
            <>
              <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Ca đang mở</span>
              </span>
              <button
                onClick={() => setShowCloseShiftModal(true)}
                disabled={!can('pos.shift.update')}
                className="flex items-center gap-2 px-3 py-1.5 border border-amber-500 dark:border-amber-600 rounded-lg text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Calendar className="w-3.5 h-3.5" />
                Đóng Ca
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowOpenShiftModal(true)}
              disabled={!can('pos.shift.open')}
              className="flex items-center gap-2 px-3 py-1.5 border border-emerald-500 dark:border-emerald-600 rounded-lg text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Calendar className="w-3.5 h-3.5" />
              Mở Ca
            </button>
          )}
          <button
            onClick={() => setShowOrderSearchModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Search className="w-3.5 h-3.5" />
            Tra Cứu Đơn
          </button>
        </div>
      </div>

      {/* Offline Mode Indicator */}
      {offlineMode && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-2.5 flex items-center gap-2">
          <WifiOff className="w-4 h-4" />
          <span>
            ⚠️ Chế độ Offline - Đơn hàng sẽ được đồng bộ khi có mạng{' '}
            {pendingOrdersCount > 0 && (
              <strong className="text-amber-900 dark:text-amber-300">
                ({pendingOrdersCount} đơn chờ sync)
              </strong>
            )}
          </span>
        </div>
      )}

      {/* Online Sync Success */}
      {isOnline && !offlineMode && pendingOrdersCount > 0 && (
        <div className="text-[11px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-lg p-2.5 flex items-center gap-2">
          <Wifi className="w-4 h-4" />
          <span>
            ✅ Đã kết nối - Đang đồng bộ {pendingOrdersCount} đơn hàng...
          </span>
        </div>
      )}

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

        {/* Shift open/close managed from header buttons above */}
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: 'pos', label: 'Bán trực tiếp' },
          { key: 'pick', label: 'Kho chuẩn bị' },
        ] as const).map((m) => (
          <button
            key={m.key}
            onClick={() => setSaleMode(m.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${saleMode === m.key
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {saleMode !== 'pick' && (
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
                  onClick={() => {
                    // Check stock availability before adding
                    if (i.stock === 0) {
                      alert('Sản phẩm đã hết hàng');
                      return;
                    }

                    const currentQty = cart.find(l => l.item.product_id === i.product_id)?.qty || 0;
                    if (currentQty + 1 > i.stock) {
                      alert(`Chỉ còn ${i.stock} sản phẩm trong kho`);
                      return;
                    }

                    addToCart(i);
                  }}
                  disabled={i.stock === 0}
                  className={`relative text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors ${
                    i.stock === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {/* Stock Badge */}
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-white/90 dark:bg-slate-800/90 rounded text-[10px] font-semibold">
                    {i.stock > 0 ? (
                      <span className={i.stock < 5 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                        Còn: {i.stock}
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Hết hàng</span>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{i.sku}</div>
                  <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 mt-0.5 line-clamp-2 pr-16">{i.name}</div>
                  <div className="mt-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{formatCurrency(i.price)}</div>
                  <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{i.category}</div>

                  {/* Out of stock overlay */}
                  {i.stock === 0 && (
                    <div className="absolute inset-0 bg-gray-900/50 dark:bg-gray-900/70 flex items-center justify-center rounded-lg">
                      <span className="text-white font-bold text-xs">HẾT HÀNG</span>
                    </div>
                  )}
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
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-2">
                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Khách hàng</div>
                <div className="mt-1 grid grid-cols-1 gap-2">
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={quickCustomerName}
                      onChange={(e) => setQuickCustomerName(e.target.value)}
                      placeholder="Tạo nhanh tên khách"
                      className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                    />
                    <input
                      value={quickCustomerPhone}
                      onChange={(e) => setQuickCustomerPhone(e.target.value)}
                      placeholder="SĐT (không bắt buộc)"
                      className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                    />
                  </div>
                  <button
                    disabled={savingCustomer || quickCustomerName.trim().length === 0}
                    onClick={async () => {
                      setSavingCustomer(true);
                      try {
                        const created = await createCustomer({
                          name: quickCustomerName.trim(),
                          phone: quickCustomerPhone.trim() || undefined,
                        });
                        if (!created) {
                          setError('Không tạo được khách hàng.');
                          return;
                        }
                        setCustomers((prev) => [created, ...prev]);
                        setSelectedCustomerId(created.id);
                        setQuickCustomerName('');
                        setQuickCustomerPhone('');
                      } finally {
                        setSavingCustomer(false);
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-bold"
                  >
                    {savingCustomer ? 'Đang tạo...' : 'Tạo nhanh khách'}
                  </button>
                </div>
              </div>
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
                {saleMode === 'pos' && (
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
                )}
              </div>
              <button
                disabled={cart.length === 0 || busy || !selectedCustomerId || !can('pos.order.create') || (saleMode === 'pos' && (!can('pos.payment.record') || !shiftId))}
                className="mt-2 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors"
                onClick={async () => {
                  setError(null);
                  if (!warehouseId) {
                    setError('Chưa chọn kho.');
                    return;
                  }
                  if (!selectedCustomerId) {
                    setError('Vui lòng chọn khách hàng.');
                    return;
                  }
                  if (saleMode === 'pos' && !shiftId) {
                    setError('Chưa mở ca.');
                    return;
                  }

                  // ========== OFFLINE MODE: Save to IndexedDB ==========
                  if (!isOnline) {
                    try {
                      const customerName = customers.find(c => c.id === selectedCustomerId)?.name || 'Khách vãng lai';

                      const offlineOrder = {
                        id: crypto.randomUUID(),
                        cart: cart.map(l => ({
                          item: {
                            product_id: l.item.product_id,
                            name: l.item.name,
                            price: l.item.price,
                            stock: l.item.stock
                          },
                          qty: l.qty
                        })),
                        payment_method: paymentMethod,
                        customer_id: selectedCustomerId,
                        customer_name: customerName,
                        total: total,
                        created_at: new Date().toISOString(),
                        synced: false
                      };

                      await saveOfflineOrder(offlineOrder);
                      setPendingOrdersCount(prev => prev + 1);

                      setCart([]);
                      alert(`✅ Đơn hàng đã lưu offline (${customerName} - ${formatCurrency(total)})\n\nSẽ tự động đồng bộ khi có mạng.`);
                      return;
                    } catch (err) {
                      console.error('Failed to save offline order:', err);
                      setError('Lỗi lưu đơn offline. Vui lòng thử lại.');
                      return;
                    }
                  }

                  // ========== ONLINE MODE: Create sale normally ==========
                  setBusy(true);
                  try {
                    if (saleMode === 'pos') {
                      const orderId = await createPosSale({
                        branchId,
                        warehouseId,
                        shiftId: shiftId ?? '',
                        customerId: selectedCustomerId,
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
                      setLastOrderId(orderId);
                    } else {
                      // Order mode removed
                    }
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
      )}

      {saleMode === 'pick' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200">Kho chuẩn bị (Đơn hàng chờ xử lý)</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Danh sách đơn hàng từ bộ phận kinh doanh</div>
            </div>
            <button
              onClick={async () => {
                const rows = await fetchSalesOrders({ status: 'confirmed' });
                setPickList(rows);
              }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Tải lại
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 text-[10px]">
                <tr>
                  <th className="px-3 py-2">Mã đơn</th>
                  <th className="px-3 py-2">Khách hàng</th>
                  <th className="px-3 py-2">Ngày</th>
                  <th className="px-3 py-2 text-center">SL</th>
                  <th className="px-3 py-2 text-right">Tổng tiền</th>
                  <th className="px-3 py-2 text-center">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pickList.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-[11px] text-slate-500 dark:text-slate-400" colSpan={6}>
                      Chưa có đơn chờ chuẩn bị.
                    </td>
                  </tr>
                )}
                {pickList.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{o.order_number}</td>
                    <td className="px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{o.customer_name}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">{new Date(o.order_date).toLocaleDateString('vi-VN')}</td>
                    <td className="px-3 py-2 text-center text-[11px] text-slate-600 dark:text-slate-300">{/* o.items count not directly available, maybe length? */ (o as any).items?.length ?? 0}</td>
                    <td className="px-3 py-2 text-right text-[11px] font-bold text-slate-900 dark:text-slate-200">{formatCurrency(o.total)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const invoiceId = await createInvoiceFromOrderHelper({ orderId: o.id, shiftId });
                            if (!invoiceId) {
                              setError('Không tạo được hóa đơn. Kiểm tra ca làm việc hoặc trạng thái đơn.');
                              return;
                            }
                            // Refresh list
                            const rows = await fetchSalesOrders({ status: 'confirmed' });
                            setPickList(rows);
                            setLastOrderId(invoiceId); // Switch to print view
                            setSaleMode('pos'); // Return to POS mode to print
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold disabled:opacity-50"
                      >
                        Tạo hóa đơn
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lastOrderId && (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">In chứng từ</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Hóa đơn</div>
              <div className="flex items-center gap-2 mb-2">
                <select
                  value={invoicePaperSize}
                  onChange={(e) => setInvoicePaperSize(e.target.value as PaperSize)}
                  className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                >
                  <option value="A5">A5</option>
                  <option value="A4">A4</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={printBusy}
                  onClick={() => void printPosDocument('print', 'invoice')}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                >
                  In hóa đơn
                </button>
                <button
                  disabled={printBusy}
                  onClick={() => void printPosDocument('pdf', 'invoice')}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                >
                  PDF
                </button>
                <button
                  disabled={printBusy}
                  onClick={() => void printPosDocument('excel', 'invoice')}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                >
                  Excel
                </button>
              </div>
            </div>

            <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Phiếu thanh toán</div>
              <div className="flex items-center gap-2 mb-2">
                <select
                  value={slipPaperSize}
                  onChange={(e) => setSlipPaperSize(e.target.value as PaperSize)}
                  className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                >
                  <option value="80mm">80mm</option>
                  <option value="A5">A5</option>
                  <option value="A4">A4</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={printBusy}
                  onClick={() => void printPosDocument('print', 'payment_slip')}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                >
                  In phiếu
                </button>
                <button
                  disabled={printBusy}
                  onClick={() => void printPosDocument('pdf', 'payment_slip')}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                >
                  PDF
                </button>
                <button
                  disabled={printBusy}
                  onClick={() => void printPosDocument('excel', 'payment_slip')}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                >
                  Excel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Open Shift Modal */}
      {showOpenShiftModal && !shiftId && (
        <OpenShiftModal
          branchId={branchId}
          onClose={() => setShowOpenShiftModal(false)}
          onSuccess={(newShiftId) => {
            setShowOpenShiftModal(false);
            setShiftId(newShiftId);
          }}
        />
      )}

      {/* Close Shift Modal */}
      {showCloseShiftModal && shiftId && (
        <CloseShiftModal
          shiftId={shiftId}
          onClose={() => setShowCloseShiftModal(false)}
          onSuccess={() => {
            setShowCloseShiftModal(false);
            setShiftId(null);
            alert('✅ Đã đóng ca thành công! Vui lòng mở ca mới để tiếp tục.');
          }}
        />
      )}

      {/* Order Search Modal */}
      {showOrderSearchModal && (
        <OrderSearchModal
          branchId={branchId}
          onClose={() => setShowOrderSearchModal(false)}
          onReprint={(orderId) => {
            setLastOrderId(orderId);
            setShowOrderSearchModal(false);
          }}
        />
      )}
    </div>
  );
};

export default POS;
